//! LSP Manager - orchestrates language servers for projects.

use super::protocol::{
    CodeAction, CodeActionContext, CodeActionParams, CodeActionResponse, CodeActionTriggerKind,
    CompletionItem, CompletionResponse, DefinitionResponse, Diagnostic,
    DidChangeTextDocumentParams, DidCloseTextDocumentParams, DidOpenTextDocumentParams, Hover,
    HoverContents, Location, MarkedString, Position, Range, ReferenceContext, ReferenceParams,
    TextDocumentContentChangeEvent, TextDocumentIdentifier, TextDocumentItem,
    TextDocumentPositionParams, VersionedTextDocumentIdentifier,
};
use super::server::{spawn_and_initialize, LanguageServer, ServerNotification};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;
use tauri::{AppHandle, Emitter};

/// Configuration for a language server.
#[derive(Debug, Clone)]
pub struct LanguageServerConfig {
    pub command: String,
    pub args: Vec<String>,
}

impl LanguageServerConfig {
    /// rust-analyzer configuration.
    pub fn rust_analyzer() -> Self {
        Self {
            command: "rust-analyzer".to_string(),
            args: vec![],
        }
    }
}

/// Tracks an open document.
#[derive(Debug, Clone)]
struct OpenDocument {
    version: i32,
}

/// State for a project's LSP connection.
struct ProjectLsp {
    server: Arc<LanguageServer>,
    documents: Mutex<HashMap<String, OpenDocument>>,
}

/// Manages all LSP connections.
pub struct LspManager {
    /// Language server configs by language ID
    configs: Vec<LanguageServerConfig>,
    /// Active servers by root path
    servers: Mutex<HashMap<String, Arc<ProjectLsp>>>,
}

impl LspManager {
    pub fn new() -> Self {
        Self {
            configs: vec![LanguageServerConfig::rust_analyzer()],
            servers: Mutex::new(HashMap::new()),
        }
    }

    /// Start a language server for a project.
    pub fn start(&self, root_path: &str, app: AppHandle) -> Result<(), String> {
        let root_uri = format!("file://{}", root_path);

        // Check if already running
        {
            let servers = self.servers.lock();
            if servers.contains_key(root_path) {
                return Ok(());
            }
        }

        // Find config (for now, assume rust-analyzer)
        let config = &self.configs[0]; // TODO: proper config selection

        // Create notification channel
        let (notif_sender, notif_receiver) = mpsc::channel::<ServerNotification>();

        // Spawn server
        let server = spawn_and_initialize(&config.command, &config.args, &root_uri, notif_sender)?;

        let project = Arc::new(ProjectLsp {
            server,
            documents: Mutex::new(HashMap::new()),
        });

        // Start notification handler thread
        let app_clone = app.clone();
        thread::spawn(move || {
            for notif in notif_receiver {
                match notif {
                    ServerNotification::Diagnostics(params) => {
                        // Emit to frontend
                        let _ = app_clone.emit("lsp:diagnostics", &params);
                    }
                }
            }
        });

        // Store server
        {
            let mut servers = self.servers.lock();
            servers.insert(root_path.to_string(), project);
        }

        Ok(())
    }

    /// Stop a language server for a project.
    pub fn stop(&self, root_path: &str) -> Result<(), String> {
        let project = {
            let mut servers = self.servers.lock();
            servers.remove(root_path)
        };

        if let Some(project) = project {
            // Send shutdown request
            let _: () = project.server.request("shutdown", None).unwrap_or_default();

            // Send exit notification
            project.server.notify("exit", None).ok();
        }

        Ok(())
    }

    /// Get the server for a project if running.
    fn get_project(&self, root_path: &str) -> Option<Arc<ProjectLsp>> {
        let servers = self.servers.lock();
        servers.get(root_path).cloned()
    }

    /// Open a document.
    pub fn open_document(
        &self,
        root_path: &str,
        file_path: &str,
        content: &str,
    ) -> Result<(), String> {
        let project = self
            .get_project(root_path)
            .ok_or_else(|| "Server not running".to_string())?;

        let uri = format!("file://{}", file_path);
        let language_id = self.detect_language(file_path);

        // Check if already open
        {
            let docs = project.documents.lock();
            if docs.contains_key(&uri) {
                return Ok(());
            }
        }

        let params = DidOpenTextDocumentParams {
            text_document: TextDocumentItem {
                uri: uri.clone(),
                language_id: language_id.clone(),
                version: 1,
                text: content.to_string(),
            },
        };

        project.server.notify(
            "textDocument/didOpen",
            Some(serde_json::to_value(&params).unwrap()),
        )?;

        // Track document
        {
            let mut docs = project.documents.lock();
            docs.insert(uri, OpenDocument { version: 1 });
        }

        Ok(())
    }

    /// Update a document's content.
    pub fn change_document(
        &self,
        root_path: &str,
        file_path: &str,
        content: &str,
    ) -> Result<(), String> {
        let project = self
            .get_project(root_path)
            .ok_or_else(|| "Server not running".to_string())?;

        let uri = format!("file://{}", file_path);

        // Get and increment version
        let version = {
            let mut docs = project.documents.lock();
            if let Some(doc) = docs.get_mut(&uri) {
                doc.version += 1;
                doc.version
            } else {
                // Not open, open it first
                drop(docs);
                return self.open_document(root_path, file_path, content);
            }
        };

        let params = DidChangeTextDocumentParams {
            text_document: VersionedTextDocumentIdentifier {
                uri: uri.clone(),
                version,
            },
            content_changes: vec![TextDocumentContentChangeEvent {
                text: content.to_string(),
            }],
        };

        project.server.notify(
            "textDocument/didChange",
            Some(serde_json::to_value(&params).unwrap()),
        )
    }

    /// Close a document.
    pub fn close_document(&self, root_path: &str, file_path: &str) -> Result<(), String> {
        let project = self
            .get_project(root_path)
            .ok_or_else(|| "Server not running".to_string())?;

        let uri = format!("file://{}", file_path);

        // Remove from tracking
        {
            let mut docs = project.documents.lock();
            docs.remove(&uri);
        }

        let params = DidCloseTextDocumentParams {
            text_document: TextDocumentIdentifier { uri },
        };

        project.server.notify(
            "textDocument/didClose",
            Some(serde_json::to_value(&params).unwrap()),
        )
    }

    /// Go to definition.
    pub fn goto_definition(
        &self,
        root_path: &str,
        file_path: &str,
        line: u32,
        character: u32,
    ) -> Result<Vec<Location>, String> {
        let project = self
            .get_project(root_path)
            .ok_or_else(|| "Server not running".to_string())?;

        let params = TextDocumentPositionParams {
            text_document: TextDocumentIdentifier {
                uri: format!("file://{}", file_path),
            },
            position: Position { line, character },
        };

        let response: Option<DefinitionResponse> = project.server.request(
            "textDocument/definition",
            Some(serde_json::to_value(&params).unwrap()),
        )?;

        Ok(response.map(|r| r.into_locations()).unwrap_or_default())
    }

    /// Get hover information.
    pub fn hover(
        &self,
        root_path: &str,
        file_path: &str,
        line: u32,
        character: u32,
    ) -> Result<Option<Hover>, String> {
        let project = self
            .get_project(root_path)
            .ok_or_else(|| "Server not running".to_string())?;

        let params = TextDocumentPositionParams {
            text_document: TextDocumentIdentifier {
                uri: format!("file://{}", file_path),
            },
            position: Position { line, character },
        };

        project.server.request(
            "textDocument/hover",
            Some(serde_json::to_value(&params).unwrap()),
        )
    }

    /// Get completions.
    pub fn completion(
        &self,
        root_path: &str,
        file_path: &str,
        line: u32,
        character: u32,
    ) -> Result<Vec<CompletionItem>, String> {
        let project = self
            .get_project(root_path)
            .ok_or_else(|| "Server not running".to_string())?;

        let params = TextDocumentPositionParams {
            text_document: TextDocumentIdentifier {
                uri: format!("file://{}", file_path),
            },
            position: Position { line, character },
        };

        let response: Option<CompletionResponse> = project.server.request(
            "textDocument/completion",
            Some(serde_json::to_value(&params).unwrap()),
        )?;

        Ok(response.map(|r| r.into_items()).unwrap_or_default())
    }

    /// Find references.
    pub fn references(
        &self,
        root_path: &str,
        file_path: &str,
        line: u32,
        character: u32,
        include_declaration: bool,
    ) -> Result<Vec<Location>, String> {
        let project = self
            .get_project(root_path)
            .ok_or_else(|| "Server not running".to_string())?;

        let params = ReferenceParams {
            text_document: TextDocumentIdentifier {
                uri: format!("file://{}", file_path),
            },
            position: Position { line, character },
            context: ReferenceContext {
                include_declaration,
            },
        };

        let response: Option<Vec<Location>> = project.server.request(
            "textDocument/references",
            Some(serde_json::to_value(&params).unwrap()),
        )?;

        Ok(response.unwrap_or_default())
    }

    /// Get code actions for a range.
    pub fn code_actions(
        &self,
        root_path: &str,
        file_path: &str,
        start_line: u32,
        start_character: u32,
        end_line: u32,
        end_character: u32,
        diagnostics: Vec<Diagnostic>,
    ) -> Result<Vec<CodeAction>, String> {
        let project = self
            .get_project(root_path)
            .ok_or_else(|| "Server not running".to_string())?;

        let params = CodeActionParams {
            text_document: TextDocumentIdentifier {
                uri: format!("file://{}", file_path),
            },
            range: Range {
                start: Position {
                    line: start_line,
                    character: start_character,
                },
                end: Position {
                    line: end_line,
                    character: end_character,
                },
            },
            context: CodeActionContext {
                diagnostics,
                only: None,
                trigger_kind: Some(CodeActionTriggerKind::INVOKED),
            },
        };

        let response: Option<CodeActionResponse> = project.server.request(
            "textDocument/codeAction",
            Some(serde_json::to_value(&params).unwrap()),
        )?;

        Ok(response.map(|r| r.into_actions()).unwrap_or_default())
    }

    /// Resolve a code action (get full edit details).
    pub fn resolve_code_action(
        &self,
        root_path: &str,
        code_action: CodeAction,
    ) -> Result<CodeAction, String> {
        let project = self
            .get_project(root_path)
            .ok_or_else(|| "Server not running".to_string())?;

        let resolved: CodeAction = project.server.request(
            "codeAction/resolve",
            Some(serde_json::to_value(&code_action).unwrap()),
        )?;

        Ok(resolved)
    }

    /// Detect language ID from file extension.
    fn detect_language(&self, file_path: &str) -> String {
        let path = Path::new(file_path);
        match path.extension().and_then(|e| e.to_str()) {
            Some("rs") => "rust".to_string(),
            Some("ts") => "typescript".to_string(),
            Some("tsx") => "typescriptreact".to_string(),
            Some("js") => "javascript".to_string(),
            Some("jsx") => "javascriptreact".to_string(),
            Some("json") => "json".to_string(),
            Some("md") => "markdown".to_string(),
            Some("toml") => "toml".to_string(),
            Some("yaml") | Some("yml") => "yaml".to_string(),
            _ => "plaintext".to_string(),
        }
    }
}

// Tauri command wrappers

/// Serialized location for frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializedLocation {
    pub uri: String,
    pub range: SerializedRange,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializedRange {
    pub start: SerializedPosition,
    pub end: SerializedPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializedPosition {
    pub line: u32,
    pub character: u32,
}

impl From<Location> for SerializedLocation {
    fn from(loc: Location) -> Self {
        Self {
            uri: loc.uri,
            range: SerializedRange {
                start: SerializedPosition {
                    line: loc.range.start.line,
                    character: loc.range.start.character,
                },
                end: SerializedPosition {
                    line: loc.range.end.line,
                    character: loc.range.end.character,
                },
            },
        }
    }
}

/// Serialized hover result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerializedHover {
    pub contents: String,
    pub range: Option<SerializedRange>,
}

impl From<Hover> for SerializedHover {
    fn from(hover: Hover) -> Self {
        let contents = match hover.contents {
            HoverContents::Markup(m) => m.value,
            HoverContents::String(s) => s,
            HoverContents::MarkedString(MarkedString::String(s)) => s,
            HoverContents::MarkedString(MarkedString::LanguageString { value, .. }) => value,
            HoverContents::Array(arr) => arr
                .into_iter()
                .map(|m| match m {
                    MarkedString::String(s) => s,
                    MarkedString::LanguageString { value, .. } => value,
                })
                .collect::<Vec<_>>()
                .join("\n\n"),
        };

        Self {
            contents,
            range: hover.range.map(|r| SerializedRange {
                start: SerializedPosition {
                    line: r.start.line,
                    character: r.start.character,
                },
                end: SerializedPosition {
                    line: r.end.line,
                    character: r.end.character,
                },
            }),
        }
    }
}

/// Serialized completion item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedCompletionItem {
    pub label: String,
    pub kind: Option<u8>,
    pub detail: Option<String>,
    pub insert_text: Option<String>,
    pub filter_text: Option<String>,
}

impl From<CompletionItem> for SerializedCompletionItem {
    fn from(item: CompletionItem) -> Self {
        Self {
            label: item.label,
            kind: item.kind.map(|k| k.0),
            detail: item.detail,
            insert_text: item.insert_text,
            filter_text: item.filter_text,
        }
    }
}

/// Serialized text edit for frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedTextEdit {
    pub range: SerializedRange,
    pub new_text: String,
}

impl From<super::protocol::TextEdit> for SerializedTextEdit {
    fn from(edit: super::protocol::TextEdit) -> Self {
        Self {
            range: SerializedRange {
                start: SerializedPosition {
                    line: edit.range.start.line,
                    character: edit.range.start.character,
                },
                end: SerializedPosition {
                    line: edit.range.end.line,
                    character: edit.range.end.character,
                },
            },
            new_text: edit.new_text,
        }
    }
}

/// Serialized workspace edit for frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedWorkspaceEdit {
    /// Map of file URI to list of text edits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changes: Option<std::collections::HashMap<String, Vec<SerializedTextEdit>>>,
    /// Document changes (for more complex edits).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_changes: Option<Vec<SerializedDocumentChange>>,
}

/// Serialized document change for frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedDocumentChange {
    /// The document to edit.
    pub uri: String,
    /// The edits to apply.
    pub edits: Vec<SerializedTextEdit>,
}

impl From<super::protocol::WorkspaceEdit> for SerializedWorkspaceEdit {
    fn from(edit: super::protocol::WorkspaceEdit) -> Self {
        let changes = edit.changes.map(|c| {
            c.into_iter()
                .map(|(uri, edits)| {
                    (
                        uri,
                        edits.into_iter().map(SerializedTextEdit::from).collect(),
                    )
                })
                .collect()
        });

        let document_changes = edit.document_changes.map(|dc| {
            dc.into_iter()
                .filter_map(|change| {
                    match change {
                        super::protocol::DocumentChange::Edit(edit) => {
                            Some(SerializedDocumentChange {
                                uri: edit.text_document.uri,
                                edits: edit
                                    .edits
                                    .into_iter()
                                    .map(|e| match e {
                                        super::protocol::TextEditOrAnnotated::TextEdit(te) => {
                                            SerializedTextEdit::from(te)
                                        }
                                        super::protocol::TextEditOrAnnotated::Annotated(ate) => {
                                            SerializedTextEdit {
                                                range: SerializedRange {
                                                    start: SerializedPosition {
                                                        line: ate.range.start.line,
                                                        character: ate.range.start.character,
                                                    },
                                                    end: SerializedPosition {
                                                        line: ate.range.end.line,
                                                        character: ate.range.end.character,
                                                    },
                                                },
                                                new_text: ate.new_text,
                                            }
                                        }
                                    })
                                    .collect(),
                            })
                        }
                        // For now, skip create/rename/delete operations
                        _ => None,
                    }
                })
                .collect()
        });

        Self {
            changes,
            document_changes,
        }
    }
}

/// Serialized code action for frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedCodeAction {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_preferred: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled_reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit: Option<SerializedWorkspaceEdit>,
    /// Original code action JSON for resolve requests.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    /// Whether this action needs to be resolved before execution.
    pub needs_resolve: bool,
}

impl From<CodeAction> for SerializedCodeAction {
    fn from(action: CodeAction) -> Self {
        // Check if we need to resolve (has data but no edit)
        let needs_resolve = action.edit.is_none() && action.data.is_some();

        Self {
            title: action.title,
            kind: action.kind,
            is_preferred: action.is_preferred,
            disabled_reason: action.disabled.map(|d| d.reason),
            edit: action.edit.map(SerializedWorkspaceEdit::from),
            data: action.data,
            needs_resolve,
        }
    }
}
