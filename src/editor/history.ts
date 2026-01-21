/**
 * Undo/redo history for the editor.
 * 
 * Uses a branching history model where redo only works immediately after undo.
 * Each edit creates a new history entry with the buffer state and cursor position.
 */

import { TextBuffer, Position } from "./buffer";

export interface HistoryEntry {
  /** The buffer state at this point */
  buffer: TextBuffer;
  /** The cursor position at this point */
  cursor: Position;
  /** Timestamp of when this change was made */
  timestamp: number;
}

export interface UndoHistory {
  /** Stack of previous states (newest at the end) */
  undoStack: HistoryEntry[];
  /** Stack of redo states (newest at the end) */
  redoStack: HistoryEntry[];
  /** Maximum number of undo entries to keep */
  maxSize: number;
}

const DEFAULT_MAX_SIZE = 1000;

export function createHistory(maxSize: number = DEFAULT_MAX_SIZE): UndoHistory {
  return {
    undoStack: [],
    redoStack: [],
    maxSize,
  };
}

/**
 * Push a new state onto the history.
 * This clears the redo stack (branching history).
 */
export function pushHistory(
  history: UndoHistory,
  buffer: TextBuffer,
  cursor: Position
): UndoHistory {
  const entry: HistoryEntry = {
    buffer,
    cursor,
    timestamp: Date.now(),
  };
  
  const newUndoStack = [...history.undoStack, entry];
  
  // Trim if over max size
  if (newUndoStack.length > history.maxSize) {
    newUndoStack.shift();
  }
  
  return {
    ...history,
    undoStack: newUndoStack,
    redoStack: [], // Clear redo on new edit
  };
}

/**
 * Undo the last change.
 * Returns the previous state and updated history, or null if nothing to undo.
 */
export function undo(
  history: UndoHistory,
  currentBuffer: TextBuffer,
  currentCursor: Position
): { history: UndoHistory; buffer: TextBuffer; cursor: Position } | null {
  if (history.undoStack.length === 0) {
    return null;
  }
  
  const entry = history.undoStack[history.undoStack.length - 1];
  const newUndoStack = history.undoStack.slice(0, -1);
  
  // Push current state to redo stack
  const redoEntry: HistoryEntry = {
    buffer: currentBuffer,
    cursor: currentCursor,
    timestamp: Date.now(),
  };
  
  return {
    history: {
      ...history,
      undoStack: newUndoStack,
      redoStack: [...history.redoStack, redoEntry],
    },
    buffer: entry.buffer,
    cursor: entry.cursor,
  };
}

/**
 * Redo the last undone change.
 * Returns the next state and updated history, or null if nothing to redo.
 */
export function redo(
  history: UndoHistory,
  currentBuffer: TextBuffer,
  currentCursor: Position
): { history: UndoHistory; buffer: TextBuffer; cursor: Position } | null {
  if (history.redoStack.length === 0) {
    return null;
  }
  
  const entry = history.redoStack[history.redoStack.length - 1];
  const newRedoStack = history.redoStack.slice(0, -1);
  
  // Push current state to undo stack
  const undoEntry: HistoryEntry = {
    buffer: currentBuffer,
    cursor: currentCursor,
    timestamp: Date.now(),
  };
  
  return {
    history: {
      ...history,
      undoStack: [...history.undoStack, undoEntry],
      redoStack: newRedoStack,
    },
    buffer: entry.buffer,
    cursor: entry.cursor,
  };
}

/**
 * Check if undo is available.
 */
export function canUndo(history: UndoHistory): boolean {
  return history.undoStack.length > 0;
}

/**
 * Check if redo is available.
 */
export function canRedo(history: UndoHistory): boolean {
  return history.redoStack.length > 0;
}

/**
 * Clear all history.
 */
export function clearHistory(history: UndoHistory): UndoHistory {
  return {
    ...history,
    undoStack: [],
    redoStack: [],
  };
}

/**
 * Get the number of undo steps available.
 */
export function undoCount(history: UndoHistory): number {
  return history.undoStack.length;
}

/**
 * Get the number of redo steps available.
 */
export function redoCount(history: UndoHistory): number {
  return history.redoStack.length;
}
