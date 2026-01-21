# Raven: Vision & Plan

## What Raven Is

Raven is a spatial, agent-native coding environment where the boundaries between editor, terminal, and AI dissolve into a single fluid workspace. You navigate by meaning, not just files. You command by intent, not just syntax. Agents aren't features—they're collaborators that inhabit the same space, visible when active, ambient when not. Everything is keyboard-first, mouse-capable, voice-augmented, and beautiful by default.

---

## Core Principles

1. **Unified input** — One prompt that understands shell commands, editor commands, natural language, all contextually
2. **Spatial flexibility** — Hybrid zones: tiling core for focused work, transient surfaces that appear/collapse as needed
3. **Agent as peer** — You and agents share the same workspace with equal access; you control who's driving
4. **Multiple spawnable agents** — Dispatch workers for parallel tasks, each with its own surface
5. **Navigate by meaning** — Semantic navigation ("show me auth") alongside traditional file tree/fuzzy find
6. **Modal editing** — Vim-inspired but open to reimagining; normal mode / insert mode
7. **Beautiful and expressive** — Dark (but pleasant), fluid animations, rich soundscape
8. **Voice-native** — Speak commands and prompts naturally
9. **Opinionated** — Built for you, no plugin architecture overhead

---

## The Spatial Model

### Surfaces, Not Windows

Raven doesn't have "windows" or "panes" in the traditional sense. It has **surfaces**—fluid containers that appear when needed and collapse when idle.

- **Persistent surfaces**: Files you're actively editing, your main terminal, anything with unsaved changes
- **Transient surfaces**: Quick references, command output, agent responses, previews

Transient surfaces don't auto-disappear, but they **auto-collapse** to indicators at the edge when idle. One keystroke restores them. Explicit dismiss to actually kill them.

### Hybrid Zones

- **Tiling core**: The main workspace uses tiling layout (splits, like vim/tmux). Predictable, muscle-memory friendly.
- **Transient overlays**: Agent thoughts, quick lookups, command output can float/overlay without disrupting layout.

### No Tabs

Instead of tabs:
- **Spatial memory**: "That file is to the right"
- **Recency**: One keystroke brings up what you were just in
- **Fuzzy jump**: Summon anything by name instantly

---

## The Editor

### Modal Editing

Vim-inspired modal editing:
- **Normal mode**: Navigate, manipulate, command
- **Insert mode**: Type text

Open to reimagining vim's rough edges, but the core modal concept stays.

### Features

- Syntax highlighting
- LSP integration (go to definition, find references, rename, inline errors, autocomplete)
- Multiple cursors
- Semantic navigation (next function, next error, jump to symbol)
- Vim motions as a starting point, evolved as needed

### What Makes It Different

- **Agent-aware**: Agents can highlight what they're looking at, annotate code
- **Unified command input**: Same prompt that runs shell commands also does editor commands
- **Relationship view**: See what a function connects to, inline

---

## The Agents

### Agent as Peer

You and agents share the same workspace:
- Both can see all files, terminals, context
- Both can edit, run commands, navigate
- You decide who's driving at any moment

### Multiple Spawnable Agents

Dispatch agents for parallel tasks:
- "Go figure out why this test fails"
- "Refactor this module"
- "Investigate the auth bug"

Each agent has:
- Its own surface(s) showing what it's doing
- A status: working / stuck / waiting / done
- The ability to ask you questions via its own prompt
- Access to the full workspace

### Agent Visual Presence

**Default: Changes just apply.** Fast, trusting. With safety nets:
- Undo is instant and granular—revert any agent action with one keystroke
- Optional "watch mode" to see ghost cursor typing in real-time

**Thought stream**: Available but hidden by default. Toggle to see agent reasoning.

**Attention signals**: Surfaces glow subtly when an agent needs input or finishes.

### Talking to Agents

- Each agent has its own prompt surface
- When an agent needs input, its prompt appears
- You respond there, it continues
- To initiate: focus on an agent's surface and type

### Agent Modes

| Mode | Behavior |
|------|----------|
| **Observing** | Watching, building context, silent |
| **Suggesting** | Subtle hints (ghost text, highlights) |
| **Conversing** | Back-and-forth dialogue |
| **Driving** | Agent has control, you're watching |

Fluid transitions between modes.

### Backend

- Start with Claude (Anthropic)
- Architect for swappable backends (GPT, local models, etc.) later

---

## Unified Input

One input surface that understands:
- Shell commands: `git status`, `cargo build`
- Editor commands: `:w`, `split right`
- Natural language: "make this function async", "why is this failing?"
- Workspace commands: "open terminal", "clear transients"

**Location**: TBD—likely summoned anywhere (appears at cursor, disappears when done). May prototype alternatives.

**Voice input** flows into the same system. Speak a command, it's understood the same way.

---

## Navigation

### Two Paradigms, Both Available

| Traditional | Semantic |
|-------------|----------|
| File tree sidebar | "Show me the auth stuff" |
| Fuzzy file finder (cmd+p) | "Where do we define routes?" |
| Go to definition | "What calls this?" |
| Manual `cd && ls` | Agent assembles relevant context |

Use what fits the moment.

---

## Aesthetics

### Visual

- **Dark but pleasant** — Not harsh, not moody. Comfortable for long sessions.
- **Fluid animations** — Expressive, delightful motion. Things glide and breathe. But never slow.
- **Typography-forward** — Code as literature.
- **Minimal chrome** — Content is king. UI gets out of the way.

### Audio

- **Rich soundscape** — Typing sounds, ambient tones, spatial audio cues
- Agent activity has audio presence
- Errors, completions, attention signals all have sound
- (Optional/toggleable for when you need silence)

---

## Input

- **Keyboard-first** — Everything reachable without mouse
- **Mouse as equal citizen** — Both input methods are first-class
- **Voice-native** — Commands and prompts via speech

---

## Project & Workspace

### Workspaces with State

When you open a project, it restores exactly how you left it:
- All surfaces and their positions
- Open files and cursor positions
- Running agents and their state
- Terminal history

### Recent Projects

Quick switch between codebases.

---

## Git Integration

**Starting point: Just diffs.**
- See changes inline in the editor
- Run git commands in terminal for everything else

Expand later as needed.

---

## Languages

Primary: Rust, TypeScript

But designed to work for anything via LSP.

---

## Technical Stack

- **Tauri 2** — Native shell, Rust backend
- **SolidJS** — Reactive UI
- **Vite** — Build tooling

---

## Open Questions

- Exact behavior of unified input (location, invocation, dismissal)
- Vim compatibility level vs. reimagined modal system
- Conflict handling when multiple agents (or you + agent) edit same file
- How to visualize agent "presence" when it's observing but not acting

---

## Build Phases (Rough)

### Phase 1: Foundation
- Basic tiling surface system
- Modal text editor with syntax highlighting
- Terminal emulator surface
- Keyboard navigation between surfaces

### Phase 2: Editor Polish
- LSP integration
- Vim motions
- Multiple cursors
- File tree + fuzzy finder

### Phase 3: Agent Integration
- Single agent, Claude backend
- Agent can read files, edit, run commands
- Watch agent work in real-time
- Basic prompt surface

### Phase 4: Multi-Agent
- Spawn multiple agents
- Per-agent surfaces and prompts
- Agent status/attention system
- Conflict handling

### Phase 5: Polish & Feel
- Fluid animations
- Sound design
- Voice input
- Workspace persistence

### Phase 6: Navigation & Intelligence
- Semantic navigation
- Agent context visualization
- Relationship views
