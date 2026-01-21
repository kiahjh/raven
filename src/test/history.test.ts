import { describe, it, expect } from "vitest";
import {
  createHistory,
  pushHistory,
  undo,
  redo,
  canUndo,
  canRedo,
  clearHistory,
  undoCount,
  redoCount,
} from "../editor/history";
import { createBuffer } from "../editor/buffer";

describe("undo history", () => {
  describe("createHistory", () => {
    it("creates empty history", () => {
      const history = createHistory();
      expect(history.undoStack).toEqual([]);
      expect(history.redoStack).toEqual([]);
      expect(history.maxSize).toBe(1000);
    });

    it("respects custom max size", () => {
      const history = createHistory(50);
      expect(history.maxSize).toBe(50);
    });
  });

  describe("pushHistory", () => {
    it("adds entry to undo stack", () => {
      const history = createHistory();
      const buffer = createBuffer("hello");
      const cursor = { line: 0, column: 0 };
      
      const newHistory = pushHistory(history, buffer, cursor);
      
      expect(newHistory.undoStack.length).toBe(1);
      expect(newHistory.undoStack[0].buffer).toBe(buffer);
      expect(newHistory.undoStack[0].cursor).toBe(cursor);
    });

    it("clears redo stack on push", () => {
      let history = createHistory();
      const buffer1 = createBuffer("hello");
      const buffer2 = createBuffer("world");
      const cursor = { line: 0, column: 0 };
      
      history = pushHistory(history, buffer1, cursor);
      
      // Simulate undo which would populate redo stack
      history = {
        ...history,
        redoStack: [{ buffer: buffer2, cursor, timestamp: Date.now() }],
      };
      
      // Push new entry
      history = pushHistory(history, createBuffer("test"), cursor);
      
      expect(history.redoStack.length).toBe(0);
    });

    it("trims oldest entry when exceeding max size", () => {
      let history = createHistory(3);
      const cursor = { line: 0, column: 0 };
      
      history = pushHistory(history, createBuffer("a"), cursor);
      history = pushHistory(history, createBuffer("b"), cursor);
      history = pushHistory(history, createBuffer("c"), cursor);
      history = pushHistory(history, createBuffer("d"), cursor);
      
      expect(history.undoStack.length).toBe(3);
      expect(history.undoStack[0].buffer.lines[0]).toBe("b");
      expect(history.undoStack[2].buffer.lines[0]).toBe("d");
    });
  });

  describe("undo", () => {
    it("returns null when nothing to undo", () => {
      const history = createHistory();
      const buffer = createBuffer("hello");
      const cursor = { line: 0, column: 0 };
      
      const result = undo(history, buffer, cursor);
      
      expect(result).toBeNull();
    });

    it("restores previous state", () => {
      let history = createHistory();
      const buffer1 = createBuffer("hello");
      const buffer2 = createBuffer("world");
      const cursor = { line: 0, column: 0 };
      
      history = pushHistory(history, buffer1, cursor);
      
      const result = undo(history, buffer2, cursor);
      
      expect(result).not.toBeNull();
      expect(result!.buffer.lines[0]).toBe("hello");
    });

    it("pushes current state to redo stack", () => {
      let history = createHistory();
      const buffer1 = createBuffer("hello");
      const buffer2 = createBuffer("world");
      const cursor = { line: 0, column: 0 };
      
      history = pushHistory(history, buffer1, cursor);
      
      const result = undo(history, buffer2, cursor);
      
      expect(result!.history.redoStack.length).toBe(1);
      expect(result!.history.redoStack[0].buffer.lines[0]).toBe("world");
    });
  });

  describe("redo", () => {
    it("returns null when nothing to redo", () => {
      const history = createHistory();
      const buffer = createBuffer("hello");
      const cursor = { line: 0, column: 0 };
      
      const result = redo(history, buffer, cursor);
      
      expect(result).toBeNull();
    });

    it("restores next state after undo", () => {
      let history = createHistory();
      const buffer1 = createBuffer("hello");
      const buffer2 = createBuffer("world");
      const cursor = { line: 0, column: 0 };
      
      history = pushHistory(history, buffer1, cursor);
      
      const undoResult = undo(history, buffer2, cursor);
      const redoResult = redo(undoResult!.history, undoResult!.buffer, cursor);
      
      expect(redoResult).not.toBeNull();
      expect(redoResult!.buffer.lines[0]).toBe("world");
    });
  });

  describe("canUndo / canRedo", () => {
    it("returns correct availability", () => {
      let history = createHistory();
      const buffer = createBuffer("hello");
      const cursor = { line: 0, column: 0 };
      
      expect(canUndo(history)).toBe(false);
      expect(canRedo(history)).toBe(false);
      
      history = pushHistory(history, buffer, cursor);
      expect(canUndo(history)).toBe(true);
      expect(canRedo(history)).toBe(false);
      
      const undoResult = undo(history, createBuffer("world"), cursor);
      expect(canUndo(undoResult!.history)).toBe(false);
      expect(canRedo(undoResult!.history)).toBe(true);
    });
  });

  describe("clearHistory", () => {
    it("clears both stacks", () => {
      let history = createHistory();
      const buffer = createBuffer("hello");
      const cursor = { line: 0, column: 0 };
      
      history = pushHistory(history, buffer, cursor);
      history = pushHistory(history, buffer, cursor);
      
      const cleared = clearHistory(history);
      
      expect(cleared.undoStack.length).toBe(0);
      expect(cleared.redoStack.length).toBe(0);
      expect(cleared.maxSize).toBe(history.maxSize);
    });
  });

  describe("count functions", () => {
    it("returns correct counts", () => {
      let history = createHistory();
      const buffer = createBuffer("hello");
      const cursor = { line: 0, column: 0 };
      
      expect(undoCount(history)).toBe(0);
      expect(redoCount(history)).toBe(0);
      
      history = pushHistory(history, buffer, cursor);
      history = pushHistory(history, buffer, cursor);
      history = pushHistory(history, buffer, cursor);
      
      expect(undoCount(history)).toBe(3);
      expect(redoCount(history)).toBe(0);
    });
  });
});
