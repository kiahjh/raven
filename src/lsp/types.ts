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
