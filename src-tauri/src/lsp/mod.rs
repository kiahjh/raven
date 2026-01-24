//! LSP (Language Server Protocol) integration.
//!
//! This module provides LSP client functionality for communicating with
//! language servers like rust-analyzer.

mod manager;
mod protocol;
mod server;
mod transport;

pub use manager::{
    LspManager, SerializedCodeAction, SerializedCompletionItem, SerializedHover, SerializedLocation,
};

use std::path::Path;
use tauri::{AppHandle, State};

/// Find the LSP root directory for a given file.
/// For Rust, this finds the nearest directory containing Cargo.toml.
fn find_lsp_root(file_path: &str) -> Option<String> {
    let path = Path::new(file_path);
    let mut dir = path.parent()?;

    loop {
        // Check for Cargo.toml (Rust)
        if dir.join("Cargo.toml").exists() {
            return Some(dir.to_string_lossy().to_string());
        }

        // Check for package.json (JS/TS)
        if dir.join("package.json").exists() {
            return Some(dir.to_string_lossy().to_string());
        }

        dir = match dir.parent() {
            Some(p) => p,
            None => return None,
        };
    }
}

// Tauri commands

/// Get the LSP root directory for a file.
#[tauri::command]
pub fn lsp_find_root(file_path: String) -> Option<String> {
    find_lsp_root(&file_path)
}

#[tauri::command]
pub fn lsp_start(
    app: AppHandle,
    state: State<'_, LspManager>,
    root_path: String,
) -> Result<(), String> {
    state.start(&root_path, app)
}

#[tauri::command]
pub fn lsp_stop(state: State<'_, LspManager>, root_path: String) -> Result<(), String> {
    state.stop(&root_path)
}

#[tauri::command]
pub fn lsp_open_document(
    state: State<'_, LspManager>,
    root_path: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    state.open_document(&root_path, &file_path, &content)
}

#[tauri::command]
pub fn lsp_change_document(
    state: State<'_, LspManager>,
    root_path: String,
    file_path: String,
    content: String,
) -> Result<(), String> {
    state.change_document(&root_path, &file_path, &content)
}

#[tauri::command]
pub fn lsp_close_document(
    state: State<'_, LspManager>,
    root_path: String,
    file_path: String,
) -> Result<(), String> {
    state.close_document(&root_path, &file_path)
}

#[tauri::command]
pub fn lsp_goto_definition(
    state: State<'_, LspManager>,
    root_path: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Vec<SerializedLocation>, String> {
    state
        .goto_definition(&root_path, &file_path, line, character)
        .map(|locs| locs.into_iter().map(SerializedLocation::from).collect())
}

#[tauri::command]
pub fn lsp_hover(
    state: State<'_, LspManager>,
    root_path: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Option<SerializedHover>, String> {
    state
        .hover(&root_path, &file_path, line, character)
        .map(|h| h.map(SerializedHover::from))
}

#[tauri::command]
pub fn lsp_completion(
    state: State<'_, LspManager>,
    root_path: String,
    file_path: String,
    line: u32,
    character: u32,
) -> Result<Vec<SerializedCompletionItem>, String> {
    state
        .completion(&root_path, &file_path, line, character)
        .map(|items| {
            items
                .into_iter()
                .map(SerializedCompletionItem::from)
                .collect()
        })
}

#[tauri::command]
pub fn lsp_references(
    state: State<'_, LspManager>,
    root_path: String,
    file_path: String,
    line: u32,
    character: u32,
    include_declaration: bool,
) -> Result<Vec<SerializedLocation>, String> {
    state
        .references(&root_path, &file_path, line, character, include_declaration)
        .map(|locs| locs.into_iter().map(SerializedLocation::from).collect())
}

/// Serialized diagnostic for the code action request.
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedDiagnostic {
    pub range: manager::SerializedRange,
    pub severity: Option<u8>,
    pub code: Option<serde_json::Value>,
    pub source: Option<String>,
    pub message: String,
}

impl From<SerializedDiagnostic> for protocol::Diagnostic {
    fn from(d: SerializedDiagnostic) -> Self {
        Self {
            range: protocol::Range {
                start: protocol::Position {
                    line: d.range.start.line,
                    character: d.range.start.character,
                },
                end: protocol::Position {
                    line: d.range.end.line,
                    character: d.range.end.character,
                },
            },
            severity: d.severity.map(protocol::DiagnosticSeverity),
            code: d.code.and_then(|v| match v {
                serde_json::Value::Number(n) => n
                    .as_i64()
                    .map(|n| protocol::DiagnosticCode::Number(n as i32)),
                serde_json::Value::String(s) => Some(protocol::DiagnosticCode::String(s)),
                _ => None,
            }),
            source: d.source,
            message: d.message,
        }
    }
}

#[tauri::command]
pub fn lsp_code_actions(
    state: State<'_, LspManager>,
    root_path: String,
    file_path: String,
    start_line: u32,
    start_character: u32,
    end_line: u32,
    end_character: u32,
    diagnostics: Vec<SerializedDiagnostic>,
) -> Result<Vec<SerializedCodeAction>, String> {
    let protocol_diagnostics: Vec<protocol::Diagnostic> = diagnostics
        .into_iter()
        .map(protocol::Diagnostic::from)
        .collect();

    state
        .code_actions(
            &root_path,
            &file_path,
            start_line,
            start_character,
            end_line,
            end_character,
            protocol_diagnostics,
        )
        .map(|actions| {
            actions
                .into_iter()
                .map(SerializedCodeAction::from)
                .collect()
        })
}

/// Code action for resolve request (sent back from frontend).
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeActionForResolve {
    pub title: String,
    pub kind: Option<String>,
    pub is_preferred: Option<bool>,
    pub data: Option<serde_json::Value>,
}

impl From<CodeActionForResolve> for protocol::CodeAction {
    fn from(ca: CodeActionForResolve) -> Self {
        Self {
            title: ca.title,
            kind: ca.kind,
            diagnostics: None,
            is_preferred: ca.is_preferred,
            disabled: None,
            edit: None,
            command: None,
            data: ca.data,
        }
    }
}

#[tauri::command]
pub fn lsp_resolve_code_action(
    state: State<'_, LspManager>,
    root_path: String,
    code_action: CodeActionForResolve,
) -> Result<SerializedCodeAction, String> {
    state
        .resolve_code_action(&root_path, code_action.into())
        .map(SerializedCodeAction::from)
}
