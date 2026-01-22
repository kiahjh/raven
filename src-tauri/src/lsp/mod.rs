//! LSP (Language Server Protocol) integration.
//!
//! This module provides LSP client functionality for communicating with
//! language servers like rust-analyzer.

mod manager;
mod protocol;
mod server;
mod transport;

pub use manager::{LspManager, SerializedCompletionItem, SerializedHover, SerializedLocation};

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
