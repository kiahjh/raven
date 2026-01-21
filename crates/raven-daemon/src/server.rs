use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::Mutex;
use tracing::{error, info, warn};

use crate::protocol::{ClientMessage, ServerMessage};
use crate::session::SessionManager;

use tokio::sync::mpsc;

/// Per-client state tracking which sessions they're attached to
/// Maps session_id -> channel to stop the streaming task
struct ClientState {
    attached_sessions: HashMap<String, mpsc::Sender<()>>,
}

impl ClientState {
    fn new() -> Self {
        Self {
            attached_sessions: HashMap::new(),
        }
    }
}

pub async fn run(socket_path: PathBuf) -> anyhow::Result<()> {
    let listener = UnixListener::bind(&socket_path)?;
    let manager = Arc::new(SessionManager::new());

    info!("Daemon listening on {:?}", socket_path);

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let manager = manager.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_client(stream, manager).await {
                        error!("Client error: {}", e);
                    }
                });
            }
            Err(e) => {
                error!("Accept error: {}", e);
            }
        }
    }
}

async fn handle_client(stream: UnixStream, manager: Arc<SessionManager>) -> anyhow::Result<()> {
    let (reader, writer) = stream.into_split();
    let mut reader = BufReader::new(reader);
    let writer = Arc::new(Mutex::new(writer));
    let client_state = Arc::new(Mutex::new(ClientState::new()));
    let mut line = String::new();

    loop {
        line.clear();
        let n = reader.read_line(&mut line).await?;
        if n == 0 {
            break; // Connection closed
        }

        let msg: ClientMessage = match serde_json::from_str(&line) {
            Ok(m) => m,
            Err(e) => {
                let response = ServerMessage::Error {
                    message: format!("Invalid message: {}", e),
                };
                let mut w = writer.lock().await;
                send_message(&mut w, &response).await?;
                continue;
            }
        };

        // Handle attach specially - need to start streaming
        if let ClientMessage::Attach { ref session_id } = msg {
            let session_id = session_id.clone();

            // First, stop any existing streaming task for this session
            {
                let mut state = client_state.lock().await;
                if let Some(stop_tx) = state.attached_sessions.remove(&session_id) {
                    // Signal the old task to stop (ignore if already closed)
                    let _ = stop_tx.send(()).await;
                }
            }

            // Get initial state
            match (
                manager.get_buffer(&session_id),
                manager.get_info(&session_id),
            ) {
                (Ok(buffer), Ok(info)) => {
                    // Send attach response
                    let response = ServerMessage::Attached {
                        session_id: session_id.clone(),
                        buffer,
                        rows: info.rows,
                        cols: info.cols,
                    };
                    {
                        let mut w = writer.lock().await;
                        send_message(&mut w, &response).await?;
                    }

                    // Subscribe to output and spawn streaming task
                    if let Ok(mut rx) = manager.subscribe(&session_id) {
                        let writer = writer.clone();
                        let session_id_clone = session_id.clone();
                        
                        // Create channel to signal stop
                        let (stop_tx, mut stop_rx) = mpsc::channel::<()>(1);

                        // Track this session with its stop channel
                        client_state
                            .lock()
                            .await
                            .attached_sessions
                            .insert(session_id.clone(), stop_tx);

                        tokio::spawn(async move {
                            loop {
                                tokio::select! {
                                    // Check for stop signal
                                    _ = stop_rx.recv() => {
                                        break;
                                    }
                                    // Process output from PTY
                                    result = rx.recv() => {
                                        match result {
                                            Ok(data) => {
                                                let msg = ServerMessage::Output {
                                                    session_id: session_id_clone.clone(),
                                                    data,
                                                };
                                                let mut w = writer.lock().await;
                                                if send_message(&mut w, &msg).await.is_err() {
                                                    break;
                                                }
                                            }
                                            Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                                                warn!("Client lagged, missed {} messages", n);
                                            }
                                            Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                                                break;
                                            }
                                        }
                                    }
                                }
                            }
                        });
                    }
                }
                (Err(e), _) | (_, Err(e)) => {
                    let response = ServerMessage::Error { message: e };
                    let mut w = writer.lock().await;
                    send_message(&mut w, &response).await?;
                }
            }
            continue;
        }

        // Handle detach - stop streaming
        if let ClientMessage::Detach { ref session_id } = msg {
            let mut state = client_state.lock().await;
            if let Some(stop_tx) = state.attached_sessions.remove(session_id) {
                let _ = stop_tx.send(()).await;
            }
            drop(state);
            
            let response = ServerMessage::Ok;
            let mut w = writer.lock().await;
            send_message(&mut w, &response).await?;
            continue;
        }

        let response = handle_message(msg, &manager).await;
        let mut w = writer.lock().await;
        send_message(&mut w, &response).await?;
    }

    // Clean up: stop all streaming tasks when client disconnects
    let state = client_state.lock().await;
    for (_, stop_tx) in state.attached_sessions.iter() {
        let _ = stop_tx.send(()).await;
    }

    Ok(())
}

async fn handle_message(msg: ClientMessage, manager: &SessionManager) -> ServerMessage {
    match msg {
        ClientMessage::Spawn {
            session_id,
            cwd,
            rows,
            cols,
        } => match manager.spawn(session_id.clone(), cwd, rows, cols) {
            Ok(()) => ServerMessage::Spawned { session_id },
            Err(e) => ServerMessage::Error { message: e },
        },
        ClientMessage::Write { session_id, data } => match manager.write(&session_id, &data) {
            Ok(()) => ServerMessage::Ok,
            Err(e) => ServerMessage::Error { message: e },
        },
        ClientMessage::Resize {
            session_id,
            rows,
            cols,
        } => match manager.resize(&session_id, rows, cols) {
            Ok(()) => ServerMessage::Ok,
            Err(e) => ServerMessage::Error { message: e },
        },
        // Attach and Detach are handled specially in handle_client
        ClientMessage::Attach { .. } | ClientMessage::Detach { .. } => {
            unreachable!("Attach/Detach handled in handle_client")
        }
        ClientMessage::Kill { session_id } => match manager.kill(&session_id) {
            Ok(()) => ServerMessage::Ok,
            Err(e) => ServerMessage::Error { message: e },
        },
        ClientMessage::List => ServerMessage::Sessions {
            sessions: manager.list(),
        },
        ClientMessage::Ping => ServerMessage::Pong,
    }
}

async fn send_message(
    writer: &mut tokio::net::unix::OwnedWriteHalf,
    msg: &ServerMessage,
) -> anyhow::Result<()> {
    let json = serde_json::to_string(msg)?;
    writer.write_all(json.as_bytes()).await?;
    writer.write_all(b"\n").await?;
    writer.flush().await?;
    Ok(())
}
