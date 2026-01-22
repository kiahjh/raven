import { onMount, onCleanup, createSignal, createEffect, on } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import type { Terminal, FitAddon } from "ghostty-web";
import { getSessionId } from "../utils/session";
import "./TerminalSurface.css";

interface Props {
  id: string;
  focused: boolean;
  projectPath: string | null;
}

export function TerminalSurface(props: Props) {
  let containerRef: HTMLDivElement | undefined;
  let term: Terminal | undefined;
  let fitAddon: FitAddon | undefined;
  let resizeObserver: ResizeObserver | undefined;
  
  const [ready, setReady] = createSignal(false);
  const [currentSessionId, setCurrentSessionId] = createSignal<string | null>(null);
  
  // Track listeners so we can clean them up on session change
  let unlistenOutput: UnlistenFn | undefined;
  let unlistenExit: UnlistenFn | undefined;
  
  // Guard against concurrent connection attempts
  let connectingTo: string | null = null;
  
  // Helper to connect to a session (attach or spawn+attach)
  async function connectToSession(sessionId: string) {
    if (!term) return;
    
    // Guard against duplicate connection attempts
    if (connectingTo === sessionId) {
      console.log(`[Terminal] Already connecting to session: ${sessionId}, skipping`);
      return;
    }
    if (currentSessionId() === sessionId) {
      console.log(`[Terminal] Already connected to session: ${sessionId}, skipping`);
      return;
    }
    
    connectingTo = sessionId;
    console.log(`[Terminal] Connecting to session: ${sessionId}`);
    
    // Clean up old listeners first
    unlistenOutput?.();
    unlistenExit?.();
    unlistenOutput = undefined;
    unlistenExit = undefined;
    
    // Set up new listeners BEFORE attaching to not miss any output
    unlistenOutput = await listen<{ id: string; data: string }>(
      `pty-output-${sessionId}`,
      (event) => {
        term?.write(event.payload.data);
      }
    );
    
    unlistenExit = await listen<string>(`pty-exit-${sessionId}`, () => {
      term?.write("\r\n[Process exited]\r\n");
    });
    
    // Try to attach to existing session first
    try {
      const buffer = await invoke<string>("daemon_attach", { id: sessionId });
      if (buffer) {
        term.write(buffer);
      }
      console.log(`[Terminal] Attached to existing session: ${sessionId}`);
      setCurrentSessionId(sessionId);
      connectingTo = null;
      setReady(true);
    } catch {
      // No existing session, spawn a new one then attach
      try {
        await invoke("daemon_spawn", {
          id: sessionId,
          cwd: props.projectPath,
          rows: term.rows,
          cols: term.cols,
        });
        console.log(`[Terminal] Spawned new session: ${sessionId}`);
        
        // Now attach to the newly spawned session
        const buffer = await invoke<string>("daemon_attach", { id: sessionId });
        if (buffer) {
          term.write(buffer);
        }
        console.log(`[Terminal] Attached to new session: ${sessionId}`);
        setCurrentSessionId(sessionId);
        connectingTo = null;
        setReady(true);
      } catch (e) {
        console.error("Failed to spawn/attach terminal:", e);
        term.write(`\r\nFailed to spawn terminal: ${e}\r\n`);
        // Clean up listeners on failure
        unlistenOutput?.();
        unlistenExit?.();
        unlistenOutput = undefined;
        unlistenExit = undefined;
        connectingTo = null;
        return;
      }
    }
  }
  
  // Helper to disconnect from current session
  function disconnectFromSession() {
    const sessionId = currentSessionId();
    if (sessionId) {
      console.log(`[Terminal] Disconnecting from session: ${sessionId}`);
      invoke("daemon_detach", { id: sessionId });
    }
    unlistenOutput?.();
    unlistenExit?.();
    setCurrentSessionId(null);
  }

  onMount(async () => {
    if (!containerRef) return;
    
    const sessionId = getSessionId(props.id, props.projectPath);
    console.log(`[Terminal] Mount: surfaceId=${props.id}, projectPath=${props.projectPath}, sessionId=${sessionId}`);

    // Load ghostty-web
    const mod = await import("ghostty-web");
    const ghostty = await mod.Ghostty.load();

    // Create terminal instance
    term = new mod.Terminal({
      cursorBlink: props.focused,
      cursorStyle: "bar",
      fontSize: 14,
      fontFamily: '"SF Mono", "JetBrains Mono", "Fira Code", monospace',
      allowTransparency: true,
      theme: {
        background: "#181818",
        foreground: "#e8e8e8",
        cursor: "#3b82f6",
        selectionBackground: "rgba(59, 130, 246, 0.3)",
        black: "#181818",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#a0a0a0",
        brightBlack: "#6e6e6e",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#e8e8e8",
      },
      scrollback: 10000,
      ghostty,
    });

    // Intercept keyboard shortcuts before terminal processes them
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      // Let our global shortcuts through (return true = let it bubble up)
      if (event.metaKey) {
        const key = event.key.toLowerCase();
        // Navigation: Cmd+hjkl
        if (["h", "j", "k", "l"].includes(key)) {
          return true;
        }
        // Split: Cmd+D, Cmd+Shift+D
        if (key === "d") {
          return true;
        }
        // Close: Cmd+W
        if (key === "w") {
          return true;
        }
      }
      // Let terminal handle everything else
      return false;
    });

    // Load fit addon
    fitAddon = new mod.FitAddon();
    term.loadAddon(fitAddon);

    // Open terminal in container
    term.open(containerRef);
    
    // Initial fit
    fitAddon.fit();

    // Handle terminal input - uses currentSessionId reactively
    term.onData((data: string) => {
      const sid = currentSessionId();
      if (sid) {
        invoke("daemon_write", { id: sid, data });
      }
    });

    // Handle resize - uses currentSessionId reactively
    term.onResize((size: { rows: number; cols: number }) => {
      const sid = currentSessionId();
      if (sid) {
        invoke("daemon_resize", { id: sid, rows: size.rows, cols: size.cols });
      }
    });

    // Observe container size changes
    resizeObserver = new ResizeObserver(() => {
      fitAddon?.fit();
    });
    resizeObserver.observe(containerRef);

    // Connect to initial session
    await connectToSession(sessionId);

    // Focus if needed
    if (props.focused) {
      term.focus();
    }
  });
  
  // Watch for project path changes and reconnect
  createEffect(on(
    () => props.projectPath,
    (newPath, oldPath) => {
      // Skip initial run and only react to actual changes
      if (oldPath === undefined) return;
      if (newPath === oldPath) return;
      
      const newSessionId = getSessionId(props.id, newPath);
      const oldSessionId = currentSessionId();
      
      if (newSessionId !== oldSessionId) {
        console.log(`[Terminal] Project changed: ${oldPath} -> ${newPath}`);
        
        // Clear terminal and reconnect
        term?.clear();
        disconnectFromSession();
        connectToSession(newSessionId);
      }
    }
  ));

  onCleanup(() => {
    console.log(`[Terminal] Cleanup: sessionId=${currentSessionId()}`);
    resizeObserver?.disconnect();
    disconnectFromSession();
    term?.dispose();
  });

  // Focus terminal and update cursor blink when surface focus changes
  createEffect(() => {
    if (!ready() || !term) return;
    
    // Update cursor blink based on focus state
    if (term.renderer) {
      term.renderer.setCursorBlink(props.focused);
    }
    
    if (props.focused) {
      term.focus();
    }
  });

  // Handle click
  const handleClick = () => {
    term?.focus();
  };

  return (
    <div
      ref={containerRef}
      class="terminal-surface"
      classList={{ "terminal-surface--focused": props.focused }}
      onClick={handleClick}
    />
  );
}
