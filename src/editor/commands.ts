/**
 * Vim command executor.
 * 
 * Executes parsed vim commands, handling motions, operators, text objects,
 * and actions to produce new editor states.
 */

import {
  TextBuffer,
  Position,
  getLine,
  getLineCount,
  getLineLength,
  insertText,
  deleteRange,
  deleteCharAt,
  comparePositions,
} from "./buffer";
import { EditorState } from "./editor";
import {
  VimState,
  VimCommand,
  motions,
  textObjects,
  findCharOnLine,
  findFirstNonWhitespace,
  createVimState,
  findAllMatches,
  findNextMatch,
  getWordUnderCursorWithBounds,
} from "./vim";
import { UndoHistory, pushHistory, undo, redo } from "./history";

// ============================================================================
// Extended Editor State
// ============================================================================

export interface ExtendedEditorState extends EditorState {
  vim: VimState;
  history: UndoHistory;
  /** Visual mode selection anchor (where visual selection started) */
  visualAnchor: Position | null;
  /** Current visual mode type */
  visualMode: "char" | "line" | null;
}

// ============================================================================
// Command Execution
// ============================================================================

export interface ExecutionResult {
  state: ExtendedEditorState;
  /** Whether the buffer was modified (for undo tracking) */
  modified: boolean;
}

/**
 * Execute a vim motion command.
 */
export function executeMotion(
  state: ExtendedEditorState,
  command: VimCommand
): ExecutionResult {
  const motionName = command.name;
  let motion = motions[motionName];
  
  // Handle f/F/t/T motions
  if (motionName.length === 2 && "fFtT".includes(motionName[0])) {
    const char = motionName[1];
    const forward = "ft".includes(motionName[0]);
    const inclusive = "fF".includes(motionName[0]);
    
    let cursor = state.cursor;
    for (let i = 0; i < command.count; i++) {
      const target = findCharOnLine(state.buffer, cursor, char, forward, inclusive);
      if (!target) break;
      cursor = target;
    }
    
    return {
      state: {
        ...state,
        cursor,
        desiredColumn: null,
      },
      modified: false,
    };
  }
  
  // Handle ; and , (repeat find)
  if (motionName === ";" || motionName === ",") {
    const vim = state.vim;
    if (!vim.lastFindChar) {
      return { state, modified: false };
    }
    
    // ; repeats in same direction, , repeats in opposite direction
    const forward = motionName === ";" ? vim.lastFindForward : !vim.lastFindForward;
    
    let cursor = state.cursor;
    for (let i = 0; i < command.count; i++) {
      const target = findCharOnLine(state.buffer, cursor, vim.lastFindChar, forward, vim.lastFindInclusive);
      if (!target) break;
      cursor = target;
    }
    
    return {
      state: { ...state, cursor, desiredColumn: null },
      modified: false,
    };
  }
  
  if (!motion) {
    return { state, modified: false };
  }
  
  const targetPos = motion.target(state.buffer, state.cursor, command.count);
  
  // For j/k motions, preserve desired column
  let desiredColumn = state.desiredColumn;
  if (motionName === "j" || motionName === "k") {
    if (desiredColumn === null) {
      desiredColumn = state.cursor.column;
    }
    // Apply desired column to target
    const lineLen = getLineLength(state.buffer, targetPos.line);
    targetPos.column = Math.min(desiredColumn, Math.max(0, lineLen - 1));
  } else {
    desiredColumn = null;
  }
  
  return {
    state: {
      ...state,
      cursor: targetPos,
      desiredColumn,
    },
    modified: false,
  };
}

/**
 * Execute an operator with motion or text object.
 */
export function executeOperator(
  state: ExtendedEditorState,
  command: VimCommand
): ExecutionResult {
  if (!command.operator) {
    return { state, modified: false };
  }
  
  let range: { start: Position; end: Position } | null = null;
  let linewise = false;
  
  // Get range from motion
  if (command.motion) {
    const motion = command.motion;
    linewise = motion.linewise ?? false;
    
    const targetPos = motion.target(state.buffer, state.cursor, command.count);
    
    if (comparePositions(state.cursor, targetPos) <= 0) {
      range = { start: state.cursor, end: targetPos };
    } else {
      range = { start: targetPos, end: state.cursor };
    }
    
    // Inclusive motions include the end character
    if (motion.inclusive && comparePositions(range.start, range.end) < 0) {
      range.end = { line: range.end.line, column: range.end.column + 1 };
    }
  }
  
  // Get range from text object
  if (command.textObject) {
    const objChar = command.name.slice(-1);
    const textObj = textObjects[objChar];
    
    if (textObj) {
      // Determine if inner (i) or around (a) from the operator name
      // e.g., "diw" -> inner, "daw" -> around
      const opLen = command.operator?.length ?? 0;
      const isInner = command.name[opLen] === "i";
      const objRange = textObj.range(state.buffer, state.cursor, isInner);
      if (objRange) {
        // Text object ranges are inclusive, convert to exclusive end
        range = {
          start: objRange.start,
          end: { line: objRange.end.line, column: objRange.end.column + 1 },
        };
      }
      linewise = textObj.linewise ?? false;
    }
  }
  
  // Handle line-wise operators (dd, cc, yy)
  if (command.name === "dd" || command.name === "cc" || command.name === "yy") {
    linewise = true;
    const startLine = state.cursor.line;
    const endLine = Math.min(startLine + command.count - 1, getLineCount(state.buffer) - 1);
    range = {
      start: { line: startLine, column: 0 },
      end: { line: endLine, column: getLineLength(state.buffer, endLine) },
    };
  }
  
  if (!range) {
    return { state, modified: false };
  }
  
  // Save to register before modifying
  const deletedText = extractText(state.buffer, range.start, range.end, linewise);
  const newVim: VimState = {
    ...state.vim,
    registers: {
      ...state.vim.registers,
      [state.vim.register]: { text: deletedText, linewise },
      '"': { text: deletedText, linewise }, // Always copy to unnamed register
    },
  };
  
  // Push current state to history before modification
  const newHistory = pushHistory(state.history, state.buffer, state.cursor);
  
  switch (command.operator) {
    case "d": {
      // Delete
      let newBuffer: TextBuffer;
      let newCursor: Position;
      
      if (linewise) {
        newBuffer = deleteLines(state.buffer, range.start.line, range.end.line);
        const lineCount = getLineCount(newBuffer);
        const targetLine = Math.min(range.start.line, lineCount - 1);
        newCursor = {
          line: targetLine,
          column: findFirstNonWhitespace(newBuffer, targetLine),
        };
      } else {
        newBuffer = deleteRange(state.buffer, range.start, range.end);
        newCursor = range.start;
        // Clamp cursor to line
        const lineLen = getLineLength(newBuffer, newCursor.line);
        newCursor.column = Math.min(newCursor.column, Math.max(0, lineLen - 1));
      }
      
      return {
        state: {
          ...state,
          buffer: newBuffer,
          cursor: newCursor,
          vim: newVim,
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "c": {
      // Change (delete + enter insert mode)
      let newBuffer: TextBuffer;
      let newCursor: Position;
      
      if (linewise) {
        // Change line: delete content but keep the line, enter insert
        const lineStart = range.start.line;
        const lineEnd = range.end.line;
        
        // Replace all lines with a single empty line (for cc)
        newBuffer = state.buffer;
        for (let i = lineEnd; i >= lineStart; i--) {
          if (i > lineStart) {
            newBuffer = deleteLine(newBuffer, i);
          } else {
            // Replace first line with empty line
            const line = getLine(newBuffer, i);
            newBuffer = deleteRange(
              newBuffer,
              { line: i, column: 0 },
              { line: i, column: line.length }
            );
          }
        }
        
        newCursor = { line: lineStart, column: 0 };
      } else {
        newBuffer = deleteRange(state.buffer, range.start, range.end);
        newCursor = range.start;
      }
      
      return {
        state: {
          ...state,
          buffer: newBuffer,
          cursor: newCursor,
          mode: "insert",
          vim: newVim,
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "y": {
      // Yank (copy only, don't modify buffer)
      return {
        state: {
          ...state,
          vim: newVim,
        },
        modified: false,
      };
    }
    
    case ">": {
      // Indent
      const newBuffer = indentLines(state.buffer, range.start.line, range.end.line, 2);
      return {
        state: {
          ...state,
          buffer: newBuffer,
          cursor: {
            line: range.start.line,
            column: findFirstNonWhitespace(newBuffer, range.start.line),
          },
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "<": {
      // Outdent
      const newBuffer = outdentLines(state.buffer, range.start.line, range.end.line, 2);
      return {
        state: {
          ...state,
          buffer: newBuffer,
          cursor: {
            line: range.start.line,
            column: findFirstNonWhitespace(newBuffer, range.start.line),
          },
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    default:
      return { state, modified: false };
  }
}

/**
 * Execute a simple action command.
 */
export function executeAction(
  state: ExtendedEditorState,
  command: VimCommand
): ExecutionResult {
  const action = command.name;
  const count = command.count;
  
  switch (action) {
    // Insert mode entries
    case "i":
      return {
        state: { ...state, mode: "insert" },
        modified: false,
      };
    
    case "I": {
      const column = findFirstNonWhitespace(state.buffer, state.cursor.line);
      return {
        state: {
          ...state,
          mode: "insert",
          cursor: { ...state.cursor, column },
        },
        modified: false,
      };
    }
    
    case "a": {
      const lineLen = getLineLength(state.buffer, state.cursor.line);
      return {
        state: {
          ...state,
          mode: "insert",
          cursor: { ...state.cursor, column: Math.min(state.cursor.column + 1, lineLen) },
        },
        modified: false,
      };
    }
    
    case "A": {
      const lineLen = getLineLength(state.buffer, state.cursor.line);
      return {
        state: {
          ...state,
          mode: "insert",
          cursor: { ...state.cursor, column: lineLen },
        },
        modified: false,
      };
    }
    
    case "o": {
      // Open line below
      const newHistory = pushHistory(state.history, state.buffer, state.cursor);
      const currentLine = state.cursor.line;
      const newBuffer = insertText(
        state.buffer,
        { line: currentLine, column: getLineLength(state.buffer, currentLine) },
        "\n"
      );
      return {
        state: {
          ...state,
          buffer: newBuffer,
          cursor: { line: currentLine + 1, column: 0 },
          mode: "insert",
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "O": {
      // Open line above
      const newHistory = pushHistory(state.history, state.buffer, state.cursor);
      const currentLine = state.cursor.line;
      const newBuffer = insertText(
        state.buffer,
        { line: currentLine, column: 0 },
        "\n"
      );
      // Move the new content down, cursor stays on the now-empty line
      return {
        state: {
          ...state,
          buffer: newBuffer,
          cursor: { line: currentLine, column: 0 },
          mode: "insert",
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "x": {
      // Delete character under cursor
      const newHistory = pushHistory(state.history, state.buffer, state.cursor);
      let newBuffer = state.buffer;
      let cursor = state.cursor;
      
      for (let i = 0; i < count; i++) {
        const lineLen = getLineLength(newBuffer, cursor.line);
        if (cursor.column < lineLen) {
          const char = getLine(newBuffer, cursor.line)[cursor.column];
          newBuffer = deleteCharAt(newBuffer, cursor);
          
          // Save to register
          state.vim.registers['"'] = { text: char, linewise: false };
        }
      }
      
      // Clamp cursor
      const newLineLen = getLineLength(newBuffer, cursor.line);
      cursor = {
        line: cursor.line,
        column: Math.min(cursor.column, Math.max(0, newLineLen - 1)),
      };
      
      return {
        state: {
          ...state,
          buffer: newBuffer,
          cursor,
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "X": {
      // Delete character before cursor
      if (state.cursor.column === 0) {
        return { state, modified: false };
      }
      
      const newHistory = pushHistory(state.history, state.buffer, state.cursor);
      let newBuffer = state.buffer;
      let cursor = state.cursor;
      
      for (let i = 0; i < count && cursor.column > 0; i++) {
        const char = getLine(newBuffer, cursor.line)[cursor.column - 1];
        newBuffer = deleteRange(
          newBuffer,
          { line: cursor.line, column: cursor.column - 1 },
          { line: cursor.line, column: cursor.column }
        );
        cursor = { line: cursor.line, column: cursor.column - 1 };
        
        // Save to register
        state.vim.registers['"'] = { text: char, linewise: false };
      }
      
      return {
        state: {
          ...state,
          buffer: newBuffer,
          cursor,
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "s": {
      // Substitute: delete char and enter insert mode
      const newHistory = pushHistory(state.history, state.buffer, state.cursor);
      let newBuffer = state.buffer;
      
      const lineLen = getLineLength(newBuffer, state.cursor.line);
      if (state.cursor.column < lineLen) {
        newBuffer = deleteCharAt(newBuffer, state.cursor);
      }
      
      return {
        state: {
          ...state,
          buffer: newBuffer,
          mode: "insert",
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "S": {
      // Substitute line: delete line content and enter insert mode
      const newHistory = pushHistory(state.history, state.buffer, state.cursor);
      const line = getLine(state.buffer, state.cursor.line);
      const newBuffer = deleteRange(
        state.buffer,
        { line: state.cursor.line, column: 0 },
        { line: state.cursor.line, column: line.length }
      );
      
      return {
        state: {
          ...state,
          buffer: newBuffer,
          cursor: { line: state.cursor.line, column: 0 },
          mode: "insert",
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "D": {
      // Delete to end of line
      const newHistory = pushHistory(state.history, state.buffer, state.cursor);
      const line = getLine(state.buffer, state.cursor.line);
      const deletedText = line.slice(state.cursor.column);
      
      const newBuffer = deleteRange(
        state.buffer,
        state.cursor,
        { line: state.cursor.line, column: line.length }
      );
      
      // Clamp cursor
      const newLineLen = getLineLength(newBuffer, state.cursor.line);
      const newCursor = {
        line: state.cursor.line,
        column: Math.max(0, Math.min(state.cursor.column, newLineLen - 1)),
      };
      
      const newVim = {
        ...state.vim,
        registers: {
          ...state.vim.registers,
          '"': { text: deletedText, linewise: false },
        },
      };
      
      return {
        state: {
          ...state,
          buffer: newBuffer,
          cursor: newCursor,
          vim: newVim,
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "C": {
      // Change to end of line
      const newHistory = pushHistory(state.history, state.buffer, state.cursor);
      const line = getLine(state.buffer, state.cursor.line);
      const deletedText = line.slice(state.cursor.column);
      
      const newBuffer = deleteRange(
        state.buffer,
        state.cursor,
        { line: state.cursor.line, column: line.length }
      );
      
      const newVim = {
        ...state.vim,
        registers: {
          ...state.vim.registers,
          '"': { text: deletedText, linewise: false },
        },
      };
      
      return {
        state: {
          ...state,
          buffer: newBuffer,
          mode: "insert",
          vim: newVim,
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "J": {
      // Join lines
      const lineCount = getLineCount(state.buffer);
      if (state.cursor.line >= lineCount - 1) {
        return { state, modified: false };
      }
      
      const newHistory = pushHistory(state.history, state.buffer, state.cursor);
      let newBuffer = state.buffer;
      let joinPos = state.cursor;
      
      for (let i = 0; i < count && joinPos.line < getLineCount(newBuffer) - 1; i++) {
        const currentLine = getLine(newBuffer, joinPos.line);
        const nextLine = getLine(newBuffer, joinPos.line + 1);
        const trimmedNext = nextLine.trimStart();
        
        // Position where the join happens (end of current line)
        const joinColumn = currentLine.length;
        
        // Delete the newline and leading whitespace of next line
        newBuffer = deleteRange(
          newBuffer,
          { line: joinPos.line, column: currentLine.length },
          { line: joinPos.line + 1, column: nextLine.length - trimmedNext.length }
        );
        
        // Add a space if both lines have content
        if (currentLine.length > 0 && trimmedNext.length > 0) {
          newBuffer = insertText(newBuffer, { line: joinPos.line, column: joinColumn }, " ");
        }
      }
      
      return {
        state: {
          ...state,
          buffer: newBuffer,
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "~": {
      // Toggle case
      const newHistory = pushHistory(state.history, state.buffer, state.cursor);
      let newBuffer = state.buffer;
      let cursor = state.cursor;
      
      for (let i = 0; i < count; i++) {
        const line = getLine(newBuffer, cursor.line);
        if (cursor.column >= line.length) break;
        
        const char = line[cursor.column];
        const toggled = char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase();
        
        // Replace character
        newBuffer = deleteCharAt(newBuffer, cursor);
        newBuffer = insertText(newBuffer, cursor, toggled);
        
        // Move cursor right
        if (cursor.column < line.length - 1) {
          cursor = { line: cursor.line, column: cursor.column + 1 };
        }
      }
      
      return {
        state: {
          ...state,
          buffer: newBuffer,
          cursor,
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "u": {
      // Undo
      const result = undo(state.history, state.buffer, state.cursor);
      if (!result) {
        return { state, modified: false };
      }
      
      return {
        state: {
          ...state,
          buffer: result.buffer,
          cursor: result.cursor,
          history: result.history,
        },
        modified: false, // Undo itself doesn't create a new history entry
      };
    }
    
    case "C-r": {
      // Redo
      const result = redo(state.history, state.buffer, state.cursor);
      if (!result) {
        return { state, modified: false };
      }
      
      return {
        state: {
          ...state,
          buffer: result.buffer,
          cursor: result.cursor,
          history: result.history,
        },
        modified: false,
      };
    }
    
    case "p": {
      // Paste after cursor
      const register = state.vim.registers[state.vim.register] || state.vim.registers['"'];
      if (!register) {
        return { state, modified: false };
      }
      
      const newHistory = pushHistory(state.history, state.buffer, state.cursor);
      let newBuffer = state.buffer;
      let newCursor = state.cursor;
      
      if (register.linewise) {
        // Paste below current line
        const insertLine = state.cursor.line + 1;
        const textToInsert = register.text.endsWith("\n") ? register.text : register.text + "\n";
        
        if (insertLine >= getLineCount(state.buffer)) {
          // At last line, insert at end
          newBuffer = insertText(
            newBuffer,
            { line: state.cursor.line, column: getLineLength(state.buffer, state.cursor.line) },
            "\n" + register.text
          );
        } else {
          newBuffer = insertText(
            newBuffer,
            { line: insertLine, column: 0 },
            textToInsert
          );
        }
        newCursor = { line: insertLine, column: findFirstNonWhitespace(newBuffer, insertLine) };
      } else {
        // Paste after cursor
        const insertCol = Math.min(state.cursor.column + 1, getLineLength(state.buffer, state.cursor.line));
        newBuffer = insertText(newBuffer, { line: state.cursor.line, column: insertCol }, register.text);
        
        // Position cursor at end of pasted text
        const lines = register.text.split("\n");
        if (lines.length === 1) {
          newCursor = { line: state.cursor.line, column: insertCol + register.text.length - 1 };
        } else {
          newCursor = { line: state.cursor.line + lines.length - 1, column: lines[lines.length - 1].length - 1 };
        }
      }
      
      return {
        state: {
          ...state,
          buffer: newBuffer,
          cursor: newCursor,
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "P": {
      // Paste before cursor
      const register = state.vim.registers[state.vim.register] || state.vim.registers['"'];
      if (!register) {
        return { state, modified: false };
      }
      
      const newHistory = pushHistory(state.history, state.buffer, state.cursor);
      let newBuffer = state.buffer;
      let newCursor = state.cursor;
      
      if (register.linewise) {
        // Paste above current line
        const textToInsert = register.text.endsWith("\n") ? register.text : register.text + "\n";
        newBuffer = insertText(newBuffer, { line: state.cursor.line, column: 0 }, textToInsert);
        newCursor = { line: state.cursor.line, column: findFirstNonWhitespace(newBuffer, state.cursor.line) };
      } else {
        // Paste at cursor
        newBuffer = insertText(newBuffer, state.cursor, register.text);
        
        // Position cursor at end of pasted text
        const lines = register.text.split("\n");
        if (lines.length === 1) {
          newCursor = { line: state.cursor.line, column: state.cursor.column + register.text.length - 1 };
        } else {
          newCursor = { line: state.cursor.line + lines.length - 1, column: lines[lines.length - 1].length - 1 };
        }
      }
      
      return {
        state: {
          ...state,
          buffer: newBuffer,
          cursor: newCursor,
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    // Visual mode
    case "v": {
      // Enter character visual mode
      return {
        state: {
          ...state,
          mode: "normal", // Mode stays normal, but we track visual state
          visualAnchor: { ...state.cursor },
          visualMode: "char",
        },
        modified: false,
      };
    }
    
    case "V": {
      // Enter line visual mode
      return {
        state: {
          ...state,
          mode: "normal",
          visualAnchor: { ...state.cursor },
          visualMode: "line",
        },
        modified: false,
      };
    }
    
    // Search next/previous
    case "n": {
      const vim = state.vim;
      if (!vim.searchPattern || vim.searchMatches.length === 0) {
        return { state, modified: false };
      }
      
      const result = findNextMatch(vim.searchMatches, state.cursor, vim.searchForward);
      if (!result) {
        return { state, modified: false };
      }
      
      return {
        state: {
          ...state,
          cursor: result.position,
          vim: { ...vim, searchMatchIndex: result.index },
        },
        modified: false,
      };
    }
    
    case "N": {
      const vim = state.vim;
      if (!vim.searchPattern || vim.searchMatches.length === 0) {
        return { state, modified: false };
      }
      
      // N goes in opposite direction
      const result = findNextMatch(vim.searchMatches, state.cursor, !vim.searchForward);
      if (!result) {
        return { state, modified: false };
      }
      
      return {
        state: {
          ...state,
          cursor: result.position,
          vim: { ...vim, searchMatchIndex: result.index },
        },
        modified: false,
      };
    }
    
    // Search word under cursor
    case "*": {
      const wordInfo = getWordUnderCursorWithBounds(state.buffer, state.cursor);
      if (!wordInfo) {
        return { state, modified: false };
      }
      
      // Use word boundary pattern
      const pattern = `\\b${wordInfo.word}\\b`;
      const matches = findAllMatches(state.buffer, wordInfo.word);
      
      if (matches.length === 0) {
        return { state, modified: false };
      }
      
      // Find next match after the END of current word (to skip current occurrence)
      const searchFrom = { line: state.cursor.line, column: wordInfo.end + 1 };
      const result = findNextMatch(matches, searchFrom, true);
      
      return {
        state: {
          ...state,
          cursor: result?.position ?? state.cursor,
          vim: {
            ...state.vim,
            searchPattern: pattern,
            searchForward: true,
            searchMatches: matches,
            searchMatchIndex: result?.index ?? -1,
          },
        },
        modified: false,
      };
    }
    
    case "#": {
      const wordInfo = getWordUnderCursorWithBounds(state.buffer, state.cursor);
      if (!wordInfo) {
        return { state, modified: false };
      }
      
      const pattern = `\\b${wordInfo.word}\\b`;
      const matches = findAllMatches(state.buffer, wordInfo.word);
      
      if (matches.length === 0) {
        return { state, modified: false };
      }
      
      // Find previous match before the START of current word (to skip current occurrence)
      const searchFrom = { line: state.cursor.line, column: wordInfo.start };
      const result = findNextMatch(matches, searchFrom, false);
      
      return {
        state: {
          ...state,
          cursor: result?.position ?? state.cursor,
          vim: {
            ...state.vim,
            searchPattern: pattern,
            searchForward: false,
            searchMatches: matches,
            searchMatchIndex: result?.index ?? -1,
          },
        },
        modified: false,
      };
    }
    
    // Scroll position commands
    case "zz":
    case "zt":
    case "zb": {
      // These don't change state, but signal to the UI to adjust scroll
      // We handle this by marking the action in the vim state
      return {
        state: {
          ...state,
          vim: {
            ...state.vim,
            inputBuffer: action, // Signal to UI
          },
        },
        modified: false,
      };
    }
    
    default:
      // Handle r<char> (replace character)
      if (action.startsWith("r") && action.length === 2) {
        const replaceChar = action[1];
        const newHistory = pushHistory(state.history, state.buffer, state.cursor);
        
        let newBuffer = state.buffer;
        let cursor = state.cursor;
        
        for (let i = 0; i < count; i++) {
          const lineLen = getLineLength(newBuffer, cursor.line);
          if (cursor.column >= lineLen) break;
          
          newBuffer = deleteCharAt(newBuffer, cursor);
          newBuffer = insertText(newBuffer, cursor, replaceChar);
          
          if (i < count - 1 && cursor.column < lineLen - 1) {
            cursor = { line: cursor.line, column: cursor.column + 1 };
          }
        }
        
        return {
          state: {
            ...state,
            buffer: newBuffer,
            cursor,
            history: newHistory,
            dirty: true,
          },
          modified: true,
        };
      }
      
      return { state, modified: false };
  }
}

/**
 * Execute an operator in visual mode on the selected region.
 */
export function executeVisualOperator(
  state: ExtendedEditorState,
  operator: string
): ExecutionResult {
  if (!state.visualAnchor || !state.visualMode) {
    return { state, modified: false };
  }
  
  const isLinewise = state.visualMode === "line";
  
  // Determine selection bounds
  let start: Position;
  let end: Position;
  
  if (isLinewise) {
    const startLine = Math.min(state.visualAnchor.line, state.cursor.line);
    const endLine = Math.max(state.visualAnchor.line, state.cursor.line);
    start = { line: startLine, column: 0 };
    end = { line: endLine, column: getLineLength(state.buffer, endLine) };
  } else {
    // Character visual mode
    if (comparePositions(state.visualAnchor, state.cursor) <= 0) {
      start = state.visualAnchor;
      end = { line: state.cursor.line, column: state.cursor.column + 1 };
    } else {
      start = state.cursor;
      end = { line: state.visualAnchor.line, column: state.visualAnchor.column + 1 };
    }
  }
  
  // Save selection to register
  const selectedText = extractText(state.buffer, start, end, isLinewise);
  const newVim: VimState = {
    ...state.vim,
    registers: {
      ...state.vim.registers,
      [state.vim.register]: { text: selectedText, linewise: isLinewise },
      '"': { text: selectedText, linewise: isLinewise },
    },
  };
  
  // Push history before modification
  const newHistory = pushHistory(state.history, state.buffer, state.cursor);
  
  // Clear visual mode
  const baseState: ExtendedEditorState = {
    ...state,
    visualAnchor: null,
    visualMode: null,
    vim: newVim,
  };
  
  switch (operator) {
    case "d":
    case "x": {
      // Delete selection
      let newBuffer: TextBuffer;
      let newCursor: Position;
      
      if (isLinewise) {
        newBuffer = deleteLines(state.buffer, start.line, end.line);
        const lineCount = getLineCount(newBuffer);
        const targetLine = Math.min(start.line, lineCount - 1);
        newCursor = { line: targetLine, column: findFirstNonWhitespace(newBuffer, targetLine) };
      } else {
        newBuffer = deleteRange(state.buffer, start, end);
        newCursor = start;
        const lineLen = getLineLength(newBuffer, newCursor.line);
        newCursor.column = Math.min(newCursor.column, Math.max(0, lineLen - 1));
      }
      
      return {
        state: {
          ...baseState,
          buffer: newBuffer,
          cursor: newCursor,
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "c":
    case "s": {
      // Change selection (delete and enter insert mode)
      let newBuffer: TextBuffer;
      let newCursor: Position;
      
      if (isLinewise) {
        // Replace lines with empty line
        newBuffer = deleteLines(state.buffer, start.line, end.line);
        // Insert empty line if we deleted everything
        if (getLineCount(newBuffer) === 1 && getLine(newBuffer, 0) === "" && start.line === 0) {
          // Already have empty line
        } else {
          newBuffer = insertText(newBuffer, { line: start.line, column: 0 }, "\n");
          newBuffer = deleteRange(newBuffer, { line: start.line, column: 0 }, { line: start.line + 1, column: 0 });
        }
        newCursor = { line: start.line, column: 0 };
      } else {
        newBuffer = deleteRange(state.buffer, start, end);
        newCursor = start;
      }
      
      return {
        state: {
          ...baseState,
          buffer: newBuffer,
          cursor: newCursor,
          mode: "insert",
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "y": {
      // Yank selection (already saved to register above)
      return {
        state: {
          ...baseState,
          cursor: start, // Move cursor to start of selection
        },
        modified: false,
      };
    }
    
    case ">": {
      // Indent
      const newBuffer = indentLines(state.buffer, start.line, end.line, 2);
      return {
        state: {
          ...baseState,
          buffer: newBuffer,
          cursor: { line: start.line, column: findFirstNonWhitespace(newBuffer, start.line) },
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "<": {
      // Outdent
      const newBuffer = outdentLines(state.buffer, start.line, end.line, 2);
      return {
        state: {
          ...baseState,
          buffer: newBuffer,
          cursor: { line: start.line, column: findFirstNonWhitespace(newBuffer, start.line) },
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    case "~": {
      // Toggle case
      let newBuffer = state.buffer;
      
      for (let line = start.line; line <= end.line; line++) {
        const lineText = getLine(newBuffer, line);
        const startCol = line === start.line ? start.column : 0;
        const endCol = line === end.line ? end.column : lineText.length;
        
        let newLine = lineText.slice(0, startCol);
        for (let col = startCol; col < endCol; col++) {
          const char = lineText[col];
          newLine += char === char.toLowerCase() ? char.toUpperCase() : char.toLowerCase();
        }
        newLine += lineText.slice(endCol);
        
        // Replace the line
        newBuffer = deleteRange(newBuffer, { line, column: 0 }, { line, column: lineText.length });
        newBuffer = insertText(newBuffer, { line, column: 0 }, newLine);
      }
      
      return {
        state: {
          ...baseState,
          buffer: newBuffer,
          cursor: start,
          history: newHistory,
          dirty: true,
        },
        modified: true,
      };
    }
    
    default:
      // Just exit visual mode
      return {
        state: baseState,
        modified: false,
      };
  }
}

/**
 * Main command execution entry point.
 */
export function executeCommand(
  state: ExtendedEditorState,
  command: VimCommand
): ExecutionResult {
  // If in visual mode and we get an operator, apply it to selection
  if (state.visualMode && command.type === "action") {
    const visualOperators = ["d", "x", "c", "s", "y", ">", "<", "~"];
    if (visualOperators.includes(command.name)) {
      return executeVisualOperator(state, command.name);
    }
    
    // Escape exits visual mode
    if (command.name === "Escape") {
      return {
        state: {
          ...state,
          visualAnchor: null,
          visualMode: null,
        },
        modified: false,
      };
    }
  }
  
  switch (command.type) {
    case "motion":
      return executeMotion(state, command);
    case "operator":
      // If in visual mode, operators apply to selection
      if (state.visualMode && command.operator) {
        return executeVisualOperator(state, command.operator);
      }
      return executeOperator(state, command);
    case "action":
      return executeAction(state, command);
    case "text-object":
      // Text objects are only meaningful with operators
      return { state, modified: false };
    default:
      return { state, modified: false };
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract text from a range.
 */
function extractText(
  buffer: TextBuffer,
  start: Position,
  end: Position,
  linewise: boolean
): string {
  if (linewise) {
    const lines: string[] = [];
    for (let i = start.line; i <= end.line; i++) {
      lines.push(getLine(buffer, i));
    }
    return lines.join("\n");
  }
  
  if (start.line === end.line) {
    const line = getLine(buffer, start.line);
    return line.slice(start.column, end.column);
  }
  
  const result: string[] = [];
  result.push(getLine(buffer, start.line).slice(start.column));
  
  for (let i = start.line + 1; i < end.line; i++) {
    result.push(getLine(buffer, i));
  }
  
  result.push(getLine(buffer, end.line).slice(0, end.column));
  
  return result.join("\n");
}

/**
 * Delete a single line from buffer.
 */
function deleteLine(buffer: TextBuffer, lineNum: number): TextBuffer {
  const lineCount = getLineCount(buffer);
  if (lineCount === 1) {
    // Can't delete the only line, just clear it
    return { lines: [""] };
  }
  
  const newLines = [...buffer.lines];
  newLines.splice(lineNum, 1);
  return { lines: newLines };
}

/**
 * Delete multiple lines from buffer.
 */
function deleteLines(buffer: TextBuffer, startLine: number, endLine: number): TextBuffer {
  const lineCount = getLineCount(buffer);
  const deleteCount = endLine - startLine + 1;
  
  if (deleteCount >= lineCount) {
    // Deleting all lines, leave one empty line
    return { lines: [""] };
  }
  
  const newLines = [...buffer.lines];
  newLines.splice(startLine, deleteCount);
  return { lines: newLines };
}

/**
 * Indent lines by adding spaces.
 */
function indentLines(buffer: TextBuffer, startLine: number, endLine: number, spaces: number): TextBuffer {
  const indent = " ".repeat(spaces);
  const newLines = [...buffer.lines];
  
  for (let i = startLine; i <= endLine; i++) {
    if (newLines[i].length > 0) { // Don't indent empty lines
      newLines[i] = indent + newLines[i];
    }
  }
  
  return { lines: newLines };
}

/**
 * Outdent lines by removing leading spaces.
 */
function outdentLines(buffer: TextBuffer, startLine: number, endLine: number, spaces: number): TextBuffer {
  const newLines = [...buffer.lines];
  
  for (let i = startLine; i <= endLine; i++) {
    let removed = 0;
    while (removed < spaces && newLines[i][removed] === " ") {
      removed++;
    }
    newLines[i] = newLines[i].slice(removed);
  }
  
  return { lines: newLines };
}

/**
 * Create an extended editor state from a basic editor state.
 */
export function createExtendedState(content: string = ""): ExtendedEditorState {
  return {
    buffer: { lines: content.length === 0 ? [""] : content.split("\n") },
    cursor: { line: 0, column: 0 },
    mode: "normal",
    desiredColumn: null,
    dirty: false,
    vim: createVimState(),
    history: { undoStack: [], redoStack: [], maxSize: 1000 },
    visualAnchor: null,
    visualMode: null,
  };
}

/**
 * Mark the extended editor state as dirty.
 */
export function markExtendedDirty(state: ExtendedEditorState): ExtendedEditorState {
  if (state.dirty) return state;
  return { ...state, dirty: true };
}

/**
 * Mark the extended editor state as clean.
 */
export function markExtendedClean(state: ExtendedEditorState): ExtendedEditorState {
  if (!state.dirty) return state;
  return { ...state, dirty: false };
}

/**
 * Clamp cursor for extended editor state.
 */
export function clampExtendedCursor(state: ExtendedEditorState): ExtendedEditorState {
  const lineCount = getLineCount(state.buffer);
  const clampedLine = Math.max(0, Math.min(state.cursor.line, lineCount - 1));
  const lineLen = getLineLength(state.buffer, clampedLine);
  
  let maxCol: number;
  if (state.mode === "normal") {
    maxCol = Math.max(0, lineLen - 1);
  } else {
    maxCol = lineLen;
  }
  
  const clampedCol = Math.max(0, Math.min(state.cursor.column, maxCol));
  
  if (clampedLine === state.cursor.line && clampedCol === state.cursor.column) {
    return state;
  }
  
  return {
    ...state,
    cursor: { line: clampedLine, column: clampedCol },
  };
}
