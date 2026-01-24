# Agent Guidelines for Raven

This document provides strict guidelines for AI agents working on this codebase. Follow these rules without exception.

---

## What Raven Is

Raven is a spatial, agent-native coding environment where the boundaries between editor, terminal, and AI dissolve into a single fluid workspace. You navigate by meaning, not just files. You command by intent, not just syntax. Agents aren't features—they're collaborators that inhabit the same space, visible when active, ambient when not. Everything is keyboard-first, mouse-capable, voice-augmented, and beautiful by default.

---

## Design First

**Raven is a design-first editor.** Everything must be absolutely beautiful, cohesive, and delightful to use. This is non-negotiable.

- **Visual consistency is paramount** — Colors, icons, spacing, and typography must be consistent everywhere. Never introduce one-off styles.
- **Use the centralized systems** — Icons come from `src/components/icons/`. Colors come from CSS variables in `src/styles/`. Don't inline SVGs or hardcode colors.
- **Match existing patterns** — Before adding any UI element, find how similar elements are styled elsewhere. Copy that approach exactly.
- **No layout jank** — Elements that change (counters, status indicators) must have fixed widths to prevent layout shifts. Use `min-width`, `tabular-nums`, and flex layouts appropriately.
- **Attention to detail** — Padding, margins, border-radius, font weights, opacity levels — these all matter. Get them right.
- **Less is more** — Don't add visual noise. Every pixel should earn its place.
- **Test visually** — Actually look at what you build. Does it look good? Does it feel right? Would you be proud of it?

---

## Code Quality

**Keep the codebase in perfect condition.** This is non-negotiable.

- **Zero warnings** — The codebase must compile with zero warnings in both TypeScript and Rust. Fix warnings immediately when you see them, even if they're not related to your current task.
- **Zero dead code** — Delete unused functions, unused imports, commented-out code, and obsolete modules. If code isn't being used, it shouldn't exist.
- **Proactive cleanup** — If you encounter messy code, poorly named variables, or architectural issues while working on something else, fix them. Don't leave broken windows.
- **Refactor aggressively** — Extract functions, create modules, improve naming. Leave code better than you found it.
- **Small, focused functions** — Each function does one thing. If you're adding comments to explain sections of a function, split it up instead.
- **Clear naming** — Names should be self-documenting. Avoid abbreviations unless universally understood.
- **DRY, but not at the cost of clarity** — Extract duplication, but don't over-abstract. Prefer explicit over clever.

---

## Testing

**Test everything.** This codebase is primarily AI-written, so comprehensive tests are essential for confidence.

- **Unit test all logic** — Every function with logic (not just glue code) needs tests.
- **Test edge cases** — Empty inputs, boundary conditions, error states.
- **Test before implementing** — When fixing bugs, write a failing test first.
- **Keep tests fast** — Tests should run in milliseconds. Mock heavy dependencies.
- **Tests are documentation** — Write tests that clearly demonstrate intended behavior.

Run tests with `just test`. Ensure all tests pass before considering work complete.

---

## Performance

**Everything must be ridiculously fast.** Users should never wait for anything.

- **Measure, don't guess** — Profile before optimizing, but have zero tolerance for perceptible lag.
- **Offload to Rust** — CPU-intensive work belongs in the Tauri backend, not the UI thread.
- **Avoid unnecessary renders** — SolidJS is reactive; use it correctly. Don't trigger re-renders for unchanged data.
- **Lazy load** — Don't load what you don't need yet.
- **Debounce/throttle** — User input that triggers expensive operations should be debounced.
- **Async by default** — Never block the UI thread. Use web workers or Rust for heavy computation.

---

## Type Safety

**Strict TypeScript, no exceptions.**

- **No `any`** — Ever. Use `unknown` and narrow, or define proper types.
- **No type assertions (`as`)** — Unless you've genuinely validated the type at runtime.
- **Leverage the type system** — Use discriminated unions, branded types, and generics where they add safety.
- **Types are documentation** — Well-typed code is self-documenting.

---

## Consistency

**Follow existing patterns.**

- **Study before coding** — Look at how similar things are done in the codebase before implementing.
- **Store structure** — Follow the established SolidJS store patterns in `src/store/`.
- **Component style** — Match the style of existing components (naming, structure, prop patterns).
- **File organization** — Put things where similar things live.
- **Naming conventions** — Match existing conventions for files, functions, types, and variables.

When in doubt, grep the codebase and follow precedent.

---

## Incremental Progress

**Small, verifiable changes.**

- **One thing at a time** — Each change should do one thing and be easy to verify.
- **Working state** — The code should compile and tests should pass after every change.
- **Don't boil the ocean** — Break large features into small, shippable increments.

---

## Implementation Quality

**Always implement features the right way, not the easy way.**

- **No shortcuts** — Never choose an approach just because it's simpler to implement. Choose the approach that's best for the product.
- **Think like a user** — Would a user of VS Code, Zed, or Neovim accept this? If not, do better.
- **Solve the hard problem** — If a feature requires complex logic to work correctly, write the complex logic. Don't punt with a hacky workaround.
- **Future-proof** — Consider how the implementation will scale, extend, and integrate with future features.
- **Research first** — If you're unsure how to implement something properly, research how best-in-class editors handle it.

---

## Error Handling

**No silent failures.**

- **Surface errors visibly** — Users should know when something fails, not wonder why nothing happened.
- **Fail fast** — Invalid states should error immediately, not propagate.
- **Meaningful error messages** — Errors should explain what went wrong and, ideally, how to fix it.
- **Log appropriately** — Errors log with context. Don't spam logs with expected conditions.

---

## Architecture Notes

- **Frontend**: SolidJS with reactive stores (not React — no hooks, no useState)
- **Backend**: Tauri 2 (Rust) — use for file I/O, heavy computation, system integration
- **Terminal**: ghostty-web with raven-daemon for session persistence
- **Build**: Vite + TypeScript
- **Tests**: Vitest + jsdom

---

## Before Submitting Work

1. All tests pass (`just test`)
2. TypeScript compiles with no errors (`just build`)
3. Rust compiles with no warnings
4. Code is formatted and clean
5. No `any` types, no type assertions without validation
6. New logic has test coverage
7. Changes are minimal and focused
