//! LSP Manager - orchestrates language servers for projects.

use super::protocol::*;
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
    pub language_id: String,
    pub command: String,
    pub args: Vec<String>,
    pub file_patterns: Vec<String>,
    pub root_markers: Vec<String>,
}

impl LanguageServerConfig {
    /// rust-analyzer configuration.
    pub fn rust_analyzer() -> Self {
        Self {
            language_id: "rust".to_string(),
            command: "rust-analyzer".to_string(),
            args: vec![],
            file_patterns: vec!["*.rs".to_string()],
            root_markers: vec!["Cargo.toml".to_string()],
        }
    }
}

/// Tracks an open document.
#[derive(Debug, Clone)]
struct OpenDocument {
    uri: String,
    language_id: String,
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

    /// Find a config that matches the given file.
    fn config_for_file(&self, file_path: &str) -> Option<&LanguageServerConfig> {
        let path = Path::new(file_path);
        let extension = path.extension()?.to_str()?;

        for config in &self.configs {
            for pattern in &config.file_patterns {
                // Simple extension matching (*.rs -> rs)
                if let Some(ext) = pattern.strip_prefix("*.") {
                    if ext == extension {
                        return Some(config);
                    }
                }
            }
        }
        None
    }

    /// Find the project root for a file based on root markers.
    fn find_root(&self, file_path: &str, config: &LanguageServerConfig) -> Option<String> {
        let path = Path::new(file_path);
        let mut dir = path.parent()?;

        loop {
            for marker in &config.root_markers {
                if dir.join(marker).exists() {
                    return Some(dir.to_string_lossy().to_string());
                }
            }
            dir = dir.parent()?;
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
            docs.insert(
                uri.clone(),
                OpenDocument {
                    uri,
                    language_id,
                    version: 1,
                },
            );
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
