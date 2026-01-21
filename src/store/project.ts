import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { loadAppState, saveAppState, SerializedWorkspace, AppState } from "./session";
import { restoreWorkspace, getSerializedWorkspace, setWorkspaceChangeCallback } from "./surface";

export interface Project {
  path: string;
  name: string;
}

const [projects, setProjects] = createStore<Project[]>([]);
const [currentPath, setCurrentPath] = createSignal<string | null>(null);
const [initialized, setInitialized] = createSignal(false);

// Per-project workspace cache
const workspaceCache: Record<string, SerializedWorkspace> = {};

// Debounced save
let saveTimeout: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 1000;

function debouncedSave() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    persistState();
    saveTimeout = null;
  }, SAVE_DEBOUNCE_MS);
}

// Set up workspace change listener
setWorkspaceChangeCallback(() => {
  debouncedSave();
});

// Also save immediately on window unload
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", () => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    // Sync save on unload
    const path = currentPath();
    if (path) {
      workspaceCache[path] = getSerializedWorkspace();
    }
    // Note: Can't do async save here, but the debounced saves should have caught most changes
  });
}

export const projectState = {
  get current() {
    const path = currentPath();
    return projects.find(p => p.path === path) ?? null;
  },
  get all() {
    return projects;
  },
  get initialized() {
    return initialized();
  },
};

// Initialize from persisted state
export async function initializeProjects(): Promise<void> {
  const state = await loadAppState();
  if (state) {
    const projectList = state.projects.map(path => ({
      path,
      name: path.split("/").pop() || path,
    }));
    setProjects(projectList);
    
    // Load cached sessions
    Object.assign(workspaceCache, state.sessions);
    
    if (state.currentProject && state.projects.includes(state.currentProject)) {
      await switchToProject(state.currentProject);
    }
  }
  setInitialized(true);
}

// Save current state to disk
async function persistState(): Promise<void> {
  // Save current workspace to cache before persisting
  const path = currentPath();
  if (path) {
    workspaceCache[path] = getSerializedWorkspace();
  }
  
  const state: AppState = {
    projects: projects.map(p => p.path),
    currentProject: currentPath(),
    sessions: workspaceCache,
  };
  await saveAppState(state);
}

export async function addProject(path: string): Promise<void> {
  // Save current project's workspace first
  const prevPath = currentPath();
  if (prevPath) {
    workspaceCache[prevPath] = getSerializedWorkspace();
  }
  
  // Don't add duplicates
  if (!projects.some(p => p.path === path)) {
    const name = path.split("/").pop() || path;
    setProjects([...projects, { path, name }]);
  }
  
  await switchToProject(path);
  await persistState();
}

async function switchToProject(path: string): Promise<void> {
  // Save current workspace
  const prevPath = currentPath();
  if (prevPath && prevPath !== path) {
    workspaceCache[prevPath] = getSerializedWorkspace();
  }
  
  setCurrentPath(path);
  
  // Restore workspace for new project
  const cached = workspaceCache[path];
  if (cached) {
    restoreWorkspace(cached);
  } else {
    // Reset to fresh workspace
    restoreWorkspace(null);
  }
}

export async function setCurrentProject(path: string): Promise<void> {
  if (projects.some(p => p.path === path) && path !== currentPath()) {
    await switchToProject(path);
    await persistState();
  }
}

export async function removeProject(path: string): Promise<void> {
  setProjects(projects.filter(p => p.path !== path));
  delete workspaceCache[path];
  
  if (currentPath() === path) {
    const nextPath = projects[0]?.path ?? null;
    if (nextPath) {
      await switchToProject(nextPath);
    } else {
      setCurrentPath(null);
    }
  }
  await persistState();
}

// Call this when workspace changes to persist
export async function saveCurrentSession(): Promise<void> {
  await persistState();
}
