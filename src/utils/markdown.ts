/**
 * Markdown rendering utilities for LSP hover content.
 * Converts markdown to HTML with syntax highlighting for code blocks.
 */

import { marked } from "marked";
import { getHighlighter, type LanguageId } from "../editor/highlighting";

// Configure marked for security and features
marked.setOptions({
  gfm: true, // GitHub Flavored Markdown
  breaks: false, // Don't convert \n to <br>
});

// Map common language names to our highlighter's language IDs
const languageMap: Record<string, LanguageId> = {
  rust: "rust",
  rs: "rust",
  javascript: "javascript",
  js: "javascript",
  typescript: "typescript",
  ts: "typescript",
  tsx: "tsx",
  json: "json",
  css: "css",
  html: "html",
};

/**
 * Render a code block with syntax highlighting.
 * Returns HTML string with highlighted code.
 */
function highlightCodeBlock(code: string, language: string): string {
  const langId = languageMap[language.toLowerCase()];
  const plainCodeHtml = `<pre class="md-code-block"><code>${escapeHtml(code)}</code></pre>`;
  
  if (!langId) {
    // No highlighter for this language, return plain code
    return plainCodeHtml;
  }
  
  try {
    const highlighter = getHighlighter();
    
    // Check if language is loaded
    if (!highlighter.isLanguageLoaded(langId)) {
      // Language not loaded, return plain code
      return plainCodeHtml;
    }
    
    // Parse and highlight the code
    const result = highlighter.parseString(langId, code);
    const lines = code.split("\n");
    const htmlLines: string[] = [];
    
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const tokens = result.lines.get(lineIndex) ?? [];
      
      if (tokens.length === 0) {
        htmlLines.push(escapeHtml(line));
        continue;
      }
      
      let html = "";
      let currentPos = 0;
      
      for (const token of tokens) {
        // Add unhighlighted text before this token
        if (token.startCol > currentPos) {
          html += escapeHtml(line.slice(currentPos, token.startCol));
        }
        
        // Add highlighted token
        const tokenText = line.slice(token.startCol, token.endCol);
        const className = `syntax-${token.type.replace(/\./g, "-")}`;
        html += `<span class="${className}">${escapeHtml(tokenText)}</span>`;
        
        currentPos = token.endCol;
      }
      
      // Add remaining text
      if (currentPos < line.length) {
        html += escapeHtml(line.slice(currentPos));
      }
      
      htmlLines.push(html);
    }
    
    return `<pre class="md-code-block md-code-block--${langId}"><code>${htmlLines.join("\n")}</code></pre>`;
  } catch {
    // If highlighting fails, return plain code
    return plainCodeHtml;
  }
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Custom renderer for marked that applies syntax highlighting to code blocks.
 */
const renderer = new marked.Renderer();

renderer.code = function ({ text, lang }): string {
  return highlightCodeBlock(text, lang ?? "");
};

renderer.codespan = function ({ text }): string {
  return `<code class="md-inline-code">${escapeHtml(text)}</code>`;
};

renderer.paragraph = function ({ tokens }): string {
  const text = this.parser!.parseInline(tokens);
  return `<p class="md-paragraph">${text}</p>`;
};

renderer.link = function ({ href, text }): string {
  return `<a class="md-link" href="${href}">${text}</a>`;
};

renderer.list = function ({ items, ordered }): string {
  const tag = ordered ? "ol" : "ul";
  const itemsHtml = items.map(item => `<li>${this.parser!.parse(item.tokens)}</li>`).join("");
  return `<${tag} class="md-list">${itemsHtml}</${tag}>`;
};

renderer.heading = function ({ tokens, depth }): string {
  const text = this.parser!.parseInline(tokens);
  return `<h${depth} class="md-heading md-heading--${depth}">${text}</h${depth}>`;
};

renderer.blockquote = function ({ tokens }): string {
  const text = this.parser!.parse(tokens);
  return `<blockquote class="md-blockquote">${text}</blockquote>`;
};

renderer.hr = function (): string {
  return `<hr class="md-hr" />`;
};

renderer.strong = function ({ text }): string {
  return `<strong class="md-strong">${text}</strong>`;
};

renderer.em = function ({ text }): string {
  return `<em class="md-em">${text}</em>`;
};

/**
 * Convert markdown string to HTML.
 * Handles LSP hover content which may include:
 * - Code blocks with language annotations (```rust ... ```)
 * - Inline code (`code`)
 * - Basic formatting (bold, italic)
 * - Links
 */
export function renderMarkdown(markdown: string): string {
  try {
    return marked.parse(markdown, { renderer, async: false }) as string;
  } catch (e) {
    console.error("Markdown parsing error:", e);
    // Fallback to escaped plain text
    return `<pre>${escapeHtml(markdown)}</pre>`;
  }
}

/**
 * Check if a string looks like it contains markdown.
 * LSP hover content from rust-analyzer typically contains markdown.
 */
export function looksLikeMarkdown(text: string): boolean {
  // Check for common markdown patterns
  return (
    text.includes("```") || // Code blocks
    text.includes("`") || // Inline code
    text.includes("**") || // Bold
    text.includes("# ") || // Headers
    /\[.+\]\(.+\)/.test(text) // Links
  );
}
