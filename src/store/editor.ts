/**
 * Store for managing editor instances.
 * Each editor surface has its own EditorState, keyed by surface ID.
 */

import { createStore } from "solid-js/store";
import { ExtendedEditorState, createExtendedState } from "../editor/commands";

interface EditorStore {
  editors: Record<string, ExtendedEditorState>;
}

const [store, setStore] = createStore<EditorStore>({
  editors: {},
});

export const editorStore = store;

/**
 * Get or create editor state for a surface.
 */
export function getEditorState(surfaceId: string): ExtendedEditorState {
  if (!store.editors[surfaceId]) {
    setStore("editors", surfaceId, createExtendedState());
  }
  return store.editors[surfaceId];
}

/**
 * Update editor state for a surface.
 */
export function setEditorState(surfaceId: string, state: ExtendedEditorState): void {
  setStore("editors", surfaceId, state);
}

/**
 * Update editor state using a transform function.
 */
export function updateEditorState(
  surfaceId: string,
  transform: (state: ExtendedEditorState) => ExtendedEditorState
): void {
  const current = getEditorState(surfaceId);
  setStore("editors", surfaceId, transform(current));
}

/**
 * Remove editor state when surface is closed.
 */
export function removeEditorState(surfaceId: string): void {
  setStore("editors", surfaceId, undefined as unknown as ExtendedEditorState);
}

/**
 * Initialize editor with content (e.g., from file).
 */
export function initializeEditor(surfaceId: string, content: string): void {
  setStore("editors", surfaceId, createExtendedState(content));
}
