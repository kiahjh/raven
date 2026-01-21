import { onMount, onCleanup } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { surfaceState, splitSurface, closeSurface, navigateTo, Direction, setSurfaceType, SurfaceNode as SurfaceNodeType } from "../store/surface";
import { projectState } from "../store/project";
import { getSessionId } from "../utils/session";
import { SurfaceNode } from "./SurfaceNode";
import "./Workspace.css";

export function Workspace() {
  // Temporary keyboard shortcuts for testing splits
  function handleKeyDown(e: KeyboardEvent) {
    const focusedId = surfaceState.focusedId;
    if (!focusedId) return;

    // Cmd+D for horizontal split (right), Cmd+Shift+D for vertical split (down), Cmd+W to close
    if (e.metaKey && e.key.toLowerCase() === "d" && !e.shiftKey) {
      e.preventDefault();
      splitSurface(focusedId, "horizontal");
    } else if (e.metaKey && e.key.toLowerCase() === "d" && e.shiftKey) {
      e.preventDefault();
      splitSurface(focusedId, "vertical");
    } else if (e.metaKey && e.key.toLowerCase() === "w") {
      e.preventDefault();
      // If it's a terminal, kill the daemon session first
      const focusedSurface = findLeafById(surfaceState.root, focusedId);
      if (focusedSurface?.type === "terminal") {
        const sessionId = getSessionId(focusedId, projectState.current?.path ?? null);
        invoke("daemon_kill", { id: sessionId });
      }
      closeSurface(focusedId);
    }
    
    // Cmd+hjkl for navigation between surfaces
    const navKeys: Record<string, Direction> = {
      h: "left",
      j: "down", 
      k: "up",
      l: "right",
    };
    
    if (e.metaKey && navKeys[e.key.toLowerCase()]) {
      e.preventDefault();
      navigateTo(navKeys[e.key.toLowerCase()]);
    }
    
    // Direct key presses on empty surfaces to set type
    if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      const focusedSurface = findLeafById(surfaceState.root, focusedId);
      if (focusedSurface?.type === "empty") {
        if (e.key.toLowerCase() === "t") {
          e.preventDefault();
          setSurfaceType(focusedId, "terminal");
        } else if (e.key.toLowerCase() === "e") {
          e.preventDefault();
          setSurfaceType(focusedId, "editor");
        }
      }
    }
  }
  
  // Helper to find a leaf by ID
  function findLeafById(node: SurfaceNodeType, id: string): (SurfaceNodeType & { kind: "leaf" }) | null {
    if (node.kind === "leaf") {
      return node.id === id ? node : null;
    }
    for (const child of node.children) {
      const found = findLeafById(child, id);
      if (found) return found;
    }
    return null;
  }

  onMount(() => {
    // Use capture phase to intercept before terminal gets the event
    window.addEventListener("keydown", handleKeyDown, true);
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown, true);
  });

  return (
    <div class="workspace">
      <SurfaceNode node={surfaceState.root} />
    </div>
  );
}
