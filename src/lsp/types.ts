/**
 * LSP types for the frontend.
 * These mirror the types from the Rust backend.
 */

export interface Position {
  line: number;
  character: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface Location {
  uri: string;
  range: Range;
}

export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
}

export type DiagnosticSeverity = 1 | 2 | 3 | 4;
export const DiagnosticSeverity = {
  Error: 1 as DiagnosticSeverity,
  Warning: 2 as DiagnosticSeverity,
  Information: 3 as DiagnosticSeverity,
  Hint: 4 as DiagnosticSeverity,
};

export interface HoverResult {
  contents: string;
  range?: Range;
}

export interface CompletionItem {
  label: string;
  kind?: CompletionItemKind;
  detail?: string;
  insertText?: string;
  filterText?: string;
}

export type CompletionItemKind = number;
export const CompletionItemKind = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Unit: 11,
  Value: 12,
  Enum: 13,
  Keyword: 14,
  Snippet: 15,
  Color: 16,
  File: 17,
  Reference: 18,
  Folder: 19,
  EnumMember: 20,
  Constant: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25,
};

/** Published diagnostics event from the server. */
export interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: Diagnostic[];
}

/** Convert a file:// URI to a file path. */
export function uriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    return uri.slice(7);
  }
  return uri;
}

/** Convert a file path to a file:// URI. */
export function pathToUri(path: string): string {
  if (path.startsWith("file://")) {
    return path;
  }
  return `file://${path}`;
}

// === Code Action Types ===

/** Text edit - a change to a document. */
export interface TextEdit {
  range: Range;
  newText: string;
}

/** Document change - edits to a specific document. */
export interface DocumentChange {
  uri: string;
  edits: TextEdit[];
}

/** Workspace edit - a collection of changes to documents. */
export interface WorkspaceEdit {
  /** Map of file URI to list of text edits. */
  changes?: Record<string, TextEdit[]>;
  /** More complex document changes. */
  documentChanges?: DocumentChange[];
}

/** Code action kinds. */
export const CodeActionKind = {
  QuickFix: "quickfix",
  Refactor: "refactor",
  RefactorExtract: "refactor.extract",
  RefactorInline: "refactor.inline",
  RefactorRewrite: "refactor.rewrite",
  Source: "source",
  SourceOrganizeImports: "source.organizeImports",
} as const;

export type CodeActionKindType = (typeof CodeActionKind)[keyof typeof CodeActionKind];

/** A code action represents a change that can be performed. */
export interface CodeAction {
  /** Human-readable title of the code action. */
  title: string;
  /** The kind of the code action (quickfix, refactor, etc.). */
  kind?: string;
  /** Whether this is the preferred action of its kind. */
  isPreferred?: boolean;
  /** If disabled, the reason why. */
  disabledReason?: string;
  /** The workspace edit to apply. */
  edit?: WorkspaceEdit;
  /** Data preserved for resolve requests. */
  data?: unknown;
  /** Whether this action needs to be resolved before execution. */
  needsResolve: boolean;
}

/** Code action for resolve request (minimal data sent to backend). */
export interface CodeActionForResolve {
  title: string;
  kind?: string;
  isPreferred?: boolean;
  data?: unknown;
}
