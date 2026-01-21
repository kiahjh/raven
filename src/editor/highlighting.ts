/**
 * Syntax highlighting using Tree-sitter.
 * 
 * This module provides incremental syntax highlighting by parsing source code
 * with Tree-sitter and mapping AST nodes to highlight captures.
 */

import { Parser, Language, Tree, Query, Edit } from "web-tree-sitter";

// ============================================================================
// Types
// ============================================================================

export interface HighlightToken {
  /** Start column (0-indexed) */
  startCol: number;
  /** End column (exclusive) */
  endCol: number;
  /** Highlight category (e.g., "keyword", "string", "function") */
  type: string;
}

export interface HighlightResult {
  /** Tokens for each line, keyed by line number */
  lines: Map<number, HighlightToken[]>;
}

export type LanguageId = 
  | "typescript"
  | "tsx"
  | "javascript"
  | "rust"
  | "json"
  | "css"
  | "html";

interface LanguageConfig {
  wasmPath: string;
  highlightQuery: string;
}

// ============================================================================
// Highlight Queries (defined before use)
// ============================================================================

// TypeScript highlight queries
const TYPESCRIPT_HIGHLIGHTS = `
; Keywords
[
  "as"
  "async"
  "await"
  "break"
  "case"
  "catch"
  "class"
  "const"
  "continue"
  "debugger"
  "default"
  "delete"
  "do"
  "else"
  "enum"
  "export"
  "extends"
  "finally"
  "for"
  "from"
  "function"
  "get"
  "if"
  "implements"
  "import"
  "in"
  "instanceof"
  "interface"
  "let"
  "new"
  "of"
  "private"
  "protected"
  "public"
  "readonly"
  "return"
  "set"
  "static"
  "switch"
  "throw"
  "try"
  "type"
  "typeof"
  "var"
  "void"
  "while"
  "with"
  "yield"
] @keyword

; Literals
(string) @string
(template_string) @string
(number) @number
(true) @boolean
(false) @boolean
(null) @constant.builtin
(undefined) @constant.builtin

; Comments
(comment) @comment

; Functions
(function_declaration name: (identifier) @function)
(method_definition name: (property_identifier) @function)
(call_expression function: (identifier) @function.call)
(call_expression function: (member_expression property: (property_identifier) @function.call))
(arrow_function) @function

; Types
(type_identifier) @type
(predefined_type) @type.builtin

; Variables and properties
(identifier) @variable
(property_identifier) @property
(shorthand_property_identifier) @property

; Parameters
(formal_parameters (identifier) @parameter)
(required_parameter (identifier) @parameter)
(optional_parameter (identifier) @parameter)

; Operators
[
  "+"
  "-"
  "*"
  "/"
  "%"
  "**"
  "="
  "+="
  "-="
  "*="
  "/="
  "%="
  "=="
  "==="
  "!="
  "!=="
  "<"
  ">"
  "<="
  ">="
  "&&"
  "||"
  "!"
  "?"
  ":"
  "??"
  "?."
  "=>"
  "..."
] @operator

; Punctuation
[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  ";"
  ","
  "."
] @punctuation.delimiter
`;

const TSX_HIGHLIGHTS = TYPESCRIPT_HIGHLIGHTS + `
; JSX
(jsx_element
  open_tag: (jsx_opening_element name: (_) @tag))
(jsx_element
  close_tag: (jsx_closing_element name: (_) @tag))
(jsx_self_closing_element name: (_) @tag)
(jsx_attribute (property_identifier) @attribute)
`;

const JAVASCRIPT_HIGHLIGHTS = `
; Keywords
[
  "as"
  "async"
  "await"
  "break"
  "case"
  "catch"
  "class"
  "const"
  "continue"
  "debugger"
  "default"
  "delete"
  "do"
  "else"
  "export"
  "extends"
  "finally"
  "for"
  "from"
  "function"
  "get"
  "if"
  "import"
  "in"
  "instanceof"
  "let"
  "new"
  "of"
  "return"
  "set"
  "static"
  "switch"
  "throw"
  "try"
  "typeof"
  "var"
  "void"
  "while"
  "with"
  "yield"
] @keyword

; Literals
(string) @string
(template_string) @string
(number) @number
(true) @boolean
(false) @boolean
(null) @constant.builtin

; Comments
(comment) @comment

; Functions
(function_declaration name: (identifier) @function)
(method_definition name: (property_identifier) @function)
(call_expression function: (identifier) @function.call)
(call_expression function: (member_expression property: (property_identifier) @function.call))

; Variables and properties
(identifier) @variable
(property_identifier) @property
(shorthand_property_identifier) @property

; Parameters
(formal_parameters (identifier) @parameter)

; Operators
[
  "+"
  "-"
  "*"
  "/"
  "%"
  "**"
  "="
  "+="
  "-="
  "*="
  "/="
  "%="
  "=="
  "==="
  "!="
  "!=="
  "<"
  ">"
  "<="
  ">="
  "&&"
  "||"
  "!"
  "?"
  ":"
  "??"
  "?."
  "=>"
  "..."
] @operator

; Punctuation
[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  ";"
  ","
  "."
] @punctuation.delimiter
`;

const RUST_HIGHLIGHTS = `
; Identifiers and types
(type_identifier) @type
(primitive_type) @type.builtin
(field_identifier) @property

; Function calls
(call_expression
  function: (identifier) @function)
(call_expression
  function: (field_expression
    field: (field_identifier) @function.method))
(call_expression
  function: (scoped_identifier
    name: (identifier) @function))

(generic_function
  function: (identifier) @function)
(generic_function
  function: (scoped_identifier
    name: (identifier) @function))

; Macros
(macro_invocation
  macro: (identifier) @function.macro
  "!" @function.macro)

; Function definitions
(function_item (identifier) @function)
(function_signature_item (identifier) @function)

; Comments
(line_comment) @comment
(block_comment) @comment

; Punctuation
"(" @punctuation.bracket
")" @punctuation.bracket
"[" @punctuation.bracket
"]" @punctuation.bracket
"{" @punctuation.bracket
"}" @punctuation.bracket

(type_arguments
  "<" @punctuation.bracket
  ">" @punctuation.bracket)
(type_parameters
  "<" @punctuation.bracket
  ">" @punctuation.bracket)

"::" @punctuation.delimiter
":" @punctuation.delimiter
"." @punctuation.delimiter
"," @punctuation.delimiter
";" @punctuation.delimiter

; Parameters
(parameter (identifier) @variable.parameter)

; Lifetimes
(lifetime (identifier) @label)

; Keywords (individual lines, not in a list)
"as" @keyword
"async" @keyword
"await" @keyword
"break" @keyword
"const" @keyword
"continue" @keyword
"default" @keyword
"dyn" @keyword
"else" @keyword
"enum" @keyword
"extern" @keyword
"fn" @keyword
"for" @keyword
"if" @keyword
"impl" @keyword
"in" @keyword
"let" @keyword
"loop" @keyword
"match" @keyword
"mod" @keyword
"move" @keyword
"pub" @keyword
"ref" @keyword
"return" @keyword
"static" @keyword
"struct" @keyword
"trait" @keyword
"type" @keyword
"union" @keyword
"unsafe" @keyword
"use" @keyword
"where" @keyword
"while" @keyword
"yield" @keyword

; Node types for special keywords
(crate) @keyword
(mutable_specifier) @keyword
(super) @keyword

; Self
(self) @variable.builtin

; Literals
(char_literal) @string
(string_literal) @string
(raw_string_literal) @string

(boolean_literal) @constant.builtin
(integer_literal) @constant.builtin
(float_literal) @constant.builtin

(escape_sequence) @escape

; Attributes
(attribute_item) @attribute
(inner_attribute_item) @attribute

; Operators
"*" @operator
"&" @operator
"'" @operator

; Variables (catch-all, should be last)
(identifier) @variable
`;

const JSON_HIGHLIGHTS = `
(string) @string
(number) @number
(true) @boolean
(false) @boolean
(null) @constant.builtin
(pair key: (string) @property)
`;

const CSS_HIGHLIGHTS = `
; Selectors
(tag_name) @tag
(class_name) @type
(id_name) @constant
(pseudo_class_selector (class_name) @attribute)
(pseudo_element_selector (tag_name) @attribute)

; Properties
(property_name) @property

; Values
(string_value) @string
(color_value) @constant
(integer_value) @number
(float_value) @number
(plain_value) @variable

; Keywords
[
  "important"
  "and"
  "or"
  "not"
  "only"
] @keyword

; At-rules
(at_keyword) @keyword

; Comments
(comment) @comment

; Punctuation
[
  "{"
  "}"
  "("
  ")"
  "["
  "]"
] @punctuation.bracket

[
  ";"
  ":"
  ","
] @punctuation.delimiter
`;

const HTML_HIGHLIGHTS = `
; Tags
(tag_name) @tag
(erroneous_end_tag_name) @tag

; Attributes
(attribute_name) @attribute
(attribute_value) @string

; Text and special
(text) @variable
(comment) @comment

; Doctype
(doctype) @keyword

; Punctuation
[
  "<"
  ">"
  "</"
  "/>"
  "="
] @punctuation.bracket
`;

// ============================================================================
// Language Configurations
// ============================================================================

const LANGUAGE_CONFIGS: Record<LanguageId, LanguageConfig> = {
  typescript: {
    wasmPath: "/tree-sitter/tree-sitter-typescript.wasm",
    highlightQuery: TYPESCRIPT_HIGHLIGHTS,
  },
  tsx: {
    wasmPath: "/tree-sitter/tree-sitter-tsx.wasm",
    highlightQuery: TSX_HIGHLIGHTS,
  },
  javascript: {
    wasmPath: "/tree-sitter/tree-sitter-javascript.wasm",
    highlightQuery: JAVASCRIPT_HIGHLIGHTS,
  },
  rust: {
    wasmPath: "/tree-sitter/tree-sitter-rust.wasm",
    highlightQuery: RUST_HIGHLIGHTS,
  },
  json: {
    wasmPath: "/tree-sitter/tree-sitter-json.wasm",
    highlightQuery: JSON_HIGHLIGHTS,
  },
  css: {
    wasmPath: "/tree-sitter/tree-sitter-css.wasm",
    highlightQuery: CSS_HIGHLIGHTS,
  },
  html: {
    wasmPath: "/tree-sitter/tree-sitter-html.wasm",
    highlightQuery: HTML_HIGHLIGHTS,
  },
};

// Map file extensions to language IDs
const EXTENSION_MAP: Record<string, LanguageId> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "javascript",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".rs": "rust",
  ".json": "json",
  ".css": "css",
  ".html": "html",
  ".htm": "html",
};

// ============================================================================
// Highlighter Class
// ============================================================================

export class Highlighter {
  private parser: Parser | null = null;
  private languages: Map<LanguageId, Language> = new Map();
  private queries: Map<LanguageId, Query> = new Map();
  private currentLanguage: LanguageId | null = null;
  private currentTree: Tree | null = null;
  private currentFilePath: string | null = null;
  private initialized = false;

  /**
   * Initialize the Tree-sitter parser.
   * Must be called before any other methods.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    
    await Parser.init({
      locateFile: (scriptName: string) => {
        // Return path to tree-sitter.wasm
        if (scriptName.includes("tree-sitter.wasm")) {
          return "/tree-sitter/web-tree-sitter.wasm";
        }
        return scriptName;
      },
    });
    
    this.parser = new Parser();
    this.initialized = true;
  }

  /**
   * Get the language ID for a file path based on extension.
   */
  getLanguageForFile(filePath: string): LanguageId | null {
    const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    return EXTENSION_MAP[ext] ?? null;
  }

  /**
   * Load a language grammar if not already loaded.
   */
  async loadLanguage(langId: LanguageId): Promise<boolean> {
    if (!this.initialized || !this.parser) {
      return false;
    }

    // Check if both language AND query are loaded (previous load might have partially failed)
    if (this.languages.has(langId) && this.queries.has(langId)) {
      return true;
    }

    const config = LANGUAGE_CONFIGS[langId];
    if (!config) {
      return false;
    }

    try {
      // Load language if not already loaded
      let language = this.languages.get(langId);
      if (!language) {
        language = await Language.load(config.wasmPath);
        this.languages.set(langId, language);
      }
      
      // Create the highlight query if not already created
      if (!this.queries.has(langId)) {
        const query = new Query(language, config.highlightQuery);
        this.queries.set(langId, query);
      }
      
      return true;
    } catch (error) {
      console.error(`[Highlighter] Failed to load language ${langId}:`, error);
      // Clean up partial state on failure
      this.languages.delete(langId);
      this.queries.delete(langId);
      return false;
    }
  }

  /**
   * Set the current language for parsing.
   */
  setLanguage(langId: LanguageId): boolean {
    if (!this.parser) return false;
    
    const language = this.languages.get(langId);
    if (!language) return false;
    
    this.parser.setLanguage(language);
    this.currentLanguage = langId;
    this.currentTree = null; // Reset tree when language changes
    return true;
  }

  /**
   * Parse a file and return highlight tokens.
   * Handles file switching by resetting state when the file path changes.
   */
  parseFile(filePath: string, langId: LanguageId, source: string): HighlightResult {
    // Reset tree if file changed (prevents using old tree for wrong file)
    if (filePath !== this.currentFilePath) {
      this.currentTree = null;
      this.currentFilePath = filePath;
    }
    
    // Set language (also resets tree if language changed)
    if (langId !== this.currentLanguage) {
      this.setLanguage(langId);
    }
    
    return this.parse(source);
  }

  /**
   * Parse source code and return highlight tokens.
   * Uses incremental parsing if the tree already exists.
   */
  parse(source: string): HighlightResult {
    const result: HighlightResult = { lines: new Map() };
    
    if (!this.parser || !this.currentLanguage) {
      return result;
    }

    // Parse the source fresh each time
    // NOTE: We don't use incremental parsing (passing old tree) because we'd need
    // to call tree.edit() with precise edit information for it to work correctly.
    // Without edit info, tree-sitter reuses stale node positions.
    const tree = this.parser.parse(source);
    if (!tree) {
      return result;
    }
    // Clean up old tree to avoid memory leaks
    if (this.currentTree) {
      this.currentTree.delete();
    }
    this.currentTree = tree;

    // Get the highlight query for the current language
    const query = this.queries.get(this.currentLanguage);
    if (!query) {
      return result;
    }

    // Run the query to get captures
    const captures = query.captures(tree.rootNode);
    
    // Process captures into line-based tokens
    for (const capture of captures) {
      const node = capture.node;
      const captureName = capture.name;
      
      // Get the highlight type from the capture name
      const highlightType = mapCaptureToHighlight(captureName);
      if (!highlightType) continue;
      
      const startRow = node.startPosition.row;
      const endRow = node.endPosition.row;
      const startCol = node.startPosition.column;
      const endCol = node.endPosition.column;
      
      // Handle single-line tokens
      if (startRow === endRow) {
        addToken(result.lines, startRow, {
          startCol,
          endCol,
          type: highlightType,
        });
      } else {
        // Handle multi-line tokens (e.g., multi-line strings)
        // For the first line, token goes from startCol to end of line
        // We don't know line lengths here, so we use a large number
        addToken(result.lines, startRow, {
          startCol,
          endCol: 10000, // Will be clamped by the renderer
          type: highlightType,
        });
        
        // Middle lines are fully highlighted
        for (let row = startRow + 1; row < endRow; row++) {
          addToken(result.lines, row, {
            startCol: 0,
            endCol: 10000,
            type: highlightType,
          });
        }
        
        // Last line goes from start to endCol
        addToken(result.lines, endRow, {
          startCol: 0,
          endCol,
          type: highlightType,
        });
      }
    }
    
    // Sort tokens on each line by start position
    for (const [lineNum, tokens] of result.lines) {
      tokens.sort((a, b) => a.startCol - b.startCol);
      result.lines.set(lineNum, mergeOverlappingTokens(tokens));
    }
    
    return result;
  }

  /**
   * Update the tree with an edit for incremental parsing.
   * Should be called before parse() when the document is edited.
   */
  edit(
    startIndex: number,
    oldEndIndex: number,
    newEndIndex: number,
    startPosition: { row: number; column: number },
    oldEndPosition: { row: number; column: number },
    newEndPosition: { row: number; column: number }
  ): void {
    if (!this.currentTree) return;
    
    const editObj = new Edit({
      startIndex,
      oldEndIndex,
      newEndIndex,
      startPosition,
      oldEndPosition,
      newEndPosition,
    });
    
    this.currentTree.edit(editObj);
  }

  /**
   * Clean up resources.
   */
  dispose(): void {
    if (this.currentTree) {
      this.currentTree.delete();
      this.currentTree = null;
    }
    this.parser = null;
    this.languages.clear();
    this.queries.clear();
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function addToken(
  lines: Map<number, HighlightToken[]>,
  lineNum: number,
  token: HighlightToken
): void {
  if (!lines.has(lineNum)) {
    lines.set(lineNum, []);
  }
  lines.get(lineNum)!.push(token);
}

/**
 * Map Tree-sitter capture names to highlight types.
 * This normalizes various capture name conventions.
 */
function mapCaptureToHighlight(captureName: string): string | null {
  // Direct mappings for common capture names
  const directMappings: Record<string, string> = {
    "keyword": "keyword",
    "keyword.return": "keyword",
    "keyword.function": "keyword",
    "keyword.operator": "keyword",
    "keyword.import": "keyword",
    "keyword.export": "keyword",
    "keyword.conditional": "keyword",
    "keyword.repeat": "keyword",
    "keyword.control": "keyword",
    "string": "string",
    "string.special": "string",
    "string.escape": "escape",
    "number": "number",
    "float": "number",
    "boolean": "boolean",
    "comment": "comment",
    "comment.line": "comment",
    "comment.block": "comment",
    "function": "function",
    "function.call": "function",
    "function.method": "function",
    "function.builtin": "function.builtin",
    "method": "function",
    "method.call": "function",
    "type": "type",
    "type.builtin": "type.builtin",
    "class": "type",
    "interface": "type",
    "variable": "variable",
    "variable.builtin": "variable.builtin",
    "variable.parameter": "parameter",
    "parameter": "parameter",
    "property": "property",
    "field": "property",
    "attribute": "attribute",
    "constant": "constant",
    "constant.builtin": "constant.builtin",
    "operator": "operator",
    "punctuation": "punctuation",
    "punctuation.bracket": "punctuation",
    "punctuation.delimiter": "punctuation",
    "punctuation.special": "punctuation",
    "tag": "tag",
    "tag.builtin": "tag",
    "namespace": "namespace",
    "module": "namespace",
    "label": "label",
    "constructor": "constructor",
    "embedded": "embedded",
  };
  
  // Try direct match first
  if (directMappings[captureName]) {
    return directMappings[captureName];
  }
  
  // Try prefix matches
  for (const [prefix, type] of Object.entries(directMappings)) {
    if (captureName.startsWith(prefix + ".")) {
      return type;
    }
  }
  
  // Fallback: use the first part of the capture name
  const firstPart = captureName.split(".")[0];
  if (directMappings[firstPart]) {
    return directMappings[firstPart];
  }
  
  return null;
}

/**
 * Merge overlapping tokens, keeping the more specific one.
 * Tree-sitter queries can produce overlapping captures.
 */
function mergeOverlappingTokens(tokens: HighlightToken[]): HighlightToken[] {
  if (tokens.length === 0) return tokens;
  
  const result: HighlightToken[] = [];
  let current = { ...tokens[0] };
  
  for (let i = 1; i < tokens.length; i++) {
    const next = tokens[i];
    
    if (next.startCol >= current.endCol) {
      // No overlap
      result.push(current);
      current = { ...next };
    } else if (next.startCol === current.startCol && next.endCol === current.endCol) {
      // Exact overlap - keep the more specific type (longer name typically)
      if (next.type.length > current.type.length) {
        current.type = next.type;
      }
    } else if (next.startCol >= current.startCol && next.endCol <= current.endCol) {
      // next is contained within current - split current around next
      if (next.startCol > current.startCol) {
        result.push({ startCol: current.startCol, endCol: next.startCol, type: current.type });
      }
      result.push(next);
      if (next.endCol < current.endCol) {
        current = { startCol: next.endCol, endCol: current.endCol, type: current.type };
      } else {
        // Move to next token if there is one
        if (i + 1 < tokens.length) {
          current = { ...tokens[++i] };
        } else {
          current = { startCol: 0, endCol: 0, type: "" };
        }
      }
    } else {
      // Partial overlap - truncate current and add next
      current.endCol = next.startCol;
      if (current.endCol > current.startCol) {
        result.push(current);
      }
      current = { ...next };
    }
  }
  
  if (current.endCol > current.startCol) {
    result.push(current);
  }
  
  return result;
}

// ============================================================================
// Singleton Instance
// ============================================================================

let highlighterInstance: Highlighter | null = null;

/**
 * Get the singleton highlighter instance.
 */
export function getHighlighter(): Highlighter {
  if (!highlighterInstance) {
    highlighterInstance = new Highlighter();
  }
  return highlighterInstance;
}
