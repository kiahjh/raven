import { createSignal, onMount, onCleanup, createContext, useContext, JSX } from "solid-js";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./WindowChrome.css";

// Context to share window state with children (like TopBar)
interface WindowContextValue {
  isFocused: () => boolean;
  isFullscreen: () => boolean;
  isHoveringTraffic: () => boolean;
  setIsHoveringTraffic: (v: boolean) => void;
  handleClose: () => void;
  handleMinimize: () => void;
  handleMaximize: () => void;
  handleFullscreen: () => void;
  startDrag: () => void;
}

const WindowContext = createContext<WindowContextValue>();

export function useWindow() {
  return useContext(WindowContext);
}

interface Props {
  children: JSX.Element;
}

export function WindowChrome(props: Props) {
  const [isFocused, setIsFocused] = createSignal(true);
  const [isFullscreen, setIsFullscreen] = createSignal(false);
  const [isHoveringTraffic, setIsHoveringTraffic] = createSignal(false);
  
  onMount(async () => {
    const onFocus = () => setIsFocused(true);
    const onBlur = () => setIsFocused(false);
    
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    
    // Listen for Tauri window resize events to detect fullscreen
    const appWindow = getCurrentWindow();
    const unlisten = await appWindow.onResized(async () => {
      const fs = await appWindow.isFullscreen();
      setIsFullscreen(fs);
    });
    
    // Check initial state
    const fs = await appWindow.isFullscreen();
    setIsFullscreen(fs);
    
    onCleanup(() => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      unlisten();
    });
  });

  const handleClose = () => invoke("window_close");
  const handleMinimize = () => invoke("window_minimize");
  const handleMaximize = () => invoke("window_maximize");
  const handleFullscreen = () => invoke("window_fullscreen");
  const startDrag = () => invoke("window_start_drag");

  const contextValue: WindowContextValue = {
    isFocused,
    isFullscreen,
    isHoveringTraffic,
    setIsHoveringTraffic,
    handleClose,
    handleMinimize,
    handleMaximize,
    handleFullscreen,
    startDrag,
  };

  return (
    <WindowContext.Provider value={contextValue}>
      <div class="window-chrome" classList={{ "window-chrome--unfocused": !isFocused() }}>
        {props.children}
      </div>
    </WindowContext.Provider>
  );
}
