import { describe, it, expect, vi, beforeEach } from "vitest";
import { uriToPath, pathToUri, DiagnosticSeverity, CompletionItemKind } from "../lsp/types";

describe("LSP Types", () => {
  describe("uriToPath", () => {
    it("converts file:// URI to path", () => {
      expect(uriToPath("file:///home/user/project/src/main.rs")).toBe(
        "/home/user/project/src/main.rs"
      );
    });

    it("returns path unchanged if not a file:// URI", () => {
      expect(uriToPath("/already/a/path")).toBe("/already/a/path");
    });

    it("handles Windows-style paths", () => {
      expect(uriToPath("file:///C:/Users/test/file.rs")).toBe(
        "/C:/Users/test/file.rs"
      );
    });
  });

  describe("pathToUri", () => {
    it("converts path to file:// URI", () => {
      expect(pathToUri("/home/user/project/src/main.rs")).toBe(
        "file:///home/user/project/src/main.rs"
      );
    });

    it("returns URI unchanged if already a file:// URI", () => {
      expect(pathToUri("file:///already/a/uri")).toBe("file:///already/a/uri");
    });
  });

  describe("DiagnosticSeverity", () => {
    it("has correct severity values", () => {
      expect(DiagnosticSeverity.Error).toBe(1);
      expect(DiagnosticSeverity.Warning).toBe(2);
      expect(DiagnosticSeverity.Information).toBe(3);
      expect(DiagnosticSeverity.Hint).toBe(4);
    });
  });

  describe("CompletionItemKind", () => {
    it("has correct kind values", () => {
      expect(CompletionItemKind.Text).toBe(1);
      expect(CompletionItemKind.Method).toBe(2);
      expect(CompletionItemKind.Function).toBe(3);
      expect(CompletionItemKind.Variable).toBe(6);
      expect(CompletionItemKind.Class).toBe(7);
      expect(CompletionItemKind.Struct).toBe(22);
    });
  });
});

describe("LSP Store", () => {
  // Reset mocks before each test
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Note: Full store tests would require mocking the Tauri invoke calls
  // and the event listener. For now, we test the pure functions.

  describe("getDiagnostics", () => {
    it("returns empty array for unknown file", async () => {
      // Import store dynamically to get fresh state
      const { getDiagnostics } = await import("../store/lsp");
      const result = getDiagnostics("/nonexistent/file.rs");
      expect(result).toEqual([]);
    });
  });

  describe("getServerStatus", () => {
    it("returns stopped for unknown project", async () => {
      const { getServerStatus } = await import("../store/lsp");
      const result = getServerStatus("/nonexistent/project");
      expect(result.state).toBe("stopped");
    });
  });
});
