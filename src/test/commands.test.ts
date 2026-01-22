import { describe, it, expect } from "vitest";
import {
  createExtendedState,
  executeCommand,
  executeVisualOperator,
  ExtendedEditorState,
} from "../editor/commands";
import { parseInput, findAllMatches, findNextMatch, getWordUnderCursor } from "../editor/vim";
import { getText, createBuffer } from "../editor/buffer";

function stateWithContent(content: string, line = 0, column = 0): ExtendedEditorState {
  const state = createExtendedState(content);
  return {
    ...state,
    cursor: { line, column },
  };
}

function executeVimCommand(state: ExtendedEditorState, input: string): ExtendedEditorState {
  const parseResult = parseInput(input, state.vim, state.mode);
  if (!parseResult.complete || !parseResult.command) {
    throw new Error(`Failed to parse command: ${input}`);
  }
  const execResult = executeCommand(state, parseResult.command);
  // Merge vim states: execution state takes priority, but parse state wins for find char info
  return {
    ...execResult.state,
    vim: {
      ...execResult.state.vim,
      // Parser updates these fields for f/F/t/T commands
      lastFindChar: parseResult.state.lastFindChar,
      lastFindForward: parseResult.state.lastFindForward,
      lastFindInclusive: parseResult.state.lastFindInclusive,
    },
  };
}

describe("command execution", () => {
  describe("motions", () => {
    it("h moves cursor left", () => {
      const state = stateWithContent("hello", 0, 3);
      const result = executeVimCommand(state, "h");
      expect(result.cursor.column).toBe(2);
    });

    it("l moves cursor right", () => {
      const state = stateWithContent("hello", 0, 0);
      const result = executeVimCommand(state, "l");
      expect(result.cursor.column).toBe(1);
    });

    it("j moves cursor down", () => {
      const state = stateWithContent("hello\nworld", 0, 0);
      const result = executeVimCommand(state, "j");
      expect(result.cursor.line).toBe(1);
    });

    it("k moves cursor up", () => {
      const state = stateWithContent("hello\nworld", 1, 0);
      const result = executeVimCommand(state, "k");
      expect(result.cursor.line).toBe(0);
    });

    it("w moves to next word", () => {
      const state = stateWithContent("hello world", 0, 0);
      const result = executeVimCommand(state, "w");
      expect(result.cursor.column).toBe(6);
    });

    it("b moves to previous word", () => {
      const state = stateWithContent("hello world", 0, 8);
      const result = executeVimCommand(state, "b");
      expect(result.cursor.column).toBe(6);
    });

    it("e moves to end of word", () => {
      const state = stateWithContent("hello world", 0, 0);
      const result = executeVimCommand(state, "e");
      expect(result.cursor.column).toBe(4);
    });

    it("0 moves to start of line", () => {
      const state = stateWithContent("hello", 0, 3);
      const result = executeVimCommand(state, "0");
      expect(result.cursor.column).toBe(0);
    });

    it("$ moves to end of line", () => {
      const state = stateWithContent("hello", 0, 0);
      const result = executeVimCommand(state, "$");
      expect(result.cursor.column).toBe(4);
    });

    it("^ moves to first non-blank", () => {
      const state = stateWithContent("  hello", 0, 0);
      const result = executeVimCommand(state, "^");
      expect(result.cursor.column).toBe(2);
    });

    it("gg moves to first line", () => {
      const state = stateWithContent("a\nb\nc", 2, 0);
      const result = executeVimCommand(state, "gg");
      expect(result.cursor.line).toBe(0);
    });

    it("G moves to last line", () => {
      const state = stateWithContent("a\nb\nc", 0, 0);
      const result = executeVimCommand(state, "G");
      expect(result.cursor.line).toBe(2);
    });

    it("5j moves down 5 lines", () => {
      const state = stateWithContent("a\nb\nc\nd\ne\nf\ng", 0, 0);
      const result = executeVimCommand(state, "5j");
      expect(result.cursor.line).toBe(5);
    });
  });

  describe("delete operators", () => {
    it("x deletes character under cursor", () => {
      const state = stateWithContent("hello", 0, 0);
      const result = executeVimCommand(state, "x");
      expect(getText(result.buffer)).toBe("ello");
    });

    it("3x deletes 3 characters", () => {
      const state = stateWithContent("hello", 0, 0);
      const result = executeVimCommand(state, "3x");
      expect(getText(result.buffer)).toBe("lo");
    });

    it("dd deletes current line", () => {
      const state = stateWithContent("hello\nworld\n!", 1, 0);
      const result = executeVimCommand(state, "dd");
      expect(getText(result.buffer)).toBe("hello\n!");
    });

    it("dw deletes to next word", () => {
      const state = stateWithContent("hello world", 0, 0);
      const result = executeVimCommand(state, "dw");
      expect(getText(result.buffer)).toBe("world");
    });

    it("d$ deletes to end of line", () => {
      const state = stateWithContent("hello world", 0, 5);
      const result = executeVimCommand(state, "d$");
      expect(getText(result.buffer)).toBe("hello");
    });

    it("D deletes to end of line", () => {
      const state = stateWithContent("hello world", 0, 5);
      const result = executeVimCommand(state, "D");
      expect(getText(result.buffer)).toBe("hello");
    });

    it("diw deletes inner word", () => {
      const state = stateWithContent("hello world", 0, 7);
      const result = executeVimCommand(state, "diw");
      expect(getText(result.buffer)).toBe("hello ");
    });
  });

  describe("change operators", () => {
    it("cc changes line and enters insert mode", () => {
      const state = stateWithContent("hello", 0, 0);
      const result = executeVimCommand(state, "cc");
      expect(getText(result.buffer)).toBe("");
      expect(result.mode).toBe("insert");
    });

    it("cw changes word", () => {
      const state = stateWithContent("hello world", 0, 0);
      const result = executeVimCommand(state, "cw");
      expect(getText(result.buffer)).toBe("world");
      expect(result.mode).toBe("insert");
    });

    it("C changes to end of line", () => {
      const state = stateWithContent("hello world", 0, 5);
      const result = executeVimCommand(state, "C");
      expect(getText(result.buffer)).toBe("hello");
      expect(result.mode).toBe("insert");
    });

    it("s substitutes character", () => {
      const state = stateWithContent("hello", 0, 0);
      const result = executeVimCommand(state, "s");
      expect(getText(result.buffer)).toBe("ello");
      expect(result.mode).toBe("insert");
    });

    it("S substitutes line", () => {
      const state = stateWithContent("hello", 0, 2);
      const result = executeVimCommand(state, "S");
      expect(getText(result.buffer)).toBe("");
      expect(result.mode).toBe("insert");
    });
  });

  describe("yank and paste", () => {
    it("yy yanks line and p pastes below", () => {
      let state = stateWithContent("hello\nworld", 0, 0);
      state = executeVimCommand(state, "yy");
      state = executeVimCommand(state, "p");
      expect(getText(state.buffer)).toBe("hello\nhello\nworld");
    });

    it("yw yanks word and p pastes", () => {
      let state = stateWithContent("hello world", 0, 0);
      state = executeVimCommand(state, "yw");
      // yw yanks "hello " (word + following space until next word)
      // Move to end
      state = executeVimCommand(state, "$");
      state = executeVimCommand(state, "p");
      // Pasting "hello " after the 'd' in "world"
      expect(getText(state.buffer)).toBe("hello worldhello ");
    });

    it("dd then p moves line down", () => {
      let state = stateWithContent("a\nb\nc", 0, 0);
      state = executeVimCommand(state, "dd");
      state = executeVimCommand(state, "p");
      expect(getText(state.buffer)).toBe("b\na\nc");
    });

    it("P pastes before cursor", () => {
      let state = stateWithContent("hello\nworld", 0, 0);
      state = executeVimCommand(state, "yy");
      state = executeVimCommand(state, "j");
      state = executeVimCommand(state, "P");
      expect(getText(state.buffer)).toBe("hello\nhello\nworld");
    });
  });

  describe("indent and outdent", () => {
    it(">> indents current line", () => {
      const state = stateWithContent("hello\nworld", 0, 0);
      const result = executeVimCommand(state, ">>");
      expect(getText(result.buffer)).toBe("    hello\nworld");
      // Cursor should move to first non-whitespace
      expect(result.cursor.column).toBe(4);
    });

    it("<< outdents current line", () => {
      const state = stateWithContent("    hello\nworld", 0, 4);
      const result = executeVimCommand(state, "<<");
      expect(getText(result.buffer)).toBe("hello\nworld");
      expect(result.cursor.column).toBe(0);
    });

    it("2>> indents two lines", () => {
      const state = stateWithContent("hello\nworld\nfoo", 0, 0);
      const result = executeVimCommand(state, "2>>");
      expect(getText(result.buffer)).toBe("    hello\n    world\nfoo");
    });

    it("2<< outdents two lines", () => {
      const state = stateWithContent("    hello\n    world\nfoo", 0, 4);
      const result = executeVimCommand(state, "2<<");
      expect(getText(result.buffer)).toBe("hello\nworld\nfoo");
    });

    it(">j indents current and next line", () => {
      const state = stateWithContent("hello\nworld\nfoo", 0, 0);
      const result = executeVimCommand(state, ">j");
      expect(getText(result.buffer)).toBe("    hello\n    world\nfoo");
    });

    it("<j outdents current and next line", () => {
      const state = stateWithContent("    hello\n    world\nfoo", 0, 4);
      const result = executeVimCommand(state, "<j");
      expect(getText(result.buffer)).toBe("hello\nworld\nfoo");
    });

    it("<< does nothing when line has no indent", () => {
      const state = stateWithContent("hello\nworld", 0, 0);
      const result = executeVimCommand(state, "<<");
      expect(getText(result.buffer)).toBe("hello\nworld");
    });
  });

  describe("insert mode entries", () => {
    it("i enters insert mode", () => {
      const state = stateWithContent("hello", 0, 2);
      const result = executeVimCommand(state, "i");
      expect(result.mode).toBe("insert");
      expect(result.cursor.column).toBe(2);
    });

    it("I enters insert mode at first non-blank", () => {
      const state = stateWithContent("  hello", 0, 4);
      const result = executeVimCommand(state, "I");
      expect(result.mode).toBe("insert");
      expect(result.cursor.column).toBe(2);
    });

    it("a enters insert mode after cursor", () => {
      const state = stateWithContent("hello", 0, 2);
      const result = executeVimCommand(state, "a");
      expect(result.mode).toBe("insert");
      expect(result.cursor.column).toBe(3);
    });

    it("A enters insert mode at end of line", () => {
      const state = stateWithContent("hello", 0, 0);
      const result = executeVimCommand(state, "A");
      expect(result.mode).toBe("insert");
      expect(result.cursor.column).toBe(5);
    });

    it("o opens line below", () => {
      const state = stateWithContent("hello\nworld", 0, 0);
      const result = executeVimCommand(state, "o");
      expect(getText(result.buffer)).toBe("hello\n\nworld");
      expect(result.cursor.line).toBe(1);
      expect(result.mode).toBe("insert");
    });

    it("O opens line above", () => {
      const state = stateWithContent("hello\nworld", 1, 0);
      const result = executeVimCommand(state, "O");
      expect(getText(result.buffer)).toBe("hello\n\nworld");
      expect(result.cursor.line).toBe(1);
      expect(result.mode).toBe("insert");
    });
  });

  describe("other commands", () => {
    it("J joins lines", () => {
      const state = stateWithContent("hello\nworld", 0, 0);
      const result = executeVimCommand(state, "J");
      expect(getText(result.buffer)).toBe("hello world");
    });

    it("r replaces character", () => {
      const state = stateWithContent("hello", 0, 0);
      const result = executeVimCommand(state, "rx");
      expect(getText(result.buffer)).toBe("xello");
    });

    it("~ toggles case", () => {
      const state = stateWithContent("Hello", 0, 0);
      const result = executeVimCommand(state, "~");
      expect(getText(result.buffer)).toBe("hello");
    });

    it("3~ toggles case of 3 chars", () => {
      const state = stateWithContent("Hello", 0, 0);
      const result = executeVimCommand(state, "3~");
      expect(getText(result.buffer)).toBe("hELlo");
    });
  });

  describe("undo/redo", () => {
    it("u undoes last change", () => {
      let state = stateWithContent("hello", 0, 0);
      state = executeVimCommand(state, "x");
      expect(getText(state.buffer)).toBe("ello");
      state = executeVimCommand(state, "u");
      expect(getText(state.buffer)).toBe("hello");
    });

    it("multiple undos work", () => {
      let state = stateWithContent("hello", 0, 0);
      state = executeVimCommand(state, "x");
      state = executeVimCommand(state, "x");
      expect(getText(state.buffer)).toBe("llo");
      state = executeVimCommand(state, "u");
      expect(getText(state.buffer)).toBe("ello");
      state = executeVimCommand(state, "u");
      expect(getText(state.buffer)).toBe("hello");
    });
  });

  describe("text objects", () => {
    it("di( deletes inside parentheses", () => {
      const state = stateWithContent("foo(bar, baz)qux", 0, 5);
      const result = executeVimCommand(state, "di(");
      expect(getText(result.buffer)).toBe("foo()qux");
    });

    it("da( deletes including parentheses", () => {
      const state = stateWithContent("foo(bar, baz)qux", 0, 5);
      const result = executeVimCommand(state, "da(");
      expect(getText(result.buffer)).toBe("fooqux");
    });

    it("ci\" changes inside quotes", () => {
      const state = stateWithContent('say "hello" now', 0, 6);
      const result = executeVimCommand(state, 'ci"');
      expect(getText(result.buffer)).toBe('say "" now');
      expect(result.mode).toBe("insert");
    });

    it("diw deletes inner word", () => {
      const state = stateWithContent("hello world test", 0, 8);
      const result = executeVimCommand(state, "diw");
      expect(getText(result.buffer)).toBe("hello  test");
    });

    it("daw deletes around word (with whitespace)", () => {
      const state = stateWithContent("hello world test", 0, 8);
      const result = executeVimCommand(state, "daw");
      expect(getText(result.buffer)).toBe("hello test");
    });
  });

  describe("find character motions", () => {
    it("f finds character forward", () => {
      const state = stateWithContent("hello world", 0, 0);
      const result = executeVimCommand(state, "fo");
      expect(result.cursor.column).toBe(4);
    });

    it("t finds character forward (exclusive)", () => {
      const state = stateWithContent("hello world", 0, 0);
      const result = executeVimCommand(state, "to");
      expect(result.cursor.column).toBe(3);
    });

    it("F finds character backward", () => {
      const state = stateWithContent("hello world", 0, 8);
      const result = executeVimCommand(state, "Fl");
      expect(result.cursor.column).toBe(3);
    });

    it("; repeats find", () => {
      let state = stateWithContent("hello world woolly", 0, 0);
      state = executeVimCommand(state, "fo");
      expect(state.cursor.column).toBe(4);
      state = executeVimCommand(state, ";");
      expect(state.cursor.column).toBe(7);
    });

    it(", repeats find in opposite direction", () => {
      let state = stateWithContent("hello world woolly", 0, 0);
      state = executeVimCommand(state, "fo");
      state = executeVimCommand(state, ";");
      expect(state.cursor.column).toBe(7);
      state = executeVimCommand(state, ",");
      expect(state.cursor.column).toBe(4);
    });

    it("df deletes through found character", () => {
      const state = stateWithContent("hello world", 0, 0);
      const result = executeVimCommand(state, "dfo");
      expect(getText(result.buffer)).toBe(" world");
    });
  });

  describe("visual mode", () => {
    it("v enters character visual mode", () => {
      const state = stateWithContent("hello world", 0, 3);
      const result = executeVimCommand(state, "v");
      expect(result.visualMode).toBe("char");
      expect(result.visualAnchor).toEqual({ line: 0, column: 3 });
    });

    it("V enters line visual mode", () => {
      const state = stateWithContent("hello\nworld", 0, 0);
      const result = executeVimCommand(state, "V");
      expect(result.visualMode).toBe("line");
      expect(result.visualAnchor).toEqual({ line: 0, column: 0 });
    });

    it("d in visual mode deletes selection", () => {
      let state = stateWithContent("hello world", 0, 0);
      state = executeVimCommand(state, "v");
      // Move to column 4 (selecting "hello" - columns 0-4 inclusive)
      state = executeVimCommand(state, "4l");
      state = executeVisualOperator(state, "d").state;
      expect(getText(state.buffer)).toBe(" world");
      expect(state.visualMode).toBeNull();
    });

    it("y in visual mode yanks selection", () => {
      let state = stateWithContent("hello world", 0, 0);
      state = executeVimCommand(state, "v");
      state = executeVimCommand(state, "4l");
      state = executeVisualOperator(state, "y").state;
      expect(state.vim.registers['"'].text).toBe("hello");
      expect(state.visualMode).toBeNull();
    });

    it("V + d deletes entire line", () => {
      let state = stateWithContent("hello\nworld\n!", 1, 0);
      state = executeVimCommand(state, "V");
      state = executeVisualOperator(state, "d").state;
      expect(getText(state.buffer)).toBe("hello\n!");
    });

    it("visual mode with motions extends selection", () => {
      let state = stateWithContent("hello world test", 0, 0);
      state = executeVimCommand(state, "v");
      state = executeVimCommand(state, "w"); // move to "world"
      // Selection should now be from 0 to 6
      expect(state.cursor.column).toBe(6);
      expect(state.visualAnchor).toEqual({ line: 0, column: 0 });
    });

    it("~ in visual mode toggles case", () => {
      let state = stateWithContent("Hello World", 0, 0);
      state = executeVimCommand(state, "v");
      state = executeVimCommand(state, "4l");
      state = executeVisualOperator(state, "~").state;
      expect(getText(state.buffer)).toBe("hELLO World");
    });
  });

  describe("search", () => {
    it("findAllMatches finds all occurrences", () => {
      const buffer = createBuffer("hello world hello");
      const matches = findAllMatches(buffer, "hello");
      expect(matches.length).toBe(2);
      expect(matches[0]).toEqual({ line: 0, column: 0 });
      expect(matches[1]).toEqual({ line: 0, column: 12 });
    });

    it("findAllMatches works across lines", () => {
      const buffer = createBuffer("hello\nworld\nhello");
      const matches = findAllMatches(buffer, "hello");
      expect(matches.length).toBe(2);
      expect(matches[0]).toEqual({ line: 0, column: 0 });
      expect(matches[1]).toEqual({ line: 2, column: 0 });
    });

    it("findNextMatch finds forward match", () => {
      const buffer = createBuffer("hello world hello");
      const matches = findAllMatches(buffer, "hello");
      const result = findNextMatch(matches, { line: 0, column: 1 }, true);
      expect(result?.position).toEqual({ line: 0, column: 12 });
    });

    it("findNextMatch wraps around", () => {
      const buffer = createBuffer("hello world hello");
      const matches = findAllMatches(buffer, "hello");
      const result = findNextMatch(matches, { line: 0, column: 15 }, true);
      expect(result?.position).toEqual({ line: 0, column: 0 });
    });

    it("findNextMatch finds backward match", () => {
      const buffer = createBuffer("hello world hello");
      const matches = findAllMatches(buffer, "hello");
      const result = findNextMatch(matches, { line: 0, column: 15 }, false);
      expect(result?.position).toEqual({ line: 0, column: 12 });
    });

    it("getWordUnderCursor returns word", () => {
      const buffer = createBuffer("hello world");
      const word = getWordUnderCursor(buffer, { line: 0, column: 7 });
      expect(word).toBe("world");
    });

    it("getWordUnderCursor returns null on whitespace", () => {
      const buffer = createBuffer("hello world");
      const word = getWordUnderCursor(buffer, { line: 0, column: 5 });
      expect(word).toBeNull();
    });

    it("* searches for word under cursor", () => {
      let state = stateWithContent("hello world hello", 0, 0);
      state = executeVimCommand(state, "*");
      expect(state.vim.searchPattern).toContain("hello");
      expect(state.vim.searchMatches.length).toBe(2);
      // Should move to next occurrence
      expect(state.cursor.column).toBe(12);
    });

    it("# searches backward for word under cursor", () => {
      let state = stateWithContent("hello world hello", 0, 14);
      state = executeVimCommand(state, "#");
      expect(state.vim.searchPattern).toContain("hello");
      // Should move to previous occurrence
      expect(state.cursor.column).toBe(0);
    });

    it("n repeats search forward", () => {
      let state = stateWithContent("hello world hello again hello", 0, 0);
      state = executeVimCommand(state, "*");
      expect(state.cursor.column).toBe(12);
      state = executeVimCommand(state, "n");
      expect(state.cursor.column).toBe(24);
    });

    it("N repeats search backward", () => {
      // Text: "hello world hello again hello"
      // Matches at columns: 0, 12, 24
      let state = stateWithContent("hello world hello again hello", 0, 14);
      // * from column 14 (inside word at 12) -> goes to column 24
      state = executeVimCommand(state, "*");
      expect(state.cursor.column).toBe(24);
      // N (backward) from column 24 -> goes to column 12
      state = executeVimCommand(state, "N");
      expect(state.cursor.column).toBe(12);
      // Another N -> goes to column 0
      state = executeVimCommand(state, "N");
      expect(state.cursor.column).toBe(0);
    });
  });
});
