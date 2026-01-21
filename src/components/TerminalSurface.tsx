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
      fontSize: 15,

      fontFamily: '"Maple Mono NF CN", "Berkeley Mono", "JetBrains Mono", monospace',
      allowTransparency: true,
      theme: {
        background: "#181614",
        foreground: "#f5f0e8",
        cursor: "#d4a574",
        selectionBackground: "rgba(212, 165, 116, 0.25)",
        black: "#181614",
        red: "#c97b7b",
        green: "#8fb878",
        yellow: "#dbb868",
        blue: "#7da5c9",
        magenta: "#b8a9c4",
        cyan: "#7bc9b8",
        white: "#f5f0e8",
        brightBlack: "#5c5650",
        brightRed: "#d49494",
        brightGreen: "#a8d191",
        brightYellow: "#f4d181",
        brightBlue: "#96bede",
        brightMagenta: "#d1c2dd",
        brightCyan: "#94e2d1",
        brightWhite: "#fffaf5",
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
