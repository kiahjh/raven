import { load, Store } from "@tauri-apps/plugin-store";
import type { SurfaceNode } from "./surface";

// Serializable workspace state (without functions)
export interface SerializedWorkspace {
  root: SurfaceNode;
  focusedId: string | null;
}

export interface AppState {
  projects: string[];
  currentProject: string | null;
  sessions: Record<string, SerializedWorkspace>;
}

let store: Store | null = null;

async function getStore(): Promise<Store> {
  if (!store) {
    store = await load("raven-state.json", { autoSave: false });
  }
  return store;
}

export async function loadAppState(): Promise<AppState | null> {
  try {
    const s = await getStore();
    const state = await s.get<AppState>("appState");
    return state ?? null;
  } catch (e) {
    console.error("Failed to load app state:", e);
    return null;
  }
}

export async function saveAppState(state: AppState): Promise<void> {
  try {
    const s = await getStore();
    await s.set("appState", state);
    await s.save();
  } catch (e) {
    console.error("Failed to save app state:", e);
  }
}
