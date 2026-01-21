/**
 * Vim command parser and executor.
 * 
 * Handles multi-key sequences, counts, operator+motion composition,
 * and text objects for a complete vim editing experience.
 */

import { TextBuffer, Position, getLine, getLineCount, getLineLength } from "./buffer";
import type { EditorMode } from "./editor";

// ============================================================================
// Types
// ============================================================================

export type VimMode = "normal" | "insert" | "visual" | "visual-line" | "operator-pending" | "replace";

export type Operator = "d" | "c" | "y" | ">" | "<" | "g~" | "gu" | "gU";

export interface VimState {
  /** Current input buffer for multi-key sequences */
  inputBuffer: string;
  /** Accumulated count prefix (e.g., "12" for 12j) */
  count: number | null;
  /** Pending operator (e.g., "d" waiting for motion) */
  pendingOperator: Operator | null;
  /** Last executed command for repeat with . */
  lastCommand: VimCommand | null;
  /** Register for yank/delete operations */
  register: string;
  /** Register contents */
  registers: Record<string, RegisterContent>;
  /** Last search pattern */
  searchPattern: string | null;
  /** Search direction: true = forward, false = backward */
  searchForward: boolean;
  /** All search match positions (for highlighting) */
  searchMatches: Position[];
  /** Current search match index */
  searchMatchIndex: number;
  /** Last find character for ; and , */
  lastFindChar: string | null;
  /** Last find was forward (f/t) vs backward (F/T) */
  lastFindForward: boolean;
  /** Last find was inclusive (f/F) vs exclusive (t/T) */
  lastFindInclusive: boolean;
}

export interface RegisterContent {
  text: string;
  /** Whether the text is linewise (from dd, yy, etc.) */
  linewise: boolean;
}

export interface VimCommand {
  type: "motion" | "operator" | "action" | "text-object";
  name: string;
  count: number;
  operator?: Operator;
  motion?: VimMotion;
  textObject?: TextObject;
  register?: string;
  /** For repeat (.) - the full input that produced this command */
  input?: string;
}

export interface VimMotion {
  name: string;
  /** Calculate target position from current state */
  target: (buffer: TextBuffer, cursor: Position, count: number) => Position;
  /** Whether this motion is linewise */
  linewise?: boolean;
  /** Whether this motion is inclusive (includes the target character) */
  inclusive?: boolean;
  /** Whether this motion operates on display lines (for gj/gk) - requires UI handling */
  displayLine?: boolean;
}

export interface TextObject {
  name: string;
  /** Calculate the range for this text object */
  range: (buffer: TextBuffer, cursor: Position, inner: boolean) => { start: Position; end: Position } | null;
  /** Whether this text object is linewise */
  linewise?: boolean;
}

export interface ParseResult {
  /** Whether parsing is complete (command ready or error) */
  complete: boolean;
  /** The parsed command, if complete and successful */
  command?: VimCommand;
  /** Error message, if parsing failed */
  error?: string;
  /** Updated vim state */
  state: VimState;
}

// ============================================================================
// Initial State
// ============================================================================

export function createVimState(): VimState {
  return {
    inputBuffer: "",
    count: null,
    pendingOperator: null,
    lastCommand: null,
    register: '"',
    registers: {},
    searchPattern: null,
    searchForward: true,
    searchMatches: [],
    searchMatchIndex: -1,
    lastFindChar: null,
    lastFindForward: true,
    lastFindInclusive: true,
  };
}

// ============================================================================
// Motions
// ============================================================================

/** Check if a character is a word character (for 'w', 'b', 'e' motions) */
function isWordChar(char: string): boolean {
  return /[a-zA-Z0-9_]/.test(char);
}

/** Check if a character is a WORD character (non-whitespace for 'W', 'B', 'E') */
function isWORDChar(char: string): boolean {
  return char !== "" && !/\s/.test(char);
}

/** Check if a character is whitespace */
function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

/** Get character at position, or empty string if out of bounds */
function charAt(buffer: TextBuffer, pos: Position): string {
  const line = getLine(buffer, pos.line);
  if (pos.column < 0 || pos.column >= line.length) return "";
  return line[pos.column];
}

/** Find the start of the next word */
function findNextWordStart(buffer: TextBuffer, cursor: Position, bigWord: boolean): Position {
  const lineCount = getLineCount(buffer);
  let { line, column } = cursor;
  const isWord = bigWord ? isWORDChar : isWordChar;
  
  // Get current character type
  let currentLine = getLine(buffer, line);
  let currentChar = currentLine[column] || "";
  const startedOnWord = isWord(currentChar);
  const startedOnWhitespace = isWhitespace(currentChar);
  
  // Skip current word/non-word characters
  while (line < lineCount) {
    currentLine = getLine(buffer, line);
    
    while (column < currentLine.length) {
      currentChar = currentLine[column];
      
      if (startedOnWhitespace) {
        // Started on whitespace, find first non-whitespace
        if (!isWhitespace(currentChar)) {
          return { line, column };
        }
      } else if (startedOnWord) {
        // Started on word, skip word chars then find next word start
        if (!isWord(currentChar)) {
          // Found end of word, now skip whitespace/punctuation to next word
          while (line < lineCount) {
            currentLine = getLine(buffer, line);
            while (column < currentLine.length) {
              if (isWord(currentLine[column]) || (!bigWord && !isWhitespace(currentLine[column]) && !isWord(currentLine[column]))) {
                return { line, column };
              }
              column++;
            }
            line++;
            column = 0;
            if (line < lineCount && getLine(buffer, line).length > 0) {
              // At start of new line, check if it's a word start
              const firstChar = getLine(buffer, line)[0];
              if (isWord(firstChar) || (!bigWord && !isWhitespace(firstChar))) {
                return { line, column: 0 };
              }
            }
          }
          return { line: lineCount - 1, column: Math.max(0, getLineLength(buffer, lineCount - 1) - 1) };
        }
      } else {
        // Started on punctuation (non-word, non-whitespace)
        if (isWord(currentChar) || isWhitespace(currentChar)) {
          // Found end of punctuation sequence
          if (isWord(currentChar)) {
            return { line, column };
          }
          // Skip whitespace to find next word/punctuation
          while (line < lineCount) {
            currentLine = getLine(buffer, line);
            while (column < currentLine.length) {
              if (!isWhitespace(currentLine[column])) {
                return { line, column };
              }
              column++;
            }
            line++;
            column = 0;
          }
          return { line: lineCount - 1, column: Math.max(0, getLineLength(buffer, lineCount - 1) - 1) };
        }
      }
      column++;
    }
    
    // Move to next line
    line++;
    column = 0;
    
    // Start of new line is a word start if it has content
    if (line < lineCount) {
      const nextLine = getLine(buffer, line);
      if (nextLine.length > 0 && !isWhitespace(nextLine[0])) {
        return { line, column: 0 };
      }
    }
  }
  
  // End of buffer
  return { line: lineCount - 1, column: Math.max(0, getLineLength(buffer, lineCount - 1) - 1) };
}

/** Find the end of the current or next word */
function findWordEnd(buffer: TextBuffer, cursor: Position, bigWord: boolean): Position {
  const lineCount = getLineCount(buffer);
  let { line, column } = cursor;
  const isWord = bigWord ? isWORDChar : isWordChar;
  
  // Move forward one character to start (vim 'e' skips current char)
  column++;
  
  while (line < lineCount) {
    const currentLine = getLine(buffer, line);
    
    // Skip whitespace
    while (column < currentLine.length && isWhitespace(currentLine[column])) {
      column++;
    }
    
    if (column >= currentLine.length) {
      line++;
      column = 0;
      continue;
    }
    
    // Now we're on a non-whitespace char, find end of this word
    const onWord = isWord(currentLine[column]);
    
    while (column < currentLine.length - 1) {
      const nextChar = currentLine[column + 1];
      if (bigWord) {
        if (isWhitespace(nextChar)) break;
      } else {
        if (onWord && !isWord(nextChar)) break;
        if (!onWord && (isWord(nextChar) || isWhitespace(nextChar))) break;
      }
      column++;
    }
    
    return { line, column };
  }
  
  return { line: lineCount - 1, column: Math.max(0, getLineLength(buffer, lineCount - 1) - 1) };
}

/** Find the start of the current or previous word */
function findPrevWordStart(buffer: TextBuffer, cursor: Position, bigWord: boolean): Position {
  let { line, column } = cursor;
  const isWord = bigWord ? isWORDChar : isWordChar;
  
  // Move back one character to start
  column--;
  
  while (line >= 0) {
    const currentLine = getLine(buffer, line);
    
    if (column < 0) {
      line--;
      if (line >= 0) {
        column = getLineLength(buffer, line) - 1;
      }
      continue;
    }
    
    // Skip whitespace
    while (column >= 0 && isWhitespace(currentLine[column])) {
      column--;
    }
    
    if (column < 0) {
      line--;
      if (line >= 0) {
        column = getLineLength(buffer, line) - 1;
      }
      continue;
    }
    
    // Now we're on a non-whitespace char, find start of this word
    const onWord = isWord(currentLine[column]);
    
    while (column > 0) {
      const prevChar = currentLine[column - 1];
      if (bigWord) {
        if (isWhitespace(prevChar)) break;
      } else {
        if (onWord && !isWord(prevChar)) break;
        if (!onWord && (isWord(prevChar) || isWhitespace(prevChar))) break;
      }
      column--;
    }
    
    return { line, column };
  }
  
  return { line: 0, column: 0 };
}

/** Find character on current line */
function findCharOnLine(
  buffer: TextBuffer,
  cursor: Position,
  char: string,
  forward: boolean,
  inclusive: boolean
): Position | null {
  const line = getLine(buffer, cursor.line);
  
  if (forward) {
    // For 't' (exclusive), if we're right before the target char, we need to skip it
    // Start searching from column + 1, but for exclusive (t), also skip column + 1 if it's the target
    const startCol = cursor.column + 1;
    for (let i = startCol; i < line.length; i++) {
      if (line[i] === char) {
        const targetCol = inclusive ? i : i - 1;
        // For exclusive (t), make sure we actually move forward
        if (!inclusive && targetCol <= cursor.column) {
          continue; // Skip this match, look for the next one
        }
        return { line: cursor.line, column: targetCol };
      }
    }
  } else {
    // For 'T' (exclusive backward), similar logic
    const startCol = cursor.column - 1;
    for (let i = startCol; i >= 0; i--) {
      if (line[i] === char) {
        const targetCol = inclusive ? i : i + 1;
        // For exclusive (T), make sure we actually move backward
        if (!inclusive && targetCol >= cursor.column) {
          continue; // Skip this match, look for the next one
        }
        return { line: cursor.line, column: targetCol };
      }
    }
  }
  
  return null;
}

/** Find first non-whitespace character on line */
function findFirstNonWhitespace(buffer: TextBuffer, lineNum: number): number {
  const line = getLine(buffer, lineNum);
  for (let i = 0; i < line.length; i++) {
    if (!isWhitespace(line[i])) {
      return i;
    }
  }
  return 0;
}

export const motions: Record<string, VimMotion> = {
  h: {
    name: "left",
    target: (_buffer, cursor, count) => ({
      line: cursor.line,
      column: Math.max(0, cursor.column - count),
    }),
  },
  l: {
    name: "right",
    target: (buffer, cursor, count) => {
      const lineLen = getLineLength(buffer, cursor.line);
      return {
        line: cursor.line,
        column: Math.min(Math.max(0, lineLen - 1), cursor.column + count),
      };
    },
    inclusive: true,
  },
  j: {
    name: "down",
    target: (buffer, cursor, count) => {
      const lineCount = getLineCount(buffer);
      const targetLine = Math.min(lineCount - 1, cursor.line + count);
      const lineLen = getLineLength(buffer, targetLine);
      return {
        line: targetLine,
        column: Math.min(cursor.column, Math.max(0, lineLen - 1)),
      };
    },
    linewise: true,
  },
  k: {
    name: "up",
    target: (buffer, cursor, count) => {
      const targetLine = Math.max(0, cursor.line - count);
      const lineLen = getLineLength(buffer, targetLine);
      return {
        line: targetLine,
        column: Math.min(cursor.column, Math.max(0, lineLen - 1)),
      };
    },
    linewise: true,
  },
  w: {
    name: "word",
    target: (buffer, cursor, count) => {
      let pos = cursor;
      for (let i = 0; i < count; i++) {
        pos = findNextWordStart(buffer, pos, false);
      }
      return pos;
    },
  },
  W: {
    name: "WORD",
    target: (buffer, cursor, count) => {
      let pos = cursor;
      for (let i = 0; i < count; i++) {
        pos = findNextWordStart(buffer, pos, true);
      }
      return pos;
    },
  },
  e: {
    name: "end of word",
    target: (buffer, cursor, count) => {
      let pos = cursor;
      for (let i = 0; i < count; i++) {
        pos = findWordEnd(buffer, pos, false);
      }
      return pos;
    },
    inclusive: true,
  },
  E: {
    name: "end of WORD",
    target: (buffer, cursor, count) => {
      let pos = cursor;
      for (let i = 0; i < count; i++) {
        pos = findWordEnd(buffer, pos, true);
      }
      return pos;
    },
    inclusive: true,
  },
  b: {
    name: "back word",
    target: (buffer, cursor, count) => {
      let pos = cursor;
      for (let i = 0; i < count; i++) {
        pos = findPrevWordStart(buffer, pos, false);
      }
      return pos;
    },
  },
  B: {
    name: "back WORD",
    target: (buffer, cursor, count) => {
      let pos = cursor;
      for (let i = 0; i < count; i++) {
        pos = findPrevWordStart(buffer, pos, true);
      }
      return pos;
    },
  },
  "0": {
    name: "line start",
    target: (_buffer, cursor) => ({ line: cursor.line, column: 0 }),
  },
  "^": {
    name: "first non-blank",
    target: (buffer, cursor) => ({
      line: cursor.line,
      column: findFirstNonWhitespace(buffer, cursor.line),
    }),
  },
  $: {
    name: "line end",
    target: (buffer, cursor) => {
      const lineLen = getLineLength(buffer, cursor.line);
      return { line: cursor.line, column: Math.max(0, lineLen - 1) };
    },
    inclusive: true,
  },
  G: {
    name: "go to line / end of file",
    target: (buffer, _cursor, _count) => {
      // G without count goes to last line
      // Note: count handling for 5G would need explicit tracking in parser
      const lineCount = getLineCount(buffer);
      const targetLine = lineCount - 1;
      return {
        line: targetLine,
        column: findFirstNonWhitespace(buffer, targetLine),
      };
    },
    linewise: true,
  },
  gg: {
    name: "go to start",
    target: (buffer, _cursor, count) => {
      const targetLine = count > 0 ? Math.min(count - 1, getLineCount(buffer) - 1) : 0;
      return {
        line: targetLine,
        column: findFirstNonWhitespace(buffer, targetLine),
      };
    },
    linewise: true,
  },
  "{": {
    name: "paragraph up",
    target: (buffer, cursor, count) => {
      let line = cursor.line;
      for (let i = 0; i < count; i++) {
        // Skip current blank lines
        while (line > 0 && getLine(buffer, line).trim() === "") {
          line--;
        }
        // Find next blank line
        while (line > 0 && getLine(buffer, line).trim() !== "") {
          line--;
        }
      }
      return { line, column: 0 };
    },
    linewise: true,
  },
  "}": {
    name: "paragraph down",
    target: (buffer, cursor, count) => {
      let line = cursor.line;
      const lineCount = getLineCount(buffer);
      for (let i = 0; i < count; i++) {
        // Skip current non-blank lines
        while (line < lineCount - 1 && getLine(buffer, line).trim() !== "") {
          line++;
        }
        // Skip blank lines
        while (line < lineCount - 1 && getLine(buffer, line).trim() === "") {
          line++;
        }
      }
      return { line, column: 0 };
    },
    linewise: true,
  },
  "%": {
    name: "matching bracket",
    target: (buffer, cursor) => {
      const pairs: Record<string, string> = {
        "(": ")",
        ")": "(",
        "[": "]",
        "]": "[",
        "{": "}",
        "}": "{",
      };
      const opening = "([{";
      const closing = ")]}";
      
      const line = getLine(buffer, cursor.line);
      const char = line[cursor.column];
      
      if (!pairs[char]) {
        // Search forward on current line for a bracket
        for (let i = cursor.column; i < line.length; i++) {
          if (pairs[line[i]]) {
            return findMatchingBracket(buffer, { line: cursor.line, column: i }, pairs, opening, closing) || cursor;
          }
        }
        return cursor;
      }
      
      return findMatchingBracket(buffer, cursor, pairs, opening, closing) || cursor;
    },
    inclusive: true,
  },
  // Display line motions - these require UI handling for actual movement
  // The target function returns the same position; the UI handles the display line movement
  gj: {
    name: "display line down",
    target: (_buffer, cursor) => cursor, // Placeholder - UI handles this
    displayLine: true,
  },
  gk: {
    name: "display line up",
    target: (_buffer, cursor) => cursor, // Placeholder - UI handles this
    displayLine: true,
  },
};

function findMatchingBracket(
  buffer: TextBuffer,
  cursor: Position,
  pairs: Record<string, string>,
  opening: string,
  _closing: string
): Position | null {
  const line = getLine(buffer, cursor.line);
  const char = line[cursor.column];
  const match = pairs[char];
  const isOpening = opening.includes(char);
  
  let depth = 1;
  let pos = { ...cursor };
  
  if (isOpening) {
    // Search forward
    pos.column++;
    while (pos.line < getLineCount(buffer)) {
      const currentLine = getLine(buffer, pos.line);
      while (pos.column < currentLine.length) {
        const c = currentLine[pos.column];
        if (c === char) depth++;
        else if (c === match) {
          depth--;
          if (depth === 0) return pos;
        }
        pos.column++;
      }
      pos.line++;
      pos.column = 0;
    }
  } else {
    // Search backward
    pos.column--;
    while (pos.line >= 0) {
      const currentLine = getLine(buffer, pos.line);
      while (pos.column >= 0) {
        const c = currentLine[pos.column];
        if (c === char) depth++;
        else if (c === match) {
          depth--;
          if (depth === 0) return pos;
        }
        pos.column--;
      }
      pos.line--;
      if (pos.line >= 0) {
        pos.column = getLineLength(buffer, pos.line) - 1;
      }
    }
  }
  
  return null;
}

// ============================================================================
// Text Objects
// ============================================================================

/** Find word boundaries around cursor */
function findWordBounds(buffer: TextBuffer, cursor: Position, bigWord: boolean): { start: Position; end: Position } | null {
  const line = getLine(buffer, cursor.line);
  if (line.length === 0) return null;
  
  const isWord = bigWord ? isWORDChar : isWordChar;
  const char = line[cursor.column] || "";
  
  if (!isWord(char)) return null;
  
  // Find start
  let start = cursor.column;
  while (start > 0 && isWord(line[start - 1])) {
    start--;
  }
  
  // Find end
  let end = cursor.column;
  while (end < line.length - 1 && isWord(line[end + 1])) {
    end++;
  }
  
  return {
    start: { line: cursor.line, column: start },
    end: { line: cursor.line, column: end },
  };
}

/** Find word boundaries including surrounding whitespace for "aw" */
function findWordBoundsAround(buffer: TextBuffer, cursor: Position, bigWord: boolean): { start: Position; end: Position } | null {
  const bounds = findWordBounds(buffer, cursor, bigWord);
  if (!bounds) return null;
  
  const line = getLine(buffer, cursor.line);
  let { start, end } = bounds;
  
  // Try to include trailing whitespace first
  let endCol = end.column + 1;
  while (endCol < line.length && isWhitespace(line[endCol])) {
    endCol++;
  }
  
  if (endCol > end.column + 1) {
    return {
      start,
      end: { line: cursor.line, column: endCol - 1 },
    };
  }
  
  // If no trailing whitespace, include leading whitespace
  let startCol = start.column - 1;
  while (startCol >= 0 && isWhitespace(line[startCol])) {
    startCol--;
  }
  
  if (startCol < start.column - 1) {
    return {
      start: { line: cursor.line, column: startCol + 1 },
      end,
    };
  }
  
  return bounds;
}

/** Find matching pair boundaries */
function findPairBounds(
  buffer: TextBuffer,
  cursor: Position,
  open: string,
  close: string,
  inner: boolean
): { start: Position; end: Position } | null {
  // First, find the opening bracket (search backward)
  let depth = 0;
  let startPos: Position | null = null;
  let pos = { ...cursor };
  
  // Check if we're on the opening bracket
  const currentChar = charAt(buffer, cursor);
  if (currentChar === open) {
    startPos = { ...cursor };
  } else if (currentChar === close) {
    // We're on closing, find matching opening
    depth = 1;
    pos.column--;
    while (pos.line >= 0) {
      const line = getLine(buffer, pos.line);
      while (pos.column >= 0) {
        const c = line[pos.column];
        if (c === close) depth++;
        else if (c === open) {
          depth--;
          if (depth === 0) {
            startPos = { ...pos };
            break;
          }
        }
        pos.column--;
      }
      if (startPos) break;
      pos.line--;
      if (pos.line >= 0) {
        pos.column = getLineLength(buffer, pos.line) - 1;
      }
    }
  } else {
    // Search backward for opening bracket
    while (pos.line >= 0) {
      const line = getLine(buffer, pos.line);
      while (pos.column >= 0) {
        const c = line[pos.column];
        if (c === close) depth++;
        else if (c === open) {
          if (depth === 0) {
            startPos = { ...pos };
            break;
          }
          depth--;
        }
        pos.column--;
      }
      if (startPos) break;
      pos.line--;
      if (pos.line >= 0) {
        pos.column = getLineLength(buffer, pos.line) - 1;
      }
    }
  }
  
  if (!startPos) return null;
  
  // Now find the closing bracket (search forward from opening)
  depth = 1;
  pos = { line: startPos.line, column: startPos.column + 1 };
  
  while (pos.line < getLineCount(buffer)) {
    const line = getLine(buffer, pos.line);
    while (pos.column < line.length) {
      const c = line[pos.column];
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) {
          if (inner) {
            return {
              start: { line: startPos.line, column: startPos.column + 1 },
              end: { line: pos.line, column: pos.column - 1 },
            };
          } else {
            return {
              start: startPos,
              end: pos,
            };
          }
        }
      }
      pos.column++;
    }
    pos.line++;
    pos.column = 0;
  }
  
  return null;
}

/** Find quote boundaries */
function findQuoteBounds(
  buffer: TextBuffer,
  cursor: Position,
  quote: string,
  inner: boolean
): { start: Position; end: Position } | null {
  const line = getLine(buffer, cursor.line);
  
  // Find all quote positions on the line
  const quotePositions: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] === quote && (i === 0 || line[i - 1] !== "\\")) {
      quotePositions.push(i);
    }
  }
  
  // Find the pair that contains the cursor
  for (let i = 0; i < quotePositions.length - 1; i += 2) {
    const start = quotePositions[i];
    const end = quotePositions[i + 1];
    if (cursor.column >= start && cursor.column <= end) {
      if (inner) {
        return {
          start: { line: cursor.line, column: start + 1 },
          end: { line: cursor.line, column: end - 1 },
        };
      } else {
        return {
          start: { line: cursor.line, column: start },
          end: { line: cursor.line, column: end },
        };
      }
    }
  }
  
  return null;
}

export const textObjects: Record<string, TextObject> = {
  w: {
    name: "word",
    range: (buffer, cursor, inner) => 
      inner ? findWordBounds(buffer, cursor, false) : findWordBoundsAround(buffer, cursor, false),
  },
  W: {
    name: "WORD",
    range: (buffer, cursor, inner) =>
      inner ? findWordBounds(buffer, cursor, true) : findWordBoundsAround(buffer, cursor, true),
  },
  "(": {
    name: "parentheses",
    range: (buffer, cursor, inner) => findPairBounds(buffer, cursor, "(", ")", inner),
  },
  ")": {
    name: "parentheses",
    range: (buffer, cursor, inner) => findPairBounds(buffer, cursor, "(", ")", inner),
  },
  b: {
    name: "parentheses",
    range: (buffer, cursor, inner) => findPairBounds(buffer, cursor, "(", ")", inner),
  },
  "[": {
    name: "brackets",
    range: (buffer, cursor, inner) => findPairBounds(buffer, cursor, "[", "]", inner),
  },
  "]": {
    name: "brackets",
    range: (buffer, cursor, inner) => findPairBounds(buffer, cursor, "[", "]", inner),
  },
  "{": {
    name: "braces",
    range: (buffer, cursor, inner) => findPairBounds(buffer, cursor, "{", "}", inner),
  },
  "}": {
    name: "braces",
    range: (buffer, cursor, inner) => findPairBounds(buffer, cursor, "{", "}", inner),
  },
  B: {
    name: "braces",
    range: (buffer, cursor, inner) => findPairBounds(buffer, cursor, "{", "}", inner),
  },
  "<": {
    name: "angle brackets",
    range: (buffer, cursor, inner) => findPairBounds(buffer, cursor, "<", ">", inner),
  },
  ">": {
    name: "angle brackets",
    range: (buffer, cursor, inner) => findPairBounds(buffer, cursor, "<", ">", inner),
  },
  '"': {
    name: "double quotes",
    range: (buffer, cursor, inner) => findQuoteBounds(buffer, cursor, '"', inner),
  },
  "'": {
    name: "single quotes",
    range: (buffer, cursor, inner) => findQuoteBounds(buffer, cursor, "'", inner),
  },
  "`": {
    name: "backticks",
    range: (buffer, cursor, inner) => findQuoteBounds(buffer, cursor, "`", inner),
  },
};

// ============================================================================
// Command Parser
// ============================================================================

const OPERATORS = ["d", "c", "y", ">", "<"];
const TEXT_OBJECT_PREFIXES = ["i", "a"];

export interface ParseOptions {
  /** Whether we're in visual mode (operators apply to selection directly) */
  inVisualMode?: boolean;
}

export function parseInput(input: string, state: VimState, _mode: EditorMode, options: ParseOptions = {}): ParseResult {
  let newState = { ...state, inputBuffer: input };
  
  // Handle empty input
  if (input.length === 0) {
    return { complete: false, state: newState };
  }
  
  // Parse count prefix
  let idx = 0;
  let count: number | null = null;
  
  while (idx < input.length && /[1-9]/.test(input[idx]) || (count !== null && /[0-9]/.test(input[idx]))) {
    const digit = parseInt(input[idx], 10);
    count = (count ?? 0) * 10 + digit;
    idx++;
  }
  
  if (idx >= input.length) {
    // Just have count so far, wait for more
    return { complete: false, state: { ...newState, count } };
  }
  
  const remaining = input.slice(idx);
  const firstChar = remaining[0];
  
  // Check for operator
  if (OPERATORS.includes(firstChar) && !state.pendingOperator) {
    // In visual mode, operators apply directly to the selection
    if (options.inVisualMode && remaining.length === 1) {
      return {
        complete: true,
        command: {
          type: "action",
          name: firstChar,
          count: count ?? 1,
        },
        state: createVimState(),
      };
    }
    
    if (remaining.length === 1) {
      // Wait for motion or double operator (dd, cc, yy)
      return {
        complete: false,
        state: { ...newState, count, pendingOperator: firstChar as Operator },
      };
    }
    
    const secondChar = remaining[1];
    
    // Check for double operator (dd, cc, yy)
    if (secondChar === firstChar) {
      return {
        complete: true,
        command: {
          type: "operator",
          name: `${firstChar}${firstChar}`,
          count: count ?? 1,
          operator: firstChar as Operator,
        },
        state: createVimState(),
      };
    }
    
    // Check for operator + motion
    const motionResult = parseMotion(remaining.slice(1), newState, count ?? 1);
    if (motionResult.complete && motionResult.command) {
      // Get motion - either from static table or create dynamic find motion
      let motion = motions[motionResult.command.name];
      if (!motion && motionResult.command.name.length === 2) {
        // Handle find motions (fa, Fa, ta, Ta)
        const findType = motionResult.command.name[0];
        const findChar = motionResult.command.name[1];
        if ("fFtT".includes(findType)) {
          const forward = "ft".includes(findType);
          const inclusive = "fF".includes(findType);
          motion = {
            name: `find ${findChar}`,
            target: (buffer, cursor, findCount) => {
              let pos = cursor;
              for (let i = 0; i < findCount; i++) {
                const result = findCharOnLine(buffer, pos, findChar, forward, inclusive);
                if (!result) break;
                pos = result;
              }
              return pos;
            },
            inclusive: inclusive,
          };
        }
      }
      
      if (motion) {
        return {
          complete: true,
          command: {
            type: "operator",
            name: `${firstChar}${motionResult.command.name}`,
            count: count ?? 1,
            operator: firstChar as Operator,
            motion,
          },
          state: motionResult.state,
        };
      }
    }
    
    // Check for operator + text object
    if (TEXT_OBJECT_PREFIXES.includes(secondChar)) {
      const textObjResult = parseTextObject(remaining.slice(1), newState, count ?? 1);
      if (textObjResult.complete && textObjResult.command) {
        return {
          complete: true,
          command: {
            type: "operator",
            name: `${firstChar}${remaining.slice(1)}`,
            count: count ?? 1,
            operator: firstChar as Operator,
            textObject: textObjects[textObjResult.command.name.slice(1)],
          },
          state: createVimState(),
        };
      }
      if (!textObjResult.complete) {
        return {
          complete: false,
          state: { ...newState, count, pendingOperator: firstChar as Operator },
        };
      }
    }
    
    return {
      complete: false,
      state: { ...newState, count, pendingOperator: firstChar as Operator },
    };
  }
  
  // If we have a pending operator, look for motion or text object
  if (state.pendingOperator) {
    // Check for text object
    if (TEXT_OBJECT_PREFIXES.includes(firstChar)) {
      const textObjResult = parseTextObject(remaining, newState, count ?? 1);
      if (textObjResult.complete && textObjResult.command) {
        return {
          complete: true,
          command: {
            type: "operator",
            name: `${state.pendingOperator}${remaining}`,
            count: count ?? 1,
            operator: state.pendingOperator,
            textObject: textObjects[textObjResult.command.name.slice(1)],
          },
          state: createVimState(),
        };
      }
      return {
        complete: false,
        state: newState,
      };
    }
    
    // Check for motion
    const motionResult = parseMotion(remaining, newState, count ?? 1);
    if (motionResult.complete && motionResult.command) {
      return {
        complete: true,
        command: {
          type: "operator",
          name: `${state.pendingOperator}${motionResult.command.name}`,
          count: count ?? 1,
          operator: state.pendingOperator,
          motion: motions[motionResult.command.name],
        },
        state: createVimState(),
      };
    }
    
    return {
      complete: false,
      state: newState,
    };
  }
  
  // Try to parse as motion
  const motionResult = parseMotion(remaining, newState, count ?? 1);
  if (motionResult.complete) {
    return motionResult;
  }
  
  // Try to parse as action
  const actionResult = parseAction(remaining, newState, count ?? 1);
  if (actionResult.complete) {
    return actionResult;
  }
  
  // Unknown or incomplete
  return { complete: false, state: newState };
}

function parseMotion(input: string, state: VimState, count: number): ParseResult {
  // Check for two-char motions first
  if (input.length >= 2) {
    const twoChar = input.slice(0, 2);
    if (motions[twoChar]) {
      return {
        complete: true,
        command: {
          type: "motion",
          name: twoChar,
          count,
        },
        state: createVimState(),
      };
    }
  }
  
  // Single char motions
  const firstChar = input[0];
  if (motions[firstChar]) {
    return {
      complete: true,
      command: {
        type: "motion",
        name: firstChar,
        count,
      },
      state: createVimState(),
    };
  }
  
  // f, F, t, T motions need a character argument
  if ("fFtT".includes(firstChar)) {
    if (input.length < 2) {
      return { complete: false, state };
    }
    const targetChar = input[1];
    return {
      complete: true,
      command: {
        type: "motion",
        name: `${firstChar}${targetChar}`,
        count,
      },
      state: {
        ...createVimState(),
        lastFindChar: targetChar,
        lastFindForward: "ft".includes(firstChar),
        lastFindInclusive: "fF".includes(firstChar),
      },
    };
  }
  
  // ; and , repeat last find
  if (firstChar === ";" || firstChar === ",") {
    if (!state.lastFindChar) {
      return {
        complete: true,
        command: { type: "motion", name: firstChar, count },
        state,
      };
    }
    return {
      complete: true,
      command: {
        type: "motion",
        name: firstChar,
        count,
      },
      state,
    };
  }
  
  // g prefix motions
  if (firstChar === "g" && input.length >= 2) {
    const secondChar = input[1];
    if (secondChar === "g") {
      return {
        complete: true,
        command: {
          type: "motion",
          name: "gg",
          count,
        },
        state: createVimState(),
      };
    }
  } else if (firstChar === "g") {
    return { complete: false, state };
  }
  
  // z prefix scroll commands
  if (firstChar === "z" && input.length >= 2) {
    const secondChar = input[1];
    if ("ztzbzz".includes(`z${secondChar}`)) {
      return {
        complete: true,
        command: {
          type: "action",
          name: `z${secondChar}`,
          count,
        },
        state: createVimState(),
      };
    }
  } else if (firstChar === "z") {
    return { complete: false, state };
  }
  
  return { complete: false, state };
}

function parseTextObject(input: string, state: VimState, count: number): ParseResult {
  if (input.length < 2) {
    return { complete: false, state };
  }
  
  const prefix = input[0]; // 'i' or 'a'
  const objChar = input[1];
  
  if (!TEXT_OBJECT_PREFIXES.includes(prefix)) {
    return { complete: false, state };
  }
  
  if (textObjects[objChar]) {
    return {
      complete: true,
      command: {
        type: "text-object",
        name: `${prefix}${objChar}`,
        count,
      },
      state: createVimState(),
    };
  }
  
  return { complete: false, state };
}

function parseAction(input: string, state: VimState, count: number): ParseResult {
  const firstChar = input[0];
  
  // Simple single-character actions
  const simpleActions = [
    "i", "I", "a", "A", "o", "O",  // Insert mode entries
    "x", "X", "s", "S",            // Delete/change chars
    "r",                            // Replace char (needs argument)
    "J",                            // Join lines
    "u",                            // Undo
    "p", "P",                       // Paste
    "~",                            // Toggle case
    "D", "C",                       // Delete/change to end of line
    ".",                            // Repeat
    "v", "V",                       // Visual mode
    "n", "N",                       // Search next/previous
    "*", "#",                       // Search word under cursor
  ];
  
  if (simpleActions.includes(firstChar)) {
    // 'r' needs a replacement character
    if (firstChar === "r") {
      if (input.length < 2) {
        return { complete: false, state };
      }
      return {
        complete: true,
        command: {
          type: "action",
          name: `r${input[1]}`,
          count,
        },
        state: createVimState(),
      };
    }
    
    return {
      complete: true,
      command: {
        type: "action",
        name: firstChar,
        count,
      },
      state: createVimState(),
    };
  }
  
  // Ctrl-r for redo
  if (firstChar === "\x12") { // Ctrl-R
    return {
      complete: true,
      command: {
        type: "action",
        name: "C-r",
        count,
      },
      state: createVimState(),
    };
  }
  
  return { complete: false, state };
}

// ============================================================================
// Search Functions
// ============================================================================

/**
 * Find all matches of a pattern in the buffer.
 * Returns positions sorted by line/column.
 */
export function findAllMatches(buffer: TextBuffer, pattern: string): Position[] {
  if (!pattern) return [];
  
  const matches: Position[] = [];
  const lineCount = getLineCount(buffer);
  
  try {
    // Escape special regex chars if not a regex pattern
    const escapedPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedPattern, 'gi');
    
    for (let line = 0; line < lineCount; line++) {
      const lineText = getLine(buffer, line);
      let match;
      regex.lastIndex = 0;
      while ((match = regex.exec(lineText)) !== null) {
        matches.push({ line, column: match.index });
        // Prevent infinite loop on zero-width matches
        if (match.index === regex.lastIndex) {
          regex.lastIndex++;
        }
      }
    }
  } catch {
    // Invalid regex, return empty
    return [];
  }
  
  return matches;
}

/**
 * Find the next match after a given position.
 */
export function findNextMatch(
  matches: Position[],
  cursor: Position,
  forward: boolean
): { position: Position; index: number } | null {
  if (matches.length === 0) return null;
  
  if (forward) {
    // Find first match after cursor
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (m.line > cursor.line || (m.line === cursor.line && m.column > cursor.column)) {
        return { position: m, index: i };
      }
    }
    // Wrap to beginning
    return { position: matches[0], index: 0 };
  } else {
    // Find last match before cursor
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      if (m.line < cursor.line || (m.line === cursor.line && m.column < cursor.column)) {
        return { position: m, index: i };
      }
    }
    // Wrap to end
    return { position: matches[matches.length - 1], index: matches.length - 1 };
  }
}

/**
 * Get the word under the cursor for * and # commands.
 */
export function getWordUnderCursor(buffer: TextBuffer, cursor: Position): string | null {
  const result = getWordUnderCursorWithBounds(buffer, cursor);
  return result?.word ?? null;
}

/**
 * Get the word under the cursor with its boundary positions.
 * Returns the word and the start/end column positions.
 */
export function getWordUnderCursorWithBounds(
  buffer: TextBuffer,
  cursor: Position
): { word: string; start: number; end: number } | null {
  const line = getLine(buffer, cursor.line);
  if (cursor.column >= line.length) return null;
  
  const char = line[cursor.column];
  if (!isWordChar(char)) return null;
  
  // Find word boundaries
  let start = cursor.column;
  while (start > 0 && isWordChar(line[start - 1])) {
    start--;
  }
  
  let end = cursor.column;
  while (end < line.length - 1 && isWordChar(line[end + 1])) {
    end++;
  }
  
  return { word: line.slice(start, end + 1), start, end };
}

// ============================================================================
// Exports for testing
// ============================================================================

export {
  isWordChar,
  isWORDChar,
  isWhitespace,
  findNextWordStart,
  findWordEnd,
  findPrevWordStart,
  findCharOnLine,
  findFirstNonWhitespace,
  findWordBounds,
  findPairBounds,
  findQuoteBounds,
};
