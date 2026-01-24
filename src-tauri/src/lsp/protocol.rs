//! LSP protocol types.
//!
//! These types mirror the Language Server Protocol specification.
//! We define only what we need, not the full spec.

use serde::{Deserialize, Serialize};

/// Position in a text document (0-indexed line and character).
/// Character offset is in UTF-16 code units per LSP spec.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Position {
    pub line: u32,
    pub character: u32,
}

/// A range in a text document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Range {
    pub start: Position,
    pub end: Position,
}

/// A location in a document (URI + range).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Location {
    pub uri: String,
    pub range: Range,
}

/// Diagnostic severity levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct DiagnosticSeverity(pub u8);

impl DiagnosticSeverity {
    pub const ERROR: Self = Self(1);
    pub const WARNING: Self = Self(2);
    pub const INFORMATION: Self = Self(3);
    pub const HINT: Self = Self(4);
}

/// A diagnostic (error, warning, etc.) in a document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub range: Range,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub severity: Option<DiagnosticSeverity>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<DiagnosticCode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub message: String,
}

/// Diagnostic code can be a number or string.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DiagnosticCode {
    Number(i32),
    String(String),
}

/// Text document identifier.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextDocumentIdentifier {
    pub uri: String,
}

/// Versioned text document identifier.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionedTextDocumentIdentifier {
    pub uri: String,
    pub version: i32,
}

/// Text document item (for didOpen).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentItem {
    pub uri: String,
    pub language_id: String,
    pub version: i32,
    pub text: String,
}

/// Text document position params (common for many requests).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentPositionParams {
    pub text_document: TextDocumentIdentifier,
    pub position: Position,
}

/// Markup content (for hover, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarkupContent {
    pub kind: MarkupKind,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MarkupKind {
    PlainText,
    Markdown,
}

/// Hover result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hover {
    pub contents: HoverContents,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub range: Option<Range>,
}

/// Hover contents can be various types.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum HoverContents {
    Markup(MarkupContent),
    String(String),
    Array(Vec<MarkedString>),
    MarkedString(MarkedString),
}

/// Marked string (deprecated but still used).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum MarkedString {
    String(String),
    LanguageString { language: String, value: String },
}

/// Completion item kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CompletionItemKind(pub u8);

impl CompletionItemKind {
    pub const TEXT: Self = Self(1);
    pub const METHOD: Self = Self(2);
    pub const FUNCTION: Self = Self(3);
    pub const CONSTRUCTOR: Self = Self(4);
    pub const FIELD: Self = Self(5);
    pub const VARIABLE: Self = Self(6);
    pub const CLASS: Self = Self(7);
    pub const INTERFACE: Self = Self(8);
    pub const MODULE: Self = Self(9);
    pub const PROPERTY: Self = Self(10);
    pub const UNIT: Self = Self(11);
    pub const VALUE: Self = Self(12);
    pub const ENUM: Self = Self(13);
    pub const KEYWORD: Self = Self(14);
    pub const SNIPPET: Self = Self(15);
    pub const COLOR: Self = Self(16);
    pub const FILE: Self = Self(17);
    pub const REFERENCE: Self = Self(18);
    pub const FOLDER: Self = Self(19);
    pub const ENUM_MEMBER: Self = Self(20);
    pub const CONSTANT: Self = Self(21);
    pub const STRUCT: Self = Self(22);
    pub const EVENT: Self = Self(23);
    pub const OPERATOR: Self = Self(24);
    pub const TYPE_PARAMETER: Self = Self(25);
}

/// Completion item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItem {
    pub label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<CompletionItemKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation: Option<Documentation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insert_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub insert_text_format: Option<InsertTextFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_edit: Option<TextEdit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub filter_text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_text: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Documentation {
    String(String),
    Markup(MarkupContent),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(transparent)]
pub struct InsertTextFormat(pub u8);

impl InsertTextFormat {
    pub const PLAIN_TEXT: Self = Self(1);
    pub const SNIPPET: Self = Self(2);
}

/// Text edit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextEdit {
    pub range: Range,
    pub new_text: String,
}

/// Completion list.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionList {
    pub is_incomplete: bool,
    pub items: Vec<CompletionItem>,
}

/// Completion response can be list or array.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CompletionResponse {
    List(CompletionList),
    Array(Vec<CompletionItem>),
}

impl CompletionResponse {
    pub fn into_items(self) -> Vec<CompletionItem> {
        match self {
            Self::List(list) => list.items,
            Self::Array(items) => items,
        }
    }
}

/// Definition response can be single location, array, or location links.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DefinitionResponse {
    Single(Location),
    Array(Vec<Location>),
    Links(Vec<LocationLink>),
}

impl DefinitionResponse {
    pub fn into_locations(self) -> Vec<Location> {
        match self {
            Self::Single(loc) => vec![loc],
            Self::Array(locs) => locs,
            Self::Links(links) => links
                .into_iter()
                .map(|link| Location {
                    uri: link.target_uri,
                    range: link.target_selection_range,
                })
                .collect(),
        }
    }
}

/// Location link (richer than Location).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationLink {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub origin_selection_range: Option<Range>,
    pub target_uri: String,
    pub target_range: Range,
    pub target_selection_range: Range,
}

// === Initialize Request/Response ===

/// Client capabilities we send during initialize.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_document: Option<TextDocumentClientCapabilities>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub synchronization: Option<TextDocumentSyncClientCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion: Option<CompletionClientCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hover: Option<HoverClientCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition: Option<DefinitionClientCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references: Option<ReferencesClientCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub publish_diagnostics: Option<PublishDiagnosticsClientCapabilities>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_action: Option<CodeActionClientCapabilities>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentSyncClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub did_save: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_item: Option<CompletionItemClientCapabilities>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionItemClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub snippet_support: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub documentation_format: Option<Vec<MarkupKind>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HoverClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content_format: Option<Vec<MarkupKind>>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefinitionClientCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_support: Option<bool>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ReferencesClientCapabilities {}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PublishDiagnosticsClientCapabilities {}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeActionClientCapabilities {
    /// Whether code action supports dynamic registration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dynamic_registration: Option<bool>,
    /// The client supports code action literals.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_action_literal_support: Option<CodeActionLiteralSupport>,
    /// Whether the client supports the `isPreferred` property.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_preferred_support: Option<bool>,
    /// Whether the client supports the `disabled` property.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled_support: Option<bool>,
    /// Whether the client supports the `data` property for lazy resolution.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data_support: Option<bool>,
    /// Whether the client supports resolve for additional properties.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolve_support: Option<CodeActionResolveSupport>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeActionLiteralSupport {
    /// The code action kind values the client supports.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code_action_kind: Option<CodeActionKindValueSet>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeActionKindValueSet {
    /// The code action kind values the client supports.
    pub value_set: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeActionResolveSupport {
    /// The properties that the client can resolve lazily.
    pub properties: Vec<String>,
}

/// Initialize request params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeParams {
    pub process_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_info: Option<ClientInfo>,
    pub root_uri: Option<String>,
    pub capabilities: ClientCapabilities,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

/// Initialize response result.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InitializeResult {
    pub capabilities: ServerCapabilities,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub server_info: Option<ServerInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerInfo {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
}

/// Server capabilities (we only parse what we care about).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ServerCapabilities {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text_document_sync: Option<TextDocumentSyncCapability>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub completion_provider: Option<CompletionOptions>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hover_provider: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub definition_provider: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references_provider: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TextDocumentSyncCapability {
    Kind(TextDocumentSyncKind),
    Options(TextDocumentSyncOptions),
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TextDocumentSyncKind(pub u8);

impl TextDocumentSyncKind {
    pub const NONE: Self = Self(0);
    pub const FULL: Self = Self(1);
    pub const INCREMENTAL: Self = Self(2);
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentSyncOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_close: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub change: Option<TextDocumentSyncKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub save: Option<SaveOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub include_text: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_characters: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resolve_provider: Option<bool>,
}

// === Notification params ===

/// didOpen notification params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DidOpenTextDocumentParams {
    pub text_document: TextDocumentItem,
}

/// didChange notification params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DidChangeTextDocumentParams {
    pub text_document: VersionedTextDocumentIdentifier,
    pub content_changes: Vec<TextDocumentContentChangeEvent>,
}

/// Content change event (we use full sync, so just text).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TextDocumentContentChangeEvent {
    pub text: String,
}

/// didClose notification params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DidCloseTextDocumentParams {
    pub text_document: TextDocumentIdentifier,
}

/// publishDiagnostics notification params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublishDiagnosticsParams {
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i32>,
    pub diagnostics: Vec<Diagnostic>,
}

/// references request params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceParams {
    pub text_document: TextDocumentIdentifier,
    pub position: Position,
    pub context: ReferenceContext,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceContext {
    pub include_declaration: bool,
}

// === Code Action Types ===

/// Code action kind values (subset of the full LSP spec).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CodeActionKind(pub String);

impl CodeActionKind {
    pub const QUICK_FIX: &'static str = "quickfix";
    pub const REFACTOR: &'static str = "refactor";
    pub const REFACTOR_EXTRACT: &'static str = "refactor.extract";
    pub const REFACTOR_INLINE: &'static str = "refactor.inline";
    pub const REFACTOR_REWRITE: &'static str = "refactor.rewrite";
    pub const SOURCE: &'static str = "source";
    pub const SOURCE_ORGANIZE_IMPORTS: &'static str = "source.organizeImports";
}

/// Code action request params.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeActionParams {
    pub text_document: TextDocumentIdentifier,
    pub range: Range,
    pub context: CodeActionContext,
}

/// Context for code actions, including diagnostics.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeActionContext {
    pub diagnostics: Vec<Diagnostic>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub only: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_kind: Option<CodeActionTriggerKind>,
}

/// What triggered code actions request.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(transparent)]
pub struct CodeActionTriggerKind(pub u8);

impl CodeActionTriggerKind {
    pub const INVOKED: Self = Self(1);
    pub const AUTOMATIC: Self = Self(2);
}

/// A code action represents a change that can be performed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeAction {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<Vec<Diagnostic>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_preferred: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub disabled: Option<CodeActionDisabled>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edit: Option<WorkspaceEdit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub command: Option<Command>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

/// Reason why a code action is disabled.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodeActionDisabled {
    pub reason: String,
}

/// An LSP Command (not to be confused with a code action).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Command {
    pub title: String,
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub arguments: Option<Vec<serde_json::Value>>,
}

/// Workspace edit - a collection of changes to documents.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEdit {
    /// Map of file URI to list of text edits.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changes: Option<std::collections::HashMap<String, Vec<TextEdit>>>,
    /// More complex document changes (may include create/rename/delete).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_changes: Option<Vec<DocumentChange>>,
}

/// A document change can be a text edit or resource operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DocumentChange {
    Edit(TextDocumentEdit),
    Create(CreateFile),
    Rename(RenameFile),
    Delete(DeleteFile),
}

/// A text edit on a specific versioned document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextDocumentEdit {
    pub text_document: OptionalVersionedTextDocumentIdentifier,
    pub edits: Vec<TextEditOrAnnotated>,
}

/// Text document identifier with optional version.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionalVersionedTextDocumentIdentifier {
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<i32>,
}

/// Text edit or annotated text edit.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TextEditOrAnnotated {
    TextEdit(TextEdit),
    Annotated(AnnotatedTextEdit),
}

/// A text edit with an annotation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotatedTextEdit {
    pub range: Range,
    pub new_text: String,
    pub annotation_id: String,
}

/// Create file operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFile {
    pub kind: String, // "create"
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<CreateFileOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateFileOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overwrite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_if_exists: Option<bool>,
}

/// Rename file operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameFile {
    pub kind: String, // "rename"
    pub old_uri: String,
    pub new_uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<RenameFileOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameFileOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overwrite: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_if_exists: Option<bool>,
}

/// Delete file operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFile {
    pub kind: String, // "delete"
    pub uri: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<DeleteFileOptions>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteFileOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub recursive: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ignore_if_not_exists: Option<bool>,
}

/// Response from code action request - can be CodeAction or Command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CodeActionResponse {
    Actions(Vec<CodeActionOrCommand>),
}

/// Code action response item - either a full CodeAction or just a Command.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum CodeActionOrCommand {
    CodeAction(CodeAction),
    Command(Command),
}

impl CodeActionResponse {
    /// Extract code actions from the response.
    pub fn into_actions(self) -> Vec<CodeAction> {
        match self {
            Self::Actions(items) => items
                .into_iter()
                .filter_map(|item| match item {
                    CodeActionOrCommand::CodeAction(action) => Some(action),
                    CodeActionOrCommand::Command(cmd) => Some(CodeAction {
                        title: cmd.title.clone(),
                        kind: None,
                        diagnostics: None,
                        is_preferred: None,
                        disabled: None,
                        edit: None,
                        command: Some(cmd),
                        data: None,
                    }),
                })
                .collect(),
        }
    }
}
