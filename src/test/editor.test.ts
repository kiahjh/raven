import { describe, it, expect } from "vitest";
import {
  createEditorState,
  moveCursorLeft,
  moveCursorRight,
  moveCursorUp,
  moveCursorDown,
  moveCursorToLineStart,
  moveCursorToLineEnd,
  moveCursorToFirstLine,
  moveCursorToLastLine,
  enterInsertMode,
  enterInsertModeAfter,
  enterNormalMode,
  clampCursor,
  markDirty,
  markClean,
} from "../editor/editor";

describe("createEditorState", () => {
  it("creates empty editor with cursor at origin", () => {
    const state = createEditorState();
    expect(state.cursor).toEqual({ line: 0, column: 0 });
    expect(state.mode).toBe("normal");
    expect(state.buffer.lines).toEqual([""]);
    expect(state.dirty).toBe(false);
  });

  it("creates editor with content", () => {
    const state = createEditorState("hello\nworld");
    expect(state.buffer.lines).toEqual(["hello", "world"]);
    expect(state.dirty).toBe(false);
  });
});

describe("moveCursorLeft", () => {
  it("moves cursor left", () => {
    let state = createEditorState("hello");
    state = { ...state, cursor: { line: 0, column: 3 } };
    state = moveCursorLeft(state);
    expect(state.cursor.column).toBe(2);
  });

  it("stays at column 0", () => {
    const state = createEditorState("hello");
    const newState = moveCursorLeft(state);
    expect(newState.cursor.column).toBe(0);
  });

  it("clears desired column", () => {
    let state = createEditorState("hello");
    state = { ...state, cursor: { line: 0, column: 3 }, desiredColumn: 5 };
    state = moveCursorLeft(state);
    expect(state.desiredColumn).toBeNull();
  });
});

describe("moveCursorRight", () => {
  it("moves cursor right", () => {
    const state = createEditorState("hello");
    const newState = moveCursorRight(state);
    expect(newState.cursor.column).toBe(1);
  });

  it("stops at last character in normal mode", () => {
    let state = createEditorState("hello");
    state = { ...state, cursor: { line: 0, column: 4 } };
    const newState = moveCursorRight(state);
    expect(newState.cursor.column).toBe(4);
  });

  it("allows cursor past last character in insert mode", () => {
    let state = createEditorState("hello");
    state = { ...state, cursor: { line: 0, column: 4 }, mode: "insert" };
    const newState = moveCursorRight(state);
    expect(newState.cursor.column).toBe(5);
  });
});

describe("moveCursorUp", () => {
  it("moves cursor up", () => {
    let state = createEditorState("hello\nworld");
    state = { ...state, cursor: { line: 1, column: 2 } };
    state = moveCursorUp(state);
    expect(state.cursor).toEqual({ line: 0, column: 2 });
  });

  it("stays at line 0", () => {
    const state = createEditorState("hello\nworld");
    const newState = moveCursorUp(state);
    expect(newState.cursor.line).toBe(0);
  });

  it("clamps to shorter line", () => {
    let state = createEditorState("hi\nhello");
    state = { ...state, cursor: { line: 1, column: 4 } };
    state = moveCursorUp(state);
    expect(state.cursor.column).toBe(1); // "hi" has max column 1 in normal mode
  });

  it("preserves desired column across moves", () => {
    let state = createEditorState("hello\nhi\nworld");
    state = { ...state, cursor: { line: 0, column: 4 } };
    state = moveCursorDown(state); // to "hi", column becomes 1
    expect(state.cursor.column).toBe(1);
    expect(state.desiredColumn).toBe(4);
    state = moveCursorDown(state); // to "world", column goes back to 4
    expect(state.cursor.column).toBe(4);
  });
});

describe("moveCursorDown", () => {
  it("moves cursor down", () => {
    const state = createEditorState("hello\nworld");
    const newState = moveCursorDown(state);
    expect(newState.cursor.line).toBe(1);
  });

  it("stays at last line", () => {
    let state = createEditorState("hello\nworld");
    state = { ...state, cursor: { line: 1, column: 0 } };
    const newState = moveCursorDown(state);
    expect(newState.cursor.line).toBe(1);
  });
});

describe("moveCursorToLineStart", () => {
  it("moves cursor to column 0", () => {
    let state = createEditorState("hello");
    state = { ...state, cursor: { line: 0, column: 3 } };
    state = moveCursorToLineStart(state);
    expect(state.cursor.column).toBe(0);
  });
});

describe("moveCursorToLineEnd", () => {
  it("moves cursor to last character in normal mode", () => {
    const state = createEditorState("hello");
    const newState = moveCursorToLineEnd(state);
    expect(newState.cursor.column).toBe(4);
  });

  it("moves cursor past last character in insert mode", () => {
    let state = createEditorState("hello");
    state = { ...state, mode: "insert" };
    state = moveCursorToLineEnd(state);
    expect(state.cursor.column).toBe(5);
  });

  it("handles empty line", () => {
    const state = createEditorState("");
    const newState = moveCursorToLineEnd(state);
    expect(newState.cursor.column).toBe(0);
  });
});

describe("moveCursorToFirstLine", () => {
  it("moves to first line", () => {
    let state = createEditorState("hello\nworld\n!");
    state = { ...state, cursor: { line: 2, column: 0 } };
    state = moveCursorToFirstLine(state);
    expect(state.cursor.line).toBe(0);
  });

  it("preserves column if possible", () => {
    let state = createEditorState("hello\nworld");
    state = { ...state, cursor: { line: 1, column: 2 } };
    state = moveCursorToFirstLine(state);
    expect(state.cursor.column).toBe(2);
  });
});

describe("moveCursorToLastLine", () => {
  it("moves to last line", () => {
    let state = createEditorState("hello\nworld\n!");
    state = moveCursorToLastLine(state);
    expect(state.cursor.line).toBe(2);
  });
});

describe("enterInsertMode", () => {
  it("changes mode to insert", () => {
    const state = createEditorState("hello");
    const newState = enterInsertMode(state);
    expect(newState.mode).toBe("insert");
  });
});

describe("enterInsertModeAfter", () => {
  it("moves cursor right and enters insert mode", () => {
    let state = createEditorState("hello");
    state = { ...state, cursor: { line: 0, column: 2 } };
    state = enterInsertModeAfter(state);
    expect(state.mode).toBe("insert");
    expect(state.cursor.column).toBe(3);
  });

  it("handles end of line", () => {
    let state = createEditorState("hello");
    state = { ...state, cursor: { line: 0, column: 4 } };
    state = enterInsertModeAfter(state);
    expect(state.cursor.column).toBe(5);
  });
});

describe("enterNormalMode", () => {
  it("changes mode to normal", () => {
    let state = createEditorState("hello");
    state = { ...state, mode: "insert" };
    state = enterNormalMode(state);
    expect(state.mode).toBe("normal");
  });

  it("moves cursor back if past end of line", () => {
    let state = createEditorState("hello");
    state = { ...state, mode: "insert", cursor: { line: 0, column: 5 } };
    state = enterNormalMode(state);
    expect(state.cursor.column).toBe(4);
  });

  it("handles empty line", () => {
    let state = createEditorState("");
    state = { ...state, mode: "insert", cursor: { line: 0, column: 0 } };
    state = enterNormalMode(state);
    expect(state.cursor.column).toBe(0);
  });
});

describe("clampCursor", () => {
  it("clamps cursor after buffer shrinks", () => {
    let state = createEditorState("hello");
    state = { ...state, cursor: { line: 0, column: 10 } };
    state = clampCursor(state);
    expect(state.cursor.column).toBe(4); // normal mode: max is lineLength - 1
  });

  it("clamps to line count", () => {
    let state = createEditorState("hello");
    state = { ...state, cursor: { line: 5, column: 0 } };
    state = clampCursor(state);
    expect(state.cursor.line).toBe(0);
  });

  it("returns same state if no change needed", () => {
    const state = createEditorState("hello");
    const newState = clampCursor(state);
    expect(newState).toBe(state);
  });
});

describe("markDirty", () => {
  it("marks state as dirty", () => {
    const state = createEditorState("hello");
    const newState = markDirty(state);
    expect(newState.dirty).toBe(true);
  });

  it("returns same state if already dirty", () => {
    let state = createEditorState("hello");
    state = markDirty(state);
    const again = markDirty(state);
    expect(again).toBe(state);
  });
});

describe("markClean", () => {
  it("marks state as clean", () => {
    let state = createEditorState("hello");
    state = markDirty(state);
    state = markClean(state);
    expect(state.dirty).toBe(false);
  });

  it("returns same state if already clean", () => {
    const state = createEditorState("hello");
    const again = markClean(state);
    expect(again).toBe(state);
  });
});
