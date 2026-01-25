import { createSignal, onMount, onCleanup, JSX, createEffect, Accessor } from "solid-js";
import "./CursorPopup.css";

export interface CursorPopupPosition {
  /** X coordinate of the anchor point (usually cursor position) */
  x: number;
  /** Y coordinate for positioning below (bottom of anchor element) */
  anchorBottom: number;
  /** Y coordinate for positioning above (top of anchor element) */
  anchorTop: number;
}

export interface CursorPopupProps {
  /** Position of the anchor point (cursor) in viewport coordinates */
  position: Accessor<CursorPopupPosition | null>;
  /** Preferred vertical placement relative to anchor */
  preferredPlacement?: "above" | "below";
  /** Horizontal alignment relative to anchor */
  horizontalAlign?: "left" | "center" | "right";
  /** Optional fixed width for the popup (used for centering calculations) */
  width?: number;
  /** Optional max-width for the popup */
  maxWidth?: number;
  /** Optional max-height for the popup */
  maxHeight?: number;
  /** Minimum margin from viewport edges */
  viewportMargin?: number;
  /** Additional CSS class */
  class?: string;
  /** Callback when vertical flip occurs */
  onFlip?: (flipped: boolean) => void;
  /** Children to render inside the popup */
  children: JSX.Element;
  /** Click handler for the popup */
  onClick?: (e: MouseEvent) => void;
  /** Title attribute */
  title?: string;
}

export interface ComputedPosition {
  left: number;
  top: number | null;
  bottom: number | null;
  flippedVertically: boolean;
  flippedHorizontally: boolean;
}

export interface ComputePositionInput {
  anchorX: number;
  anchorTop: number;
  anchorBottom: number;
  popupWidth: number;
  popupHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  preferredPlacement: "above" | "below";
  horizontalAlign: "left" | "center" | "right";
  margin: number;
  gap: number;
}

/**
 * Pure function to compute popup position with viewport boundary detection.
 * Extracted for testability.
 */
export function computePopupPosition(input: ComputePositionInput): ComputedPosition {
  const {
    anchorX,
    anchorTop,
    anchorBottom,
    popupWidth,
    popupHeight,
    viewportWidth,
    viewportHeight,
    preferredPlacement,
    horizontalAlign,
    margin,
    gap,
  } = input;

  // Compute initial horizontal position based on alignment
  let left: number;
  switch (horizontalAlign) {
    case "center":
      left = anchorX - popupWidth / 2;
      break;
    case "right":
      left = anchorX - popupWidth;
      break;
    case "left":
    default:
      left = anchorX;
      break;
  }

  // Horizontal boundary check - keep popup within viewport
  let flippedHorizontally = false;
  if (left < margin) {
    left = margin;
    flippedHorizontally = horizontalAlign === "center";
  } else if (left + popupWidth > viewportWidth - margin) {
    left = viewportWidth - margin - popupWidth;
    flippedHorizontally = horizontalAlign === "center";
  }

  // Vertical placement logic
  // spaceAbove = space from viewport top to anchor top
  // spaceBelow = space from anchor bottom to viewport bottom
  const spaceAbove = anchorTop;
  const spaceBelow = viewportHeight - anchorBottom;
  
  let flippedVertically = false;
  let top: number | null = null;
  let bottom: number | null = null;

  // Determine if we need to flip based on available space
  const needsFlipToAbove = preferredPlacement === "below" && 
    spaceBelow < popupHeight + margin && 
    spaceAbove > spaceBelow;
  const needsFlipToBelow = preferredPlacement === "above" && 
    spaceAbove < popupHeight + margin && 
    spaceBelow > spaceAbove;
  
  const actualPlacement = needsFlipToAbove ? "above" : needsFlipToBelow ? "below" : preferredPlacement;
  flippedVertically = actualPlacement !== preferredPlacement;

  if (actualPlacement === "above") {
    // Position above: popup bottom edge should be at anchorTop - gap
    // CSS bottom = viewportHeight - (anchorTop - gap)
    bottom = viewportHeight - anchorTop + gap;
    // Ensure popup doesn't go above viewport top
    const popupTop = viewportHeight - bottom - popupHeight;
    if (popupTop < margin) {
      bottom = viewportHeight - margin - popupHeight;
    }
  } else {
    // Position below: popup top edge should be at anchorBottom + gap
    top = anchorBottom + gap;
    // Ensure popup doesn't go below viewport bottom
    if (top + popupHeight > viewportHeight - margin) {
      top = viewportHeight - margin - popupHeight;
    }
  }

  return { left, top, bottom, flippedVertically, flippedHorizontally };
}

/**
 * CursorPopup is a unified component for all cursor-anchored popups in the editor.
 * It handles viewport boundary detection and ensures the popup never hangs off screen.
 */
export function CursorPopup(props: CursorPopupProps) {
  let popupRef: HTMLDivElement | undefined;
  const [computedPos, setComputedPos] = createSignal<ComputedPosition | null>(null);
  let resizeObserver: ResizeObserver | null = null;

  const computePosition = () => {
    const pos = props.position();
    if (!pos || !popupRef) return;

    const rect = popupRef.getBoundingClientRect();
    // If element has no size yet (first render), use a reasonable default
    const popupWidth = props.width ?? (rect.width > 0 ? rect.width : 200);
    const popupHeight = rect.height > 0 ? rect.height : 100;
    
    const result = computePopupPosition({
      anchorX: pos.x,
      anchorTop: pos.anchorTop,
      anchorBottom: pos.anchorBottom,
      popupWidth,
      popupHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      preferredPlacement: props.preferredPlacement ?? "below",
      horizontalAlign: props.horizontalAlign ?? "left",
      margin: props.viewportMargin ?? 8,
      gap: 4,
    });

    setComputedPos(result);
    props.onFlip?.(result.flippedVertically);
  };

  // Set up ref callback to initialize when element is ready
  const setRef = (el: HTMLDivElement) => {
    popupRef = el;
    
    // Set up resize observer
    resizeObserver = new ResizeObserver(() => {
      computePosition();
    });
    resizeObserver.observe(el);
    
    // Initial position computation
    computePosition();
  };

  // Recompute position when anchor changes
  createEffect(() => {
    const pos = props.position();
    if (pos && popupRef) {
      computePosition();
    }
  });

  onMount(() => {
    // Recompute on window resize
    const handleResize = () => computePosition();
    window.addEventListener("resize", handleResize);
    onCleanup(() => {
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
    });
  });

  // Derive style values reactively
  const style = (): JSX.CSSProperties => {
    const pos = computedPos();
    return {
      left: pos ? `${pos.left}px` : "0px",
      top: pos?.top != null ? `${pos.top}px` : "auto",
      bottom: pos?.bottom != null ? `${pos.bottom}px` : "auto",
      "max-width": props.maxWidth ? `${props.maxWidth}px` : undefined,
      "max-height": props.maxHeight ? `${props.maxHeight}px` : undefined,
      width: props.width ? `${props.width}px` : undefined,
      visibility: pos ? "visible" : "hidden",
    };
  };
  
  return (
    <div
      ref={setRef}
      class={`cursor-popup ${props.class ?? ""}`}
      classList={{
        "cursor-popup--flipped-vertically": computedPos()?.flippedVertically,
        "cursor-popup--flipped-horizontally": computedPos()?.flippedHorizontally,
      }}
      style={style()}
      onClick={props.onClick}
      title={props.title}
    >
      {props.children}
    </div>
  );
}
