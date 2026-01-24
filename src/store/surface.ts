import { createStore } from "solid-js/store";

// Callback for when workspace changes (for persistence)
type WorkspaceChangeCallback = () => void;
let onWorkspaceChange: WorkspaceChangeCallback | null = null;

export function setWorkspaceChangeCallback(cb: WorkspaceChangeCallback | null) {
  onWorkspaceChange = cb;
}

function notifyChange() {
  onWorkspaceChange?.();
}

// Surface types
export type SurfaceType = "editor" | "terminal" | "empty";

// A leaf node contains an actual surface
export interface SurfaceLeaf {
  kind: "leaf";
  id: string;
  type: SurfaceType;
  /** File path for editor surfaces (undefined for new/scratch files) */
  filePath?: string;
}

// A split node contains children arranged horizontally or vertically
export interface SurfaceSplit {
  kind: "split";
  id: string;
  direction: "horizontal" | "vertical";
  children: SurfaceNode[];
  // Sizes as flex ratios (e.g., [1, 1] = equal, [2, 1] = 2:1 ratio)
  sizes: number[];
}

export type SurfaceNode = SurfaceLeaf | SurfaceSplit;

export interface WorkspaceState {
  root: SurfaceNode;
  focusedId: string | null;
  // Focus history for reverting after close
  focusHistory: string[];
  // Memory for navigation: stores last Y position when moving horizontally, last X when moving vertically
  navMemory: {
    lastY: number | null;  // remembered when moving left/right
    lastX: number | null;  // remembered when moving up/down
  };
}

// Generate unique IDs
let idCounter = 0;
export function generateId(): string {
  return `surface-${++idCounter}`;
}

// Create initial state with a single empty surface
function createInitialState(): WorkspaceState {
  const id = generateId();
  return {
    root: {
      kind: "leaf",
      id,
      type: "empty",
    },
    focusedId: id,
    focusHistory: [id],
    navMemory: {
      lastY: null,
      lastX: null,
    },
  };
}

// Create the store
const [state, setState] = createStore<WorkspaceState>(createInitialState());

// Export state and actions
export const surfaceState = state;

export function setFocused(id: string) {
  setState("focusedId", id);
  // Add to history, avoiding duplicates at the end
  setState("focusHistory", (history) => {
    const filtered = history.filter(h => h !== id);
    return [...filtered, id];
  });
}

// Find a node by ID (returns path for updates)
function findNodePath(node: SurfaceNode, targetId: string, path: (string | number)[] = []): (string | number)[] | null {
  if (node.id === targetId) {
    return path;
  }
  if (node.kind === "split") {
    for (let i = 0; i < node.children.length; i++) {
      const result = findNodePath(node.children[i], targetId, [...path, "children", i]);
      if (result) return result;
    }
  }
  return null;
}

// Split a surface
export function splitSurface(id: string, direction: "horizontal" | "vertical") {
  const path = findNodePath(state.root, id);
  if (!path) return;

  const newId = generateId();
  
  // Navigate to current node to get its value
  let currentNode: SurfaceNode = state.root;
  for (let i = 0; i < path.length; i += 2) {
    if (currentNode.kind === "split") {
      currentNode = currentNode.children[path[i + 1] as number];
    }
  }
  
  const newSplit: SurfaceSplit = {
    kind: "split",
    id: generateId(),
    direction,
    children: [
      { ...currentNode },
      { kind: "leaf", id: newId, type: "empty" },
    ],
    sizes: [1, 1],
  };

  if (path.length === 0) {
    // Splitting the root
    setState("root", newSplit);
  } else {
    // Splitting a nested node - use produce for deep update
    setState("root", (root) => {
      const newRoot = JSON.parse(JSON.stringify(root)) as SurfaceNode;
      let target: any = newRoot;
      for (let i = 0; i < path.length - 1; i++) {
        target = target[path[i]];
      }
      target[path[path.length - 1]] = newSplit;
      return newRoot;
    });
  }
  
  setFocused(newId);
  notifyChange();
}

// Close a surface
export function closeSurface(id: string) {
  // If it's the only surface, reset it to empty instead of closing
  if (state.root.kind === "leaf" && state.root.id === id) {
    setState("root", { ...state.root, type: "empty" });
    notifyChange();
    return;
  }
  
  // Find parent split and remove this node
  function removeFromParent(node: SurfaceNode, targetId: string): SurfaceNode | null {
    if (node.kind === "leaf") {
      return node.id === targetId ? null : node;
    }
    
    const newChildren: SurfaceNode[] = [];
    const newSizes: number[] = [];
    
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      if (child.id === targetId) {
        // Skip this child (remove it)
        continue;
      }
      const processed = removeFromParent(child, targetId);
      if (processed) {
        newChildren.push(processed);
        newSizes.push(node.sizes[i]);
      }
    }
    
    if (newChildren.length === 0) {
      return null;
    }
    if (newChildren.length === 1) {
      // Collapse single-child split
      return newChildren[0];
    }
    
    return {
      ...node,
      children: newChildren,
      sizes: newSizes,
    };
  }
  
  const newRoot = removeFromParent(state.root, id);
  if (newRoot) {
    setState("root", newRoot);
    
    // Remove closed surface from history
    setState("focusHistory", (history) => history.filter(h => h !== id));
    
    // Focus previous surface from history if we closed the focused one
    if (state.focusedId === id) {
      // Get all remaining leaf IDs
      const remainingLeaves = new Set(getLeafPositions(newRoot).map(p => p.id));
      
      // Find most recent valid surface from history
      const history = state.focusHistory.filter(h => h !== id);
      let newFocusId: string | null = null;
      
      for (let i = history.length - 1; i >= 0; i--) {
        if (remainingLeaves.has(history[i])) {
          newFocusId = history[i];
          break;
        }
      }
      
      // Fallback to first leaf if no history match
      if (!newFocusId) {
        const firstLeaf = findFirstLeaf(newRoot);
        if (firstLeaf) {
          newFocusId = firstLeaf.id;
        }
      }
      
      if (newFocusId) {
        setState("focusedId", newFocusId);
      }
    }
    notifyChange();
  }
}

function findFirstLeaf(node: SurfaceNode): SurfaceLeaf | null {
  if (node.kind === "leaf") return node;
  if (node.children.length > 0) {
    return findFirstLeaf(node.children[0]);
  }
  return null;
}

// Navigation directions
export type Direction = "left" | "right" | "up" | "down";

// Navigate to adjacent surface
export function navigateTo(direction: Direction) {
  const focusedId = state.focusedId;
  if (!focusedId) return;

  // Get current position before moving
  const positions = getLeafPositions(state.root);
  const currentPos = positions.find(p => p.id === focusedId);
  
  const targetId = findAdjacentSurface(state.root, focusedId, direction, state.navMemory);
  if (targetId && currentPos) {
    // Update memory based on direction we're moving
    const currentCenterY = currentPos.y + currentPos.height / 2;
    const currentCenterX = currentPos.x + currentPos.width / 2;
    
    if (direction === "left" || direction === "right") {
      // Moving horizontally: remember Y position
      setState("navMemory", "lastY", currentCenterY);
    } else {
      // Moving vertically: remember X position
      setState("navMemory", "lastX", currentCenterX);
    }
    
    setFocused(targetId);
  }
}

interface LeafPosition {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function getLeafPositions(
  node: SurfaceNode,
  x: number = 0,
  y: number = 0,
  width: number = 1,
  height: number = 1
): LeafPosition[] {
  if (node.kind === "leaf") {
    return [{ id: node.id, x, y, width, height }];
  }
  
  const results: LeafPosition[] = [];
  const totalSize = node.sizes.reduce((a, b) => a + b, 0);
  let offset = 0;
  
  for (let i = 0; i < node.children.length; i++) {
    const ratio = node.sizes[i] / totalSize;
    
    if (node.direction === "horizontal") {
      const childWidth = width * ratio;
      results.push(...getLeafPositions(node.children[i], x + offset, y, childWidth, height));
      offset += childWidth;
    } else {
      const childHeight = height * ratio;
      results.push(...getLeafPositions(node.children[i], x, y + offset, width, childHeight));
      offset += childHeight;
    }
  }
  
  return results;
}

function findAdjacentSurface(
  root: SurfaceNode,
  fromId: string,
  direction: Direction,
  memory: { lastY: number | null; lastX: number | null }
): string | null {
  const positions = getLeafPositions(root);
  const current = positions.find(p => p.id === fromId);
  if (!current) return null;
  
  // Get overlap amount (0 if no overlap)
  function overlapAmount(a1: number, a2: number, b1: number, b2: number): number {
    const start = Math.max(a1, b1);
    const end = Math.min(a2, b2);
    return Math.max(0, end - start);
  }
  
  let bestCandidate: LeafPosition | null = null;
  let bestScore = -Infinity;
  
  for (const pos of positions) {
    if (pos.id === fromId) continue;
    
    const currentRight = current.x + current.width;
    const currentBottom = current.y + current.height;
    const posRight = pos.x + pos.width;
    const posBottom = pos.y + pos.height;
    
    let isValidDirection = false;
    let edgeDistance = Infinity;
    let overlap = 0;
    
    switch (direction) {
      case "left":
        // Target's right edge must be at or before our left edge (small tolerance for float precision)
        isValidDirection = posRight <= current.x + 0.001;
        edgeDistance = current.x - posRight;
        overlap = overlapAmount(current.y, currentBottom, pos.y, posBottom);
        break;
      case "right":
        // Target's left edge must be at or past our right edge
        isValidDirection = pos.x >= currentRight - 0.001;
        edgeDistance = pos.x - currentRight;
        overlap = overlapAmount(current.y, currentBottom, pos.y, posBottom);
        break;
      case "up":
        // Target's bottom edge must be at or before our top edge
        isValidDirection = posBottom <= current.y + 0.001;
        edgeDistance = current.y - posBottom;
        overlap = overlapAmount(current.x, currentRight, pos.x, posRight);
        break;
      case "down":
        // Target's top edge must be at or past our bottom edge
        isValidDirection = pos.y >= currentBottom - 0.001;
        edgeDistance = pos.y - currentBottom;
        overlap = overlapAmount(current.x, currentRight, pos.x, posRight);
        break;
    }
    
    if (!isValidDirection) continue;
    
    // Score: prioritize overlap, then closeness, then memory
    const overlapScore = overlap * 1000;
    const distanceScore = -Math.max(0, edgeDistance) * 10;
    
    // Memory bonus: if we have a remembered position, prefer surfaces that contain it
    let memoryScore = 0;
    const posCenterY = pos.y + pos.height / 2;
    const posCenterX = pos.x + pos.width / 2;
    
    if (direction === "left" || direction === "right") {
      // Moving horizontally: use remembered Y
      if (memory.lastY !== null) {
        // Check if the remembered Y falls within this surface
        if (memory.lastY >= pos.y && memory.lastY <= pos.y + pos.height) {
          memoryScore = 500; // Bonus for containing remembered position
        } else {
          // Smaller bonus for being close to remembered position
          memoryScore = -Math.abs(posCenterY - memory.lastY) * 100;
        }
      }
    } else {
      // Moving vertically: use remembered X
      if (memory.lastX !== null) {
        if (memory.lastX >= pos.x && memory.lastX <= pos.x + pos.width) {
          memoryScore = 500;
        } else {
          memoryScore = -Math.abs(posCenterX - memory.lastX) * 100;
        }
      }
    }
    
    const score = overlapScore + distanceScore + memoryScore;
    
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = pos;
    }
  }
  
  return bestCandidate?.id ?? null;
}

// Set surface type
export function setSurfaceType(id: string, type: SurfaceType, filePath?: string) {
  const path = findNodePath(state.root, id);
  if (!path) return;
  
  if (path.length === 0) {
    setState("root", (root) => {
      if (root.kind === "leaf") {
        return { ...root, type, filePath };
      }
      return root;
    });
  } else {
    setState("root", (root) => {
      const newRoot = JSON.parse(JSON.stringify(root)) as SurfaceNode;
      let target: SurfaceNode = newRoot;
      for (let i = 0; i < path.length; i++) {
        if (target.kind === "split") {
          target = target.children[path[i + 1] as number];
          i++; // skip the "children" part
        }
      }
      if (target.kind === "leaf") {
        target.type = type;
        target.filePath = filePath;
      }
      return newRoot;
    });
  }
  notifyChange();
}

// Get surface leaf by ID
export function getSurfaceLeaf(id: string): SurfaceLeaf | null {
  function find(node: SurfaceNode): SurfaceLeaf | null {
    if (node.kind === "leaf") {
      return node.id === id ? node : null;
    }
    for (const child of node.children) {
      const found = find(child);
      if (found) return found;
    }
    return null;
  }
  return find(state.root);
}

// Update sizes of a split node
export function updateSplitSizes(splitId: string, newSizes: number[]) {
  const path = findNodePath(state.root, splitId);
  if (!path) return;
  
  setState("root", (root) => {
    const newRoot = JSON.parse(JSON.stringify(root)) as SurfaceNode;
    let target: any = newRoot;
    for (let i = 0; i < path.length; i++) {
      target = target[path[i]];
    }
    if (target.kind === "split") {
      target.sizes = newSizes;
    }
    return newRoot;
  });
  notifyChange();
}

// Get serializable workspace state (for persistence)
export function getSerializedWorkspace() {
  return {
    root: JSON.parse(JSON.stringify(state.root)) as SurfaceNode,
    focusedId: state.focusedId,
  };
}

// Restore workspace from serialized state
export function restoreWorkspace(saved: { root: SurfaceNode; focusedId: string | null } | null) {
  if (saved) {
    // Update ID counter to avoid collisions
    const maxId = findMaxId(saved.root);
    idCounter = Math.max(idCounter, maxId);
    
    setState({
      root: saved.root,
      focusedId: saved.focusedId,
      focusHistory: saved.focusedId ? [saved.focusedId] : [],
      navMemory: { lastY: null, lastX: null },
    });
  } else {
    // Reset to fresh state
    const newState = createInitialState();
    setState(newState);
  }
}

// Find highest ID number in tree (to avoid collisions after restore)
function findMaxId(node: SurfaceNode): number {
  const match = node.id.match(/surface-(\d+)/);
  let max = match ? parseInt(match[1], 10) : 0;
  
  if (node.kind === "split") {
    for (const child of node.children) {
      max = Math.max(max, findMaxId(child));
    }
  }
  return max;
}
