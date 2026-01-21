import { describe, it, expect } from "vitest";
import {
  createVimState,
  parseInput,
  motions,
  textObjects,
  findNextWordStart,
  findWordEnd,
  findPrevWordStart,
  findCharOnLine,
  findFirstNonWhitespace,
  findWordBounds,
  isWordChar,
  isWORDChar,
} from "../editor/vim";
import { createBuffer } from "../editor/buffer";

describe("vim motions", () => {
  describe("character classification", () => {
    it("identifies word characters", () => {
      expect(isWordChar("a")).toBe(true);
      expect(isWordChar("Z")).toBe(true);
      expect(isWordChar("5")).toBe(true);
      expect(isWordChar("_")).toBe(true);
      expect(isWordChar("-")).toBe(false);
      expect(isWordChar(" ")).toBe(false);
      expect(isWordChar(".")).toBe(false);
    });

    it("identifies WORD characters", () => {
      expect(isWORDChar("a")).toBe(true);
      expect(isWORDChar("-")).toBe(true);
      expect(isWORDChar(".")).toBe(true);
      expect(isWORDChar(" ")).toBe(false);
      expect(isWORDChar("\t")).toBe(false);
    });
  });

  describe("findNextWordStart", () => {
    it("finds next word from start of word", () => {
      const buffer = createBuffer("hello world");
      const result = findNextWordStart(buffer, { line: 0, column: 0 }, false);
      expect(result).toEqual({ line: 0, column: 6 });
    });

    it("finds next word from middle of word", () => {
      const buffer = createBuffer("hello world");
      const result = findNextWordStart(buffer, { line: 0, column: 2 }, false);
      expect(result).toEqual({ line: 0, column: 6 });
    });

    it("handles punctuation as separate words", () => {
      const buffer = createBuffer("hello.world");
      const result = findNextWordStart(buffer, { line: 0, column: 0 }, false);
      expect(result).toEqual({ line: 0, column: 5 }); // stops at .
    });

    it("WORD motion skips punctuation", () => {
      const buffer = createBuffer("hello.world next");
      const result = findNextWordStart(buffer, { line: 0, column: 0 }, true);
      expect(result).toEqual({ line: 0, column: 12 }); // skips to "next"
    });

    it("crosses lines", () => {
      const buffer = createBuffer("hello\nworld");
      const result = findNextWordStart(buffer, { line: 0, column: 0 }, false);
      expect(result).toEqual({ line: 1, column: 0 });
    });
  });

  describe("findWordEnd", () => {
    it("finds end of current word", () => {
      const buffer = createBuffer("hello world");
      const result = findWordEnd(buffer, { line: 0, column: 0 }, false);
      expect(result).toEqual({ line: 0, column: 4 });
    });

    it("finds end of next word from whitespace", () => {
      const buffer = createBuffer("hello world");
      const result = findWordEnd(buffer, { line: 0, column: 5 }, false);
      expect(result).toEqual({ line: 0, column: 10 });
    });
  });

  describe("findPrevWordStart", () => {
    it("finds previous word start", () => {
      const buffer = createBuffer("hello world");
      const result = findPrevWordStart(buffer, { line: 0, column: 8 }, false);
      expect(result).toEqual({ line: 0, column: 6 });
    });

    it("finds previous word from whitespace", () => {
      const buffer = createBuffer("hello world");
      const result = findPrevWordStart(buffer, { line: 0, column: 5 }, false);
      expect(result).toEqual({ line: 0, column: 0 });
    });
  });

  describe("findCharOnLine", () => {
    it("finds character forward", () => {
      const buffer = createBuffer("hello world");
      const result = findCharOnLine(buffer, { line: 0, column: 0 }, "o", true, true);
      expect(result).toEqual({ line: 0, column: 4 });
    });

    it("finds character forward with t (exclusive)", () => {
      const buffer = createBuffer("hello world");
      const result = findCharOnLine(buffer, { line: 0, column: 0 }, "o", true, false);
      expect(result).toEqual({ line: 0, column: 3 });
    });

    it("finds character backward", () => {
      const buffer = createBuffer("hello world");
      const result = findCharOnLine(buffer, { line: 0, column: 8 }, "l", false, true);
      expect(result).toEqual({ line: 0, column: 3 });
    });

    it("returns null if character not found", () => {
      const buffer = createBuffer("hello world");
      const result = findCharOnLine(buffer, { line: 0, column: 0 }, "z", true, true);
      expect(result).toBeNull();
    });
  });

  describe("findFirstNonWhitespace", () => {
    it("finds first non-whitespace", () => {
      const buffer = createBuffer("  hello");
      const result = findFirstNonWhitespace(buffer, 0);
      expect(result).toBe(2);
    });

    it("returns 0 for no leading whitespace", () => {
      const buffer = createBuffer("hello");
      const result = findFirstNonWhitespace(buffer, 0);
      expect(result).toBe(0);
    });

    it("returns 0 for empty line", () => {
      const buffer = createBuffer("");
      const result = findFirstNonWhitespace(buffer, 0);
      expect(result).toBe(0);
    });
  });

  describe("motion functions", () => {
    it("h moves left", () => {
      const buffer = createBuffer("hello");
      const result = motions.h.target(buffer, { line: 0, column: 3 }, 1);
      expect(result.column).toBe(2);
    });

    it("l moves right", () => {
      const buffer = createBuffer("hello");
      const result = motions.l.target(buffer, { line: 0, column: 0 }, 1);
      expect(result.column).toBe(1);
    });

    it("j moves down", () => {
      const buffer = createBuffer("hello\nworld");
      const result = motions.j.target(buffer, { line: 0, column: 0 }, 1);
      expect(result.line).toBe(1);
    });

    it("k moves up", () => {
      const buffer = createBuffer("hello\nworld");
      const result = motions.k.target(buffer, { line: 1, column: 0 }, 1);
      expect(result.line).toBe(0);
    });

    it("0 goes to line start", () => {
      const buffer = createBuffer("hello");
      const result = motions["0"].target(buffer, { line: 0, column: 3 }, 1);
      expect(result.column).toBe(0);
    });

    it("$ goes to line end", () => {
      const buffer = createBuffer("hello");
      const result = motions["$"].target(buffer, { line: 0, column: 0 }, 1);
      expect(result.column).toBe(4);
    });

    it("^ goes to first non-blank", () => {
      const buffer = createBuffer("  hello");
      const result = motions["^"].target(buffer, { line: 0, column: 0 }, 1);
      expect(result.column).toBe(2);
    });

    it("G goes to last line", () => {
      const buffer = createBuffer("a\nb\nc");
      const result = motions.G.target(buffer, { line: 0, column: 0 }, 0);
      expect(result.line).toBe(2);
    });

    it("G goes to last line (count ignored)", () => {
      // Note: In full vim, 2G goes to line 2. Our simplified implementation
      // always goes to the last line. Count handling would need parser changes.
      const buffer = createBuffer("a\nb\nc");
      const result = motions.G.target(buffer, { line: 0, column: 0 }, 2);
      expect(result.line).toBe(2); // Always goes to last line
    });

    it("gg goes to first line", () => {
      const buffer = createBuffer("a\nb\nc");
      const result = motions.gg.target(buffer, { line: 2, column: 0 }, 0);
      expect(result.line).toBe(0);
    });
  });
});

describe("text objects", () => {
  describe("findWordBounds", () => {
    it("finds word boundaries", () => {
      const buffer = createBuffer("hello world");
      const result = findWordBounds(buffer, { line: 0, column: 2 }, false);
      expect(result).toEqual({
        start: { line: 0, column: 0 },
        end: { line: 0, column: 4 },
      });
    });

    it("returns null when not on a word", () => {
      const buffer = createBuffer("hello world");
      const result = findWordBounds(buffer, { line: 0, column: 5 }, false);
      expect(result).toBeNull();
    });
  });

  describe("textObjects", () => {
    it("iw selects inner word", () => {
      const buffer = createBuffer("hello world");
      const result = textObjects.w.range(buffer, { line: 0, column: 7 }, true);
      expect(result).toEqual({
        start: { line: 0, column: 6 },
        end: { line: 0, column: 10 },
      });
    });

    it("i( selects inside parentheses", () => {
      const buffer = createBuffer("foo(bar, baz)qux");
      const result = textObjects["("].range(buffer, { line: 0, column: 5 }, true);
      expect(result).toEqual({
        start: { line: 0, column: 4 },
        end: { line: 0, column: 11 },
      });
    });

    it("a( selects including parentheses", () => {
      const buffer = createBuffer("foo(bar, baz)qux");
      const result = textObjects["("].range(buffer, { line: 0, column: 5 }, false);
      expect(result).toEqual({
        start: { line: 0, column: 3 },
        end: { line: 0, column: 12 },
      });
    });

    it("i\" selects inside quotes", () => {
      const buffer = createBuffer('say "hello world" now');
      const result = textObjects['"'].range(buffer, { line: 0, column: 8 }, true);
      expect(result).toEqual({
        start: { line: 0, column: 5 },
        end: { line: 0, column: 15 },
      });
    });
  });
});

describe("command parser", () => {
  describe("simple motions", () => {
    it("parses h motion", () => {
      const state = createVimState();
      const result = parseInput("h", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("motion");
      expect(result.command?.name).toBe("h");
      expect(result.command?.count).toBe(1);
    });

    it("parses motion with count", () => {
      const state = createVimState();
      const result = parseInput("5j", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("motion");
      expect(result.command?.name).toBe("j");
      expect(result.command?.count).toBe(5);
    });

    it("parses gg motion", () => {
      const state = createVimState();
      const result = parseInput("gg", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("motion");
      expect(result.command?.name).toBe("gg");
    });

    it("waits for second g", () => {
      const state = createVimState();
      const result = parseInput("g", state, "normal");
      expect(result.complete).toBe(false);
    });
  });

  describe("operators", () => {
    it("parses dd (delete line)", () => {
      const state = createVimState();
      const result = parseInput("dd", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("operator");
      expect(result.command?.operator).toBe("d");
    });

    it("parses d$ (delete to end of line)", () => {
      const state = createVimState();
      const result = parseInput("d$", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("operator");
      expect(result.command?.operator).toBe("d");
      expect(result.command?.motion?.name).toBe("line end");
    });

    it("parses dw (delete word)", () => {
      const state = createVimState();
      const result = parseInput("dw", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("operator");
      expect(result.command?.operator).toBe("d");
      expect(result.command?.motion?.name).toBe("word");
    });

    it("parses yy (yank line)", () => {
      const state = createVimState();
      const result = parseInput("yy", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("operator");
      expect(result.command?.operator).toBe("y");
    });

    it("parses cc (change line)", () => {
      const state = createVimState();
      const result = parseInput("cc", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("operator");
      expect(result.command?.operator).toBe("c");
    });

    it("waits for motion after operator", () => {
      const state = createVimState();
      const result = parseInput("d", state, "normal");
      expect(result.complete).toBe(false);
      expect(result.state.pendingOperator).toBe("d");
    });
  });

  describe("text objects with operators", () => {
    it("parses diw (delete inner word)", () => {
      const state = createVimState();
      const result = parseInput("diw", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("operator");
      expect(result.command?.operator).toBe("d");
    });

    it("parses ci\" (change inner quotes)", () => {
      const state = createVimState();
      const result = parseInput("ci\"", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("operator");
      expect(result.command?.operator).toBe("c");
    });

    it("parses da( (delete around parentheses)", () => {
      const state = createVimState();
      const result = parseInput("da(", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("operator");
      expect(result.command?.operator).toBe("d");
    });
  });

  describe("actions", () => {
    it("parses x (delete char)", () => {
      const state = createVimState();
      const result = parseInput("x", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("action");
      expect(result.command?.name).toBe("x");
    });

    it("parses A (append at end)", () => {
      const state = createVimState();
      const result = parseInput("A", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("action");
      expect(result.command?.name).toBe("A");
    });

    it("parses o (open line below)", () => {
      const state = createVimState();
      const result = parseInput("o", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("action");
      expect(result.command?.name).toBe("o");
    });

    it("parses r with replacement char", () => {
      const state = createVimState();
      const result = parseInput("rx", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("action");
      expect(result.command?.name).toBe("rx");
    });

    it("waits for char after r", () => {
      const state = createVimState();
      const result = parseInput("r", state, "normal");
      expect(result.complete).toBe(false);
    });
  });

  describe("find motions", () => {
    it("parses f with target char", () => {
      const state = createVimState();
      const result = parseInput("fa", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("motion");
      expect(result.command?.name).toBe("fa");
      expect(result.state.lastFindChar).toBe("a");
      expect(result.state.lastFindForward).toBe(true);
      expect(result.state.lastFindInclusive).toBe(true);
    });

    it("parses F with target char", () => {
      const state = createVimState();
      const result = parseInput("Fa", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.state.lastFindForward).toBe(false);
      expect(result.state.lastFindInclusive).toBe(true);
    });

    it("parses t with target char", () => {
      const state = createVimState();
      const result = parseInput("ta", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.state.lastFindForward).toBe(true);
      expect(result.state.lastFindInclusive).toBe(false);
    });

    it("waits for char after f", () => {
      const state = createVimState();
      const result = parseInput("f", state, "normal");
      expect(result.complete).toBe(false);
    });
  });

  describe("count handling", () => {
    it("parses multi-digit count", () => {
      const state = createVimState();
      const result = parseInput("123j", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.count).toBe(123);
    });

    it("applies count to operator + motion", () => {
      const state = createVimState();
      const result = parseInput("3dw", state, "normal");
      expect(result.complete).toBe(true);
      expect(result.command?.count).toBe(3);
    });
  });

  describe("visual mode parsing", () => {
    it("treats d as complete command in visual mode", () => {
      const state = createVimState();
      const result = parseInput("d", state, "normal", { inVisualMode: true });
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("action");
      expect(result.command?.name).toBe("d");
    });

    it("treats c as complete command in visual mode", () => {
      const state = createVimState();
      const result = parseInput("c", state, "normal", { inVisualMode: true });
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("action");
      expect(result.command?.name).toBe("c");
    });

    it("treats y as complete command in visual mode", () => {
      const state = createVimState();
      const result = parseInput("y", state, "normal", { inVisualMode: true });
      expect(result.complete).toBe(true);
      expect(result.command?.type).toBe("action");
      expect(result.command?.name).toBe("y");
    });

    it("d waits for motion in normal mode (not visual)", () => {
      const state = createVimState();
      const result = parseInput("d", state, "normal", { inVisualMode: false });
      expect(result.complete).toBe(false);
    });

    it("respects count with visual mode operators", () => {
      const state = createVimState();
      const result = parseInput("3d", state, "normal", { inVisualMode: true });
      expect(result.complete).toBe(true);
      expect(result.command?.count).toBe(3);
      expect(result.command?.name).toBe("d");
    });
  });
});
