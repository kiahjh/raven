import { Switch, Match } from "solid-js";
import { SurfaceLeaf, surfaceState, setFocused } from "../store/surface";
import { projectState } from "../store/project";
import { TerminalSurface } from "./TerminalSurface";
import "./Surface.css";

interface Props {
  node: SurfaceLeaf;
}

export function Surface(props: Props) {
  const isFocused = () => surfaceState.focusedId === props.node.id;

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
            <div class="surface__hints">
              <div class="surface__hint">
                <kbd>e</kbd>
                <span>editor</span>
              </div>
              <div class="surface__hint">
                <kbd>t</kbd>
                <span>terminal</span>
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
          <div class="surface__content">
            <div class="surface__placeholder">
              <span class="surface__type">editor (coming soon)</span>
            </div>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
