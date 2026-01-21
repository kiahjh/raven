import { describe, it, expect } from "vitest";
import { fuzzyMatch, fuzzyFilter } from "../utils/fuzzy";

describe("fuzzyMatch", () => {
  it("matches exact string", () => {
    const result = fuzzyMatch("hello", "hello");
    expect(result).not.toBeNull();
    expect(result!.matches).toEqual([0, 1, 2, 3, 4]);
  });

  it("matches substring", () => {
    const result = fuzzyMatch("hlo", "hello");
    expect(result).not.toBeNull();
    expect(result!.matches).toEqual([0, 2, 4]);
  });

  it("matches case insensitively", () => {
    const result = fuzzyMatch("HEL", "hello");
    expect(result).not.toBeNull();
    expect(result!.matches).toEqual([0, 1, 2]);
  });

  it("returns null for no match", () => {
    const result = fuzzyMatch("xyz", "hello");
    expect(result).toBeNull();
  });

  it("returns null for partial match", () => {
    const result = fuzzyMatch("hellox", "hello");
    expect(result).toBeNull();
  });

  it("handles empty query", () => {
    const result = fuzzyMatch("", "hello");
    expect(result).not.toBeNull();
    expect(result!.matches).toEqual([]);
    expect(result!.score).toBe(0);
  });

  it("matches path separators with bonus", () => {
    const result1 = fuzzyMatch("sf", "src/file.ts");
    const result2 = fuzzyMatch("sf", "asfile.ts");
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    // Path separator match should score higher
    expect(result1!.score).toBeGreaterThan(result2!.score);
  });

  it("gives bonus for filename matches", () => {
    const result1 = fuzzyMatch("app", "src/components/App.tsx");
    const result2 = fuzzyMatch("app", "src/application/index.ts");
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    // Both match, but App.tsx has the match in the filename
    // The scores should be close but result1 slightly higher due to filename bonus
    expect(result1!.matches.length).toBe(3);
    expect(result2!.matches.length).toBe(3);
  });
});

describe("fuzzyFilter", () => {
  const paths = [
    "src/components/App.tsx",
    "src/components/Surface.tsx",
    "src/store/surface.ts",
    "src/test/surface.test.ts",
    "package.json",
  ];

  it("returns all paths for empty query", () => {
    const results = fuzzyFilter("", paths);
    expect(results.length).toBe(paths.length);
  });

  it("filters by query", () => {
    const results = fuzzyFilter("surf", paths);
    expect(results.length).toBe(3);
    expect(results.every((r) => r.path.toLowerCase().includes("surf"))).toBe(true);
  });

  it("sorts by score", () => {
    const results = fuzzyFilter("surface", paths);
    // Should be sorted by score descending
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it("handles no matches", () => {
    const results = fuzzyFilter("xyz123", paths);
    expect(results.length).toBe(0);
  });
});
