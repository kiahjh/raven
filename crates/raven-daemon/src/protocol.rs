use serde::{Deserialize, Serialize};

/// Messages sent from client to daemon
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ClientMessage {
    /// Spawn a new PTY session
    Spawn {
        session_id: String,
        cwd: Option<String>,
        rows: u16,
        cols: u16,
    },
    /// Write data to a session
    Write { session_id: String, data: String },
    /// Resize a session
    Resize {
        session_id: String,
        rows: u16,
        cols: u16,
    },
    /// Attach to an existing session (get current buffer + subscribe to output)
    Attach { session_id: String },
    /// Detach from a session (stop receiving output)
    Detach { session_id: String },
    /// Kill a session
    Kill { session_id: String },
    /// List all sessions
    List,
    /// Ping (keepalive)
    Ping,
}

/// Messages sent from daemon to client
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "payload")]
pub enum ServerMessage {
    /// Session spawned successfully
    Spawned { session_id: String },
    /// Output from a session
    Output { session_id: String, data: String },
    /// Session exited
    Exited {
        session_id: String,
        exit_code: Option<i32>,
    },
    /// Attached to session, includes current buffer
    Attached {
        session_id: String,
        buffer: String,
        rows: u16,
        cols: u16,
    },
    /// List of sessions
    Sessions { sessions: Vec<SessionInfo> },
    /// Error occurred
    Error { message: String },
    /// Pong (keepalive response)
    Pong,
    /// Acknowledged
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
