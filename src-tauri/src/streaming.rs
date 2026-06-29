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
        let shared = Arc::new(StreamingShared {
            state: Mutex::new(StreamingState {
                buffer: Vec::new(),
                read_pos: 0,
                finished: false,
                cancelled: false,
                content_length,
            }),
            data_available: Condvar::new(),
        });
        (
            StreamingBuffer { shared: shared.clone() },
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
}

impl Read for StreamingBuffer {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let mut state = self.shared.state.lock().unwrap();
        loop {
            if state.cancelled {
                return Err(io::Error::new(io::ErrorKind::Interrupted, "playback superseded"));
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

impl FileBackedStreamingWriter {
    pub fn write_chunk(&mut self, data: &[u8]) -> bool {
        {
            let state = self.shared.state.lock().unwrap();
            if state.cancelled {
                return false;
            }
        }
        if self.file.write_all(data).is_err() {
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
}

impl Read for FileBackedStreamingBuffer {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let mut state = self.shared.state.lock().unwrap();
        loop {
            if state.cancelled {
                return Err(io::Error::new(io::ErrorKind::Interrupted, "playback superseded"));
            }
            if self.read_pos < state.bytes_written {
                let avail = (state.bytes_written - self.read_pos) as usize;
                let n = avail.min(buf.len());
                drop(state);
                let read_n = self.file.read(&mut buf[..n])?;
                self.read_pos += read_n as u64;
                return Ok(read_n);
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
}
