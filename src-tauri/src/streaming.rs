use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};

// ── RAM-backed streaming buffer ───────────────────────────────────────────────

struct StreamingState {
    buffer: Vec<u8>,
    read_pos: u64,
    finished: bool,
    cancelled: bool,
    // Set by `fail()` when the download ended early. Distinguishes a truncated body from a
    // deliberate cancellation so the reader can report the right error, and so a short stream
    // is never handed to the decoder as a clean EOF.
    failed: bool,
    content_length: Option<u64>,
}

struct StreamingShared {
    state: Mutex<StreamingState>,
    data_available: Condvar,
}

/// Growing byte buffer fed by a background download thread.
/// Implements `Read + Seek + Send` so it passes directly to `rodio::Decoder`
/// while the HTTP body is still arriving. Forward reads block on a Condvar
/// until data arrives. `SeekFrom::End` resolves immediately if Content-Length
/// is known; otherwise it waits until `finish()` is called.
pub struct StreamingBuffer {
    shared: Arc<StreamingShared>,
}

/// Write-side handle owned by the download thread.
pub struct StreamingWriter {
    shared: Arc<StreamingShared>,
}

impl StreamingBuffer {
    pub fn new(content_length: Option<u64>) -> (Self, StreamingWriter) {
        // Pre-allocate to the known size up front so `write_chunk` never triggers
        // reallocation churn as the track downloads.
        let capacity = content_length.map(|len| len as usize).unwrap_or(0);
        let shared = Arc::new(StreamingShared {
            state: Mutex::new(StreamingState {
                buffer: Vec::with_capacity(capacity),
                read_pos: 0,
                finished: false,
                cancelled: false,
                failed: false,
                content_length,
            }),
            data_available: Condvar::new(),
        });
        (
            StreamingBuffer {
                shared: shared.clone(),
            },
            StreamingWriter { shared },
        )
    }
}

impl Drop for StreamingBuffer {
    fn drop(&mut self) {
        // Signal the download thread to abort when the decoder is dropped
        // (e.g. because audio_play was superseded by a newer play command).
        let mut state = self.shared.state.lock().unwrap();
        state.cancelled = true;
        self.shared.data_available.notify_all();
    }
}

impl StreamingWriter {
    /// Append a chunk. Returns `false` if the reader was dropped — the download
    /// thread should stop and exit when this happens.
    pub fn write_chunk(&self, data: &[u8]) -> bool {
        let mut state = self.shared.state.lock().unwrap();
        if state.cancelled {
            return false;
        }
        state.buffer.extend_from_slice(data);
        self.shared.data_available.notify_all();
        true
    }

    pub fn finish(&self) {
        let mut state = self.shared.state.lock().unwrap();
        state.finished = true;
        self.shared.data_available.notify_all();
    }

    /// End the stream as a failure rather than a completion. The reader gets an error instead
    /// of EOF, so a truncated download cannot be mistaken for a track that played to its end.
    pub fn fail(&self) {
        let mut state = self.shared.state.lock().unwrap();
        state.failed = true;
        state.cancelled = true;
        self.shared.data_available.notify_all();
    }
}

impl Read for StreamingBuffer {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let mut state = self.shared.state.lock().unwrap();
        loop {
            // A failed stream still serves whatever arrived before the connection died, so the
            // user hears the part of the track that was actually downloaded, and only then errors.
            if state.cancelled && !state.failed {
                return Err(io::Error::new(
                    io::ErrorKind::Interrupted,
                    "playback superseded",
                ));
            }
            let buffered = state.buffer.len() as u64;
            if state.read_pos < buffered {
                let start = state.read_pos as usize;
                let avail = (buffered - state.read_pos) as usize;
                let n = avail.min(buf.len());
                buf[..n].copy_from_slice(&state.buffer[start..start + n]);
                state.read_pos += n as u64;
                return Ok(n);
            }
            if state.failed {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "stream truncated",
                ));
            }
            if state.finished {
                return Ok(0); // EOF
            }
            state = self.shared.data_available.wait(state).unwrap();
        }
    }
}

impl Seek for StreamingBuffer {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let mut state = self.shared.state.lock().unwrap();
        let new_pos = match pos {
            SeekFrom::Start(n) => n,
            SeekFrom::Current(n) => (state.read_pos as i64 + n).max(0) as u64,
            SeekFrom::End(n) => {
                // Use Content-Length if download isn't done yet; block until done if unknown.
                let total = if state.finished {
                    state.buffer.len() as u64
                } else if let Some(len) = state.content_length {
                    len
                } else {
                    // No Content-Length and still downloading: block until finish().
                    loop {
                        state = self.shared.data_available.wait(state).unwrap();
                        if state.finished || state.cancelled {
                            break;
                        }
                    }
                    state.buffer.len() as u64
                };
                (total as i64 + n) as u64
            }
        };
        state.read_pos = new_pos;
        Ok(new_pos)
    }
}

// ── File-backed streaming buffer (spill >64 MiB to disk) ─────────────────────

struct FileBufState {
    bytes_written: u64,
    finished: bool,
    cancelled: bool,
    failed: bool,
    content_length: Option<u64>,
}

struct FileBufShared {
    state: Mutex<FileBufState>,
    data_available: Condvar,
}

/// File-backed streaming buffer for tracks whose Content-Length exceeds 64 MiB.
/// Chunks are written to a temp file in `stream-spill/`; the read side seeks
/// within that file rather than accumulating an unbounded `Vec<u8>` in RAM.
pub struct FileBackedStreamingBuffer {
    shared: Arc<FileBufShared>,
    file: File,
    read_pos: u64,
    path: PathBuf,
}

pub struct FileBackedStreamingWriter {
    shared: Arc<FileBufShared>,
    file: File,
}

impl FileBackedStreamingBuffer {
    pub fn new(
        spill_dir: &std::path::Path,
        play_id: u64,
        content_length: Option<u64>,
    ) -> io::Result<(Self, FileBackedStreamingWriter)> {
        fs::create_dir_all(spill_dir)?;
        let path = spill_dir.join(format!("play-{play_id}.spill"));
        File::create(&path)?;
        let read_file = File::open(&path)?;
        let write_file = OpenOptions::new().write(true).open(&path)?;
        let shared = Arc::new(FileBufShared {
            state: Mutex::new(FileBufState {
                bytes_written: 0,
                finished: false,
                cancelled: false,
                failed: false,
                content_length,
            }),
            data_available: Condvar::new(),
        });
        Ok((
            FileBackedStreamingBuffer {
                shared: shared.clone(),
                file: read_file,
                read_pos: 0,
                path,
            },
            FileBackedStreamingWriter {
                shared,
                file: write_file,
            },
        ))
    }
}

impl Drop for FileBackedStreamingBuffer {
    fn drop(&mut self) {
        let mut state = self.shared.state.lock().unwrap();
        state.cancelled = true;
        self.shared.data_available.notify_all();
        drop(state);
        let _ = fs::remove_file(&self.path);
    }
}

impl Drop for FileBackedStreamingWriter {
    fn drop(&mut self) {
        // If the download thread exits without calling finish() (e.g. panic), wake
        // the reader so it returns Err rather than blocking forever in condvar wait.
        let mut state = self.shared.state.lock().unwrap();
        if !state.finished && !state.cancelled {
            state.cancelled = true;
            self.shared.data_available.notify_all();
        }
    }
}

impl FileBackedStreamingWriter {
    pub fn write_chunk(&mut self, data: &[u8]) -> bool {
        {
            let state = self.shared.state.lock().unwrap();
            if state.cancelled {
                return false;
            }
        }
        if self.file.write_all(data).is_err() {
            // Mark cancelled so the reader returns Err instead of a premature Ok(0) EOF.
            let mut state = self.shared.state.lock().unwrap();
            state.cancelled = true;
            self.shared.data_available.notify_all();
            return false;
        }
        let mut state = self.shared.state.lock().unwrap();
        if state.cancelled {
            return false;
        }
        state.bytes_written += data.len() as u64;
        self.shared.data_available.notify_all();
        true
    }

    pub fn finish(&self) {
        let mut state = self.shared.state.lock().unwrap();
        state.finished = true;
        self.shared.data_available.notify_all();
    }

    /// See `StreamingWriter::fail`.
    pub fn fail(&self) {
        let mut state = self.shared.state.lock().unwrap();
        state.failed = true;
        state.cancelled = true;
        self.shared.data_available.notify_all();
    }
}

impl Read for FileBackedStreamingBuffer {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let mut state = self.shared.state.lock().unwrap();
        loop {
            if state.cancelled && !state.failed {
                return Err(io::Error::new(
                    io::ErrorKind::Interrupted,
                    "playback superseded",
                ));
            }
            if self.read_pos < state.bytes_written {
                let avail = (state.bytes_written - self.read_pos) as usize;
                let n = avail.min(buf.len());
                drop(state);
                let read_n = self.file.read(&mut buf[..n])?;
                self.read_pos += read_n as u64;
                return Ok(read_n);
            }
            if state.failed {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "stream truncated",
                ));
            }
            if state.finished {
                return Ok(0);
            }
            state = self.shared.data_available.wait(state).unwrap();
        }
    }
}

impl Seek for FileBackedStreamingBuffer {
    fn seek(&mut self, pos: SeekFrom) -> io::Result<u64> {
        let new_pos = {
            let mut state = self.shared.state.lock().unwrap();
            match pos {
                SeekFrom::Start(n) => n,
                SeekFrom::Current(n) => (self.read_pos as i64 + n).max(0) as u64,
                SeekFrom::End(n) => {
                    let total = if state.finished {
                        state.bytes_written
                    } else if let Some(len) = state.content_length {
                        len
                    } else {
                        loop {
                            state = self.shared.data_available.wait(state).unwrap();
                            if state.finished || state.cancelled {
                                break;
                            }
                        }
                        state.bytes_written
                    };
                    (total as i64 + n).max(0) as u64
                }
            }
        };
        self.file.seek(SeekFrom::Start(new_pos))?;
        self.read_pos = new_pos;
        Ok(new_pos)
    }
}

// ── Unified writer for the download thread ────────────────────────────────────

pub enum AnyWriter {
    Ram(StreamingWriter),
    File(FileBackedStreamingWriter),
}

impl AnyWriter {
    pub fn write_chunk(&mut self, data: &[u8]) -> bool {
        match self {
            AnyWriter::Ram(w) => w.write_chunk(data),
            AnyWriter::File(w) => w.write_chunk(data),
        }
    }

    pub fn finish(self) {
        match self {
            AnyWriter::Ram(w) => w.finish(),
            AnyWriter::File(w) => w.finish(),
        }
    }

    pub fn fail(self) {
        match self {
            AnyWriter::Ram(w) => w.fail(),
            AnyWriter::File(w) => w.fail(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::time::Duration;

    /// Reads until the reader reports EOF or an error, returning both the bytes that
    /// arrived and the terminal outcome. Written by hand rather than with
    /// `read_to_end` because the whole point of these tests is the distinction
    /// between a clean `Ok(0)` and an `Err`, which `read_to_end` collapses.
    fn drain<R: Read>(r: &mut R) -> (Vec<u8>, io::Result<usize>) {
        let mut out = Vec::new();
        let mut chunk = [0u8; 8];
        loop {
            match r.read(&mut chunk) {
                Ok(0) => return (out, Ok(0)),
                Ok(n) => out.extend_from_slice(&chunk[..n]),
                Err(e) => return (out, Err(e)),
            }
        }
    }

    // ── RAM-backed buffer ─────────────────────────────────────────────────────

    #[test]
    fn finish_makes_the_reader_report_a_clean_eof_after_the_buffered_bytes() {
        let (mut buf, writer) = StreamingBuffer::new(Some(5));
        assert!(writer.write_chunk(b"hello"));
        writer.finish();

        let (bytes, terminal) = drain(&mut buf);
        assert_eq!(bytes, b"hello");
        assert_eq!(terminal.expect("finish must produce EOF, not an error"), 0);
    }

    #[test]
    fn fail_makes_the_reader_report_unexpected_eof() {
        let (mut buf, writer) = StreamingBuffer::new(Some(1024));
        writer.fail();

        let err = buf
            .read(&mut [0u8; 8])
            .expect_err("a failed stream must not read as EOF");
        assert_eq!(err.kind(), io::ErrorKind::UnexpectedEof);
    }

    #[test]
    fn fail_still_serves_the_bytes_that_arrived_before_the_download_died() {
        let (mut buf, writer) = StreamingBuffer::new(Some(1024));
        assert!(writer.write_chunk(b"partial audio"));
        writer.fail();

        let (bytes, terminal) = drain(&mut buf);
        assert_eq!(bytes, b"partial audio");
        assert_eq!(
            terminal
                .expect_err("truncated stream must end in an error")
                .kind(),
            io::ErrorKind::UnexpectedEof
        );
    }

    #[test]
    fn a_forward_read_blocks_until_a_concurrent_writer_supplies_the_bytes() {
        let (mut buf, writer) = StreamingBuffer::new(None);
        let handle = std::thread::spawn(move || {
            for chunk in [&b"aaaa"[..], &b"bbbb"[..], &b"cccc"[..]] {
                std::thread::sleep(Duration::from_millis(10));
                assert!(writer.write_chunk(chunk));
            }
            writer.finish();
        });

        let (bytes, terminal) = drain(&mut buf);
        handle.join().expect("writer thread panicked");
        assert_eq!(bytes, b"aaaabbbbcccc");
        assert_eq!(terminal.expect("stream finished cleanly"), 0);
    }

    #[test]
    fn write_chunk_reports_failure_once_the_reader_has_been_dropped() {
        let (buf, writer) = StreamingBuffer::new(Some(4));
        assert!(writer.write_chunk(b"ab"));
        drop(buf);
        assert!(
            !writer.write_chunk(b"cd"),
            "a cancelled stream must tell the download thread to stop"
        );
    }

    #[test]
    fn seek_from_end_resolves_against_content_length_while_still_downloading() {
        let (mut buf, writer) = StreamingBuffer::new(Some(100));
        assert!(writer.write_chunk(b"only ten b"));

        // Would deadlock if it waited for finish(), which is exactly the regression
        // this guards: rodio probes the tail of the file before playback starts.
        assert_eq!(buf.seek(SeekFrom::End(0)).unwrap(), 100);
        assert_eq!(buf.seek(SeekFrom::Start(4)).unwrap(), 4);
        assert_eq!(buf.seek(SeekFrom::Current(2)).unwrap(), 6);
    }

    #[test]
    fn seek_from_current_clamps_a_negative_offset_to_the_start() {
        let (mut buf, writer) = StreamingBuffer::new(Some(8));
        assert!(writer.write_chunk(b"12345678"));
        buf.seek(SeekFrom::Start(3)).unwrap();
        assert_eq!(buf.seek(SeekFrom::Current(-99)).unwrap(), 0);
    }

    #[test]
    fn a_seek_backwards_re_reads_bytes_already_consumed() {
        let (mut buf, writer) = StreamingBuffer::new(Some(6));
        assert!(writer.write_chunk(b"abcdef"));
        writer.finish();

        let mut first = [0u8; 6];
        buf.read_exact(&mut first).unwrap();
        buf.seek(SeekFrom::Start(2)).unwrap();
        let (rest, _) = drain(&mut buf);
        assert_eq!(&rest, b"cdef");
    }

    // ── File-backed buffer ────────────────────────────────────────────────────

    /// Unique scratch dir per test, removed on drop. Avoids pulling in `tempfile`
    /// for what amounts to two directories.
    struct ScratchDir(PathBuf);

    impl ScratchDir {
        fn new(label: &str) -> Self {
            static SEQ: AtomicU32 = AtomicU32::new(0);
            let n = SEQ.fetch_add(1, Ordering::Relaxed);
            let dir = std::env::temp_dir().join(format!(
                "canon-streaming-test-{label}-{}-{n}",
                std::process::id()
            ));
            let _ = fs::remove_dir_all(&dir);
            fs::create_dir_all(&dir).expect("scratch dir");
            ScratchDir(dir)
        }
    }

    impl Drop for ScratchDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn the_file_backed_buffer_round_trips_bytes_through_the_spill_file() {
        let scratch = ScratchDir::new("roundtrip");
        let (mut buf, mut writer) =
            FileBackedStreamingBuffer::new(&scratch.0, 1, Some(9)).expect("spill file");
        assert!(writer.write_chunk(b"spilled!!"));
        writer.finish();

        let (bytes, terminal) = drain(&mut buf);
        assert_eq!(bytes, b"spilled!!");
        assert_eq!(terminal.expect("finish must produce EOF"), 0);
    }

    #[test]
    fn the_file_backed_buffer_reports_unexpected_eof_after_fail_and_keeps_partial_bytes() {
        let scratch = ScratchDir::new("fail");
        let (mut buf, mut writer) =
            FileBackedStreamingBuffer::new(&scratch.0, 2, Some(4096)).expect("spill file");
        assert!(writer.write_chunk(b"half a track"));
        writer.fail();

        let (bytes, terminal) = drain(&mut buf);
        assert_eq!(bytes, b"half a track");
        assert_eq!(
            terminal.expect_err("truncated spill must error").kind(),
            io::ErrorKind::UnexpectedEof
        );
    }

    #[test]
    fn dropping_the_file_backed_writer_without_finishing_wakes_a_blocked_reader() {
        let scratch = ScratchDir::new("orphan");
        let (mut buf, mut writer) =
            FileBackedStreamingBuffer::new(&scratch.0, 3, None).expect("spill file");
        assert!(writer.write_chunk(b"xy"));

        // Consume everything available first, so the read below is guaranteed to be
        // the blocking one rather than racing the drop for the buffered bytes.
        let mut got = [0u8; 2];
        buf.read_exact(&mut got).unwrap();
        assert_eq!(&got, b"xy");

        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(10));
            // Deliberately no finish()/fail(): simulates the download thread dying.
            drop(writer);
        });

        let err = buf
            .read(&mut [0u8; 8])
            .expect_err("an abandoned download must not read as EOF");
        handle.join().expect("writer thread panicked");
        assert_eq!(err.kind(), io::ErrorKind::Interrupted);
    }

    #[test]
    fn dropping_the_file_backed_buffer_removes_its_spill_file() {
        let scratch = ScratchDir::new("cleanup");
        let (buf, mut writer) =
            FileBackedStreamingBuffer::new(&scratch.0, 7, Some(2)).expect("spill file");
        assert!(writer.write_chunk(b"ab"));
        let path = scratch.0.join("play-7.spill");
        assert!(path.exists());
        drop(buf);
        assert!(!path.exists(), "spill file must not outlive the reader");
    }
}
