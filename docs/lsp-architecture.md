# LSP Integration Architecture

## Overview

This document describes the architecture for Language Server Protocol (LSP) integration in Raven. The design is modular, making it easy to add support for new languages while initially focusing on Rust (rust-analyzer).

## Architecture Layers

```
┌─────────────────────────────────────────────────────────────────┐
│                    Frontend (SolidJS)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
│  │ EditorSurface│  │ Diagnostics  │  │ Autocomplete/Hover    │ │
│  │              │  │ Overlay      │  │ Popups               │ │
│  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘ │
│         │                 │                      │              │
│         └─────────────────┼──────────────────────┘              │
│                           │                                     │
│                    ┌──────┴──────┐                              │
│                    │  LSP Store  │  (SolidJS reactive state)    │
│                    └──────┬──────┘                              │
└───────────────────────────┼─────────────────────────────────────┘
                            │ Tauri commands + events
┌───────────────────────────┼─────────────────────────────────────┐
│                    Backend (Rust/Tauri)                         │
│                    ┌──────┴──────┐                              │
│                    │ LSP Manager │                              │
│                    └──────┬──────┘                              │
│                           │                                     │
│         ┌─────────────────┼─────────────────────┐               │
│         │                 │                     │               │
│   ┌─────┴─────┐    ┌──────┴──────┐      ┌──────┴──────┐        │
│   │  Server   │    │  Document   │      │  Request    │        │
│   │  Process  │    │  Tracker    │      │  Router     │        │
│   └─────┬─────┘    └─────────────┘      └─────────────┘        │
│         │ stdio                                                 │
└─────────┼───────────────────────────────────────────────────────┘
          │
    ┌─────┴─────┐
    │  rust-    │
    │  analyzer │
    └───────────┘
```

## Component Details

### 1. Backend: LSP Manager (`src-tauri/src/lsp.rs`)

The Rust backend handles all communication with language servers via stdio.

#### Responsibilities:
- Spawn and manage language server processes
- JSON-RPC message framing (Content-Length headers)
- Request/response correlation (track pending requests by ID)
- Route server notifications to frontend via Tauri events
- Track open documents and their versions

#### Key Types:

```rust
/// Configuration for a language server
pub struct LanguageServerConfig {
    pub language_id: String,      // "rust", "typescript", etc.
    pub command: String,          // "rust-analyzer"
    pub args: Vec<String>,        // []
    pub file_patterns: Vec<String>, // ["*.rs"]
    pub root_markers: Vec<String>,  // ["Cargo.toml"]
}

/// Represents a running language server
struct LanguageServer {
    process: Child,
    stdin: ChildStdin,
    next_request_id: AtomicU64,
    pending_requests: DashMap<u64, oneshot::Sender<JsonValue>>,
    capabilities: ServerCapabilities,
}

/// Manages all language servers
pub struct LspManager {
    servers: DashMap<String, LanguageServer>,  // keyed by root_uri
    configs: Vec<LanguageServerConfig>,
}
```

#### Tauri Commands:

```rust
#[tauri::command]
async fn lsp_start(root_path: String) -> Result<(), String>;

#[tauri::command]
async fn lsp_stop(root_path: String) -> Result<(), String>;

#[tauri::command]
async fn lsp_open_document(
    root_path: String,
    uri: String,
    language_id: String,
    content: String,
) -> Result<(), String>;

#[tauri::command]
async fn lsp_change_document(
    root_path: String,
    uri: String,
    version: u32,
    content: String,  // Full sync for simplicity
) -> Result<(), String>;

#[tauri::command]
async fn lsp_close_document(root_path: String, uri: String) -> Result<(), String>;

#[tauri::command]
async fn lsp_goto_definition(
    root_path: String,
    uri: String,
    line: u32,
    character: u32,
) -> Result<Vec<Location>, String>;

#[tauri::command]
async fn lsp_hover(
    root_path: String,
    uri: String,
    line: u32,
    character: u32,
) -> Result<Option<HoverResult>, String>;

#[tauri::command]
async fn lsp_completion(
    root_path: String,
    uri: String,
    line: u32,
    character: u32,
) -> Result<Vec<CompletionItem>, String>;

#[tauri::command]
async fn lsp_references(
    root_path: String,
    uri: String,
    line: u32,
    character: u32,
    include_declaration: bool,
) -> Result<Vec<Location>, String>;
```

#### Tauri Events (server → client):

```rust
// Emitted when server sends diagnostics
#[derive(Serialize)]
struct DiagnosticsEvent {
    uri: String,
    diagnostics: Vec<Diagnostic>,
}

// Event name: "lsp:diagnostics"
```

### 2. Frontend: LSP Store (`src/store/lsp.ts`)

Reactive store managing LSP state for the UI.

#### State Shape:

```typescript
interface LspStore {
  // Per-project server status
  servers: Record<string, ServerStatus>;  // keyed by root_path
  
  // Diagnostics per file
  diagnostics: Record<string, Diagnostic[]>;  // keyed by file URI
  
  // Document versions (for sync)
  documentVersions: Record<string, number>;  // keyed by file URI
}

interface ServerStatus {
  state: "starting" | "running" | "stopped" | "error";
  error?: string;
  capabilities?: ServerCapabilities;
}

interface Diagnostic {
  range: Range;
  severity: 1 | 2 | 3 | 4;  // Error, Warning, Info, Hint
  message: string;
  source?: string;
  code?: string | number;
}

interface Range {
  start: Position;
  end: Position;
}

interface Position {
  line: number;
  character: number;
}
```

#### Actions:

```typescript
// Server lifecycle
async function startServer(rootPath: string): Promise<void>;
async function stopServer(rootPath: string): Promise<void>;

// Document sync
async function openDocument(filePath: string, content: string): Promise<void>;
async function changeDocument(filePath: string, content: string): Promise<void>;
async function closeDocument(filePath: string): Promise<void>;

// Queries (return results directly, not stored)
async function gotoDefinition(filePath: string, line: number, col: number): Promise<Location[]>;
async function hover(filePath: string, line: number, col: number): Promise<HoverResult | null>;
async function complete(filePath: string, line: number, col: number): Promise<CompletionItem[]>;
async function references(filePath: string, line: number, col: number): Promise<Location[]>;

// Internal: called from event listener
function updateDiagnostics(uri: string, diagnostics: Diagnostic[]): void;
```

### 3. Frontend: Editor Integration

#### Document Synchronization

The editor will call LSP store methods at appropriate times:

```typescript
// In EditorSurface.tsx or a dedicated hook

// On file open (after loading content)
createEffect(() => {
  if (props.filePath && loadedFilePath() === props.filePath) {
    const content = getText(getEditorState(props.id).buffer);
    lspStore.openDocument(props.filePath, content);
  }
});

// On content change (debounced)
createEffect(() => {
  const state = editorStore.editors[props.id];
  if (!state || !props.filePath) return;
  
  // Debounce to avoid flooding server
  debouncedChangeDocument(props.filePath, getText(state.buffer));
});

// On surface close
onCleanup(() => {
  if (props.filePath) {
    lspStore.closeDocument(props.filePath);
  }
});
```

#### Diagnostics Display

Add diagnostic underlines and gutter markers to EditorSurface:

```typescript
// Get diagnostics for current file
const fileDiagnostics = createMemo(() => {
  if (!props.filePath) return [];
  const uri = `file://${props.filePath}`;
  return lspStore.diagnostics[uri] ?? [];
});

// Render underlines in the line rendering logic
// Render gutter icons for lines with errors/warnings
```

#### Go-to-Definition (gd in vim)

Add to vim commands:

```typescript
// In commands.ts or a new lsp-commands.ts
case "gd":
  // Get word under cursor, then:
  const locations = await lspStore.gotoDefinition(filePath, cursor.line, cursor.column);
  if (locations.length === 1) {
    // Open file at location
    openFileAtLocation(locations[0]);
  } else if (locations.length > 1) {
    // Show picker
  }
  break;
```

#### Hover (K in vim)

Show popup on K keypress:

```typescript
case "K":
  const result = await lspStore.hover(filePath, cursor.line, cursor.column);
  if (result) {
    showHoverPopup(result);
  }
  break;
```

#### Autocomplete

Trigger on Ctrl+Space or automatically after typing trigger characters:

```typescript
// On Ctrl+Space in insert mode
const items = await lspStore.complete(filePath, cursor.line, cursor.column);
showCompletionMenu(items);
```

## Implementation Order

### Phase 1: Backend Foundation
1. Create `src-tauri/src/lsp.rs` with basic types
2. Implement server spawning and stdio communication
3. Implement JSON-RPC framing (Content-Length parsing)
4. Implement initialize/initialized handshake
5. Add `lsp_start` and `lsp_stop` commands

### Phase 2: Document Sync
1. Implement document tracking (open/change/close)
2. Add version tracking
3. Wire up Tauri commands
4. Set up diagnostics event emission

### Phase 3: Frontend Store
1. Create `src/store/lsp.ts`
2. Implement server lifecycle functions
3. Implement document sync functions
4. Set up diagnostics event listener

### Phase 4: Diagnostics UI
1. Add diagnostic state to editor
2. Render underlines for errors/warnings
3. Add gutter markers
4. Show diagnostic messages on hover

### Phase 5: Navigation Features
1. Implement `lsp_goto_definition` backend
2. Add `gd` vim command
3. Implement `lsp_references` backend
4. Add `gr` vim command

### Phase 6: Information Features
1. Implement `lsp_hover` backend
2. Add `K` vim command
3. Create hover popup component

### Phase 7: Completion
1. Implement `lsp_completion` backend
2. Create completion menu component
3. Wire up trigger logic (Ctrl+Space, trigger chars)
4. Handle completion item insertion

## File Structure

```
src-tauri/src/
  lsp/
    mod.rs           # Re-exports
    manager.rs       # LspManager, server lifecycle
    transport.rs     # JSON-RPC framing, stdio handling
    protocol.rs      # LSP types (Position, Range, etc.)
    config.rs        # LanguageServerConfig, rust-analyzer config
    
src/
  store/
    lsp.ts           # LSP store
  lsp/
    types.ts         # TypeScript LSP types
    client.ts        # Tauri command wrappers
  components/
    DiagnosticUnderline.tsx
    DiagnosticGutter.tsx
    HoverPopup.tsx
    CompletionMenu.tsx
```

## Configuration

For now, rust-analyzer config is hardcoded:

```rust
LanguageServerConfig {
    language_id: "rust".to_string(),
    command: "rust-analyzer".to_string(),
    args: vec![],
    file_patterns: vec!["*.rs".to_string()],
    root_markers: vec!["Cargo.toml".to_string()],
}
```

Later, this can be made configurable per-project or globally.

## Error Handling

- If rust-analyzer isn't installed, show a non-blocking notification
- If server crashes, attempt restart with exponential backoff
- If server is slow, requests should have timeouts
- All LSP features degrade gracefully (editor works without LSP)

## Testing Strategy

- Unit tests for JSON-RPC framing
- Unit tests for request/response correlation
- Integration tests with a mock language server
- Manual testing with rust-analyzer on real Rust projects
