import { describe, it, expect, beforeEach } from "vitest";
import {
  getEditorState,
  setEditorState,
  updateEditorState,
  removeEditorState,
  initializeEditor,
} from "../store/editor";
import { createExtendedState, ExtendedEditorState } from "../editor/commands";

describe("editor store", () => {
  const testId = "test-surface-1";

  beforeEach(() => {
    // Clean up test surface
    removeEditorState(testId);
  });

  describe("getEditorState", () => {
    it("creates new state if none exists", () => {
      const state = getEditorState(testId);
      expect(state).toBeDefined();
      expect(state.cursor).toEqual({ line: 0, column: 0 });
      expect(state.mode).toBe("normal");
    });

    it("returns existing state", () => {
      const initial = getEditorState(testId);
      const again = getEditorState(testId);
      expect(again).toBe(initial);
    });
  });

  describe("setEditorState", () => {
    it("sets editor state", () => {
      const newState = createExtendedState("hello");
      setEditorState(testId, newState);
      const retrieved = getEditorState(testId);
      expect(retrieved.buffer.lines).toEqual(["hello"]);
    });
  });

  describe("updateEditorState", () => {
    it("transforms editor state", () => {
      initializeEditor(testId, "hello");
      updateEditorState(testId, (state: ExtendedEditorState) => ({
        ...state,
        cursor: { ...state.cursor, column: state.cursor.column + 1 },
      }));
      const state = getEditorState(testId);
      expect(state.cursor.column).toBe(1);
    });
  });

  describe("removeEditorState", () => {
    it("removes editor state", () => {
      getEditorState(testId); // Create it
      removeEditorState(testId);
      // Getting it again should create a fresh one
      const fresh = getEditorState(testId);
      expect(fresh.cursor).toEqual({ line: 0, column: 0 });
    });
  });

  describe("initializeEditor", () => {
    it("initializes editor with content", () => {
      initializeEditor(testId, "line1\nline2");
      const state = getEditorState(testId);
      expect(state.buffer.lines).toEqual(["line1", "line2"]);
      expect(state.cursor).toEqual({ line: 0, column: 0 });
    });
  });
});
