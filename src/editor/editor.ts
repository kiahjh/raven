/**
 * Editor state management. Each editor surface has its own EditorState.
 */

import {
  TextBuffer,
  Position,
  createBuffer,
  getLineCount,
  getLineLength,
  clampPosition,
} from "./buffer";

export type EditorMode = "normal" | "insert";

export interface EditorState {
  buffer: TextBuffer;
  cursor: Position;
  mode: EditorMode;
  /** Desired column when moving vertically (sticky column) */
  desiredColumn: number | null;
  /** Whether the buffer has unsaved changes */
  dirty: boolean;
}

export function createEditorState(content: string = ""): EditorState {
  return {
    buffer: createBuffer(content),
    cursor: { line: 0, column: 0 },
    mode: "normal",
    desiredColumn: null,
    dirty: false,
  };
}

/**
 * Mark the editor as dirty (has unsaved changes).
 */
export function markDirty(state: EditorState): EditorState {
  if (state.dirty) return state;
  return { ...state, dirty: true };
}

/**
 * Mark the editor as clean (no unsaved changes).
 */
export function markClean(state: EditorState): EditorState {
  if (!state.dirty) return state;
  return { ...state, dirty: false };
}

/**
 * Move cursor left, staying on current line.
 */
export function moveCursorLeft(state: EditorState): EditorState {
  if (state.cursor.column > 0) {
    return {
      ...state,
      cursor: { ...state.cursor, column: state.cursor.column - 1 },
      desiredColumn: null,
    };
  }
  return state;
}

/**
 * Move cursor right, staying on current line.
 * In normal mode, cursor can't go past last character.
 * In insert mode, cursor can go one past (for appending).
 */
export function moveCursorRight(state: EditorState): EditorState {
  const lineLength = getLineLength(state.buffer, state.cursor.line);
  const maxColumn = state.mode === "normal" ? Math.max(0, lineLength - 1) : lineLength;
  
  if (state.cursor.column < maxColumn) {
    return {
      ...state,
      cursor: { ...state.cursor, column: state.cursor.column + 1 },
      desiredColumn: null,
    };
  }
  return state;
}

/**
 * Move cursor up one line.
 */
export function moveCursorUp(state: EditorState): EditorState {
  if (state.cursor.line === 0) {
    return state;
  }
  
  const targetLine = state.cursor.line - 1;
  const targetLineLength = getLineLength(state.buffer, targetLine);
  const desiredCol = state.desiredColumn ?? state.cursor.column;
  const maxColumn = state.mode === "normal" ? Math.max(0, targetLineLength - 1) : targetLineLength;
  const column = Math.min(desiredCol, maxColumn);
  
  return {
    ...state,
    cursor: { line: targetLine, column },
    desiredColumn: desiredCol,
  };
}

/**
 * Move cursor down one line.
 */
export function moveCursorDown(state: EditorState): EditorState {
  const lineCount = getLineCount(state.buffer);
  
  if (state.cursor.line >= lineCount - 1) {
    return state;
  }
  
  const targetLine = state.cursor.line + 1;
  const targetLineLength = getLineLength(state.buffer, targetLine);
  const desiredCol = state.desiredColumn ?? state.cursor.column;
  const maxColumn = state.mode === "normal" ? Math.max(0, targetLineLength - 1) : targetLineLength;
  const column = Math.min(desiredCol, maxColumn);
  
  return {
    ...state,
    cursor: { line: targetLine, column },
    desiredColumn: desiredCol,
  };
}

/**
 * Move cursor to start of line.
 */
export function moveCursorToLineStart(state: EditorState): EditorState {
  return {
    ...state,
    cursor: { ...state.cursor, column: 0 },
    desiredColumn: null,
  };
}

/**
 * Move cursor to end of line.
 */
export function moveCursorToLineEnd(state: EditorState): EditorState {
  const lineLength = getLineLength(state.buffer, state.cursor.line);
  const column = state.mode === "normal" ? Math.max(0, lineLength - 1) : lineLength;
  
  return {
    ...state,
    cursor: { ...state.cursor, column },
    desiredColumn: null,
  };
}

/**
 * Move cursor to first line.
 */
export function moveCursorToFirstLine(state: EditorState): EditorState {
  const lineLength = getLineLength(state.buffer, 0);
  const column = Math.min(state.cursor.column, state.mode === "normal" ? Math.max(0, lineLength - 1) : lineLength);
  
  return {
    ...state,
    cursor: { line: 0, column },
    desiredColumn: null,
  };
}

/**
 * Move cursor to last line.
 */
export function moveCursorToLastLine(state: EditorState): EditorState {
  const lastLine = Math.max(0, getLineCount(state.buffer) - 1);
  const lineLength = getLineLength(state.buffer, lastLine);
  const column = Math.min(state.cursor.column, state.mode === "normal" ? Math.max(0, lineLength - 1) : lineLength);
  
  return {
    ...state,
    cursor: { line: lastLine, column },
    desiredColumn: null,
  };
}

/**
 * Enter insert mode.
 */
export function enterInsertMode(state: EditorState): EditorState {
  return { ...state, mode: "insert", desiredColumn: null };
}

/**
 * Enter insert mode after cursor (append).
 */
export function enterInsertModeAfter(state: EditorState): EditorState {
  const lineLength = getLineLength(state.buffer, state.cursor.line);
  const column = Math.min(state.cursor.column + 1, lineLength);
  
  return {
    ...state,
    mode: "insert",
    cursor: { ...state.cursor, column },
    desiredColumn: null,
  };
}

/**
 * Enter normal mode.
 */
export function enterNormalMode(state: EditorState): EditorState {
  // In normal mode, cursor can't be past the last character
  const lineLength = getLineLength(state.buffer, state.cursor.line);
  const maxColumn = Math.max(0, lineLength - 1);
  const column = Math.min(state.cursor.column, maxColumn);
  
  return {
    ...state,
    mode: "normal",
    cursor: { ...state.cursor, column },
    desiredColumn: null,
  };
}

/**
 * Clamp cursor to valid position after buffer changes.
 */
export function clampCursor(state: EditorState): EditorState {
  const clamped = clampPosition(state.buffer, state.cursor);
  
  // Also respect mode constraints
  if (state.mode === "normal") {
    const lineLength = getLineLength(state.buffer, clamped.line);
    const maxColumn = Math.max(0, lineLength - 1);
    clamped.column = Math.min(clamped.column, maxColumn);
  }
  
  if (clamped.line === state.cursor.line && clamped.column === state.cursor.column) {
    return state;
  }
  
  return { ...state, cursor: clamped };
}
