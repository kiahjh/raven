/**
 * A text buffer that stores content as an array of lines.
 * Simple and efficient for small-medium files; can be swapped
 * for a rope/piece table later for large file performance.
 */

export interface Position {
  line: number;
  column: number;
}

export interface TextBuffer {
  lines: string[];
}

export function createBuffer(content: string = ""): TextBuffer {
  const lines = content.length === 0 ? [""] : content.split("\n");
  return { lines };
}

export function getLineCount(buffer: TextBuffer): number {
  return buffer.lines.length;
}

export function getLine(buffer: TextBuffer, lineIndex: number): string {
  if (lineIndex < 0 || lineIndex >= buffer.lines.length) {
    return "";
  }
  return buffer.lines[lineIndex];
}

export function getLineLength(buffer: TextBuffer, lineIndex: number): number {
  return getLine(buffer, lineIndex).length;
}

export function getText(buffer: TextBuffer): string {
  return buffer.lines.join("\n");
}

export function clampPosition(buffer: TextBuffer, pos: Position): Position {
  const lineCount = getLineCount(buffer);
  
  if (lineCount === 0) {
    return { line: 0, column: 0 };
  }
  
  const line = Math.max(0, Math.min(pos.line, lineCount - 1));
  const lineLength = getLineLength(buffer, line);
  const column = Math.max(0, Math.min(pos.column, lineLength));
  
  return { line, column };
}

/**
 * Insert text at position. Returns new buffer (immutable).
 */
export function insertText(
  buffer: TextBuffer,
  pos: Position,
  text: string
): TextBuffer {
  const clampedPos = clampPosition(buffer, pos);
  const { line, column } = clampedPos;
  
  const currentLine = getLine(buffer, line);
  const before = currentLine.slice(0, column);
  const after = currentLine.slice(column);
  
  const insertedLines = text.split("\n");
  const newLines = [...buffer.lines];
  
  if (insertedLines.length === 1) {
    // Single line insert
    newLines[line] = before + insertedLines[0] + after;
  } else {
    // Multi-line insert
    const firstLine = before + insertedLines[0];
    const lastLine = insertedLines[insertedLines.length - 1] + after;
    const middleLines = insertedLines.slice(1, -1);
    
    newLines.splice(line, 1, firstLine, ...middleLines, lastLine);
  }
  
  return { lines: newLines };
}

/**
 * Delete a range of text. Returns new buffer (immutable).
 */
export function deleteRange(
  buffer: TextBuffer,
  start: Position,
  end: Position
): TextBuffer {
  const clampedStart = clampPosition(buffer, start);
  const clampedEnd = clampPosition(buffer, end);
  
  // Ensure start is before end
  const [from, to] = comparePositions(clampedStart, clampedEnd) <= 0
    ? [clampedStart, clampedEnd]
    : [clampedEnd, clampedStart];
  
  const startLine = getLine(buffer, from.line);
  const endLine = getLine(buffer, to.line);
  
  const before = startLine.slice(0, from.column);
  const after = endLine.slice(to.column);
  
  const newLines = [...buffer.lines];
  newLines.splice(from.line, to.line - from.line + 1, before + after);
  
  return { lines: newLines };
}

/**
 * Delete a single character before position (backspace).
 * Returns new buffer and new cursor position.
 */
export function deleteCharBefore(
  buffer: TextBuffer,
  pos: Position
): { buffer: TextBuffer; position: Position } {
  const clampedPos = clampPosition(buffer, pos);
  
  if (clampedPos.column > 0) {
    // Delete character on same line
    const newPos = { line: clampedPos.line, column: clampedPos.column - 1 };
    return {
      buffer: deleteRange(buffer, newPos, clampedPos),
      position: newPos,
    };
  } else if (clampedPos.line > 0) {
    // At start of line - join with previous line
    const prevLineLength = getLineLength(buffer, clampedPos.line - 1);
    const newPos = { line: clampedPos.line - 1, column: prevLineLength };
    return {
      buffer: deleteRange(buffer, newPos, clampedPos),
      position: newPos,
    };
  }
  
  // At start of buffer - nothing to delete
  return { buffer, position: clampedPos };
}

/**
 * Delete a single character at position (delete key).
 * Returns new buffer (position stays the same).
 */
export function deleteCharAt(buffer: TextBuffer, pos: Position): TextBuffer {
  const clampedPos = clampPosition(buffer, pos);
  const lineLength = getLineLength(buffer, clampedPos.line);
  
  if (clampedPos.column < lineLength) {
    // Delete character on same line
    const endPos = { line: clampedPos.line, column: clampedPos.column + 1 };
    return deleteRange(buffer, clampedPos, endPos);
  } else if (clampedPos.line < getLineCount(buffer) - 1) {
    // At end of line - join with next line
    const endPos = { line: clampedPos.line + 1, column: 0 };
    return deleteRange(buffer, clampedPos, endPos);
  }
  
  // At end of buffer - nothing to delete
  return buffer;
}

/**
 * Compare two positions. Returns:
 * - negative if a < b
 * - 0 if a === b
 * - positive if a > b
 */
export function comparePositions(a: Position, b: Position): number {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.column - b.column;
}

/**
 * Get the leading whitespace (indentation) of a line.
 */
export function getLineIndent(buffer: TextBuffer, lineIndex: number): string {
  const line = getLine(buffer, lineIndex);
  const match = line.match(/^(\s*)/);
  return match ? match[1] : "";
}

/**
 * Compute smart indentation for a new line.
 * - Preserves indentation from the reference line
 * - Adds extra indent after opening brackets { ( [
 * - Reduces indent for closing brackets } ) ]
 */
export function computeSmartIndent(
  buffer: TextBuffer,
  lineIndex: number,
  column: number,
  indentString: string = "    "
): string {
  const line = getLine(buffer, lineIndex);
  const baseIndent = getLineIndent(buffer, lineIndex);
  
  // Get the text before the cursor on this line
  const textBeforeCursor = line.slice(0, column);
  
  // Check if line ends with an opening bracket (before cursor)
  const trimmed = textBeforeCursor.trimEnd();
  const lastChar = trimmed[trimmed.length - 1];
  
  if (lastChar === "{" || lastChar === "(" || lastChar === "[") {
    // Add extra indentation
    return baseIndent + indentString;
  }
  
  // Check if the text after cursor starts with a closing bracket
  const textAfterCursor = line.slice(column).trimStart();
  const firstCharAfter = textAfterCursor[0];
  
  if (firstCharAfter === "}" || firstCharAfter === ")" || firstCharAfter === "]") {
    // Reduce indentation for closing bracket
    if (baseIndent.length >= indentString.length) {
      return baseIndent.slice(indentString.length);
    }
  }
  
  return baseIndent;
}
