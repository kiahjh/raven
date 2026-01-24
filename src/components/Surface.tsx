import { Switch, Match, createSignal, onMount } from "solid-js";
import { getVersion } from "@tauri-apps/api/app";
import { SurfaceLeaf, surfaceState, setFocused } from "../store/surface";
import { projectState } from "../store/project";
import { TerminalSurface } from "./TerminalSurface";
import { EditorSurface } from "./EditorSurface";
import "./Surface.css";

interface Props {
  node: SurfaceLeaf;
}

// Cache the version so we only fetch it once
let cachedVersion: string | null = null;

export function Surface(props: Props) {
  const isFocused = () => surfaceState.focusedId === props.node.id;
  const [version, setVersion] = createSignal(cachedVersion ?? "");
  
  onMount(async () => {
    if (!cachedVersion) {
      try {
        cachedVersion = await getVersion();
        setVersion(cachedVersion);
      } catch {
        // In dev mode, version might not be available
        setVersion("dev");
      }
    }
  });

  return (
    <div
      class="surface"
      classList={{
        "surface--focused": isFocused(),
        [`surface--${props.node.type}`]: true,
      }}
      onClick={() => setFocused(props.node.id)}
    >
      <Switch>
        <Match when={props.node.type === "empty"}>
          <div class="surface__content">
            <div class="surface__placeholder">
              <div class="surface__title">Raven v{version()}</div>
              <div class="surface__hints">
                <div class="surface__hint">
                  <span class="surface__hint-key">e</span>
                  <span class="surface__hint-label">editor</span>
                </div>
                <div class="surface__hint">
                  <span class="surface__hint-key">t</span>
                  <span class="surface__hint-label">terminal</span>
                </div>
              </div>
            </div>
          </div>
        </Match>
        <Match when={props.node.type === "terminal"}>
          <TerminalSurface 
            id={props.node.id} 
            focused={isFocused()} 
            projectPath={projectState.current?.path ?? null}
          />
        </Match>
        <Match when={props.node.type === "editor"}>
          <EditorSurface
            id={props.node.id}
            focused={isFocused()}
            filePath={props.node.filePath}
          />
        </Match>
      </Switch>
    </div>
  );
}
