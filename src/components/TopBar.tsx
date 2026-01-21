import { For, Show, createSignal } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { useWindow } from "./WindowChrome";
import { projectState, setCurrentProject, Project } from "../store/project";
import "./TopBar.css";

interface Props {
  projects: Project[];
  onAddProject: (path: string) => Promise<void>;
}

export function TopBar(props: Props) {
  const window = useWindow();
  const [isHoveringTraffic, setIsHoveringTraffic] = createSignal(false);

  const handleAddProject = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open Project",
    });
    
    if (selected && typeof selected === "string") {
      await props.onAddProject(selected);
    }
  };

  const handleMouseDown = (e: MouseEvent) => {
    // Don't drag if clicking on interactive elements
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('.traffic-lights')) {
      return;
    }
    window?.startDrag();
  };

  const handleDoubleClick = (e: MouseEvent) => {
    // Double-click on topbar maximizes (native macOS behavior)
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('.traffic-lights')) {
      return;
    }
    window?.handleMaximize();
  };

  return (
    <div class="topbar" classList={{ "topbar--fullscreen": window?.isFullscreen() }} onMouseDown={handleMouseDown} onDblClick={handleDoubleClick}>
      {/* Traffic lights - hidden in fullscreen */}
      <Show when={!window?.isFullscreen()}>
        <div 
          class="traffic-lights"
          onMouseEnter={() => setIsHoveringTraffic(true)}
          onMouseLeave={() => setIsHoveringTraffic(false)}
        >
          <button 
            class="traffic-light traffic-light--close"
            classList={{ "traffic-light--inactive": !window?.isFocused() }}
            onClick={() => window?.handleClose()}
          >
            {isHoveringTraffic() && window?.isFocused() && (
              <svg viewBox="0 0 12 12">
                <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
            )}
          </button>
          <button 
            class="traffic-light traffic-light--minimize"
            classList={{ "traffic-light--inactive": !window?.isFocused() }}
            onClick={() => window?.handleMinimize()}
          >
            {isHoveringTraffic() && window?.isFocused() && (
              <svg viewBox="0 0 12 12">
                <path d="M2.5 6h7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
              </svg>
            )}
          </button>
          <button 
            class="traffic-light traffic-light--maximize"
            classList={{ "traffic-light--inactive": !window?.isFocused() }}
            onClick={() => window?.handleFullscreen()}
          >
            {isHoveringTraffic() && window?.isFocused() && (
              <svg viewBox="0 0 12 12">
                <path d="M3.5 8.5l5-5M8.5 7V3.5H5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            )}
          </button>
        </div>
      </Show>
      
      {/* Project tabs */}
      <div class="topbar__tabs">
        <For each={props.projects}>
          {(project) => (
            <button
              class="tab"
              classList={{ "tab--active": projectState.current?.path === project.path }}
              onClick={() => setCurrentProject(project.path)}
            >
              <span class="tab__name">{project.name}</span>
            </button>
          )}
        </For>
        
        <button class="topbar__add" onClick={handleAddProject}>
          <svg viewBox="0 0 12 12" fill="currentColor">
            <path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
