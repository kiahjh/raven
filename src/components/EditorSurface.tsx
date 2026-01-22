import { createEffect, createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { editorStore, getEditorState, updateEditorState, initializeEditor, setEditorState } from "../store/editor";
import { getLine, getLineCount, getText, insertText as bufferInsertText, deleteCharBefore, Position, comparePositions, computeSmartIndent } from "../editor/buffer";
import { executeCommand, markExtendedDirty, markExtendedClean, clampExtendedCursor } from "../editor/commands";
import { parseInput, createVimState, findAllMatches } from "../editor/vim";
import { pushHistory } from "../editor/history";
import { getHighlighter, type HighlightResult, type LanguageId } from "../editor/highlighting";

import { startServerForFile, openDocument, changeDocument, closeDocument, getDiagnostics, gotoDefinition, hover, complete, references, lspStore, type ServerState } from "../store/lsp";
import { setSurfaceType } from "../store/surface";
import type { Diagnostic, CompletionItem } from "../lsp/types";
import { uriToPath } from "../lsp/types";
import { renderMarkdown } from "../utils/markdown";
import { getCompletionIcon, IconMacro } from "./icons";
import "./EditorSurface.css";
import "./icons/icons.css";

interface Props {
  id: string;
  focused: boolean;
  filePath?: string;
}

export function EditorSurface(props: Props) {
  let containerRef: HTMLDivElement | undefined;
  let linesContainerRef: HTMLDivElement | undefined;
  let searchInputRef: HTMLInputElement | undefined;
  
  // Map of line index to DOM element for scroll management
  const lineRefs = new Map<number, HTMLDivElement>();
  
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [loadedFilePath, setLoadedFilePath] = createSignal<string | null>(null);
  
  // Pending vim input for multi-key sequences
  const [pendingInput, setPendingInput] = createSignal("");
  
  // Search UI state
  const [searchMode, setSearchMode] = createSignal<"/" | "?" | null>(null);
  const [searchInput, setSearchInput] = createSignal("");
  
  // Syntax highlighting state
  const [highlightTokens, setHighlightTokens] = createSignal<HighlightResult>({ lines: new Map() });
  const [highlighterReady, setHighlighterReady] = createSignal(false);
  
  // Cursor blink control - only blink after inactivity
  const [cursorActive, setCursorActive] = createSignal(true);
  let cursorActivityTimer: ReturnType<typeof setTimeout> | null = null;
  const CURSOR_BLINK_DELAY = 530; // ms of inactivity before cursor starts blinking
  
  // Hover popup state
  const [hoverContent, setHoverContent] = createSignal<string | null>(null);
  const [hoverPosition, setHoverPosition] = createSignal<{ x: number; y: number; flipUp: boolean } | null>(null);
  const [hoverAnchorCursor, setHoverAnchorCursor] = createSignal<{ line: number; column: number } | null>(null);
  
  // Completion menu state
  const [completionItems, setCompletionItems] = createSignal<CompletionItem[]>([]);
  const [completionIndex, setCompletionIndex] = createSignal(0);
  const [completionPosition, setCompletionPosition] = createSignal<{ x: number; y: number; flipUp: boolean } | null>(null);
  
  // References list state
  const [referencesLocations, setReferencesLocations] = createSignal<Array<{ uri: string; line: number; col: number }>>([]);
  const [referencesIndex, setReferencesIndex] = createSignal(0);
  const [showReferences, setShowReferences] = createSignal(false);
  
  // LSP root path for current file (may differ from project root)
  const [lspRootPath, setLspRootPath] = createSignal<string | null>(null);
  
  // LSP status for current file's LSP root
  const lspStatus = createMemo((): { state: ServerState; label: string } => {
    const rootPath = lspRootPath();
    if (!rootPath) return { state: "stopped", label: "" };
    
    // Only show for Rust files
    const filePath = props.filePath;
    if (!filePath?.endsWith(".rs")) return { state: "stopped", label: "" };
    
    const status = lspStore.servers[rootPath];
    const state = status?.state ?? "stopped";
    
    switch (state) {
      case "starting":
        return { state, label: "rust-analyzer starting..." };
      case "running":
        return { state, label: "rust-analyzer" };
      case "error":
        return { state, label: `rust-analyzer error: ${status?.error ?? "unknown"}` };
      default:
        return { state: "stopped", label: "" };
    }
  });
  
  const resetCursorBlink = () => {
    // Show cursor solid (not blinking) immediately
    setCursorActive(true);
    
    // Clear existing timer
    if (cursorActivityTimer) {
      clearTimeout(cursorActivityTimer);
    }
    
    // Start blinking after delay
    cursorActivityTimer = setTimeout(() => {
      setCursorActive(false);
    }, CURSOR_BLINK_DELAY);
  };

  // Load file when filePath changes
  // Initialize syntax highlighter
  onMount(async () => {
    try {
      const highlighter = getHighlighter();
      await highlighter.init();
      setHighlighterReady(true);
    } catch (e) {
      console.error("Failed to initialize highlighter:", e);
    }
  });
  
  onCleanup(() => {
    // Clear cursor blink timer
    if (cursorActivityTimer) {
      clearTimeout(cursorActivityTimer);
    }
  });

  // Load file when filePath changes
  createEffect(async () => {
    const filePath = props.filePath;

    // Skip if we've already loaded this file
    if (filePath === loadedFilePath()) {
      return;
    }

    if (filePath) {
      setLoading(true);
      setError(null);
      try {
        const content = await invoke<string>("read_file", { path: filePath });
        initializeEditor(props.id, content);
        setLoadedFilePath(filePath);
      } catch (e) {
        setError(`Failed to load file: ${e}`);
        initializeEditor(props.id, "");
      } finally {
        setLoading(false);
      }
    } else if (loadedFilePath() === null) {
      // Initialize empty editor for scratch buffer (only on first mount)
      const state = getEditorState(props.id);
      if (state.buffer.lines.length === 1 && state.buffer.lines[0] === "") {
        initializeEditor(props.id, "");
      }
      setLoadedFilePath("");
    }
  });
  
  // Track which language is loaded for the current file
  const [loadedLangId, setLoadedLangId] = createSignal<LanguageId | null>(null);
  
  // Load language when file path changes (async, but separate from parsing)
  createEffect(() => {
    const ready = highlighterReady();
    const filePath = props.filePath;
    
    if (!ready || !filePath) {
      setLoadedLangId(null);
      return;
    }
    
    const highlighter = getHighlighter();
    const langId = highlighter.getLanguageForFile(filePath);
    
    if (!langId) {
      setLoadedLangId(null);
      return;
    }
    
    // Load language asynchronously
    highlighter.loadLanguage(langId).then((loaded) => {
      if (loaded) {
        setLoadedLangId(langId);
      } else {
        setLoadedLangId(null);
      }
    });
  });
  
  // Parse and highlight when content changes (synchronous, no async issues)
  createEffect(() => {
    const langId = loadedLangId();
    const filePath = props.filePath;
    const state = editorStore.editors[props.id];
    
    if (!langId || !filePath || !state) {
      setHighlightTokens({ lines: new Map() });
      return;
    }
    
    // Access buffer.lines to track changes - SolidJS stores track array reference changes
    // When we do `buffer: newBuffer` in updateEditorState, the buffer object changes
    const buffer = state.buffer;
    const content = buffer.lines.join("\n");
    
    const highlighter = getHighlighter();
    const newTokens = highlighter.parseFile(filePath, langId, content);
    setHighlightTokens(newTokens);
  });

  // LSP: Start server and open document when file loads (only for Rust files)
  // Combined into single effect to avoid race condition between server start and document open
  createEffect(() => {
    const filePath = props.filePath;
    const loaded = loadedFilePath();
    
    if (!filePath) return;
    
    // Only start LSP for Rust files
    if (!filePath.endsWith(".rs")) {
      setLspRootPath(null);
      return;
    }
    
    // Wait until file is loaded
    if (loaded !== filePath) {
      return;
    }
    
    const state = editorStore.editors[props.id];
    if (!state) return;
    
    const content = getText(state.buffer);
    
    // Find LSP root, start server, then open document - properly chained
    startServerForFile(filePath)
      .then((rootPath) => {
        if (!rootPath) {
          setLspRootPath(null);
          return;
        }
        setLspRootPath(rootPath);
        return openDocument(rootPath, filePath, content);
      })
      .catch((e: unknown) => {
        console.error("LSP: Failed to start/open:", e);
      });
  });

  // LSP: Send document changes (debounced)
  let lspChangeTimeout: ReturnType<typeof setTimeout> | null = null;
  const LSP_CHANGE_DEBOUNCE_MS = 300;
  
  createEffect(() => {
    const rootPath = lspRootPath();
    const filePath = props.filePath;
    const state = editorStore.editors[props.id];
    
    if (!rootPath || !filePath || !state) return;
    if (!filePath.endsWith(".rs")) return;
    
    // Track buffer changes by accessing the buffer
    const content = getText(state.buffer);
    
    // Debounce changes to avoid flooding the server
    if (lspChangeTimeout) {
      clearTimeout(lspChangeTimeout);
    }
    
    lspChangeTimeout = setTimeout(() => {
      changeDocument(rootPath, filePath, content).catch((e) => {
        console.warn("LSP: Failed to send document change:", e);
      });
    }, LSP_CHANGE_DEBOUNCE_MS);
  });

  // LSP: Close document on cleanup
  onCleanup(() => {
    if (lspChangeTimeout) {
      clearTimeout(lspChangeTimeout);
    }
    
    const rootPath = lspRootPath();
    const filePath = props.filePath;
    
    if (rootPath && filePath && filePath.endsWith(".rs")) {
      closeDocument(rootPath, filePath).catch((e) => {
        console.warn("LSP: Failed to close document:", e);
      });
    }
  });

  // LSP: Get diagnostics for current file
  const fileDiagnostics = createMemo((): Diagnostic[] => {
    const filePath = props.filePath;
    if (!filePath) return [];
    return getDiagnostics(filePath);
  });

  // Count diagnostics by severity for status bar
  const diagnosticCounts = createMemo(() => {
    const diags = fileDiagnostics();
    let errors = 0;
    let warnings = 0;
    let info = 0;
    let hints = 0;
    for (const d of diags) {
      switch (d.severity) {
        case 1: errors++; break;
        case 2: warnings++; break;
        case 3: info++; break;
        case 4: hints++; break;
      }
    }
    return { errors, warnings, info, hints };
  });

  createEffect(() => {
    if (props.focused && containerRef) {
      containerRef.focus();
    }
  });

  // Close hover popup when cursor moves away from anchor position
  createEffect(() => {
    const s = editorStore.editors[props.id];
    const anchor = hoverAnchorCursor();
    if (!s || !anchor) return;
    
    // If cursor has moved from the hover anchor, close the hover
    if (s.cursor.line !== anchor.line || s.cursor.column !== anchor.column) {
      closeHover();
    }
  });

  // Scroll to keep cursor visible when it changes
  createEffect(() => {
    // Access store reactively to track cursor changes
    const s = editorStore.editors[props.id];
    if (!s || !linesContainerRef) return;
    
    const cursorLine = s.cursor.line;
    const lineEl = lineRefs.get(cursorLine);
    if (!lineEl) return;
    
    const container = linesContainerRef;
    const containerRect = container.getBoundingClientRect();
    const lineRect = lineEl.getBoundingClientRect();
    
    // Calculate line position relative to container
    const lineTop = lineRect.top - containerRect.top + container.scrollTop;
    const lineBottom = lineTop + lineRect.height;
    
    const viewportTop = container.scrollTop;
    const viewportBottom = viewportTop + containerRect.height;
    
    // Scroll margin in pixels
    const margin = 60;
    
    // Scroll if cursor line is outside visible area (with margin)
    if (lineTop < viewportTop + margin) {
      // Cursor above viewport - scroll up
      container.scrollTop = Math.max(0, lineTop - margin);
    } else if (lineBottom > viewportBottom - margin) {
      // Cursor below viewport - scroll down
      container.scrollTop = lineBottom - containerRect.height + margin;
    }
  });

  // Get all line indices for rendering
  const lineIndices = createMemo(() => {
    const s = editorStore.editors[props.id];
    if (!s) return [];
    const totalLines = getLineCount(s.buffer);
    return Array.from({ length: totalLines }, (_, i) => i);
  });

  const saveFile = async () => {
    const filePath = props.filePath;
    
    if (!filePath) {
      console.log("No file path for this buffer");
      return;
    }

    const state = getEditorState(props.id);
    const content = getText(state.buffer);

    try {
      await invoke("write_file", { path: filePath, content });
      updateEditorState(props.id, (s) => markExtendedClean(s));
    } catch (e) {
      setError(`Failed to save: ${e}`);
    }
  };

  const handleGotoDefinition = async () => {
    const rootPath = lspRootPath();
    const filePath = props.filePath;
    
    if (!rootPath || !filePath) return;
    
    const state = getEditorState(props.id);
    const { line, column } = state.cursor;
    
    try {
      const locations = await gotoDefinition(rootPath, filePath, line, column);
      
      if (locations.length === 0) {
        return;
      }
      
      // Take the first location
      const loc = locations[0];
      const targetPath = uriToPath(loc.uri);
      const targetLine = loc.range.start.line;
      const targetColumn = loc.range.start.character;
      
      if (targetPath === filePath) {
        // Same file - just move cursor
        updateEditorState(props.id, (s) => ({
          ...s,
          cursor: { line: targetLine, column: targetColumn },
          desiredColumn: null,
        }));
      } else {
        // Different file - open it in current surface
        // First update the surface to point to the new file
        setSurfaceType(props.id, "editor", targetPath);
        // The file will be loaded by the effect, then we need to position cursor
        // Store the target position to apply after file loads
        // For now, just open the file - positioning will happen automatically
        // TODO: Store target position and apply after file loads
      }
    } catch (e) {
      console.error("LSP: gotoDefinition error:", e);
    }
  };

  const handleHover = async () => {
    const rootPath = lspRootPath();
    const filePath = props.filePath;
    
    if (!rootPath || !filePath) return;
    
    const state = getEditorState(props.id);
    const { line, column } = state.cursor;
    
    try {
      const result = await hover(rootPath, filePath, line, column);
      
      if (!result || !result.contents) {
        setHoverContent(null);
        setHoverPosition(null);
        return;
      }
      
      // Get cursor position for popup placement
      const lineEl = lineRefs.get(line);
      if (lineEl) {
        const rect = lineEl.getBoundingClientRect();
        const x = rect.left + column * 7.8; // approximate char width
        
        // Check if we should flip the popup below the cursor
        // Assume max hover height of 350px
        const hoverHeight = 350;
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;
        const flipUp = spaceAbove >= hoverHeight || spaceAbove > spaceBelow;
        
        // If flipping up, position at top of line; otherwise at bottom
        const y = flipUp ? rect.top : rect.bottom;
        setHoverPosition({ x, y, flipUp });
      }
      
      setHoverContent(result.contents);
      setHoverAnchorCursor({ line, column });
    } catch (e) {
      console.error("LSP: hover error:", e);
      setHoverContent(null);
      setHoverPosition(null);
    }
  };

  const closeHover = () => {
    setHoverContent(null);
    setHoverPosition(null);
    setHoverAnchorCursor(null);
  };

  // Get completion context - the word prefix and whether we're after a trigger char
  const getCompletionContext = (): { prefix: string; startColumn: number; afterTrigger: boolean } => {
    const state = getEditorState(props.id);
    const lineContent = getLine(state.buffer, state.cursor.line);
    const column = state.cursor.column;
    
    // Check if we're right after a trigger character (. or ::)
    const charBefore = column > 0 ? lineContent[column - 1] : "";
    const twoBefore = column > 1 ? lineContent.slice(column - 2, column) : "";
    const afterTrigger = charBefore === "." || twoBefore === "::";
    
    // Walk backwards to find the start of the current word
    let startColumn = column;
    while (startColumn > 0 && /[a-zA-Z0-9_]/.test(lineContent[startColumn - 1])) {
      startColumn--;
    }
    
    const prefix = lineContent.slice(startColumn, column);
    return { prefix, startColumn, afterTrigger };
  };

  const handleCompletion = async () => {
    const rootPath = lspRootPath();
    const filePath = props.filePath;
    
    if (!rootPath || !filePath) return;
    
    const state = getEditorState(props.id);
    const { line, column } = state.cursor;
    
    // Get the context for filtering
    const { prefix, startColumn, afterTrigger } = getCompletionContext();
    
    // Need either a prefix OR be after a trigger character (. or ::)
    if (prefix.length === 0 && !afterTrigger) {
      closeCompletion();
      return;
    }
    
    try {
      // Flush any pending document changes to rust-analyzer first
      // so it has the latest content including the trigger character
      if (lspChangeTimeout) {
        clearTimeout(lspChangeTimeout);
        lspChangeTimeout = null;
      }
      const content = getText(state.buffer);
      await changeDocument(rootPath, filePath, content);
      
      const items = await complete(rootPath, filePath, line, column);
      
      if (items.length === 0) {
        closeCompletion();
        return;
      }
      
      let filteredItems = items;
      
      // Only filter if we have a prefix to filter by
      if (prefix.length > 0) {
        const prefixLower = prefix.toLowerCase();
        filteredItems = items.filter(item => {
          const filterText = (item.filterText ?? item.label).toLowerCase();
          return filterText.startsWith(prefixLower) || filterText.includes(prefixLower);
        });
        
        // Sort: exact prefix matches first, then by label length
        filteredItems.sort((a, b) => {
          const aText = (a.filterText ?? a.label).toLowerCase();
          const bText = (b.filterText ?? b.label).toLowerCase();
          const aStartsWith = aText.startsWith(prefixLower);
          const bStartsWith = bText.startsWith(prefixLower);
          if (aStartsWith && !bStartsWith) return -1;
          if (!aStartsWith && bStartsWith) return 1;
          return a.label.length - b.label.length;
        });
      }
      
      if (filteredItems.length === 0) {
        closeCompletion();
        return;
      }
      
      // Get cursor position for menu placement (at the start of the word, or at cursor if no prefix)
      const lineEl = lineRefs.get(line);
      if (lineEl) {
        const rect = lineEl.getBoundingClientRect();
        const menuColumn = prefix.length > 0 ? startColumn : column;
        const x = rect.left + menuColumn * 7.8;
        
        // Check if we should flip the menu above the cursor
        // Assume max menu height of 220px (10 items * ~22px each)
        const menuHeight = 220;
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        const flipUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
        
        // If flipping up, position at top of line; otherwise at bottom
        const y = flipUp ? rect.top : rect.bottom;
        setCompletionPosition({ x, y, flipUp });
      }
      
      setCompletionItems(filteredItems);
      setCompletionIndex(0);
    } catch (e) {
      console.error("LSP: completion error:", e);
      closeCompletion();
    }
  };

  const closeCompletion = () => {
    setCompletionItems([]);
    setCompletionIndex(0);
    setCompletionPosition(null);
  };

  // Debounced autocomplete trigger
  let autoCompleteTimeout: ReturnType<typeof setTimeout> | null = null;
  const AUTO_COMPLETE_DEBOUNCE_MS = 150;
  
  const triggerAutoComplete = () => {
    if (autoCompleteTimeout) {
      clearTimeout(autoCompleteTimeout);
    }
    autoCompleteTimeout = setTimeout(() => {
      handleCompletion();
    }, AUTO_COMPLETE_DEBOUNCE_MS);
  };

  // Clean up autocomplete timeout
  onCleanup(() => {
    if (autoCompleteTimeout) {
      clearTimeout(autoCompleteTimeout);
    }
  });

  const acceptCompletion = () => {
    const items = completionItems();
    const index = completionIndex();
    
    if (items.length === 0 || index >= items.length) {
      closeCompletion();
      return;
    }
    
    const item = items[index];
    let textToInsert = item.insertText ?? item.label;
    
    // Strip "(as Type)" suffix that rust-analyzer adds for trait method display
    // e.g., "into()(as Into)" -> "into()"
    textToInsert = textToInsert.replace(/\(as \w+\)$/, "");
    
    // Check if we should place cursor inside parens
    // Handle both "foo(...)" and "foo()" patterns
    let cursorOffset = textToInsert.length;
    const ellipsisMatch = textToInsert.match(/\(…\)$/);
    const emptyParensMatch = textToInsert.match(/\(\)$/);
    
    if (ellipsisMatch) {
      // Replace "(...)" with "()" and place cursor inside
      textToInsert = textToInsert.slice(0, -3) + "()";
      cursorOffset = textToInsert.length - 1; // Position before closing paren
    } else if (emptyParensMatch) {
      // Place cursor inside empty parens
      cursorOffset = textToInsert.length - 1; // Position before closing paren
    }
    
    // Replace the word prefix with the completion text
    const { startColumn } = getCompletionContext();
    
    updateEditorState(props.id, (state) => {
      const newHistory = pushHistory(state.history, state.buffer, state.cursor);
      
      // Delete the prefix first, then insert the completion
      const lineContent = getLine(state.buffer, state.cursor.line);
      const beforePrefix = lineContent.slice(0, startColumn);
      const afterCursor = lineContent.slice(state.cursor.column);
      const newLineContent = beforePrefix + textToInsert + afterCursor;
      
      // Update the buffer with the new line
      const newLines = [...state.buffer.lines];
      newLines[state.cursor.line] = newLineContent;
      const newBuffer = { ...state.buffer, lines: newLines };
      
      const newCursor = { ...state.cursor, column: startColumn + cursorOffset };
      return markExtendedDirty({ ...state, buffer: newBuffer, cursor: newCursor, history: newHistory });
    });
    
    closeCompletion();
  };

  // Rust keywords for detection
  const RUST_KEYWORDS = new Set([
    "as", "async", "await", "break", "const", "continue", "crate", "dyn",
    "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in",
    "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return",
    "self", "Self", "static", "struct", "super", "trait", "true", "type",
    "unsafe", "use", "where", "while", "yield",
    // Common snippets that should show as keywords
    "letm", "println", "eprintln", "format", "vec", "panic", "assert",
    "debug_assert", "unimplemented", "unreachable", "todo",
  ]);

  // Rust primitive types
  const RUST_PRIMITIVES = new Set([
    "bool", "char", "str", "i8", "i16", "i32", "i64", "i128", "isize",
    "u8", "u16", "u32", "u64", "u128", "usize", "f32", "f64",
  ]);

  // Infer the effective completion kind based on label, detail, and provided kind
  const inferCompletionKind = (item: CompletionItem): { kind: number; isMacro: boolean } => {
    const label = item.label;
    const detail = item.detail?.toLowerCase() ?? "";
    const kind = item.kind;
    
    // Check for macros first (highest priority detection)
    if (label.endsWith("!") || label.endsWith("!(…)") || detail.includes("macro")) {
      return { kind: 14, isMacro: true }; // Use keyword kind but flag as macro for special icon
    }
    
    // Always override for known keywords and primitives (rust-analyzer often sends wrong/no kind)
    if (RUST_KEYWORDS.has(label)) {
      return { kind: 14, isMacro: false }; // Keyword
    }
    if (RUST_PRIMITIVES.has(label)) {
      return { kind: 22, isMacro: false }; // Struct (for primitive types)
    }
    
    // If we have a valid kind from LSP, use it
    if (kind !== undefined && kind !== null && kind >= 1 && kind <= 25) {
      return { kind, isMacro: false };
    }
    
    // Check detail for hints
    if (detail.includes("fn ") || detail.includes("function")) {
      return { kind: 3, isMacro: false }; // Function
    }
    if (detail.includes("struct ")) {
      return { kind: 22, isMacro: false }; // Struct
    }
    if (detail.includes("enum ")) {
      return { kind: 13, isMacro: false }; // Enum
    }
    if (detail.includes("trait ")) {
      return { kind: 8, isMacro: false }; // Interface
    }
    if (detail.includes("mod ")) {
      return { kind: 9, isMacro: false }; // Module
    }
    if (detail.includes("const ")) {
      return { kind: 21, isMacro: false }; // Constant
    }
    if (detail.includes("type ")) {
      return { kind: 7, isMacro: false }; // Class (type alias)
    }
    
    // Check label patterns
    if (label.startsWith("r#")) {
      return { kind: 14, isMacro: false }; // Raw identifier (keyword)
    }
    // PascalCase typically indicates a type
    if (/^[A-Z][a-zA-Z0-9]*$/.test(label)) {
      return { kind: 22, isMacro: false }; // Struct (type)
    }
    // SCREAMING_CASE typically indicates a constant
    if (/^[A-Z][A-Z0-9_]*$/.test(label) && label.includes("_")) {
      return { kind: 21, isMacro: false }; // Constant
    }
    
    // Default fallback
    return { kind: 1, isMacro: false }; // Text
  };

  // Get CSS class suffix for completion kind
  const getCompletionKindClass = (kind: number): string => {
    switch (kind) {
      case 1: return "text";
      case 2: return "method";
      case 3: return "function";
      case 4: return "constructor";
      case 5: return "field";
      case 6: return "variable";
      case 7: return "class";
      case 8: return "interface";
      case 9: return "module";
      case 10: return "property";
      case 11: return "unit";
      case 12: return "value";
      case 13: return "enum";
      case 14: return "keyword";
      case 15: return "snippet";
      case 16: return "color";
      case 17: return "file";
      case 18: return "reference";
      case 19: return "folder";
      case 20: return "enum-member";
      case 21: return "constant";
      case 22: return "struct";
      case 23: return "event";
      case 24: return "operator";
      case 25: return "type-parameter";
      default: return "text";
    }
  };

  const handleFindReferences = async () => {
    const rootPath = lspRootPath();
    const filePath = props.filePath;
    
    if (!rootPath || !filePath) return;
    
    const state = getEditorState(props.id);
    const { line, column } = state.cursor;
    
    try {
      const locations = await references(rootPath, filePath, line, column, true);
      
      if (locations.length === 0) {
        setShowReferences(false);
        return;
      }
      
      // Transform locations to simpler format
      const refs = locations.map(loc => ({
        uri: loc.uri,
        line: loc.range.start.line,
        col: loc.range.start.character,
      }));
      
      setReferencesLocations(refs);
      setReferencesIndex(0);
      setShowReferences(true);
    } catch (e) {
      console.error("LSP: references error:", e);
      setShowReferences(false);
    }
  };

  const closeReferences = () => {
    setReferencesLocations([]);
    setReferencesIndex(0);
    setShowReferences(false);
  };

  const gotoReference = (index: number) => {
    const refs = referencesLocations();
    if (index < 0 || index >= refs.length) return;
    
    const ref = refs[index];
    const targetPath = uriToPath(ref.uri);
    
    if (targetPath === props.filePath) {
      // Same file - just move cursor
      updateEditorState(props.id, (s) => ({
        ...s,
        cursor: { line: ref.line, column: ref.col },
        desiredColumn: null,
      }));
    } else {
      // Different file - open it
      setSurfaceType(props.id, "editor", targetPath);
    }
    
    setReferencesIndex(index);
  };

  const handleWheel = (_e: WheelEvent) => {
    // Let the browser handle scrolling naturally
    // Don't prevent default - this allows smooth scrolling of the lines container
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Reset cursor blink on any key activity
    resetCursorBlink();
    
    // Close hover on any key press (it will reopen if K is pressed)
    if (hoverContent() && e.key !== "Escape") {
      closeHover();
    }
    
    // Don't handle keys when search input is active (let it handle its own input)
    if (searchMode()) {
      return;
    }

    const state = getEditorState(props.id);

    // Handle Cmd+S for save
    if (e.metaKey && e.key === "s") {
      e.preventDefault();
      saveFile();
      return;
    }

    // Handle Ctrl+N for completion (in insert mode) - vim-style
    if (e.ctrlKey && e.key === "n" && state.mode === "insert" && props.filePath?.endsWith(".rs")) {
      e.preventDefault();
      handleCompletion();
      return;
    }

    // Handle Ctrl+R for redo (don't let browser intercept)
    if (e.ctrlKey && e.key === "r") {
      e.preventDefault();
      if (state.mode === "normal") {
        const newInput = pendingInput() + "\x12"; // Ctrl-R
        processVimInput(newInput);
      }
      return;
    }

    // Handle Ctrl+D for half page down
    if (e.ctrlKey && e.key === "d") {
      e.preventDefault();
      if (state.mode === "normal") {
        // Estimate visible lines based on container height and typical line height
        const visibleLines = linesContainerRef ? Math.floor(linesContainerRef.clientHeight / 20) : 20;
        const halfPage = Math.floor(visibleLines / 2);
        updateEditorState(props.id, (s) => {
          const newLine = Math.min(s.cursor.line + halfPage, getLineCount(s.buffer) - 1);
          return { ...s, cursor: { ...s.cursor, line: newLine } };
        });
      }
      return;
    }

    // Handle Ctrl+U for half page up
    if (e.ctrlKey && e.key === "u") {
      e.preventDefault();
      if (state.mode === "normal") {
        const visibleLines = linesContainerRef ? Math.floor(linesContainerRef.clientHeight / 20) : 20;
        const halfPage = Math.floor(visibleLines / 2);
        updateEditorState(props.id, (s) => {
          const newLine = Math.max(0, s.cursor.line - halfPage);
          return { ...s, cursor: { ...s.cursor, line: newLine } };
        });
      }
      return;
    }

    // Handle Ctrl+F for full page down
    if (e.ctrlKey && e.key === "f") {
      e.preventDefault();
      if (state.mode === "normal") {
        const visibleLines = linesContainerRef ? Math.floor(linesContainerRef.clientHeight / 20) : 20;
        const fullPage = Math.max(1, visibleLines - 2);
        updateEditorState(props.id, (s) => {
          const newLine = Math.min(s.cursor.line + fullPage, getLineCount(s.buffer) - 1);
          return { ...s, cursor: { ...s.cursor, line: newLine } };
        });
      }
      return;
    }

    // Handle Ctrl+B for full page up
    if (e.ctrlKey && e.key === "b") {
      e.preventDefault();
      if (state.mode === "normal") {
        const visibleLines = linesContainerRef ? Math.floor(linesContainerRef.clientHeight / 20) : 20;
        const fullPage = Math.max(1, visibleLines - 2);
        updateEditorState(props.id, (s) => {
          const newLine = Math.max(0, s.cursor.line - fullPage);
          return { ...s, cursor: { ...s.cursor, line: newLine } };
        });
      }
      return;
    }

    // Don't intercept other modifier key combos
    if (e.metaKey || e.altKey) {
      return;
    }

    if (state.mode === "normal") {
      handleNormalModeKey(e);
    } else {
      handleInsertModeKey(e);
    }
  };

  // Handle display line movement (gj/gk) - requires measuring visual lines
  const handleDisplayLineMotion = (direction: "down" | "up", count: number) => {
    const state = getEditorState(props.id);
    const cursorLine = state.cursor.line;
    const cursorCol = state.cursor.column;
    
    const lineEl = lineRefs.get(cursorLine);
    if (!lineEl) return;
    
    const contentEl = lineEl.querySelector(".editor-surface__line-content") as HTMLElement;
    if (!contentEl) return;
    
    const lineContent = getLine(state.buffer, cursorLine);
    if (lineContent.length === 0) {
      // Empty line - just move to next/prev buffer line
      if (direction === "down") {
        const totalLines = getLineCount(state.buffer);
        if (cursorLine < totalLines - 1) {
          updateEditorState(props.id, (s) => ({
            ...s,
            cursor: { line: cursorLine + 1, column: 0 },
          }));
        }
      } else {
        if (cursorLine > 0) {
          updateEditorState(props.id, (s) => ({
            ...s,
            cursor: { line: cursorLine - 1, column: 0 },
          }));
        }
      }
      return;
    }
    
    const computedStyle = getComputedStyle(contentEl);
    const lineHeight = parseFloat(computedStyle.lineHeight) || 20;
    
    // Get the content element's position for reference
    const contentRect = contentEl.getBoundingClientRect();
    
    // Use Range API to get the exact position of each character
    // Find text nodes within the content element
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      textNodes.push(node);
    }
    
    if (textNodes.length === 0) return;
    
    // Build a map of column -> {y, x} for each character position
    // by measuring the Y position of each character.
    // We need to handle the case where the DOM might have characters that don't map 1:1
    // to buffer columns (e.g., cursor placeholder in normal mode).
    const charPositions = new Map<number, { y: number; x: number }>();
    let charIndex = 0;
    const bufferLen = lineContent.length;
    
    for (const textNode of textNodes) {
      const text = textNode.textContent || "";
      for (let i = 0; i < text.length; i++) {
        // Only track positions for characters that exist in the buffer
        if (charIndex < bufferLen) {
          const range = document.createRange();
          range.setStart(textNode, i);
          range.setEnd(textNode, i + 1);
          const rect = range.getBoundingClientRect();
          charPositions.set(charIndex, {
            y: rect.top - contentRect.top,
            x: rect.left - contentRect.left,
          });
        }
        charIndex++;
      }
    }
    
    if (charPositions.size === 0) return;
    
    // Convert map to sorted array for easier processing
    const sortedCols = Array.from(charPositions.keys()).sort((a, b) => a - b);
    
    // Group characters by visual line (same Y position, within tolerance)
    const visualLines: { cols: number[]; y: number }[] = [];
    let currentY = charPositions.get(sortedCols[0])!.y;
    let currentLineCols: number[] = [];
    
    for (const col of sortedCols) {
      const pos = charPositions.get(col)!;
      // If Y changed significantly (more than half line height), it's a new visual line
      if (Math.abs(pos.y - currentY) > lineHeight / 2) {
        visualLines.push({ cols: currentLineCols, y: currentY });
        currentLineCols = [];
        currentY = pos.y;
      }
      currentLineCols.push(col);
    }
    // Add the last visual line
    if (currentLineCols.length > 0) {
      visualLines.push({ cols: currentLineCols, y: currentY });
    }
    
    if (visualLines.length === 0) return;
    
    // Find which visual line the cursor is on
    let currentVisualLineIndex = 0;
    for (let i = 0; i < visualLines.length; i++) {
      const lineCols = visualLines[i].cols;
      const startCol = lineCols[0];
      const endCol = lineCols[lineCols.length - 1];
      if (cursorCol >= startCol && cursorCol <= endCol) {
        currentVisualLineIndex = i;
        break;
      }
      // Handle cursor at end of line (past last character)
      if (i === visualLines.length - 1 && cursorCol > endCol) {
        currentVisualLineIndex = i;
      }
    }
    
    // Get cursor's X position for maintaining horizontal position
    const cursorPos = charPositions.get(cursorCol);
    const cursorX = cursorPos?.x ?? 
                    (charPositions.size > 0 ? charPositions.get(sortedCols[sortedCols.length - 1])!.x : 0);
    
    // Calculate target visual line
    const targetVisualLineIndex = direction === "down"
      ? currentVisualLineIndex + count
      : currentVisualLineIndex - count;
    
    if (targetVisualLineIndex < 0) {
      // Move to previous buffer line
      if (cursorLine > 0) {
        const prevLine = cursorLine - 1;
        const prevLineLen = getLine(state.buffer, prevLine).length;
        updateEditorState(props.id, (s) => ({
          ...s,
          cursor: { line: prevLine, column: Math.min(cursorCol, Math.max(0, prevLineLen - 1)) },
        }));
      }
    } else if (targetVisualLineIndex >= visualLines.length) {
      // Move to next buffer line
      const totalLines = getLineCount(state.buffer);
      if (cursorLine < totalLines - 1) {
        const nextLine = cursorLine + 1;
        const nextLineLen = getLine(state.buffer, nextLine).length;
        updateEditorState(props.id, (s) => ({
          ...s,
          cursor: { line: nextLine, column: Math.min(cursorCol, Math.max(0, nextLineLen - 1)) },
        }));
      }
    } else {
      // Move to character on target visual line that's closest to cursor's X position
      const targetLineCols = visualLines[targetVisualLineIndex].cols;
      let bestCol = targetLineCols[0];
      let bestDistance = Infinity;
      
      for (const col of targetLineCols) {
        const pos = charPositions.get(col);
        if (pos) {
          const distance = Math.abs(pos.x - cursorX);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestCol = col;
          }
        }
      }
      
      updateEditorState(props.id, (s) => ({
        ...s,
        cursor: { line: cursorLine, column: bestCol },
      }));
    }
  };

  // Calculate line and column from mouse coordinates
  const getPositionFromMouse = (clientX: number, clientY: number): Position | null => {
    const state = getEditorState(props.id);
    
    // Find which line was clicked by checking Y coordinate against line positions
    let clickedLine: number | null = null;
    const totalLines = getLineCount(state.buffer);
    
    // Check each line's bounding rect
    for (let lineIndex = 0; lineIndex < totalLines; lineIndex++) {
      const lineEl = lineRefs.get(lineIndex);
      if (lineEl) {
        const rect = lineEl.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) {
          clickedLine = lineIndex;
          break;
        }
      }
    }
    
    // If clicked above first line, use line 0
    if (clickedLine === null && totalLines > 0) {
      const firstLineEl = lineRefs.get(0);
      if (firstLineEl && clientY < firstLineEl.getBoundingClientRect().top) {
        clickedLine = 0;
      }
    }
    
    // If clicked below last line, use last line
    if (clickedLine === null && totalLines > 0) {
      clickedLine = totalLines - 1;
    }
    
    if (clickedLine === null) return null;
    
    // Get the content element for this line
    const lineEl = lineRefs.get(clickedLine);
    if (!lineEl) return null;
    
    const contentEl = lineEl.querySelector(".editor-surface__line-content") as HTMLElement;
    if (!contentEl) return null;
    
    const lineContent = getLine(state.buffer, clickedLine);
    const contentRect = contentEl.getBoundingClientRect();
    const clickX = clientX - contentRect.left;
    
    // If line is empty, position at column 0
    if (lineContent.length === 0) {
      return { line: clickedLine, column: 0 };
    }
    
    // Use Range API to find the closest character to the click position
    const walker = document.createTreeWalker(contentEl, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node: Text | null;
    while ((node = walker.nextNode() as Text | null)) {
      textNodes.push(node);
    }
    
    // Build character positions
    let charIndex = 0;
    const bufferLen = lineContent.length;
    let bestCol = 0;
    let bestDistance = Infinity;
    
    for (const textNode of textNodes) {
      const text = textNode.textContent || "";
      for (let i = 0; i < text.length; i++) {
        if (charIndex < bufferLen) {
          const range = document.createRange();
          range.setStart(textNode, i);
          range.setEnd(textNode, i + 1);
          const rect = range.getBoundingClientRect();
          const charX = rect.left - contentRect.left;
          const charMidX = charX + rect.width / 2;
          
          // Check distance from click to character center
          const distance = Math.abs(clickX - charMidX);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestCol = charIndex;
          }
        }
        charIndex++;
      }
    }
    
    // If clicked past the end of the line, position at last character
    const maxCol = state.mode === "insert" ? lineContent.length : Math.max(0, lineContent.length - 1);
    const finalCol = Math.min(bestCol, maxCol);
    
    return { line: clickedLine, column: finalCol };
  };
  
  // Track if we're currently dragging
  const [isDragging, setIsDragging] = createSignal(false);

  // Handle mouse click to position cursor (and start drag)
  const handleMouseDown = (e: MouseEvent) => {
    // Reset cursor blink on mouse activity
    resetCursorBlink();
    
    // Only handle left click
    if (e.button !== 0) return;
    
    const pos = getPositionFromMouse(e.clientX, e.clientY);
    if (!pos) return;
    
    // Start drag tracking
    setIsDragging(true);
    
    updateEditorState(props.id, (s) => ({
      ...s,
      cursor: pos,
      // Start visual mode at this position (will be cleared if no drag)
      visualAnchor: pos,
      visualMode: "char",
    }));
    
    e.preventDefault();
  };
  
  // Handle mouse move during drag
  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging()) return;
    
    const pos = getPositionFromMouse(e.clientX, e.clientY);
    if (!pos) return;
    
    updateEditorState(props.id, (s) => ({
      ...s,
      cursor: pos,
      // Keep visual mode active during drag
    }));
  };
  
  // Handle mouse up to end drag
  const handleMouseUp = (_e: MouseEvent) => {
    if (!isDragging()) return;
    
    setIsDragging(false);
    
    const state = getEditorState(props.id);
    
    // If anchor and cursor are the same, clear visual mode (was just a click)
    if (state.visualAnchor && 
        state.visualAnchor.line === state.cursor.line && 
        state.visualAnchor.column === state.cursor.column) {
      updateEditorState(props.id, (s) => ({
        ...s,
        visualAnchor: null,
        visualMode: null,
      }));
    }
  };
  
  // Set up document-level mouse handlers for drag (so drag works outside the editor)
  createEffect(() => {
    if (props.focused) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  });

  const processVimInput = (input: string) => {
    const state = getEditorState(props.id);
    
    // Handle special LSP commands before vim parsing
    if (input === "gd" && state.mode === "normal" && props.filePath?.endsWith(".rs")) {
      handleGotoDefinition();
      setPendingInput("");
      return;
    }
    
    // K - show hover information
    if (input === "K" && state.mode === "normal" && props.filePath?.endsWith(".rs")) {
      handleHover();
      setPendingInput("");
      return;
    }
    
    // gr - find references
    if (input === "gr" && state.mode === "normal" && props.filePath?.endsWith(".rs")) {
      handleFindReferences();
      setPendingInput("");
      return;
    }
    
    // Parse with a fresh vim state that preserves only find char info and registers
    // The full input string contains all the context needed for parsing
    const parseVimState = {
      ...createVimState(),
      registers: state.vim.registers,
      lastFindChar: state.vim.lastFindChar,
      lastFindForward: state.vim.lastFindForward,
      lastFindInclusive: state.vim.lastFindInclusive,
      searchPattern: state.vim.searchPattern,
      searchForward: state.vim.searchForward,
      searchMatches: state.vim.searchMatches,
      searchMatchIndex: state.vim.searchMatchIndex,
    };
    const result = parseInput(input, parseVimState, state.mode, {
      inVisualMode: state.visualMode !== null,
    });
    
    if (result.complete) {
      setPendingInput("");
      
      if (result.command) {
        // Handle display line motions (gj/gk) specially - they need UI measurement
        if (result.command.type === "motion" && (result.command.name === "gj" || result.command.name === "gk")) {
          const direction = result.command.name === "gj" ? "down" : "up";
          handleDisplayLineMotion(direction, result.command.count);
          return;
        }
        
        const execResult = executeCommand(state, result.command);
        // Merge vim states: execution takes priority, but parser wins for find char info
        setEditorState(props.id, {
          ...execResult.state,
          vim: {
            ...execResult.state.vim,
            // Parser updates these fields for f/F/t/T commands
            lastFindChar: result.state.lastFindChar ?? state.vim.lastFindChar,
            lastFindForward: result.state.lastFindForward,
            lastFindInclusive: result.state.lastFindInclusive,
          },
        });
      } else {
        // Update vim state even if no command (e.g., for find char memory)
        updateEditorState(props.id, (s) => ({ ...s, vim: result.state }));
      }
    } else {
      setPendingInput(input);
      // Don't update vim state for incomplete input - just track pending input
    }
  };

  const handleNormalModeKey = (e: KeyboardEvent) => {
    let key = e.key;
    
    // Handle Escape - exit visual mode or clear pending input, close hover
    if (key === "Escape") {
      setPendingInput("");
      setSearchMode(null);
      setSearchInput("");
      closeHover();
      updateEditorState(props.id, (s) => ({
        ...s,
        vim: createVimState(),
        visualAnchor: null,
        visualMode: null,
      }));
      e.preventDefault();
      return;
    }
    
    // Handle / and ? to enter search mode
    if (key === "/" || key === "?") {
      e.preventDefault();
      setSearchMode(key as "/" | "?");
      setSearchInput("");
      // Focus the search input after a tick
      setTimeout(() => searchInputRef?.focus(), 0);
      return;
    }
    
    // Handle z commands for scroll positioning
    if (pendingInput() === "z" || key === "z") {
      if (pendingInput() === "z") {
        e.preventDefault();
        const s = editorStore.editors[props.id];
        const lineEl = s ? lineRefs.get(s.cursor.line) : null;
        
        if (lineEl && linesContainerRef) {
          const container = linesContainerRef;
          const containerRect = container.getBoundingClientRect();
          const lineRect = lineEl.getBoundingClientRect();
          const lineTop = lineRect.top - containerRect.top + container.scrollTop;
          
          if (key === "z") {
            // zz - center cursor line in view
            const newScrollTop = lineTop - containerRect.height / 2 + lineRect.height / 2;
            container.scrollTop = Math.max(0, newScrollTop);
          } else if (key === "t") {
            // zt - cursor to top
            container.scrollTop = Math.max(0, lineTop);
          } else if (key === "b") {
            // zb - cursor to bottom
            const newScrollTop = lineTop - containerRect.height + lineRect.height;
            container.scrollTop = Math.max(0, newScrollTop);
          }
        }
        setPendingInput("");
        return;
      }
    }
    
    // Arrow keys map to hjkl
    const arrowMap: Record<string, string> = {
      ArrowLeft: "h",
      ArrowRight: "l",
      ArrowUp: "k",
      ArrowDown: "j",
    };
    
    if (arrowMap[key]) {
      key = arrowMap[key];
    }
    
    // Only process printable characters and mapped keys
    if (key.length === 1 || arrowMap[e.key]) {
      e.preventDefault();
      const newInput = pendingInput() + key;
      processVimInput(newInput);
    }
  };

  const handleInsertModeKey = (e: KeyboardEvent) => {
    const key = e.key;

    // Handle completion menu navigation if open
    if (completionItems().length > 0) {
      if (key === "Escape") {
        closeCompletion();
        e.preventDefault();
        return;
      }
      if (key === "ArrowDown" || (e.ctrlKey && key === "n")) {
        setCompletionIndex((i) => Math.min(i + 1, completionItems().length - 1));
        e.preventDefault();
        return;
      }
      if (key === "ArrowUp" || (e.ctrlKey && key === "p")) {
        setCompletionIndex((i) => Math.max(i - 1, 0));
        e.preventDefault();
        return;
      }
      if (key === "Enter" || key === "Tab") {
        acceptCompletion();
        e.preventDefault();
        return;
      }
    }

    if (key === "Escape") {
      // Return to normal mode, adjust cursor position
      if (autoCompleteTimeout) {
        clearTimeout(autoCompleteTimeout);
        autoCompleteTimeout = null;
      }
      closeCompletion();
      updateEditorState(props.id, (state) => {
        const lineLen = state.buffer.lines[state.cursor.line]?.length ?? 0;
        const newCol = Math.max(0, Math.min(state.cursor.column - 1, lineLen - 1));
        return {
          ...state,
          mode: "normal",
          cursor: { ...state.cursor, column: Math.max(0, newCol) },
          vim: createVimState(),
        };
      });
      e.preventDefault();
      return;
    }

    // Arrow keys for cursor movement
    const arrowActions: Record<string, () => void> = {
      ArrowLeft: () => updateEditorState(props.id, (s) => {
        if (s.cursor.column > 0) {
          return { ...s, cursor: { ...s.cursor, column: s.cursor.column - 1 } };
        }
        return s;
      }),
      ArrowRight: () => updateEditorState(props.id, (s) => {
        const lineLen = s.buffer.lines[s.cursor.line]?.length ?? 0;
        if (s.cursor.column < lineLen) {
          return { ...s, cursor: { ...s.cursor, column: s.cursor.column + 1 } };
        }
        return s;
      }),
      ArrowUp: () => updateEditorState(props.id, (s) => {
        if (s.cursor.line > 0) {
          const targetLineLen = s.buffer.lines[s.cursor.line - 1]?.length ?? 0;
          return {
            ...s,
            cursor: {
              line: s.cursor.line - 1,
              column: Math.min(s.cursor.column, targetLineLen),
            },
          };
        }
        return s;
      }),
      ArrowDown: () => updateEditorState(props.id, (s) => {
        if (s.cursor.line < getLineCount(s.buffer) - 1) {
          const targetLineLen = s.buffer.lines[s.cursor.line + 1]?.length ?? 0;
          return {
            ...s,
            cursor: {
              line: s.cursor.line + 1,
              column: Math.min(s.cursor.column, targetLineLen),
            },
          };
        }
        return s;
      }),
    };

    if (arrowActions[key]) {
      arrowActions[key]();
      e.preventDefault();
      return;
    }

    // Backspace
    if (key === "Backspace") {
      updateEditorState(props.id, (state) => {
        // Push history before modification
        const newHistory = pushHistory(state.history, state.buffer, state.cursor);
        const { buffer, position } = deleteCharBefore(state.buffer, state.cursor);
        return markExtendedDirty({ ...state, buffer, cursor: position, history: newHistory });
      });
      e.preventDefault();
      // Re-trigger autocomplete after backspace (might still be in a word)
      if (props.filePath?.endsWith(".rs")) {
        triggerAutoComplete();
      }
      return;
    }

    // Enter - insert newline with smart indentation
    if (key === "Enter") {
      // Close completion menu first
      closeCompletion();
      
      updateEditorState(props.id, (state) => {
        const newHistory = pushHistory(state.history, state.buffer, state.cursor);
        
        // Compute smart indentation based on current line and cursor position
        const indent = computeSmartIndent(state.buffer, state.cursor.line, state.cursor.column);
        
        const newBuffer = bufferInsertText(state.buffer, state.cursor, "\n" + indent);
        const newCursor = { line: state.cursor.line + 1, column: indent.length };
        return clampExtendedCursor(markExtendedDirty({ ...state, buffer: newBuffer, cursor: newCursor, history: newHistory }));
      });
      e.preventDefault();
      return;
    }

    // Tab - insert 4 spaces
    if (key === "Tab") {
      updateEditorState(props.id, (state) => {
        const newHistory = pushHistory(state.history, state.buffer, state.cursor);
        const newBuffer = bufferInsertText(state.buffer, state.cursor, "    ");
        const newCursor = { ...state.cursor, column: state.cursor.column + 4 };
        return markExtendedDirty({ ...state, buffer: newBuffer, cursor: newCursor, history: newHistory });
      });
      e.preventDefault();
      return;
    }

    // Regular character input
    if (key.length === 1) {
      updateEditorState(props.id, (state) => {
        const newHistory = pushHistory(state.history, state.buffer, state.cursor);
        const newBuffer = bufferInsertText(state.buffer, state.cursor, key);
        const newCursor = { ...state.cursor, column: state.cursor.column + 1 };
        return markExtendedDirty({ ...state, buffer: newBuffer, cursor: newCursor, history: newHistory });
      });
      e.preventDefault();
      
      // Trigger autocomplete for identifier characters and trigger characters
      if (props.filePath?.endsWith(".rs")) {
        if (/[a-zA-Z0-9_]/.test(key)) {
          // Identifier character - trigger with debounce
          triggerAutoComplete();
        } else if (key === "." || key === ":") {
          // Trigger character - trigger immediately for member access
          triggerAutoComplete();
        } else {
          // Other characters - close completion
          closeCompletion();
        }
      }
    }
  };

  // Access the store directly to ensure SolidJS tracks reactivity
  const state = () => editorStore.editors[props.id] ?? getEditorState(props.id);
  
  const fileName = () => {
    const path = props.filePath;
    if (!path) return "[scratch]";
    const parts = path.split("/");
    return parts[parts.length - 1];
  };

  // Get line number gutter width based on total lines
  const gutterWidth = createMemo(() => {
    const lineCount = getLineCount(state().buffer);
    const digits = Math.max(2, String(lineCount).length);
    return digits * 10 + 16; // 10px per digit + 16px padding
  });

  // Get diagnostic class name for a severity
  const getDiagnosticClass = (severity: number | undefined): string => {
    switch (severity) {
      case 1: return "editor-surface__diagnostic--error";
      case 2: return "editor-surface__diagnostic--warning";
      case 3: return "editor-surface__diagnostic--info";
      case 4: return "editor-surface__diagnostic--hint";
      default: return "";
    }
  };

  // Helper to render text with syntax highlighting and diagnostics
  // Takes allTokens as a parameter so callers can pass the reactive value
  const renderHighlightedText = (text: string, lineIndex: number, startCol: number, allTokens: HighlightResult, lineDiags?: Diagnostic[]) => {
    if (text.length === 0) return text;
    
    const tokens = allTokens.lines.get(lineIndex) ?? [];
    const endCol = startCol + text.length;
    
    // Build a list of spans with combined syntax + diagnostic info
    // Each character position can have: syntax class, diagnostic class, or both
    interface CharInfo {
      syntaxClass?: string;
      diagClass?: string;
    }
    
    const charInfos: CharInfo[] = Array.from({ length: text.length }, () => ({}));
    
    // Apply syntax highlighting
    for (const token of tokens) {
      if (token.endCol <= startCol) continue;
      if (token.startCol >= endCol) break;
      
      const tokenStart = Math.max(token.startCol, startCol) - startCol;
      const tokenEnd = Math.min(token.endCol, endCol) - startCol;
      const className = `syntax-${token.type.replace(/\./g, "-")}`;
      
      for (let i = tokenStart; i < tokenEnd; i++) {
        charInfos[i].syntaxClass = className;
      }
    }
    
    // Apply diagnostic underlines
    if (lineDiags && lineDiags.length > 0) {
      for (const diag of lineDiags) {
        // Handle multi-line diagnostics: determine correct range based on which line we're on
        let diagRangeStart: number;
        let diagRangeEnd: number;
        
        const isStartLine = lineIndex === diag.range.start.line;
        const isEndLine = lineIndex === diag.range.end.line;
        
        if (isStartLine && isEndLine) {
          // Single-line diagnostic
          diagRangeStart = diag.range.start.character;
          diagRangeEnd = diag.range.end.character;
        } else if (isStartLine) {
          // Start line of multi-line: from start char to end of line
          diagRangeStart = diag.range.start.character;
          diagRangeEnd = text.length + startCol;
        } else if (isEndLine) {
          // End line of multi-line: from start of line to end char
          diagRangeStart = 0;
          diagRangeEnd = diag.range.end.character;
        } else {
          // Middle line of multi-line: entire line
          diagRangeStart = 0;
          diagRangeEnd = text.length + startCol;
        }
        
        // Clamp to our text range
        const diagStart = Math.max(diagRangeStart, startCol) - startCol;
        const diagEnd = Math.min(diagRangeEnd, endCol) - startCol;
        
        // Skip if diagnostic doesn't overlap our text range
        if (diagStart >= diagEnd || diagStart >= text.length || diagEnd <= 0) {
          continue;
        }
        
        const diagClass = getDiagnosticClass(diag.severity);
        
        for (let i = Math.max(0, diagStart); i < Math.min(text.length, diagEnd); i++) {
          // Use most severe diagnostic if multiple
          if (!charInfos[i].diagClass || (diag.severity ?? 4) < 
              (charInfos[i].diagClass?.includes("error") ? 1 : 
               charInfos[i].diagClass?.includes("warning") ? 2 :
               charInfos[i].diagClass?.includes("info") ? 3 : 4)) {
            charInfos[i].diagClass = diagClass;
          }
        }
      }
    }
    
    // Merge consecutive characters with the same classes into spans
    const result: ReturnType<typeof renderSpan>[] = [];
    let spanStart = 0;
    let currentSyntax = charInfos[0]?.syntaxClass;
    let currentDiag = charInfos[0]?.diagClass;
    
    function renderSpan(spanText: string, syntaxClass?: string, diagClass?: string) {
      if (diagClass) {
        // Wrap in diagnostic span which adds the underline
        if (syntaxClass) {
          return <span class={diagClass}><span class={syntaxClass}>{spanText}</span></span>;
        }
        return <span class={diagClass}>{spanText}</span>;
      }
      if (syntaxClass) {
        return <span class={syntaxClass}>{spanText}</span>;
      }
      return <>{spanText}</>;
    }
    
    for (let i = 1; i <= text.length; i++) {
      const newSyntax = charInfos[i]?.syntaxClass;
      const newDiag = charInfos[i]?.diagClass;
      
      if (i === text.length || newSyntax !== currentSyntax || newDiag !== currentDiag) {
        // End current span
        const spanText = text.slice(spanStart, i);
        result.push(renderSpan(spanText, currentSyntax, currentDiag));
        
        spanStart = i;
        currentSyntax = newSyntax;
        currentDiag = newDiag;
      }
    }
    
    return <>{result}</>;
  };

  // Get the syntax class for a character at a specific position
  const getSyntaxClassAtPosition = (lineIndex: number, col: number, allTokens: HighlightResult): string | null => {
    const tokens = allTokens.lines.get(lineIndex);
    if (!tokens) return null;
    
    for (const token of tokens) {
      if (col >= token.startCol && col < token.endCol) {
        return `syntax-${token.type.replace(/\./g, "-")}`;
      }
    }
    return null;
  };

  // CursorLineContent component for rendering the cursor line with proper reactivity
  // This is a SolidJS component that will re-render when its reactive dependencies change
  function CursorLineContent(props: {
    lineContent: () => string;
    cursorColumn: () => number;
    mode: () => string;
    shouldBlink: () => boolean;
    tokens: () => HighlightResult;
    diagnostics: () => Diagnostic[];
    lineIndex: number;
  }) {
    return (
      <>
        {/* Before cursor - wrapped in dynamic expression */}
        {() => {
          const content = props.lineContent();
          const col = props.cursorColumn();
          return <span>{renderHighlightedText(content.slice(0, col), props.lineIndex, 0, props.tokens(), props.diagnostics())}</span>;
        }}
        {/* Cursor */}
        {() => {
          const content = props.lineContent();
          const col = props.cursorColumn();
          const currentMode = props.mode();
          const isNormal = currentMode === "normal";
          const cursorChar = isNormal ? (content[col] || " ") : "\u200B";
          const cursorSyntaxClass = getSyntaxClassAtPosition(props.lineIndex, col, props.tokens());
          return (
            <span
              class="editor-surface__cursor"
              classList={{
                "editor-surface__cursor--block": isNormal,
                "editor-surface__cursor--bar": currentMode === "insert",
                "editor-surface__cursor--blink": props.shouldBlink(),
              }}
              data-syntax-class={cursorSyntaxClass}
            >
              <span class={cursorSyntaxClass ?? undefined}>{cursorChar}</span>
            </span>
          );
        }}
        {/* After cursor - wrapped in dynamic expression */}
        {() => {
          const content = props.lineContent();
          const col = props.cursorColumn();
          const isNormal = props.mode() === "normal";
          const afterCursorStart = col + (isNormal ? 1 : 0);
          return <span>{renderHighlightedText(content.slice(afterCursorStart), props.lineIndex, afterCursorStart, props.tokens(), props.diagnostics())}</span>;
        }}
      </>
    );
  }

  // EditorLine component - renders a single line with cursor and selection
  // This is a component so SolidJS properly tracks reactive dependencies
  function EditorLine(lineProps: { lineIndex: number }) {
    const lineIndex = lineProps.lineIndex;
    
    // All state reads happen inside these memos/derived values
    // so SolidJS tracks them as dependencies
    const lineContent = () => getLine(state().buffer, lineIndex);
    const isCursorLine = () => state().cursor.line === lineIndex;
    const cursorColumn = () => state().cursor.column;
    const mode = () => state().mode;
    const visualMode = () => state().visualMode;
    const visualAnchor = () => state().visualAnchor;
    const cursor = () => state().cursor;
    // Track highlight tokens reactively so lines re-render when highlighting changes
    const tokens = () => highlightTokens();
    // Track cursor blink state
    const shouldBlink = () => props.focused && !cursorActive();
    
    // Get diagnostics for this line (includes multi-line diagnostics that span this line)
    const lineDiagnostics = () => {
      const diags = fileDiagnostics();
      return diags.filter(d => 
        lineIndex >= d.range.start.line && lineIndex <= d.range.end.line
      );
    };
    
    // Get the most severe diagnostic for the gutter
    const gutterSeverity = () => {
      const diags = lineDiagnostics();
      if (diags.length === 0) return null;
      // Find minimum severity (1=error is most severe)
      return Math.min(...diags.map(d => d.severity ?? 4));
    };
    
    // Get the most severe diagnostic message for inline display
    // Only show on the line where the diagnostic starts
    const inlineDiagnostic = () => {
      const diags = lineDiagnostics().filter(d => d.range.start.line === lineIndex);
      if (diags.length === 0) return null;
      // Sort by severity (lower = more severe) and return the first
      const sorted = [...diags].sort((a, b) => (a.severity ?? 4) - (b.severity ?? 4));
      return sorted[0];
    };
    
    // Check if this line has visual selection
    const visualSelection = () => {
      const anchor = visualAnchor();
      const cur = cursor();
      const vMode = visualMode();
      const lineLen = lineContent().length;
      
      if (!anchor || !vMode) {
        return { inSelection: false, selStart: 0, selEnd: 0 };
      }
      
      if (vMode === "line") {
        const startLine = Math.min(anchor.line, cur.line);
        const endLine = Math.max(anchor.line, cur.line);
        if (lineIndex >= startLine && lineIndex <= endLine) {
          return { inSelection: true, selStart: 0, selEnd: lineLen };
        }
        return { inSelection: false, selStart: 0, selEnd: 0 };
      }
      
      // Character visual mode
      let start: Position;
      let end: Position;
      if (comparePositions(anchor, cur) <= 0) {
        start = anchor;
        end = cur;
      } else {
        start = cur;
        end = anchor;
      }
      
      if (lineIndex < start.line || lineIndex > end.line) {
        return { inSelection: false, selStart: 0, selEnd: 0 };
      }
      
      let selStart = 0;
      let selEnd = lineLen;
      
      if (lineIndex === start.line) {
        selStart = start.column;
      }
      if (lineIndex === end.line) {
        selEnd = end.column + 1;
      }
      
      return { inSelection: true, selStart, selEnd };
    };

    // Get diagnostic icon for severity
    const diagnosticIcon = () => {
      const sev = gutterSeverity();
      if (sev === null) return null;
      switch (sev) {
        case 1: return "●"; // Error - filled circle
        case 2: return "▲"; // Warning - triangle
        case 3: return "◆"; // Info - diamond
        case 4: return "○"; // Hint - empty circle
        default: return null;
      }
    };

    return (
      <div
        ref={(el) => { lineRefs.set(lineIndex, el); }}
        class="editor-surface__line"
        classList={{ 
          "editor-surface__line--cursor": isCursorLine(),
          "editor-surface__line--visual": visualSelection().inSelection && visualMode() === "line",
        }}
      >
        <span class="editor-surface__gutter">
          <span
            class="editor-surface__diagnostic-icon"
            classList={{
              "editor-surface__diagnostic-icon--error": gutterSeverity() === 1,
              "editor-surface__diagnostic-icon--warning": gutterSeverity() === 2,
              "editor-surface__diagnostic-icon--info": gutterSeverity() === 3,
              "editor-surface__diagnostic-icon--hint": gutterSeverity() === 4,
            }}
          >
            {diagnosticIcon()}
          </span>
          <span
            class="editor-surface__line-number"
            classList={{
              "editor-surface__line-number--error": gutterSeverity() === 1,
              "editor-surface__line-number--warning": gutterSeverity() === 2,
              "editor-surface__line-number--info": gutterSeverity() === 3,
              "editor-surface__line-number--hint": gutterSeverity() === 4,
            }}
            style={{ width: `${gutterWidth()}px` }}
          >
            {lineIndex + 1}
          </span>
        </span>
        <span class="editor-surface__line-content">
          <Show when={isCursorLine()} fallback={
            <Show when={visualSelection().inSelection} fallback={
              lineContent() ? renderHighlightedText(lineContent(), lineIndex, 0, tokens(), lineDiagnostics()) : " "
            }>
              <span>{renderHighlightedText(lineContent().slice(0, visualSelection().selStart), lineIndex, 0, tokens(), lineDiagnostics())}</span>
              <span class="editor-surface__selection">{renderHighlightedText(lineContent().slice(visualSelection().selStart, visualSelection().selEnd) || " ", lineIndex, visualSelection().selStart, tokens(), lineDiagnostics())}</span>
              <span>{renderHighlightedText(lineContent().slice(visualSelection().selEnd), lineIndex, visualSelection().selEnd, tokens(), lineDiagnostics())}</span>
            </Show>
          }>
            {/* Cursor line rendering - with visual selection support */}
            <Show when={visualSelection().inSelection} fallback={
              <CursorLineContent
                lineContent={lineContent}
                cursorColumn={cursorColumn}
                mode={mode}
                shouldBlink={shouldBlink}
                tokens={tokens}
                diagnostics={lineDiagnostics}
                lineIndex={lineIndex}
              />
            }>
              {/* Cursor line with visual selection */}
              {(() => {
                const content = lineContent();
                const col = cursorColumn();
                const sel = visualSelection();
                const isNormal = mode() === "normal";
                
                // Build segments: before selection, selection before cursor, cursor, selection after cursor, after selection
                // Track column offset for syntax highlighting
                const segments: { text: string; isSelected: boolean; isCursor: boolean; startCol: number }[] = [];
                
                // Before selection
                if (sel.selStart > 0) {
                  segments.push({ text: content.slice(0, sel.selStart), isSelected: false, isCursor: false, startCol: 0 });
                }
                
                // Selection before cursor (if cursor is after selection start)
                if (col > sel.selStart) {
                  segments.push({ text: content.slice(sel.selStart, col), isSelected: true, isCursor: false, startCol: sel.selStart });
                }
                
                // Cursor
                const cursorChar = content[col] || (isNormal ? " " : "");
                const cursorInSelection = col >= sel.selStart && col < sel.selEnd;
                segments.push({ text: cursorChar, isSelected: cursorInSelection, isCursor: true, startCol: col });
                
                // Selection after cursor (if cursor is before selection end)
                const afterCursor = col + (isNormal ? 1 : 0);
                if (afterCursor < sel.selEnd) {
                  segments.push({ text: content.slice(afterCursor, sel.selEnd), isSelected: true, isCursor: false, startCol: afterCursor });
                }
                
                // After selection
                if (sel.selEnd < content.length) {
                  segments.push({ text: content.slice(sel.selEnd), isSelected: false, isCursor: false, startCol: sel.selEnd });
                }
                
                return segments.map((seg) => {
                  if (seg.isCursor) {
                    return (
                      <span
                        class="editor-surface__cursor"
                        classList={{
                          "editor-surface__cursor--block": mode() === "normal",
                          "editor-surface__cursor--bar": mode() === "insert",
                    "editor-surface__cursor--blink": shouldBlink(),
                          "editor-surface__cursor--visual": seg.isSelected,
                        }}
                      >
                        {mode() === "normal" ? seg.text : "\u200B"}
                      </span>
                    );
                  }
                  if (seg.isSelected) {
                    return <span class="editor-surface__selection">{renderHighlightedText(seg.text, lineIndex, seg.startCol, tokens(), lineDiagnostics())}</span>;
                  }
                  return <span>{renderHighlightedText(seg.text, lineIndex, seg.startCol, tokens(), lineDiagnostics())}</span>;
                });
              })()}
            </Show>
          </Show>
          <Show when={inlineDiagnostic()}>
            {(diag) => (
              <span
                class="editor-surface__inline-diagnostic"
                classList={{
                  "editor-surface__inline-diagnostic--error": diag().severity === 1,
                  "editor-surface__inline-diagnostic--warning": diag().severity === 2,
                  "editor-surface__inline-diagnostic--info": diag().severity === 3,
                  "editor-surface__inline-diagnostic--hint": diag().severity === 4,
                }}
              >
                {diag().message}
              </span>
            )}
          </Show>
        </span>
      </div>
    );
  }
  
  // Handle search input
  const handleSearchKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setSearchMode(null);
      setSearchInput("");
      containerRef?.focus();
      e.preventDefault();
      return;
    }
    
    if (e.key === "Enter") {
      e.preventDefault();
      const query = searchInput();
      if (!query) {
        setSearchMode(null);
        containerRef?.focus();
        return;
      }
      
      // Perform search
      const state = getEditorState(props.id);
      const matches = findAllMatches(state.buffer, query);
      const forward = searchMode() === "/";
      
      if (matches.length === 0) {
        // No matches found
        setSearchMode(null);
        setSearchInput("");
        containerRef?.focus();
        return;
      }
      
      // Find next match from cursor
      let targetIndex = 0;
      if (forward) {
        for (let i = 0; i < matches.length; i++) {
          const m = matches[i];
          if (m.line > state.cursor.line || (m.line === state.cursor.line && m.column > state.cursor.column)) {
            targetIndex = i;
            break;
          }
        }
      } else {
        targetIndex = matches.length - 1;
        for (let i = matches.length - 1; i >= 0; i--) {
          const m = matches[i];
          if (m.line < state.cursor.line || (m.line === state.cursor.line && m.column < state.cursor.column)) {
            targetIndex = i;
            break;
          }
        }
      }
      
      updateEditorState(props.id, (s) => ({
        ...s,
        cursor: matches[targetIndex],
        vim: {
          ...s.vim,
          searchPattern: query,
          searchForward: forward,
          searchMatches: matches,
          searchMatchIndex: targetIndex,
        },
      }));
      
      setSearchMode(null);
      setSearchInput("");
      containerRef?.focus();
    }
  };

  return (
    <div
      ref={containerRef}
      class="editor-surface"
      classList={{ "editor-surface--focused": props.focused }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onWheel={handleWheel}
    >
      <Show when={loading()}>
        <div class="editor-surface__loading">Loading...</div>
      </Show>
      <Show when={error()}>
        <div class="editor-surface__error">{error()}</div>
      </Show>
      <Show when={!loading()}>
        <div class="editor-surface__content">
          <div
            ref={linesContainerRef}
            class="editor-surface__lines"
            onMouseDown={handleMouseDown}
          >
            <div class="editor-surface__lines-inner">
              <For each={lineIndices()}>
                {(lineIndex) => <EditorLine lineIndex={lineIndex} />}
              </For>
            </div>
          </div>
          <Show when={searchMode()}>
            <div class="editor-surface__search">
              <span class="editor-surface__search-prompt">{searchMode()}</span>
              <input
                ref={searchInputRef}
                class="editor-surface__search-input"
                type="text"
                value={searchInput()}
                onInput={(e) => setSearchInput(e.currentTarget.value)}
                onKeyDown={handleSearchKeyDown}
              />
            </div>
          </Show>
          <Show when={hoverContent() && hoverPosition()}>
            <div
              class="editor-surface__hover"
              classList={{ "editor-surface__hover--flip-down": !hoverPosition()!.flipUp }}
              style={{
                left: `${hoverPosition()!.x}px`,
                top: hoverPosition()!.flipUp ? "auto" : `${hoverPosition()!.y}px`,
                bottom: hoverPosition()!.flipUp ? `${window.innerHeight - hoverPosition()!.y + 4}px` : "auto",
                transform: hoverPosition()!.flipUp ? "none" : "none",
              }}
              onClick={closeHover}
            >
              <div 
                class="editor-surface__hover-content"
                innerHTML={renderMarkdown(hoverContent()!)}
              />
            </div>
          </Show>
          <Show when={completionItems().length > 0 && completionPosition()}>
            <div
              class="editor-surface__completion"
              classList={{ "editor-surface__completion--flip-up": completionPosition()!.flipUp }}
              style={{
                left: `${completionPosition()!.x}px`,
                top: completionPosition()!.flipUp ? "auto" : `${completionPosition()!.y}px`,
                bottom: completionPosition()!.flipUp ? `${window.innerHeight - completionPosition()!.y}px` : "auto",
              }}
            >
              <For each={completionItems().slice(0, 10)}>
                {(item, index) => {
                  // Infer the best icon/class for this completion item
                  const inferred = inferCompletionKind(item);
                  const IconComponent = inferred.isMacro ? IconMacro : getCompletionIcon(inferred.kind);
                  const kindClass = inferred.isMacro ? "macro" : getCompletionKindClass(inferred.kind);
                  return (
                    <div
                      class="editor-surface__completion-item"
                      classList={{ "editor-surface__completion-item--selected": index() === completionIndex() }}
                      onClick={() => {
                        setCompletionIndex(index());
                        acceptCompletion();
                      }}
                    >
                      <span class={`editor-surface__completion-icon editor-surface__completion-icon--${kindClass}`}>
                        <IconComponent size={14} />
                      </span>
                      <span class="editor-surface__completion-label">{item.label}</span>
                      <Show when={item.detail}>
                        <span class="editor-surface__completion-detail">{item.detail}</span>
                      </Show>
                    </div>
                  );
                }}
              </For>
              <Show when={completionItems().length > 10}>
                <div class="editor-surface__completion-more">
                  +{completionItems().length - 10} more
                </div>
              </Show>
            </div>
          </Show>
          <Show when={showReferences() && referencesLocations().length > 0}>
            <div class="editor-surface__references">
              <div class="editor-surface__references-header">
                <span>References ({referencesLocations().length})</span>
                <button class="editor-surface__references-close" onClick={closeReferences}>x</button>
              </div>
              <div class="editor-surface__references-list">
                <For each={referencesLocations()}>
                  {(ref, index) => (
                    <div
                      class="editor-surface__references-item"
                      classList={{ "editor-surface__references-item--selected": index() === referencesIndex() }}
                      onClick={() => gotoReference(index())}
                    >
                      <span class="editor-surface__references-file">
                        {uriToPath(ref.uri).split("/").pop()}
                      </span>
                      <span class="editor-surface__references-location">
                        :{ref.line + 1}:{ref.col + 1}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </Show>
          <div class="editor-surface__status">
            <span class="editor-surface__filename">
              {fileName()}
              {state().dirty && <span class="editor-surface__dirty">*</span>}
            </span>
            <Show when={diagnosticCounts().errors > 0 || diagnosticCounts().warnings > 0 || diagnosticCounts().info > 0 || diagnosticCounts().hints > 0}>
              <span class="editor-surface__diagnostics">
                <Show when={diagnosticCounts().errors > 0}>
                  <span class="editor-surface__diagnostics-error">● {diagnosticCounts().errors}</span>
                </Show>
                <Show when={diagnosticCounts().warnings > 0}>
                  <span class="editor-surface__diagnostics-warning">▲ {diagnosticCounts().warnings}</span>
                </Show>
                <Show when={diagnosticCounts().info > 0}>
                  <span class="editor-surface__diagnostics-info">◆ {diagnosticCounts().info}</span>
                </Show>
                <Show when={diagnosticCounts().hints > 0}>
                  <span class="editor-surface__diagnostics-hint">○ {diagnosticCounts().hints}</span>
                </Show>
              </span>
            </Show>
            <Show when={lspStatus().label}>
              <span class={`editor-surface__lsp editor-surface__lsp--${lspStatus().state}`}>
                {lspStatus().label}
              </span>
            </Show>
            <Show when={state().visualMode}>
              <span class="editor-surface__visual-mode">
                {state().visualMode === "line" ? "VISUAL LINE" : "VISUAL"}
              </span>
            </Show>
            <Show when={state().vim.searchPattern && !searchMode()}>
              <span class="editor-surface__search-info">
                /{state().vim.searchPattern}
                <Show when={state().vim.searchMatches.length > 0}>
                  {" "}[{state().vim.searchMatchIndex + 1}/{state().vim.searchMatches.length}]
                </Show>
              </span>
            </Show>
            <Show when={pendingInput()}>
              <span class="editor-surface__pending">{pendingInput()}</span>
            </Show>
            <span class="editor-surface__mode">
              {state().visualMode ? (state().visualMode === "line" ? "V-LINE" : "VISUAL") : state().mode.toUpperCase()}
            </span>
            <span class="editor-surface__position">
              {state().cursor.line + 1}:{state().cursor.column + 1}
            </span>
          </div>
        </div>
      </Show>
    </div>
  );
}
