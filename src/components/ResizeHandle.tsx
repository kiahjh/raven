import { createSignal } from "solid-js";
import "./ResizeHandle.css";

interface Props {
  direction: "horizontal" | "vertical";
  onResize: (delta: number) => void;
}

export function ResizeHandle(props: Props) {
  const [isDragging, setIsDragging] = createSignal(false);
  
  let startPos = 0;
  
  const handleMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    startPos = props.direction === "horizontal" ? e.clientX : e.clientY;
    
    const handleMouseMove = (e: MouseEvent) => {
      const currentPos = props.direction === "horizontal" ? e.clientX : e.clientY;
      const delta = currentPos - startPos;
      if (delta !== 0) {
        props.onResize(delta);
        startPos = currentPos;
      }
    };
    
    const handleMouseUp = () => {
      setIsDragging(false);
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    document.body.style.cursor = props.direction === "horizontal" ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";
  };
  
  return (
    <div
      class="resize-handle"
      classList={{
        "resize-handle--horizontal": props.direction === "horizontal",
        "resize-handle--vertical": props.direction === "vertical",
        "resize-handle--dragging": isDragging(),
      }}
      onMouseDown={handleMouseDown}
    />
  );
}
