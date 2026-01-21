import { Match, Switch, Index } from "solid-js";
import { SurfaceNode as SurfaceNodeType, SurfaceSplit, updateSplitSizes } from "../store/surface";
import { Surface } from "./Surface";
import { ResizeHandle } from "./ResizeHandle";
import "./SurfaceNode.css";

interface Props {
  node: SurfaceNodeType;
}

export function SurfaceNode(props: Props) {
  return (
    <Switch>
      <Match when={props.node.kind === "leaf"}>
        <Surface node={props.node as SurfaceNodeType & { kind: "leaf" }} />
      </Match>
      <Match when={props.node.kind === "split"}>
        {(() => {
          const split = () => props.node as SurfaceSplit;
          
          let containerRef: HTMLDivElement | undefined;
          
          const handleResize = (handleIndex: number, delta: number) => {
            const s = split();
            if (!containerRef) return;
            
            // Get actual container size
            const containerSize = s.direction === "horizontal" 
              ? containerRef.offsetWidth 
              : containerRef.offsetHeight;
            
            const totalSize = s.sizes.reduce((a, b) => a + b, 0);
            const newSizes = [...s.sizes];
            
            // Convert delta (pixels) to ratio change
            const deltaRatio = (delta / containerSize) * totalSize;
            
            // Adjust the sizes on either side of the handle
            newSizes[handleIndex] = Math.max(0.1, newSizes[handleIndex] + deltaRatio);
            newSizes[handleIndex + 1] = Math.max(0.1, newSizes[handleIndex + 1] - deltaRatio);
            
            updateSplitSizes(s.id, newSizes);
          };
          
          return (
            <div
              ref={containerRef}
              class="surface-split"
              classList={{
                "surface-split--horizontal": split().direction === "horizontal",
                "surface-split--vertical": split().direction === "vertical",
              }}
            >
              <Index each={split().children}>
                {(child, index) => (
                  <>
                    {index > 0 && (
                      <ResizeHandle
                        direction={split().direction}
                        onResize={(delta) => handleResize(index - 1, delta)}
                      />
                    )}
                    <div
                      class="surface-split__child"
                      style={{
                        flex: split().sizes[index],
                      }}
                    >
                      <SurfaceNode node={child()} />
                    </div>
                  </>
                )}
              </Index>
            </div>
          );
        })()}
      </Match>
    </Switch>
  );
}
