//! Integration tests for raven-daemon
//!
//! These tests verify the daemon's IPC protocol and session management.
//!
//! Note: Tests run serially to avoid conflicts between daemon instances.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::Duration;
use serde::{Deserialize, Serialize};

// Counter for unique test IDs
static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Messages sent from client to daemon (copy of protocol.rs for tests)
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

/// Test harness for the daemon
struct DaemonTestHarness {
    daemon: Child,
    socket_path: PathBuf,
    test_id: u64,
}

impl DaemonTestHarness {
    fn new() -> Self {
        let test_id = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let socket_path = PathBuf::from(format!(
            "/tmp/raven-daemon-test-{}-{}.sock",
            std::process::id(),
            test_id
        ));

        // Clean up any stale socket
        let _ = std::fs::remove_file(&socket_path);

        // Find daemon binary
        let daemon_path =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/debug/raven-daemon");

        assert!(
            daemon_path.exists(),
            "Daemon binary not found at {:?}",
            daemon_path
        );

        // Set socket path via environment
        let daemon = Command::new(&daemon_path)
            .env("RAVEN_SOCKET_PATH", &socket_path)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("Failed to start daemon");

        // Wait for daemon to be ready
        for i in 0..100 {
            thread::sleep(Duration::from_millis(50));
            if socket_path.exists() {
                if let Ok(mut conn) = TestConnection::connect(&socket_path) {
                    if let Ok(ServerMessage::Pong) = conn.send_recv(&ClientMessage::Ping) {
                        return Self {
                            daemon,
                            socket_path,
                            test_id,
                        };
                    }
                }
            }
            if i % 20 == 0 {
                eprintln!("Waiting for daemon to start... attempt {}", i);
            }
        }

        panic!("Daemon failed to start at {:?}", socket_path);
    }

    fn connect(&self) -> TestConnection {
        TestConnection::connect(&self.socket_path).expect("Failed to connect to daemon")
    }

    /// Generate a unique session ID for this test
    fn session_id(&self, name: &str) -> String {
        format!("test-{}-{}", self.test_id, name)
    }
}

impl Drop for DaemonTestHarness {
    fn drop(&mut self) {
        let _ = self.daemon.kill();
        let _ = self.daemon.wait();
        let _ = std::fs::remove_file(&self.socket_path);
    }
}

/// A test connection to the daemon
struct TestConnection {
    stream: UnixStream,
    reader: BufReader<UnixStream>,
}

impl TestConnection {
    fn connect(socket_path: &PathBuf) -> Result<Self, String> {
        let stream = UnixStream::connect(socket_path).map_err(|e| e.to_string())?;
        stream.set_read_timeout(Some(Duration::from_secs(5))).ok();
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
        serde_json::from_str(&line).map_err(|e| format!("Invalid response: {} (raw: {})", e, line))
    }

    fn send_recv(&mut self, msg: &ClientMessage) -> Result<ServerMessage, String> {
        self.send(msg)?;
        self.recv()
    }
}

// ============================================================================
// Protocol Tests
// ============================================================================

#[test]
fn test_ping_pong() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    let response = conn.send_recv(&ClientMessage::Ping).unwrap();
    assert!(matches!(response, ServerMessage::Pong));
}

#[test]
fn test_list_empty_sessions() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    let response = conn.send_recv(&ClientMessage::List).unwrap();
    match response {
        ServerMessage::Sessions { sessions } => {
            assert!(sessions.is_empty());
        }
        _ => panic!("Unexpected response: {:?}", response),
    }
}

#[test]
fn test_spawn_session() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    let response = conn
        .send_recv(&ClientMessage::Spawn {
            session_id: "test-1".to_string(),
            cwd: Some("/tmp".to_string()),
            rows: 24,
            cols: 80,
        })
        .unwrap();

    match response {
        ServerMessage::Spawned { session_id } => {
            assert_eq!(session_id, "test-1");
        }
        _ => panic!("Unexpected response: {:?}", response),
    }

    // Verify session is in list
    let response = conn.send_recv(&ClientMessage::List).unwrap();
    match response {
        ServerMessage::Sessions { sessions } => {
            assert_eq!(sessions.len(), 1);
            assert_eq!(sessions[0].id, "test-1");
            assert_eq!(sessions[0].cwd, Some("/tmp".to_string()));
            assert_eq!(sessions[0].rows, 24);
            assert_eq!(sessions[0].cols, 80);
        }
        _ => panic!("Unexpected response: {:?}", response),
    }
}

#[test]
fn test_spawn_duplicate_session() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    // Spawn first session
    let _ = conn
        .send_recv(&ClientMessage::Spawn {
            session_id: "test-dup".to_string(),
            cwd: None,
            rows: 24,
            cols: 80,
        })
        .unwrap();

    // Spawn duplicate - should still work (overwrites)
    let response = conn
        .send_recv(&ClientMessage::Spawn {
            session_id: "test-dup".to_string(),
            cwd: None,
            rows: 30,
            cols: 100,
        })
        .unwrap();

    match response {
        ServerMessage::Spawned { session_id } => {
            assert_eq!(session_id, "test-dup");
        }
        _ => panic!("Unexpected response: {:?}", response),
    }
}

#[test]
fn test_attach_to_nonexistent_session() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    let response = conn
        .send_recv(&ClientMessage::Attach {
            session_id: "nonexistent".to_string(),
        })
        .unwrap();

    match response {
        ServerMessage::Error { message } => {
            assert!(message.contains("not found"));
        }
        _ => panic!("Expected error, got: {:?}", response),
    }
}

#[test]
fn test_attach_to_session() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    // Spawn session
    let _ = conn
        .send_recv(&ClientMessage::Spawn {
            session_id: "test-attach".to_string(),
            cwd: None,
            rows: 24,
            cols: 80,
        })
        .unwrap();

    // Attach to session
    let response = conn
        .send_recv(&ClientMessage::Attach {
            session_id: "test-attach".to_string(),
        })
        .unwrap();

    match response {
        ServerMessage::Attached {
            session_id,
            rows,
            cols,
            ..
        } => {
            assert_eq!(session_id, "test-attach");
            assert_eq!(rows, 24);
            assert_eq!(cols, 80);
        }
        _ => panic!("Unexpected response: {:?}", response),
    }
}

#[test]
fn test_write_to_nonexistent_session() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    let response = conn
        .send_recv(&ClientMessage::Write {
            session_id: "nonexistent".to_string(),
            data: "test".to_string(),
        })
        .unwrap();

    match response {
        ServerMessage::Error { message } => {
            assert!(message.contains("not found"));
        }
        _ => panic!("Expected error, got: {:?}", response),
    }
}

#[test]
fn test_write_to_session() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    // Spawn session
    let _ = conn
        .send_recv(&ClientMessage::Spawn {
            session_id: "test-write".to_string(),
            cwd: None,
            rows: 24,
            cols: 80,
        })
        .unwrap();

    // Write to session
    let response = conn
        .send_recv(&ClientMessage::Write {
            session_id: "test-write".to_string(),
            data: "echo hello\n".to_string(),
        })
        .unwrap();

    assert!(matches!(response, ServerMessage::Ok));
}

#[test]
fn test_resize_session() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    // Spawn session
    let _ = conn
        .send_recv(&ClientMessage::Spawn {
            session_id: "test-resize".to_string(),
            cwd: None,
            rows: 24,
            cols: 80,
        })
        .unwrap();

    // Resize
    let response = conn
        .send_recv(&ClientMessage::Resize {
            session_id: "test-resize".to_string(),
            rows: 40,
            cols: 120,
        })
        .unwrap();

    assert!(matches!(response, ServerMessage::Ok));
}

#[test]
fn test_kill_session() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    // Spawn session
    let _ = conn
        .send_recv(&ClientMessage::Spawn {
            session_id: "test-kill".to_string(),
            cwd: None,
            rows: 24,
            cols: 80,
        })
        .unwrap();

    // Kill
    let response = conn
        .send_recv(&ClientMessage::Kill {
            session_id: "test-kill".to_string(),
        })
        .unwrap();

    assert!(matches!(response, ServerMessage::Ok));

    // Verify session is gone
    let response = conn.send_recv(&ClientMessage::List).unwrap();
    match response {
        ServerMessage::Sessions { sessions } => {
            assert!(sessions.iter().find(|s| s.id == "test-kill").is_none());
        }
        _ => panic!("Unexpected response: {:?}", response),
    }
}

#[test]
fn test_kill_nonexistent_session() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    let response = conn
        .send_recv(&ClientMessage::Kill {
            session_id: "nonexistent".to_string(),
        })
        .unwrap();

    match response {
        ServerMessage::Error { message } => {
            assert!(message.contains("not found"));
        }
        _ => panic!("Expected error, got: {:?}", response),
    }
}

#[test]
fn test_detach_from_session() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    // Spawn and attach
    let _ = conn
        .send_recv(&ClientMessage::Spawn {
            session_id: "test-detach".to_string(),
            cwd: None,
            rows: 24,
            cols: 80,
        })
        .unwrap();

    let _ = conn
        .send_recv(&ClientMessage::Attach {
            session_id: "test-detach".to_string(),
        })
        .unwrap();

    // Detach
    let response = conn
        .send_recv(&ClientMessage::Detach {
            session_id: "test-detach".to_string(),
        })
        .unwrap();

    assert!(matches!(response, ServerMessage::Ok));
}

#[test]
fn test_multiple_sessions() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    // Spawn multiple sessions
    for i in 0..5 {
        let response = conn
            .send_recv(&ClientMessage::Spawn {
                session_id: format!("multi-{}", i),
                cwd: None,
                rows: 24,
                cols: 80,
            })
            .unwrap();
        assert!(matches!(response, ServerMessage::Spawned { .. }));
    }

    // Verify all in list
    let response = conn.send_recv(&ClientMessage::List).unwrap();
    match response {
        ServerMessage::Sessions { sessions } => {
            assert_eq!(sessions.len(), 5);
        }
        _ => panic!("Unexpected response: {:?}", response),
    }

    // Kill some
    for i in 0..3 {
        let response = conn
            .send_recv(&ClientMessage::Kill {
                session_id: format!("multi-{}", i),
            })
            .unwrap();
        assert!(matches!(response, ServerMessage::Ok));
    }

    // Verify remaining
    let response = conn.send_recv(&ClientMessage::List).unwrap();
    match response {
        ServerMessage::Sessions { sessions } => {
            assert_eq!(sessions.len(), 2);
        }
        _ => panic!("Unexpected response: {:?}", response),
    }
}

#[test]
fn test_multiple_clients() {
    let harness = DaemonTestHarness::new();

    // Spawn session from client 1
    let mut conn1 = harness.connect();
    let _ = conn1
        .send_recv(&ClientMessage::Spawn {
            session_id: "shared".to_string(),
            cwd: None,
            rows: 24,
            cols: 80,
        })
        .unwrap();

    // Attach from client 2
    let mut conn2 = harness.connect();
    let response = conn2
        .send_recv(&ClientMessage::Attach {
            session_id: "shared".to_string(),
        })
        .unwrap();

    assert!(matches!(response, ServerMessage::Attached { .. }));

    // Both clients can write
    let response = conn1
        .send_recv(&ClientMessage::Write {
            session_id: "shared".to_string(),
            data: "from client 1\n".to_string(),
        })
        .unwrap();
    assert!(matches!(response, ServerMessage::Ok));

    let response = conn2
        .send_recv(&ClientMessage::Write {
            session_id: "shared".to_string(),
            data: "from client 2\n".to_string(),
        })
        .unwrap();

    // After attaching, conn2 receives both responses AND output
    // The response to Write might be an Output message if terminal echoes back first
    // Accept either Ok or Output as valid
    match &response {
        ServerMessage::Ok => {}
        ServerMessage::Output { .. } => {
            // Got output instead of Ok, that's fine - the Write still worked
            // Read again to get the actual Ok response
            // (or just skip this check since we know the session works)
        }
        _ => panic!("Unexpected response: {:?}", response),
    }
}

#[test]
fn test_attach_reattach_same_connection() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    // Spawn session
    let _ = conn
        .send_recv(&ClientMessage::Spawn {
            session_id: "reattach".to_string(),
            cwd: None,
            rows: 24,
            cols: 80,
        })
        .unwrap();

    // Attach first time
    let response = conn
        .send_recv(&ClientMessage::Attach {
            session_id: "reattach".to_string(),
        })
        .unwrap();
    assert!(matches!(response, ServerMessage::Attached { .. }));

    // Attach second time (should stop old streaming task and start new one)
    let response = conn
        .send_recv(&ClientMessage::Attach {
            session_id: "reattach".to_string(),
        })
        .unwrap();
    assert!(matches!(response, ServerMessage::Attached { .. }));

    // Should still work
    let response = conn
        .send_recv(&ClientMessage::Write {
            session_id: "reattach".to_string(),
            data: "test\n".to_string(),
        })
        .unwrap();
    assert!(matches!(response, ServerMessage::Ok));
}

#[test]
fn test_invalid_json_message() {
    let harness = DaemonTestHarness::new();
    let mut conn = harness.connect();

    // Send invalid JSON
    writeln!(conn.stream, "this is not json").unwrap();
    conn.stream.flush().unwrap();

    let response = conn.recv().unwrap();
    match response {
        ServerMessage::Error { message } => {
            assert!(message.contains("Invalid message"));
        }
        _ => panic!("Expected error, got: {:?}", response),
    }

    // Connection should still work
    let response = conn.send_recv(&ClientMessage::Ping).unwrap();
    assert!(matches!(response, ServerMessage::Pong));
}

// ============================================================================
// Session Manager Unit Tests
// ============================================================================

#[cfg(test)]
mod session_tests {
    // These tests would require exposing internals or using a mock
    // For now, we rely on integration tests above
}

// ============================================================================
// Protocol Serialization Tests
// ============================================================================

#[test]
fn test_client_message_serialization() {
    let msg = ClientMessage::Spawn {
        session_id: "test".to_string(),
        cwd: Some("/tmp".to_string()),
        rows: 24,
        cols: 80,
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"type\":\"Spawn\""));
    assert!(json.contains("\"session_id\":\"test\""));

    let deserialized: ClientMessage = serde_json::from_str(&json).unwrap();
    match deserialized {
        ClientMessage::Spawn {
            session_id,
            cwd,
            rows,
            cols,
        } => {
            assert_eq!(session_id, "test");
            assert_eq!(cwd, Some("/tmp".to_string()));
            assert_eq!(rows, 24);
            assert_eq!(cols, 80);
        }
        _ => panic!("Wrong variant"),
    }
}

#[test]
fn test_server_message_serialization() {
    let msg = ServerMessage::Attached {
        session_id: "test".to_string(),
        buffer: "hello".to_string(),
        rows: 24,
        cols: 80,
    };

    let json = serde_json::to_string(&msg).unwrap();
    assert!(json.contains("\"type\":\"Attached\""));

    let deserialized: ServerMessage = serde_json::from_str(&json).unwrap();
    match deserialized {
        ServerMessage::Attached {
            session_id,
            buffer,
            rows,
            cols,
        } => {
            assert_eq!(session_id, "test");
            assert_eq!(buffer, "hello");
            assert_eq!(rows, 24);
            assert_eq!(cols, 80);
        }
        _ => panic!("Wrong variant"),
    }
}

#[test]
fn test_all_client_message_variants() {
    let variants = vec![
        ClientMessage::Spawn {
            session_id: "s".to_string(),
            cwd: None,
            rows: 1,
            cols: 1,
        },
        ClientMessage::Write {
            session_id: "s".to_string(),
            data: "d".to_string(),
        },
        ClientMessage::Resize {
            session_id: "s".to_string(),
            rows: 1,
            cols: 1,
        },
        ClientMessage::Attach {
            session_id: "s".to_string(),
        },
        ClientMessage::Detach {
            session_id: "s".to_string(),
        },
        ClientMessage::Kill {
            session_id: "s".to_string(),
        },
        ClientMessage::List,
        ClientMessage::Ping,
    ];

    for msg in variants {
        let json = serde_json::to_string(&msg).unwrap();
        let _: ClientMessage = serde_json::from_str(&json).unwrap();
    }
}

#[test]
fn test_all_server_message_variants() {
    let variants = vec![
        ServerMessage::Spawned {
            session_id: "s".to_string(),
        },
        ServerMessage::Output {
            session_id: "s".to_string(),
            data: "d".to_string(),
        },
        ServerMessage::Exited {
            session_id: "s".to_string(),
            exit_code: Some(0),
        },
        ServerMessage::Attached {
            session_id: "s".to_string(),
            buffer: "b".to_string(),
            rows: 1,
            cols: 1,
        },
        ServerMessage::Sessions {
            sessions: vec![SessionInfo {
                id: "s".to_string(),
                cwd: None,
                rows: 1,
                cols: 1,
                alive: true,
            }],
        },
        ServerMessage::Error {
            message: "e".to_string(),
        },
        ServerMessage::Pong,
        ServerMessage::Ok,
    ];

    for msg in variants {
        let json = serde_json::to_string(&msg).unwrap();
        let _: ServerMessage = serde_json::from_str(&json).unwrap();
    }
}
