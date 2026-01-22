/**
 * Raven Icon Library
 * 
 * Simple, bold icons optimized for small sizes (14-20px).
 * All icons use geometric shapes for maximum visibility.
 */

import { JSX } from "solid-js";

interface IconProps {
  size?: number;
  class?: string;
}

const defaultSize = 16;

// Helper to create icon component
// Takes a function that returns paths to ensure fresh JSX on each render
const createIcon = (getPaths: () => JSX.Element, viewBox = "0 0 16 16") => {
  return (props: IconProps) => (
    <svg
      width={props.size ?? defaultSize}
      height={props.size ?? defaultSize}
      viewBox={viewBox}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      class={props.class}
    >
      {getPaths()}
    </svg>
  );
};

// ============================================================================
// LSP Completion Icons - Geometric shapes for clarity at small sizes
// ============================================================================

/** Function icon - parentheses () */
export const IconFunction = createIcon(() => (
  <>
    <path d="M6 4C4 4 3 6 3 8C3 10 4 12 6 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M10 4C12 4 13 6 13 8C13 10 12 12 10 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </>
));

/** Method icon - dot + parentheses */
export const IconMethod = createIcon(() => (
  <>
    <circle cx="4" cy="8" r="2" fill="currentColor"/>
    <path d="M9 5C8 5 7 6 7 8C7 10 8 11 9 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M11 5C12 5 13 6 13 8C13 10 12 11 11 11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </>
));

/** Variable icon - x shape */
export const IconVariable = createIcon(() => (
  <>
    <path d="M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M12 4L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </>
));

/** Field icon - horizontal line with dot */
export const IconField = createIcon(() => (
  <>
    <circle cx="4" cy="8" r="2.5" fill="currentColor"/>
    <rect x="8" y="6.5" width="6" height="3" rx="1" fill="currentColor"/>
  </>
));

/** Property icon - key shape */
export const IconProperty = createIcon(() => (
  <>
    <circle cx="5" cy="8" r="3" stroke="currentColor" stroke-width="2"/>
    <rect x="8" y="7" width="6" height="2" fill="currentColor"/>
  </>
));

/** Class icon - letter C */
export const IconClass = createIcon(() => (
  <path d="M12 4C11 3 9.5 2 7.5 2C4 2 2 5 2 8C2 11 4 14 7.5 14C9.5 14 11 13 12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
));

/** Struct icon - curly braces */
export const IconStruct = createIcon(() => (
  <>
    <path d="M6 2C4 2 3 3 3 4V6.5C3 7 2.5 7.5 2 8C2.5 8.5 3 9 3 9.5V12C3 13 4 14 6 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M10 2C12 2 13 3 13 4V6.5C13 7 13.5 7.5 14 8C13.5 8.5 13 9 13 9.5V12C13 13 12 14 10 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </>
));

/** Interface icon - letter I */
export const IconInterface = createIcon(() => (
  <>
    <rect x="6" y="2" width="4" height="12" fill="currentColor"/>
    <rect x="3" y="2" width="10" height="3" fill="currentColor"/>
    <rect x="3" y="11" width="10" height="3" fill="currentColor"/>
  </>
));

/** Module icon - stacked boxes */
export const IconModule = createIcon(() => (
  <>
    <rect x="2" y="5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="2"/>
    <path d="M5 5V3C5 2.5 5.5 2 6 2H13C13.5 2 14 2.5 14 3V10C14 10.5 13.5 11 13 11H11" stroke="currentColor" stroke-width="2"/>
  </>
));

/** Enum icon - list of 3 dots */
export const IconEnum = createIcon(() => (
  <>
    <circle cx="4" cy="4" r="2" fill="currentColor"/>
    <circle cx="4" cy="8" r="2" fill="currentColor"/>
    <circle cx="4" cy="12" r="2" fill="currentColor"/>
    <rect x="8" y="3" width="6" height="2" rx="1" fill="currentColor"/>
    <rect x="8" y="7" width="6" height="2" rx="1" fill="currentColor"/>
    <rect x="8" y="11" width="6" height="2" rx="1" fill="currentColor"/>
  </>
));

/** Enum member icon - single filled square */
export const IconEnumMember = createIcon(() => (
  <rect x="4" y="4" width="8" height="8" rx="1" fill="currentColor"/>
));

/** Constant icon - diamond/rhombus */
export const IconConstant = createIcon(() => (
  <path d="M8 2L14 8L8 14L2 8L8 2Z" fill="currentColor"/>
));

/** Keyword icon - letter K */
export const IconKeyword = createIcon(() => (
  <>
    <rect x="2" y="2" width="3" height="12" fill="currentColor"/>
    <path d="M5 8L12 2" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
    <path d="M5 8L12 14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>
  </>
));

/** Snippet icon - curly braces */
export const IconSnippet = createIcon(() => (
  <>
    <path d="M6 3C4 3 3 4 3 5V7C3 7.5 2.5 8 2 8C2.5 8 3 8.5 3 9V11C3 12 4 13 6 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M10 3C12 3 13 4 13 5V7C13 7.5 13.5 8 14 8C13.5 8 13 8.5 13 9V11C13 12 12 13 10 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </>
));

/** Text icon - 3 horizontal lines */
export const IconText = createIcon(() => (
  <>
    <rect x="3" y="3" width="10" height="2" rx="1" fill="currentColor"/>
    <rect x="3" y="7" width="8" height="2" rx="1" fill="currentColor"/>
    <rect x="3" y="11" width="6" height="2" rx="1" fill="currentColor"/>
  </>
));

/** Constructor icon - arrow pointing into box */
export const IconConstructor = createIcon(() => (
  <>
    <rect x="6" y="3" width="8" height="10" rx="1" stroke="currentColor" stroke-width="2"/>
    <path d="M2 8H7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M5 5.5L7.5 8L5 10.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </>
));

/** Value icon - equals sign */
export const IconValue = createIcon(() => (
  <>
    <rect x="3" y="5" width="10" height="2" rx="1" fill="currentColor"/>
    <rect x="3" y="9" width="10" height="2" rx="1" fill="currentColor"/>
  </>
));

/** Unit icon - ruler marks */
export const IconUnit = createIcon(() => (
  <>
    <rect x="3" y="3" width="2" height="10" fill="currentColor"/>
    <rect x="5" y="3" width="6" height="2" fill="currentColor"/>
    <rect x="5" y="7" width="4" height="2" fill="currentColor"/>
    <rect x="5" y="11" width="6" height="2" fill="currentColor"/>
  </>
));

/** Color icon - filled circle with outline */
export const IconColor = createIcon(() => (
  <>
    <circle cx="8" cy="8" r="5" fill="currentColor"/>
    <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1"/>
  </>
));

/** File icon - document */
export const IconFile = createIcon(() => (
  <>
    <path d="M4 2H10L13 5V14H4V2Z" fill="currentColor"/>
    <path d="M10 2V5H13" stroke="currentColor" stroke-width="1"/>
  </>
));

/** Folder icon */
export const IconFolder = createIcon(() => (
  <path d="M2 5V13H14V5H8L6.5 3H2V5Z" fill="currentColor"/>
));

/** Reference icon - chain links */
export const IconReference = createIcon(() => (
  <>
    <rect x="2" y="5" width="5" height="6" rx="2" stroke="currentColor" stroke-width="2"/>
    <rect x="9" y="5" width="5" height="6" rx="2" stroke="currentColor" stroke-width="2"/>
    <rect x="6" y="7" width="4" height="2" fill="currentColor"/>
  </>
));

/** Operator icon - plus */
export const IconOperator = createIcon(() => (
  <>
    <rect x="7" y="3" width="2" height="10" fill="currentColor"/>
    <rect x="3" y="7" width="10" height="2" fill="currentColor"/>
  </>
));

/** Type parameter icon - angle brackets */
export const IconTypeParameter = createIcon(() => (
  <>
    <path d="M5 4L2 8L5 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11 4L14 8L11 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </>
));

/** Event icon - lightning bolt */
export const IconEvent = createIcon(() => (
  <path d="M9 2L4 9H8L7 14L12 7H8L9 2Z" fill="currentColor"/>
));

/** Macro icon - hash/pound */
export const IconMacro = createIcon(() => (
  <>
    <rect x="5" y="2" width="2" height="12" fill="currentColor"/>
    <rect x="9" y="2" width="2" height="12" fill="currentColor"/>
    <rect x="2" y="5" width="12" height="2" fill="currentColor"/>
    <rect x="2" y="9" width="12" height="2" fill="currentColor"/>
  </>
));

// ============================================================================
// Diagnostic Icons
// ============================================================================

/** Error icon - filled circle */
export const IconError = createIcon(() => (
  <circle cx="8" cy="8" r="6" fill="currentColor"/>
));

/** Warning icon - triangle */
export const IconWarning = createIcon(() => (
  <path d="M8 2L14 13H2L8 2Z" fill="currentColor"/>
));

/** Info icon - diamond */
export const IconInfo = createIcon(() => (
  <path d="M8 2L14 8L8 14L2 8L8 2Z" fill="currentColor"/>
));

/** Hint icon - hollow circle */
export const IconHint = createIcon(() => (
  <circle cx="8" cy="8" r="5" stroke="currentColor" stroke-width="2"/>
));

// ============================================================================
// UI Icons
// ============================================================================

/** Close icon - X */
export const IconClose = createIcon(() => (
  <>
    <path d="M4 4L12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M12 4L4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </>
));

/** Check icon */
export const IconCheck = createIcon(() => (
  <path d="M3 8L6 11L13 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
));

/** Arrow right icon */
export const IconArrowRight = createIcon(() => (
  <>
    <path d="M3 8H13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M9 4L13 8L9 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </>
));

/** Search icon - magnifying glass */
export const IconSearch = createIcon(() => (
  <>
    <circle cx="7" cy="7" r="4" stroke="currentColor" stroke-width="2"/>
    <path d="M10 10L14 14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </>
));

/** Settings icon - gear */
export const IconSettings = createIcon(() => (
  <>
    <circle cx="8" cy="8" r="2" stroke="currentColor" stroke-width="2"/>
    <path d="M8 2V4M8 12V14M2 8H4M12 8H14M3.5 3.5L5 5M11 11L12.5 12.5M3.5 12.5L5 11M11 5L12.5 3.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </>
));

/** Terminal icon */
export const IconTerminal = createIcon(() => (
  <>
    <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" stroke-width="2"/>
    <path d="M4 7L6 9L4 11" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M8 11H11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </>
));

/** Split vertical icon */
export const IconSplitVertical = createIcon(() => (
  <>
    <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" stroke-width="2"/>
    <path d="M8 2V14" stroke="currentColor" stroke-width="2"/>
  </>
));

/** Split horizontal icon */
export const IconSplitHorizontal = createIcon(() => (
  <>
    <rect x="2" y="2" width="12" height="12" rx="1" stroke="currentColor" stroke-width="2"/>
    <path d="M2 8H14" stroke="currentColor" stroke-width="2"/>
  </>
));

// ============================================================================
// Icon Map for LSP Completion Kinds
// ============================================================================

/** Map of LSP completion kind numbers to icon components */
export const completionKindIcons: Record<number, (props: IconProps) => JSX.Element> = {
  1: IconText,        // Text
  2: IconMethod,      // Method
  3: IconFunction,    // Function
  4: IconConstructor, // Constructor
  5: IconField,       // Field
  6: IconVariable,    // Variable
  7: IconClass,       // Class
  8: IconInterface,   // Interface
  9: IconModule,      // Module
  10: IconProperty,   // Property
  11: IconUnit,       // Unit
  12: IconValue,      // Value
  13: IconEnum,       // Enum
  14: IconKeyword,    // Keyword
  15: IconSnippet,    // Snippet
  16: IconColor,      // Color
  17: IconFile,       // File
  18: IconReference,  // Reference
  19: IconFolder,     // Folder
  20: IconEnumMember, // EnumMember
  21: IconConstant,   // Constant
  22: IconStruct,     // Struct
  23: IconEvent,      // Event
  24: IconOperator,   // Operator
  25: IconTypeParameter, // TypeParameter
};

/** Get the icon component for a completion kind */
export function getCompletionIcon(kind: number | undefined): (props: IconProps) => JSX.Element {
  if (kind === undefined || !completionKindIcons[kind]) {
    return IconText; // Default fallback
  }
  return completionKindIcons[kind];
}
