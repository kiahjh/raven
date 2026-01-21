import { createEffect, createSignal, createMemo, For, Show, onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { editorStore, getEditorState, updateEditorState, initializeEditor, setEditorState } from "../store/editor";
import { getLine, getLineCount, getText, insertText, deleteCharBefore, Position, comparePositions } from "../editor/buffer";
import { executeCommand, markExtendedDirty, markExtendedClean, clampExtendedCursor } from "../editor/commands";
import { parseInput, createVimState, findAllMatches } from "../editor/vim";
import { pushHistory } from "../editor/history";
import { getHighlighter, type HighlightResult, type LanguageId } from "../editor/highlighting";
import "./EditorSurface.css";

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

  createEffect(() => {
    if (props.focused && containerRef) {
      containerRef.focus();
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

  const handleWheel = (_e: WheelEvent) => {
    // Let the browser handle scrolling naturally
    // Don't prevent default - this allows smooth scrolling of the lines container
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    // Reset cursor blink on any key activity
    resetCursorBlink();
    
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
    
    // Handle Escape - exit visual mode or clear pending input
    if (key === "Escape") {
      setPendingInput("");
      setSearchMode(null);
      setSearchInput("");
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

    if (key === "Escape") {
      // Return to normal mode, adjust cursor position
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
      return;
    }

    // Enter
    if (key === "Enter") {
      updateEditorState(props.id, (state) => {
        const newHistory = pushHistory(state.history, state.buffer, state.cursor);
        const newBuffer = insertText(state.buffer, state.cursor, "\n");
        const newCursor = { line: state.cursor.line + 1, column: 0 };
        return clampExtendedCursor(markExtendedDirty({ ...state, buffer: newBuffer, cursor: newCursor, history: newHistory }));
      });
      e.preventDefault();
      return;
    }

    // Tab
    if (key === "Tab") {
      updateEditorState(props.id, (state) => {
        const newHistory = pushHistory(state.history, state.buffer, state.cursor);
        const newBuffer = insertText(state.buffer, state.cursor, "  ");
        const newCursor = { ...state.cursor, column: state.cursor.column + 2 };
        return markExtendedDirty({ ...state, buffer: newBuffer, cursor: newCursor, history: newHistory });
      });
      e.preventDefault();
      return;
    }

    // Regular character input
    if (key.length === 1) {
      updateEditorState(props.id, (state) => {
        const newHistory = pushHistory(state.history, state.buffer, state.cursor);
        const newBuffer = insertText(state.buffer, state.cursor, key);
        const newCursor = { ...state.cursor, column: state.cursor.column + 1 };
        return markExtendedDirty({ ...state, buffer: newBuffer, cursor: newCursor, history: newHistory });
      });
      e.preventDefault();
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

  // Helper to render text with syntax highlighting
  // Takes allTokens as a parameter so callers can pass the reactive value
  const renderHighlightedText = (text: string, lineIndex: number, startCol: number, allTokens: HighlightResult) => {
    const tokens = allTokens.lines.get(lineIndex);
    
    if (!tokens || tokens.length === 0) {
      return text;
    }
    
    const endCol = startCol + text.length;
    const result: (string | ReturnType<typeof renderHighlightedSpan>)[] = [];
    let currentPos = startCol;
    
    function renderHighlightedSpan(spanText: string, className: string) {
      return <span class={className}>{spanText}</span>;
    }
    
    for (const token of tokens) {
      // Skip tokens before our range
      if (token.endCol <= startCol) continue;
      // Stop if token starts after our range
      if (token.startCol >= endCol) break;
      
      // Clamp token to our range
      const tokenStart = Math.max(token.startCol, startCol);
      const tokenEnd = Math.min(token.endCol, endCol);
      
      // Add unhighlighted text before this token
      if (tokenStart > currentPos) {
        result.push(text.slice(currentPos - startCol, tokenStart - startCol));
      }
      
      // Add highlighted token
      const tokenText = text.slice(tokenStart - startCol, tokenEnd - startCol);
      const className = `syntax-${token.type.replace(/\./g, "-")}`;
      result.push(renderHighlightedSpan(tokenText, className));
      
      currentPos = tokenEnd;
    }
    
    // Add remaining unhighlighted text
    if (currentPos < endCol) {
      result.push(text.slice(currentPos - startCol));
    }
    
    return <>{result}</>;
  };

  // Separate component for cursor line content to ensure proper reactivity
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function CursorLineContent(clcProps: {
    lineContent: () => string;
    cursorColumn: () => number;
    mode: () => string;
    shouldBlink: () => boolean;
    tokens: () => HighlightResult;
    lineIndex: number;
    renderHighlightedText: (text: string, lineIndex: number, startCol: number, allTokens: HighlightResult) => any;
  }) {
    // Create derived values that SolidJS will track
    const beforeCursor = () => clcProps.lineContent().slice(0, clcProps.cursorColumn());
    const afterCursorStart = () => clcProps.cursorColumn() + (clcProps.mode() === "normal" ? 1 : 0);
    const afterCursor = () => clcProps.lineContent().slice(afterCursorStart());
    const cursorChar = () => clcProps.mode() === "normal" ? (clcProps.lineContent()[clcProps.cursorColumn()] || " ") : "\u200B";
    
    return (
      <>
        <span>{clcProps.renderHighlightedText(beforeCursor(), clcProps.lineIndex, 0, clcProps.tokens())}</span>
        <span
          class="editor-surface__cursor"
          classList={{
            "editor-surface__cursor--block": clcProps.mode() === "normal",
            "editor-surface__cursor--bar": clcProps.mode() === "insert",
            "editor-surface__cursor--blink": clcProps.shouldBlink(),
          }}
        >
          {cursorChar()}
        </span>
        <span>{clcProps.renderHighlightedText(afterCursor(), clcProps.lineIndex, afterCursorStart(), clcProps.tokens())}</span>
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

    return (
      <div
        ref={(el) => { lineRefs.set(lineIndex, el); }}
        class="editor-surface__line"
        classList={{ 
          "editor-surface__line--cursor": isCursorLine(),
          "editor-surface__line--visual": visualSelection().inSelection && visualMode() === "line",
        }}
      >
        <span
          class="editor-surface__line-number"
          style={{ width: `${gutterWidth()}px` }}
        >
          {lineIndex + 1}
        </span>
        <span class="editor-surface__line-content">
          <Show when={isCursorLine()} fallback={
            <Show when={visualSelection().inSelection} fallback={
              lineContent() ? renderHighlightedText(lineContent(), lineIndex, 0, tokens()) : " "
            }>
              <span>{renderHighlightedText(lineContent().slice(0, visualSelection().selStart), lineIndex, 0, tokens())}</span>
              <span class="editor-surface__selection">{lineContent().slice(visualSelection().selStart, visualSelection().selEnd) || " "}</span>
              <span>{renderHighlightedText(lineContent().slice(visualSelection().selEnd), lineIndex, visualSelection().selEnd, tokens())}</span>
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
                lineIndex={lineIndex}
                renderHighlightedText={renderHighlightedText}
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
                    return <span class="editor-surface__selection">{seg.text}</span>;
                  }
                  return <span>{renderHighlightedText(seg.text, lineIndex, seg.startCol, tokens())}</span>;
                });
              })()}
            </Show>
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
          <div class="editor-surface__status">
            <span class="editor-surface__filename">
              {fileName()}
              {state().dirty && <span class="editor-surface__dirty">*</span>}
            </span>
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
