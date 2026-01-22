/**
 * LSP client - Tauri command wrappers.
 */

import { invoke } from "@tauri-apps/api/core";
import type { Location, HoverResult, CompletionItem } from "./types";

/**
 * Find the LSP root directory for a file (e.g., directory containing Cargo.toml).
 * Returns null if no root marker is found.
 */
export async function lspFindRoot(filePath: string): Promise<string | null> {
  return invoke("lsp_find_root", { filePath });
}

/**
 * Start the language server for a project.
 */
export async function lspStart(rootPath: string): Promise<void> {
  await invoke("lsp_start", { rootPath });
}

/**
 * Stop the language server for a project.
 */
export async function lspStop(rootPath: string): Promise<void> {
  await invoke("lsp_stop", { rootPath });
}

/**
 * Notify the server that a document was opened.
 */
export async function lspOpenDocument(
  rootPath: string,
  filePath: string,
  content: string
): Promise<void> {
  await invoke("lsp_open_document", { rootPath, filePath, content });
}

/**
 * Notify the server that a document changed.
 */
export async function lspChangeDocument(
  rootPath: string,
  filePath: string,
  content: string
): Promise<void> {
  await invoke("lsp_change_document", { rootPath, filePath, content });
}

/**
 * Notify the server that a document was closed.
 */
export async function lspCloseDocument(
  rootPath: string,
  filePath: string
): Promise<void> {
  await invoke("lsp_close_document", { rootPath, filePath });
}

/**
 * Get the definition locations for a symbol.
 */
export async function lspGotoDefinition(
  rootPath: string,
  filePath: string,
  line: number,
  character: number
): Promise<Location[]> {
  return invoke("lsp_goto_definition", { rootPath, filePath, line, character });
}

/**
 * Get hover information for a position.
 */
export async function lspHover(
  rootPath: string,
  filePath: string,
  line: number,
  character: number
): Promise<HoverResult | null> {
  return invoke("lsp_hover", { rootPath, filePath, line, character });
}

/**
 * Get completion items for a position.
 */
export async function lspCompletion(
  rootPath: string,
  filePath: string,
  line: number,
  character: number
): Promise<CompletionItem[]> {
  return invoke("lsp_completion", { rootPath, filePath, line, character });
}

/**
 * Find all references to a symbol.
 */
export async function lspReferences(
  rootPath: string,
  filePath: string,
  line: number,
  character: number,
  includeDeclaration: boolean = true
): Promise<Location[]> {
  return invoke("lsp_references", {
    rootPath,
    filePath,
    line,
    character,
    includeDeclaration,
  });
}
