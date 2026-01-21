use directories::ProjectDirs;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter, Manager};

/// Messages sent from client to daemon (must match daemon's protocol.rs)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ClientMessage {
    Spawn {
        session_id: String,
        cwd: Option<String>,
        rows: u16,
        cols: u16,
    },
    Write {
        session_id: String,
        data: String,
    },
    Resize {
        session_id: String,
        rows: u16,
        cols: u16,
    },
    Attach {
        session_id: String,
    },
    Detach {
        session_id: String,
    },
    Kill {
        session_id: String,
    },
    List,
    Ping,
}

/// Messages sent from daemon to client (must match daemon's protocol.rs)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ServerMessage {
    Spawned {
        session_id: String,
    },
    Output {
        session_id: String,
        data: String,
    },
    Exited {
        session_id: String,
        exit_code: Option<i32>,
    },
    Attached {
        session_id: String,
        buffer: String,
        rows: u16,
        cols: u16,
    },
    Sessions {
        sessions: Vec<SessionInfo>,
    },
    Error {
        message: String,
    },
    Pong,
    Ok,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub id: String,
    pub cwd: Option<String>,
    pub rows: u16,
    pub cols: u16,
    pub alive: bool,
}

fn get_socket_path() -> PathBuf {
    if let Some(proj_dirs) = ProjectDirs::from("com", "innocencelabs", "raven") {
        let runtime_dir = proj_dirs.runtime_dir().unwrap_or(proj_dirs.data_dir());
        runtime_dir.join("daemon.sock")
    } else {
        PathBuf::from("/tmp/raven-daemon.sock")
    }
}

fn get_daemon_binary_path() -> Option<PathBuf> {
    // In development, look for it in the workspace
    let dev_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("crates/raven-daemon/target/debug/raven-daemon");
    if dev_path.exists() {
        return Some(dev_path);
    }

    // In production, look next to the app bundle
    if let Ok(exe) = std::env::current_exe() {
        let prod_path = exe.parent().unwrap().join("raven-daemon");
        if prod_path.exists() {
            return Some(prod_path);
        }
    }

    None
}

/// A connection to the daemon that can send/receive messages
struct DaemonConnection {
    stream: UnixStream,
    reader: BufReader<UnixStream>,
}

impl DaemonConnection {
    fn connect() -> Result<Self, String> {
        let socket_path = get_socket_path();
        let stream = UnixStream::connect(&socket_path)
            .map_err(|e| format!("Failed to connect to daemon: {}", e))?;
        let reader_stream = stream.try_clone().map_err(|e| e.to_string())?;
        let reader = BufReader::new(reader_stream);
        Ok(Self { stream, reader })
    }

    fn send(&mut self, msg: &ClientMessage) -> Result<(), String> {
        let json = serde_json::to_string(msg).map_err(|e| e.to_string())?;
        writeln!(self.stream, "{}", json).map_err(|e| e.to_string())?;
        self.stream.flush().map_err(|e| e.to_string())?;
        Ok(())
    }

    fn recv(&mut self) -> Result<ServerMessage, String> {
        let mut line = String::new();
        self.reader
            .read_line(&mut line)
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&line).map_err(|e| format!("Invalid response: {}", e))
    }

    fn send_recv(&mut self, msg: &ClientMessage) -> Result<ServerMessage, String> {
        self.send(msg)?;
        self.recv()
    }
}

/// Manages daemon process and connections
pub struct DaemonManager {
    daemon_process: Mutex<Option<Child>>,
    /// Active session flags - when set to false, the reader thread should stop
    active_sessions: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl DaemonManager {
    pub fn new() -> Self {
        Self {
            daemon_process: Mutex::new(None),
            active_sessions: Mutex::new(HashMap::new()),
        }
    }

    fn register_session(&self, id: &str) -> Arc<AtomicBool> {
        let mut sessions = self.active_sessions.lock();
        // Deactivate any existing session first to stop old reader thread
        if let Some(old_flag) = sessions.get(id) {
            old_flag.store(false, Ordering::SeqCst);
        }
        let flag = Arc::new(AtomicBool::new(true));
        sessions.insert(id.to_string(), flag.clone());
        flag
    }

    fn deactivate_session(&self, id: &str) {
        let mut sessions = self.active_sessions.lock();
        if let Some(flag) = sessions.remove(id) {
            flag.store(false, Ordering::SeqCst);
        }
    }

    /// Ensure daemon is running, start it if not
    pub fn ensure_running(&self) -> Result<(), String> {
        let socket_path = get_socket_path();

        // Check if daemon is already running
        if socket_path.exists() {
            if let Ok(mut conn) = DaemonConnection::connect() {
                if let Ok(ServerMessage::Pong) = conn.send_recv(&ClientMessage::Ping) {
                    return Ok(());
                }
            }
            // Stale socket, remove it
            let _ = std::fs::remove_file(&socket_path);
        }

        // Start daemon
        let daemon_path = get_daemon_binary_path().ok_or("Could not find raven-daemon binary")?;

        let child = Command::new(&daemon_path)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start daemon: {}", e))?;

        *self.daemon_process.lock() = Some(child);

        // Wait for daemon to be ready
        for _ in 0..50 {
            thread::sleep(std::time::Duration::from_millis(100));
            if let Ok(mut conn) = DaemonConnection::connect() {
                if let Ok(ServerMessage::Pong) = conn.send_recv(&ClientMessage::Ping) {
                    return Ok(());
                }
            }
        }

        Err("Daemon failed to start in time".to_string())
    }
}

#[derive(Clone, Serialize)]
struct PtyOutput {
    id: String,
    data: String,
}

/// Spawn a new terminal session via daemon (does NOT attach - caller must attach separately)
#[tauri::command]
pub fn daemon_spawn(
    app: AppHandle,
    id: String,
    cwd: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let manager = app.state::<DaemonManager>();
    manager.ensure_running()?;

    // Create connection for this session
    let mut conn = DaemonConnection::connect()?;

    // Spawn session only - don't attach here, let caller do that
    let msg = ClientMessage::Spawn {
        session_id: id.clone(),
        cwd,
        rows,
        cols,
    };
    match conn.send_recv(&msg)? {
        ServerMessage::Spawned { .. } => Ok(()),
        ServerMessage::Error { message } => Err(message),
        _ => Err("Unexpected response".to_string()),
    }
}

/// Write to a terminal session via daemon
#[tauri::command]
pub fn daemon_write(app: AppHandle, id: String, data: String) -> Result<(), String> {
    let manager = app.state::<DaemonManager>();
    manager.ensure_running()?;

    let mut conn = DaemonConnection::connect()?;
    let msg = ClientMessage::Write {
        session_id: id,
        data,
    };

    match conn.send_recv(&msg)? {
        ServerMessage::Ok => Ok(()),
        ServerMessage::Error { message } => Err(message),
        _ => Err("Unexpected response".to_string()),
    }
}

/// Resize a terminal session via daemon
#[tauri::command]
pub fn daemon_resize(app: AppHandle, id: String, rows: u16, cols: u16) -> Result<(), String> {
    let manager = app.state::<DaemonManager>();
    manager.ensure_running()?;

    let mut conn = DaemonConnection::connect()?;
    let msg = ClientMessage::Resize {
        session_id: id,
        rows,
        cols,
    };

    match conn.send_recv(&msg)? {
        ServerMessage::Ok => Ok(()),
        ServerMessage::Error { message } => Err(message),
        _ => Err("Unexpected response".to_string()),
    }
}

/// Detach from a terminal session (stops output streaming but keeps session alive)
#[tauri::command]
pub fn daemon_detach(app: AppHandle, id: String) -> Result<(), String> {
    let manager = app.state::<DaemonManager>();

    // Stop the reader thread
    manager.deactivate_session(&id);

    // Tell daemon we're detaching (optional, mainly for cleanup)
    if let Ok(mut conn) = DaemonConnection::connect() {
        let msg = ClientMessage::Detach {
            session_id: id.clone(),
        };
        let _ = conn.send_recv(&msg);
    }

    Ok(())
}

/// Kill a terminal session via daemon
#[tauri::command]
pub fn daemon_kill(app: AppHandle, id: String) -> Result<(), String> {
    let manager = app.state::<DaemonManager>();

    // Stop the reader thread first
    manager.deactivate_session(&id);

    // If daemon is running, tell it to kill the session
    if let Ok(mut conn) = DaemonConnection::connect() {
        let msg = ClientMessage::Kill {
            session_id: id.clone(),
        };
        let _ = conn.send_recv(&msg);
    }

    Ok(())
}

/// List all sessions from daemon
#[tauri::command]
pub fn daemon_list(app: AppHandle) -> Result<Vec<SessionInfo>, String> {
    let manager = app.state::<DaemonManager>();
    manager.ensure_running()?;

    let mut conn = DaemonConnection::connect()?;
    match conn.send_recv(&ClientMessage::List)? {
        ServerMessage::Sessions { sessions } => Ok(sessions),
        ServerMessage::Error { message } => Err(message),
        _ => Err("Unexpected response".to_string()),
    }
}

/// Attach to an existing session (for reconnection after app restart)
#[tauri::command]
pub fn daemon_attach(app: AppHandle, id: String) -> Result<String, String> {
    let manager = app.state::<DaemonManager>();
    manager.ensure_running()?;

    let mut conn = DaemonConnection::connect()?;
    let msg = ClientMessage::Attach {
        session_id: id.clone(),
    };

    match conn.send_recv(&msg)? {
        ServerMessage::Attached { buffer, .. } => {
            // Track this session
            let active_flag = manager.register_session(&id);

            // Spawn thread to read output
            let app_clone = app.clone();
            let id_clone = id.clone();

            thread::spawn(move || loop {
                if !active_flag.load(Ordering::SeqCst) {
                    break;
                }

                match conn.recv() {
                    Ok(ServerMessage::Output { data, .. }) => {
                        let _ = app_clone.emit(
                            &format!("pty-output-{}", id_clone),
                            PtyOutput {
                                id: id_clone.clone(),
                                data,
                            },
                        );
                    }
                    Ok(ServerMessage::Exited { exit_code, .. }) => {
                        let _ = app_clone.emit(&format!("pty-exit-{}", id_clone), exit_code);
                        break;
                    }
                    Ok(_) => {}
                    Err(_) => break,
                }
            });

            Ok(buffer)
        }
        ServerMessage::Error { message } => Err(message),
        _ => Err("Unexpected response".to_string()),
    }
}
