import { describe, it, expect } from "vitest";
import {
  createBuffer,
  getLineCount,
  getLine,
  getLineLength,
  getText,
  clampPosition,
  insertText,
  deleteRange,
  deleteCharBefore,
  deleteCharAt,
  comparePositions,
} from "../editor/buffer";

describe("createBuffer", () => {
  it("creates empty buffer with one empty line", () => {
    const buffer = createBuffer();
    expect(buffer.lines).toEqual([""]);
  });

  it("creates buffer from single line", () => {
    const buffer = createBuffer("hello");
    expect(buffer.lines).toEqual(["hello"]);
  });

  it("creates buffer from multiple lines", () => {
    const buffer = createBuffer("hello\nworld\n!");
    expect(buffer.lines).toEqual(["hello", "world", "!"]);
  });

  it("handles empty string input", () => {
    const buffer = createBuffer("");
    expect(buffer.lines).toEqual([""]);
  });
});

describe("getLineCount", () => {
  it("returns 1 for empty buffer", () => {
    expect(getLineCount(createBuffer())).toBe(1);
  });

  it("returns correct count for multi-line buffer", () => {
    expect(getLineCount(createBuffer("a\nb\nc"))).toBe(3);
  });
});

describe("getLine", () => {
  it("returns line content", () => {
    const buffer = createBuffer("hello\nworld");
    expect(getLine(buffer, 0)).toBe("hello");
    expect(getLine(buffer, 1)).toBe("world");
  });

  it("returns empty string for out of bounds", () => {
    const buffer = createBuffer("hello");
    expect(getLine(buffer, -1)).toBe("");
    expect(getLine(buffer, 1)).toBe("");
  });
});

describe("getLineLength", () => {
  it("returns line length", () => {
    const buffer = createBuffer("hello\nhi");
    expect(getLineLength(buffer, 0)).toBe(5);
    expect(getLineLength(buffer, 1)).toBe(2);
  });

  it("returns 0 for empty line", () => {
    const buffer = createBuffer("");
    expect(getLineLength(buffer, 0)).toBe(0);
  });
});

describe("getText", () => {
  it("returns full content with newlines", () => {
    const buffer = createBuffer("hello\nworld");
    expect(getText(buffer)).toBe("hello\nworld");
  });

  it("returns empty string for empty buffer", () => {
    const buffer = createBuffer();
    expect(getText(buffer)).toBe("");
  });
});

describe("clampPosition", () => {
  it("clamps line to valid range", () => {
    const buffer = createBuffer("hello\nworld");
    expect(clampPosition(buffer, { line: -1, column: 0 })).toEqual({ line: 0, column: 0 });
    expect(clampPosition(buffer, { line: 5, column: 0 })).toEqual({ line: 1, column: 0 });
  });

  it("clamps column to valid range", () => {
    const buffer = createBuffer("hello");
    expect(clampPosition(buffer, { line: 0, column: -1 })).toEqual({ line: 0, column: 0 });
    expect(clampPosition(buffer, { line: 0, column: 10 })).toEqual({ line: 0, column: 5 });
  });

  it("handles empty buffer", () => {
    const buffer = createBuffer();
    expect(clampPosition(buffer, { line: 5, column: 5 })).toEqual({ line: 0, column: 0 });
  });
});

describe("insertText", () => {
  it("inserts text in middle of line", () => {
    const buffer = createBuffer("helo");
    const result = insertText(buffer, { line: 0, column: 2 }, "l");
    expect(getText(result)).toBe("hello");
  });

  it("inserts text at start of line", () => {
    const buffer = createBuffer("world");
    const result = insertText(buffer, { line: 0, column: 0 }, "hello ");
    expect(getText(result)).toBe("hello world");
  });

  it("inserts text at end of line", () => {
    const buffer = createBuffer("hello");
    const result = insertText(buffer, { line: 0, column: 5 }, " world");
    expect(getText(result)).toBe("hello world");
  });

  it("inserts newline", () => {
    const buffer = createBuffer("helloworld");
    const result = insertText(buffer, { line: 0, column: 5 }, "\n");
    expect(result.lines).toEqual(["hello", "world"]);
  });

  it("inserts multiple lines", () => {
    const buffer = createBuffer("start end");
    const result = insertText(buffer, { line: 0, column: 6 }, "middle\nof\n");
    expect(result.lines).toEqual(["start middle", "of", "end"]);
  });

  it("does not mutate original buffer", () => {
    const buffer = createBuffer("hello");
    insertText(buffer, { line: 0, column: 5 }, " world");
    expect(getText(buffer)).toBe("hello");
  });
});

describe("deleteRange", () => {
  it("deletes characters on same line", () => {
    const buffer = createBuffer("hello world");
    const result = deleteRange(buffer, { line: 0, column: 5 }, { line: 0, column: 11 });
    expect(getText(result)).toBe("hello");
  });

  it("deletes across lines", () => {
    const buffer = createBuffer("hello\nworld");
    const result = deleteRange(buffer, { line: 0, column: 3 }, { line: 1, column: 2 });
    expect(getText(result)).toBe("helrld");
  });

  it("handles reversed range", () => {
    const buffer = createBuffer("hello");
    const result = deleteRange(buffer, { line: 0, column: 5 }, { line: 0, column: 0 });
    expect(getText(result)).toBe("");
  });

  it("does not mutate original buffer", () => {
    const buffer = createBuffer("hello");
    deleteRange(buffer, { line: 0, column: 0 }, { line: 0, column: 5 });
    expect(getText(buffer)).toBe("hello");
  });
});

describe("deleteCharBefore", () => {
  it("deletes character before cursor", () => {
    const buffer = createBuffer("hello");
    const { buffer: result, position } = deleteCharBefore(buffer, { line: 0, column: 3 });
    expect(getText(result)).toBe("helo");
    expect(position).toEqual({ line: 0, column: 2 });
  });

  it("joins lines when at start of line", () => {
    const buffer = createBuffer("hello\nworld");
    const { buffer: result, position } = deleteCharBefore(buffer, { line: 1, column: 0 });
    expect(getText(result)).toBe("helloworld");
    expect(position).toEqual({ line: 0, column: 5 });
  });

  it("does nothing at start of buffer", () => {
    const buffer = createBuffer("hello");
    const { buffer: result, position } = deleteCharBefore(buffer, { line: 0, column: 0 });
    expect(getText(result)).toBe("hello");
    expect(position).toEqual({ line: 0, column: 0 });
  });
});

describe("deleteCharAt", () => {
  it("deletes character at cursor", () => {
    const buffer = createBuffer("hello");
    const result = deleteCharAt(buffer, { line: 0, column: 2 });
    expect(getText(result)).toBe("helo");
  });

  it("joins lines when at end of line", () => {
    const buffer = createBuffer("hello\nworld");
    const result = deleteCharAt(buffer, { line: 0, column: 5 });
    expect(getText(result)).toBe("helloworld");
  });

  it("does nothing at end of buffer", () => {
    const buffer = createBuffer("hello");
    const result = deleteCharAt(buffer, { line: 0, column: 5 });
    expect(getText(result)).toBe("hello");
  });
});

describe("comparePositions", () => {
  it("returns negative when a < b", () => {
    expect(comparePositions({ line: 0, column: 0 }, { line: 0, column: 1 })).toBeLessThan(0);
    expect(comparePositions({ line: 0, column: 0 }, { line: 1, column: 0 })).toBeLessThan(0);
  });

  it("returns positive when a > b", () => {
    expect(comparePositions({ line: 0, column: 1 }, { line: 0, column: 0 })).toBeGreaterThan(0);
    expect(comparePositions({ line: 1, column: 0 }, { line: 0, column: 0 })).toBeGreaterThan(0);
  });

  it("returns zero when equal", () => {
    expect(comparePositions({ line: 0, column: 0 }, { line: 0, column: 0 })).toBe(0);
    expect(comparePositions({ line: 5, column: 10 }, { line: 5, column: 10 })).toBe(0);
  });
});
