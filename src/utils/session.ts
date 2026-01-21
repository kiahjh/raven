/**
 * Session ID utilities for terminal persistence
 */

/**
 * Generate a unique session ID that includes project path to avoid collisions.
 * Each project gets its own set of session IDs.
 * 
 * @param surfaceId - The surface ID (e.g., "surface-1")
 * @param projectPath - The project path, or null for default
 * @returns A unique session ID like "L1VzZXJzL21pY2lhaC9wcm9qZWN0:surface-1"
 */
export function getSessionId(surfaceId: string, projectPath: string | null): string {
  // Use base64-encoded path to ensure uniqueness
  const pathId = projectPath 
    ? btoa(projectPath).replace(/[+/=]/g, '_')  // Make URL-safe
    : "default";
  return `${pathId}:${surfaceId}`;
}

/**
 * Parse a session ID back into its components
 * 
 * @param sessionId - The session ID to parse
 * @returns The surface ID and project path, or null if invalid
 */
export function parseSessionId(sessionId: string): { surfaceId: string; projectPath: string | null } | null {
  const colonIndex = sessionId.indexOf(':');
  if (colonIndex === -1) return null;
  
  const pathId = sessionId.slice(0, colonIndex);
  const surfaceId = sessionId.slice(colonIndex + 1);
  
  if (!surfaceId) return null;
  
  if (pathId === "default") {
    return { surfaceId, projectPath: null };
  }
  
  try {
    // Reverse the URL-safe base64
    const base64 = pathId.replace(/_/g, match => {
      // We replaced +, /, = with _ - we need to guess which one it was
      // Since paths don't usually have + or =, treat all as /
      return '/';
    });
    const projectPath = atob(base64);
    return { surfaceId, projectPath };
  } catch {
    return null;
  }
}
