//! LSP server management.
//!
//! Handles spawning language servers, sending requests, and routing responses.

use super::protocol::*;
use super::transport::*;
use parking_lot::Mutex;
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

/// A pending request waiting for a response.
struct PendingRequest {
    sender: mpsc::Sender<Result<JsonValue, ResponseError>>,
}

/// A running language server.
pub struct LanguageServer {
    #[allow(dead_code)]
    process: Child,
    writer: Mutex<MessageWriter>,
    next_id: AtomicU64,
    /// Shared with reader thread - must be Arc
    pending: Arc<Mutex<HashMap<u64, PendingRequest>>>,
    capabilities: Mutex<Option<ServerCapabilities>>,
    /// Channel for server notifications (diagnostics, etc.)
    #[allow(dead_code)]
    notification_sender: mpsc::Sender<ServerNotification>,
    /// Handle to the reader thread
    _reader_handle: thread::JoinHandle<()>,
}

/// Notifications from the server that we care about.
#[derive(Debug, Clone)]
pub enum ServerNotification {
    Diagnostics(PublishDiagnosticsParams),
}

impl LanguageServer {
    /// Allocate the next request ID.
    fn next_request_id(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::SeqCst)
    }

    /// Send a request and wait for the response.
    pub fn request<T: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        params: Option<JsonValue>,
    ) -> Result<T, String> {
        self.request_with_timeout(method, params, Duration::from_secs(30))
    }

    /// Send a request with a custom timeout.
    pub fn request_with_timeout<T: serde::de::DeserializeOwned>(
        &self,
        method: &str,
        params: Option<JsonValue>,
        timeout: Duration,
    ) -> Result<T, String> {
        let id = self.next_request_id();
        let (sender, receiver) = mpsc::channel();

        // Register pending request
        {
            let mut pending = self.pending.lock();
            pending.insert(id, PendingRequest { sender });
        }

        // Send request
        let request = Request::new(id, method, params);
        {
            let mut writer = self.writer.lock();
            writer
                .send_request(&request)
                .map_err(|e| format!("Failed to send request: {}", e))?;
        }

        // Wait for response
        let result = receiver
            .recv_timeout(timeout)
            .map_err(|_| format!("Request {} timed out", method))?;

        // Clean up pending (in case of timeout race)
        {
            let mut pending = self.pending.lock();
            pending.remove(&id);
        }

        match result {
            Ok(value) => serde_json::from_value(value)
                .map_err(|e| format!("Failed to parse response: {}", e)),
            Err(err) => Err(err.to_string()),
        }
    }

    /// Send a notification (no response expected).
    pub fn notify(&self, method: &str, params: Option<JsonValue>) -> Result<(), String> {
        let notification = Notification::new(method, params);
        let mut writer = self.writer.lock();
        writer
            .send_notification(&notification)
            .map_err(|e| format!("Failed to send notification: {}", e))
    }

    /// Get server capabilities (available after initialization).
    #[allow(dead_code)]
    pub fn capabilities(&self) -> Option<ServerCapabilities> {
        self.capabilities.lock().clone()
    }
}

/// Spawn a language server and perform the LSP initialization handshake.
pub fn spawn_and_initialize(
    command: &str,
    args: &[String],
    root_uri: &str,
    notification_sender: mpsc::Sender<ServerNotification>,
) -> Result<Arc<LanguageServer>, String> {
    // Spawn the process
    let mut process = Command::new(command)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to spawn {}: {}", command, e))?;

    let stdin = process
        .stdin
        .take()
        .ok_or_else(|| "Failed to get stdin".to_string())?;
    let stdout = process
        .stdout
        .take()
        .ok_or_else(|| "Failed to get stdout".to_string())?;

    let writer = Mutex::new(MessageWriter::new(stdin));
    let pending: Arc<Mutex<HashMap<u64, PendingRequest>>> = Arc::new(Mutex::new(HashMap::new()));
    let next_id = AtomicU64::new(1);

    // Spawn reader thread
    let pending_for_reader = pending.clone();
    let notif_sender = notification_sender.clone();
    let reader_handle = thread::spawn(move || {
        let reader = MessageReader::spawn(stdout);
        loop {
            match reader.recv() {
                Some(msg) => {
                    if msg.is_response() {
                        // Route response to waiting request
                        if let Some(id) = msg.id {
                            let mut pending = pending_for_reader.lock();
                            if let Some(req) = pending.remove(&id) {
                                let result = if let Some(err) = msg.error {
                                    Err(err)
                                } else {
                                    Ok(msg.result.unwrap_or(JsonValue::Null))
                                };
                                let _ = req.sender.send(result);
                            }
                        }
                    } else if msg.is_notification() {
                        // Handle notifications
                        if let Some(method) = &msg.method {
                            match method.as_str() {
                                "textDocument/publishDiagnostics" => {
                                    if let Some(params) = msg.params {
                                        if let Ok(diag_params) =
                                            serde_json::from_value::<PublishDiagnosticsParams>(
                                                params,
                                            )
                                        {
                                            let _ = notif_sender
                                                .send(ServerNotification::Diagnostics(diag_params));
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
                None => {
                    // Server closed
                    break;
                }
            }
        }
    });

    // Helper struct for initialization phase
    struct InitHelper<'a> {
        writer: &'a Mutex<MessageWriter>,
        next_id: &'a AtomicU64,
        pending: &'a Arc<Mutex<HashMap<u64, PendingRequest>>>,
    }

    impl<'a> InitHelper<'a> {
        fn request<T: serde::de::DeserializeOwned>(
            &self,
            method: &str,
            params: Option<JsonValue>,
        ) -> Result<T, String> {
            let id = self.next_id.fetch_add(1, Ordering::SeqCst);
            let (sender, receiver) = mpsc::channel();

            {
                let mut pending = self.pending.lock();
                pending.insert(id, PendingRequest { sender });
            }

            let request = Request::new(id, method, params);
            {
                let mut writer = self.writer.lock();
                writer
                    .send_request(&request)
                    .map_err(|e| format!("Failed to send request: {}", e))?;
            }

            let result = receiver
                .recv_timeout(Duration::from_secs(30))
                .map_err(|_| format!("Request {} timed out", method))?;

            {
                let mut pending = self.pending.lock();
                pending.remove(&id);
            }

            match result {
                Ok(value) => serde_json::from_value(value)
                    .map_err(|e| format!("Failed to parse response: {}", e)),
                Err(err) => Err(err.to_string()),
            }
        }

        fn notify(&self, method: &str, params: Option<JsonValue>) -> Result<(), String> {
            let notification = Notification::new(method, params);
            let mut writer = self.writer.lock();
            writer
                .send_notification(&notification)
                .map_err(|e| format!("Failed to send notification: {}", e))
        }
    }

    let helper = InitHelper {
        writer: &writer,
        next_id: &next_id,
        pending: &pending,
    };

    // Send initialize request
    let init_params = InitializeParams {
        process_id: Some(std::process::id()),
        client_info: Some(ClientInfo {
            name: "raven".to_string(),
            version: Some(env!("CARGO_PKG_VERSION").to_string()),
        }),
        root_uri: Some(root_uri.to_string()),
        capabilities: ClientCapabilities {
            text_document: Some(TextDocumentClientCapabilities {
                synchronization: Some(TextDocumentSyncClientCapabilities {
                    did_save: Some(true),
                }),
                completion: Some(CompletionClientCapabilities {
                    completion_item: Some(CompletionItemClientCapabilities {
                        snippet_support: Some(true),
                        documentation_format: Some(vec![
                            MarkupKind::Markdown,
                            MarkupKind::PlainText,
                        ]),
                    }),
                }),
                hover: Some(HoverClientCapabilities {
                    content_format: Some(vec![MarkupKind::Markdown, MarkupKind::PlainText]),
                }),
                definition: Some(DefinitionClientCapabilities {
                    link_support: Some(true),
                }),
                references: Some(ReferencesClientCapabilities {}),
                publish_diagnostics: Some(PublishDiagnosticsClientCapabilities {}),
                code_action: Some(CodeActionClientCapabilities {
                    dynamic_registration: Some(false),
                    code_action_literal_support: Some(CodeActionLiteralSupport {
                        code_action_kind: Some(CodeActionKindValueSet {
                            value_set: vec![
                                "quickfix".to_string(),
                                "refactor".to_string(),
                                "refactor.extract".to_string(),
                                "refactor.inline".to_string(),
                                "refactor.rewrite".to_string(),
                                "source".to_string(),
                                "source.organizeImports".to_string(),
                            ],
                        }),
                    }),
                    is_preferred_support: Some(true),
                    disabled_support: Some(true),
                    data_support: Some(true),
                    resolve_support: Some(CodeActionResolveSupport {
                        properties: vec!["edit".to_string()],
                    }),
                }),
            }),
        },
    };

    let init_result: InitializeResult = helper.request(
        "initialize",
        Some(serde_json::to_value(&init_params).unwrap()),
    )?;

    // Send initialized notification
    helper.notify("initialized", Some(serde_json::json!({})))?;

    // Create the server struct
    let server = LanguageServer {
        process,
        writer,
        next_id,
        pending,
        capabilities: Mutex::new(Some(init_result.capabilities)),
        notification_sender,
        _reader_handle: reader_handle,
    };

    Ok(Arc::new(server))
}
