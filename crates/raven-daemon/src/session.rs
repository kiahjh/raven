use parking_lot::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{error, info};

use crate::protocol::SessionInfo;

const BUFFER_SIZE: usize = 64 * 1024; // 64KB scrollback per session

pub struct Session {
    pub id: String,
    pub cwd: Option<String>,
    pub rows: u16,
    pub cols: u16,
    pub alive: bool,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    buffer: Arc<Mutex<String>>,
    output_tx: broadcast::Sender<String>,
}

impl Session {
    pub fn spawn(id: String, cwd: Option<String>, rows: u16, cols: u16) -> Result<Self, String> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        let mut cmd = CommandBuilder::new(&shell);
        cmd.arg("-l");

        if let Some(ref dir) = cwd {
            cmd.cwd(dir);
        }

        let mut child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

        let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;

        let buffer = Arc::new(Mutex::new(String::new()));
        let (output_tx, _) = broadcast::channel(256);

        // Spawn reader thread
        let buffer_clone = buffer.clone();
        let output_tx_clone = output_tx.clone();
        let id_clone = id.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();

                        // Append to buffer (with size limit)
                        {
                            let mut b = buffer_clone.lock();
                            b.push_str(&data);
                            // Truncate buffer if too large
                            if b.len() > BUFFER_SIZE {
                                let drain_to = b.len() - BUFFER_SIZE;
                                // Find a good break point (newline)
                                if let Some(pos) = b[drain_to..].find('\n') {
                                    b.drain(..drain_to + pos + 1);
                                } else {
                                    b.drain(..drain_to);
                                }
                            }
                        }

                        // Broadcast to attached clients
                        let _ = output_tx_clone.send(data);
                    }
                    Err(e) => {
                        error!("Read error for session {}: {}", id_clone, e);
                        break;
                    }
                }
            }
            info!("Reader thread ended for session {}", id_clone);
        });

        // Spawn thread to wait for child exit
        let id_clone2 = id.clone();
        std::thread::spawn(move || match child.wait() {
            Ok(status) => {
                info!("Session {} exited with status {:?}", id_clone2, status);
            }
            Err(e) => {
                error!("Error waiting for session {}: {}", id_clone2, e);
            }
        });

        Ok(Session {
            id,
            cwd,
            rows,
            cols,
            alive: true,
            master: pair.master,
            writer,
            buffer,
            output_tx,
        })
    }

    pub fn write(&mut self, data: &str) -> Result<(), String> {
        self.writer
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())?;
        self.writer.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn resize(&self, rows: u16, cols: u16) -> Result<(), String> {
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn get_buffer(&self) -> String {
        self.buffer.lock().clone()
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.output_tx.subscribe()
    }

    pub fn info(&self) -> SessionInfo {
        SessionInfo {
            id: self.id.clone(),
            cwd: self.cwd.clone(),
            rows: self.rows,
            cols: self.cols,
            alive: self.alive,
        }
    }
}

pub struct SessionManager {
    sessions: Mutex<HashMap<String, Session>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn spawn(
        &self,
        id: String,
        cwd: Option<String>,
        rows: u16,
        cols: u16,
    ) -> Result<(), String> {
        let session = Session::spawn(id.clone(), cwd, rows, cols)?;
        self.sessions.lock().insert(id, session);
        Ok(())
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        let session = sessions.get_mut(id).ok_or("Session not found")?;
        session.write(data)
    }

    pub fn resize(&self, id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let sessions = self.sessions.lock();
        let session = sessions.get(id).ok_or("Session not found")?;
        session.resize(rows, cols)
    }

    pub fn get_buffer(&self, id: &str) -> Result<String, String> {
        let sessions = self.sessions.lock();
        let session = sessions.get(id).ok_or("Session not found")?;
        Ok(session.get_buffer())
    }

    pub fn subscribe(&self, id: &str) -> Result<broadcast::Receiver<String>, String> {
        let sessions = self.sessions.lock();
        let session = sessions.get(id).ok_or("Session not found")?;
        Ok(session.subscribe())
    }

    pub fn get_info(&self, id: &str) -> Result<SessionInfo, String> {
        let sessions = self.sessions.lock();
        let session = sessions.get(id).ok_or("Session not found")?;
        Ok(session.info())
    }

    pub fn kill(&self, id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock();
        sessions.remove(id).ok_or("Session not found")?;
        Ok(())
    }

    pub fn list(&self) -> Vec<SessionInfo> {
        self.sessions.lock().values().map(|s| s.info()).collect()
    }
}
