/**
 * LSP store - manages LSP state for the UI.
 */

import { createStore } from "solid-js/store";
import { listen } from "@tauri-apps/api/event";
import {
  lspFindRoot,
  lspStart,
  lspStop,
  lspOpenDocument,
  lspChangeDocument,
  lspCloseDocument,
  lspGotoDefinition,
  lspHover,
  lspCompletion,
  lspReferences,
  lspCodeActions,
  lspResolveCodeAction,
} from "../lsp/client";
import type {
  Diagnostic,
  Location,
  HoverResult,
  CompletionItem,
  PublishDiagnosticsParams,
  CodeAction,
  CodeActionForResolve,
} from "../lsp/types";
import { uriToPath } from "../lsp/types";

export type ServerState = "stopped" | "starting" | "running" | "error";

interface ServerStatus {
  state: ServerState;
  error?: string;
}

interface LspStoreState {
  /** Per-project server status, keyed by root path */
  servers: Record<string, ServerStatus>;
  /** Diagnostics per file, keyed by file path (not URI) */
  diagnostics: Record<string, Diagnostic[]>;
  /** Document versions for sync, keyed by file path */
  documentVersions: Record<string, number>;
}

const [store, setStore] = createStore<LspStoreState>({
  servers: {},
  diagnostics: {},
  documentVersions: {},
});

export const lspStore = store;

// Set up event listener for diagnostics from the backend
let listenerInitialized = false;

async function initListener(): Promise<void> {
  if (listenerInitialized) return;
  listenerInitialized = true;

  await listen<PublishDiagnosticsParams>("lsp:diagnostics", (event) => {
    const { uri, diagnostics } = event.payload;
    const filePath = uriToPath(uri);
    setStore("diagnostics", filePath, diagnostics);
  });
}

// Initialize listener on module load
initListener().catch(console.error);

/**
 * Find the LSP root for a file (e.g., the directory containing Cargo.toml).
 */
export async function findLspRoot(filePath: string): Promise<string | null> {
  return lspFindRoot(filePath);
}

/**
 * Start the language server for a project.
 */
export async function startServer(rootPath: string): Promise<void> {
  // Check if already running or starting
  const current = store.servers[rootPath];
  if (current?.state === "running" || current?.state === "starting") {
    return;
  }

  setStore("servers", rootPath, { state: "starting" });

  try {
    await lspStart(rootPath);
    setStore("servers", rootPath, { state: "running" });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("LSP: Failed to start server:", error);
    setStore("servers", rootPath, { state: "error", error });
    throw e;
  }
}

/**
 * Start the language server for a file, automatically finding the correct root.
 * Returns the root path used, or null if no LSP root was found.
 */
export async function startServerForFile(filePath: string): Promise<string | null> {
  const rootPath = await findLspRoot(filePath);
  if (!rootPath) {
    return null;
  }
  
  await startServer(rootPath);
  return rootPath;
}

/**
 * Stop the language server for a project.
 */
export async function stopServer(rootPath: string): Promise<void> {
  try {
    await lspStop(rootPath);
  } finally {
    setStore("servers", rootPath, { state: "stopped" });
    
    // Clear diagnostics for files in this project
    // (A simple approach - clear all diagnostics that start with the root path)
    const diagnosticsToRemove = Object.keys(store.diagnostics).filter(
      (path) => path.startsWith(rootPath)
    );
    for (const path of diagnosticsToRemove) {
      setStore("diagnostics", path, undefined as unknown as Diagnostic[]);
    }
  }
}

/**
 * Get the server status for a project.
 */
export function getServerStatus(rootPath: string): ServerStatus {
  return store.servers[rootPath] ?? { state: "stopped" };
}

/**
 * Open a document and notify the language server.
 */
export async function openDocument(
  rootPath: string,
  filePath: string,
  content: string
): Promise<void> {
  const serverStatus = store.servers[rootPath];
  if (serverStatus?.state !== "running") {
    return;
  }

  try {
    await lspOpenDocument(rootPath, filePath, content);
    setStore("documentVersions", filePath, 1);
  } catch (e) {
    console.error("LSP: Failed to open document:", e);
  }
}

/**
 * Update a document and notify the language server.
 */
export async function changeDocument(
  rootPath: string,
  filePath: string,
  content: string
): Promise<void> {
  const serverStatus = store.servers[rootPath];
  if (serverStatus?.state !== "running") {
    return;
  }

  try {
    await lspChangeDocument(rootPath, filePath, content);
    const currentVersion = store.documentVersions[filePath] ?? 0;
    setStore("documentVersions", filePath, currentVersion + 1);
  } catch (e) {
    console.error("LSP: Failed to change document:", e);
  }
}

/**
 * Close a document and notify the language server.
 */
export async function closeDocument(
  rootPath: string,
  filePath: string
): Promise<void> {
  const serverStatus = store.servers[rootPath];
  if (serverStatus?.state !== "running") {
    return;
  }

  try {
    await lspCloseDocument(rootPath, filePath);
    setStore("documentVersions", filePath, undefined as unknown as number);
    setStore("diagnostics", filePath, undefined as unknown as Diagnostic[]);
  } catch (e) {
    console.error("LSP: Failed to close document:", e);
  }
}

/**
 * Get diagnostics for a file.
 */
export function getDiagnostics(filePath: string): Diagnostic[] {
  return store.diagnostics[filePath] ?? [];
}

/**
 * Get total diagnostic counts for a project (or all projects if no rootPath provided).
 * Returns counts by severity: errors, warnings, info, hints.
 */
export function getProjectDiagnosticCounts(rootPath?: string): { errors: number; warnings: number; info: number; hints: number } {
  let errors = 0;
  let warnings = 0;
  let info = 0;
  let hints = 0;
  
  for (const [filePath, diagnostics] of Object.entries(store.diagnostics)) {
    // Filter by project if rootPath is provided
    if (rootPath && !filePath.startsWith(rootPath)) {
      continue;
    }
    
    if (!diagnostics) continue;
    
    for (const diag of diagnostics) {
      switch (diag.severity) {
        case 1: errors++; break;
        case 2: warnings++; break;
        case 3: info++; break;
        case 4: hints++; break;
      }
    }
  }
  
  return { errors, warnings, info, hints };
}

/**
 * Go to definition.
 */
export async function gotoDefinition(
  rootPath: string,
  filePath: string,
  line: number,
  character: number
): Promise<Location[]> {
  const serverStatus = store.servers[rootPath];
  if (serverStatus?.state !== "running") {
    return [];
  }

  try {
    return await lspGotoDefinition(rootPath, filePath, line, character);
  } catch (e) {
    console.error("LSP: gotoDefinition failed:", e);
    return [];
  }
}

/**
 * Get hover information.
 */
export async function hover(
  rootPath: string,
  filePath: string,
  line: number,
  character: number
): Promise<HoverResult | null> {
  const serverStatus = store.servers[rootPath];
  if (serverStatus?.state !== "running") {
    return null;
  }

  try {
    return await lspHover(rootPath, filePath, line, character);
  } catch (e) {
    console.error("LSP: hover failed:", e);
    return null;
  }
}

/**
 * Get completions.
 */
export async function complete(
  rootPath: string,
  filePath: string,
  line: number,
  character: number
): Promise<CompletionItem[]> {
  const serverStatus = store.servers[rootPath];
  if (serverStatus?.state !== "running") {
    return [];
  }

  try {
    return await lspCompletion(rootPath, filePath, line, character);
  } catch (e) {
    console.error("LSP: completion failed:", e);
    return [];
  }
}

/**
 * Find references.
 */
export async function references(
  rootPath: string,
  filePath: string,
  line: number,
  character: number,
  includeDeclaration: boolean = true
): Promise<Location[]> {
  const serverStatus = store.servers[rootPath];
  if (serverStatus?.state !== "running") {
    return [];
  }

  try {
    return await lspReferences(
      rootPath,
      filePath,
      line,
      character,
      includeDeclaration
    );
  } catch (e) {
    console.error("LSP: references failed:", e);
    return [];
  }
}

/**
 * Get code actions for a range.
 */
export async function codeActions(
  rootPath: string,
  filePath: string,
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
  diagnostics: Diagnostic[]
): Promise<CodeAction[]> {
  const serverStatus = store.servers[rootPath];
  if (serverStatus?.state !== "running") {
    return [];
  }

  try {
    return await lspCodeActions(
      rootPath,
      filePath,
      startLine,
      startCharacter,
      endLine,
      endCharacter,
      diagnostics
    );
  } catch (e) {
    console.error("LSP: codeActions failed:", e);
    return [];
  }
}

/**
 * Resolve a code action to get full edit details.
 */
export async function resolveCodeAction(
  rootPath: string,
  codeAction: CodeActionForResolve
): Promise<CodeAction | null> {
  const serverStatus = store.servers[rootPath];
  if (serverStatus?.state !== "running") {
    return null;
  }

  try {
    return await lspResolveCodeAction(rootPath, codeAction);
  } catch (e) {
    console.error("LSP: resolveCodeAction failed:", e);
    return null;
  }
}
