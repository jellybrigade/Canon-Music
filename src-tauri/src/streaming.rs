use std::io::{self, Read, Seek, SeekFrom};
use std::sync::{Arc, Condvar, Mutex};

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
