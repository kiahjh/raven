/**
 * Simple fuzzy matching for file paths.
 * Returns a score (higher is better match) or null if no match.
 */

export interface FuzzyMatch {
  path: string;
  score: number;
  /** Indices of matched characters for highlighting */
  matches: number[];
}

/**
 * Fuzzy match a query against a path.
 * Returns match info or null if no match.
 */
export function fuzzyMatch(query: string, path: string): FuzzyMatch | null {
  if (query.length === 0) {
    return { path, score: 0, matches: [] };
  }

  const lowerQuery = query.toLowerCase();
  const lowerPath = path.toLowerCase();

  let queryIndex = 0;
  let score = 0;
  const matches: number[] = [];
  let consecutiveMatches = 0;
  let lastMatchIndex = -1;

  for (let i = 0; i < path.length && queryIndex < lowerQuery.length; i++) {
    if (lowerPath[i] === lowerQuery[queryIndex]) {
      matches.push(i);

      // Bonus for consecutive matches
      if (lastMatchIndex === i - 1) {
        consecutiveMatches++;
        score += consecutiveMatches * 2;
      } else {
        consecutiveMatches = 0;
      }

      // Bonus for matching at start of path or after separator
      if (i === 0 || path[i - 1] === "/" || path[i - 1] === "\\") {
        score += 10;
      }

      // Bonus for matching filename (after last separator)
      const lastSep = path.lastIndexOf("/");
      if (i > lastSep) {
        score += 5;
      }

      // Base score for matching
      score += 1;

      lastMatchIndex = i;
      queryIndex++;
    }
  }

  // All query characters must match
  if (queryIndex !== lowerQuery.length) {
    return null;
  }

  // Penalty for longer paths (prefer shorter matches)
  score -= path.length * 0.1;

  return { path, score, matches };
}

/**
 * Filter and sort paths by fuzzy match score.
 */
export function fuzzyFilter(query: string, paths: string[]): FuzzyMatch[] {
  if (query.length === 0) {
    // No query: return all paths sorted alphabetically
    return paths.map((path) => ({ path, score: 0, matches: [] }));
  }

  const matches: FuzzyMatch[] = [];

  for (const path of paths) {
    const match = fuzzyMatch(query, path);
    if (match) {
      matches.push(match);
    }
  }

  // Sort by score descending
  matches.sort((a, b) => b.score - a.score);

  return matches;
}
