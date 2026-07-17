# OpenChat — AI Coding Workspace Platform

OpenChat is an AI coding platform (similar to OpenAI Codex/Canvas) built with **React**, **TypeScript**, **Vite**, and **Vanilla CSS** — now with a **backend gateway** that lets AI truly execute tasks (run commands, read/write files, search code) rather than just generate text.

It features an immersive dual-pane layout: a **Chat & Thinking Console** on the left and a **Code & Task Workspace** on the right. The backend provides real tool execution (bash, file ops, grep, git), multi-provider model routing, and session persistence.

---

## 🌟 Features

1. **Immersive Dual-Pane Layout**
   - **Left Panel (Chat Console)**: High fidelity chat feed featuring real-time stream chunk compilation, automatic code syntax highlighting, and expandable thinking blocks (collapsing `<thinking>` tags into sleek UI elements).
   - **Right Panel (Workspace)**: Toggleable tabs between a Code Editor (supporting tabbed file sheets) and a Task Kanban Board.

2. **File Upload & Model Attachment Support**
   - **Asynchronous Staging**: Select and stage files asynchronously using `FileReader` pipelines. Displays image thumbnails or document badges with file sizes before sending.
   - **Inline Code Expanders**: Clickable file cards inside the chat bubble list toggle open/closed to preview code file content.
   - **Vision & Prompt Injections**: Maps attachments to OpenAI multimodal payloads (`image_url`), Ollama vision arrays, and appends text file contents as formatted markdown blocks in text prompts.

3. **Web Search Integration (联网搜索)**
   - **Tavily Search Engine**: Direct integration with Tavily API for LLM-optimized real-time web search capabilities.
   - **Globe Toggle**: Quick-toggle button (`🌐`) in the chat footer with active glow outline styling and fallback guidance when API key is missing.
   - **Dynamic Context Injection**: Shows a "🔍 Searching..." indicator, queries web results, and appends formatted search result snippets to system prompt context transparently behind the scenes.

4. **Real Streaming API Client**
   - Full support for OpenAI-compatible Server-Sent Events (SSE) streaming (`text/event-stream`).
   - Native support for local Ollama newline-delimited JSON streams.
   - Built-in `AbortController` cancellation to stop response generation on the fly.
   - Automatic fallback to simulated offline Demo mode when API credentials are not provided.

4. **Smart Endpoint Auto-Completion**
   - Normalizes and auto-completes base URLs (e.g. `https://example.com/v1`) to standard completion paths (`/v1/chat/completions`) automatically on input blur and request dispatch.

5. **Model Routing Gateway**
   - Built-in adapter system mapping payloads to standard OpenAI completions or local Ollama instances.
   - Comprehensive model validation panel allowing users to live-edit, delete, add, and switch default router choices.

6. **Persistent Client Configuration (.openchat & LocalStorage)**
   - **Local Config File**: Automatically loads and saves all custom model configs, active selections, web search flags, and API keys to a local `.openchat` file in the project root via server endpoints.
   - **Local Storage Sync**: Dual-syncs state with browser `localStorage` as a fast local fallback.
   - **Git Exclusion**: Automatically ignores `.openchat` in version control to ensure API credentials are never leaked.

7. **Startup Port Occupy Check**
   - Performs a port check on startup to determine if default port 3000 is occupied by another process, printing an eye-catching warning banner in the terminal to help troubleshoot local port conflicts.

8. **Agent Task State Machine**
   - Enforcement of a deterministic finite state machine (DFA) representing task transitions:
     `Pending` $\rightarrow$ `Running` $\rightarrow$ `Success` / `Failed` (with `Retry` & `Cancel` capabilities).
   - Live execution logging system outputting color-coded statuses (Info, Warn, Success, Error).

9. **Premium Design System**
   - Custom styling with CSS properties.
   - Modern elements: Glassmorphism shadows, glowing status dots, smooth gradient outlines, and custom scrollbar bars.

---

## 📂 File Structure

```
CHANGELOG.md                  # Development history and version logs
src/
├── core/
│   ├── types.ts              # System interfaces and type declarations
│   ├── searchClient.ts       # Web search client (Tavily Search API)
│   ├── streamParser.ts       # Parses <thinking> block stream chunks
│   ├── modelRouter.ts        # Model routing and URL normalization
│   ├── apiClient.ts          # Real-time streaming API client (OpenAI SSE / Ollama)
│   ├── taskStateMachine.ts   # Transition state machine rules & manager
│   └── simulatedApi.ts       # Offline text and code generator stream
├── components/
│   ├── ChatPanel.tsx         # Console view displaying messages & thinking accordion
│   ├── WorkspacePanel.tsx    # Workspace tabs for editor and task board
│   ├── TaskBoard.tsx         # Kanban view managing task card status actions
│   └── ModelConfigPanel.tsx  # Dynamic model configuration manager
├── test/
│   ├── setup.ts              # Happy/js-dom testing setup imports
│   ├── searchClient.test.ts  # Test Suite E: Web search client mock fetch tests
│   ├── streamParser.test.ts  # Test Suite A: Stream parser & tag extraction
│   ├── modelRouter.test.ts   # Test Suite B: Model configuration, normalization & requests
│   ├── taskStateMachine.test.ts # Test Suite C: Task state transition flows
│   └── ChatPanel.test.tsx    # Test Suite D: Component file attachment integration tests
├── index.css                 # Dark theme design system stylesheet
├── App.tsx                   # Main orchestrator & global React state
└── main.tsx                  # React DOM mount point
```

---

## 🚀 Getting Started

### Prerequisites
Make sure you have Node.js (v22+) installed.

### 1. Install Dependencies
Navigate to the root directory and run:
```bash
npm install
```

### Terminal UI (TUI)

Interactive full-screen chat in the terminal (no browser required):

```bash
npm run tui
# or
openchat tui
openchat --tui --port 3001 --model <id>
openchat tui --no-serve          # require backend already running
openchat tui --no-thinking       # disable deep thinking / CoT
```

In-session: type to chat, `/help` for commands, Esc aborts a stream, Ctrl+C twice quits.

### 2. Run Tests
Verify modules and state machines with the automated test suites:
```bash
npm run test:run
```

### 3. Launch Development Server

**Full stack (recommended)** — checks ports 3000/3001 first, then starts backend + frontend:
```bash
npm run dev:all
```

Only check ports:
```bash
npm run ports
```

Or start them separately:
```bash
# Terminal 1: Backend gateway (port 3001) — fails fast if busy
npm run dev:server

# Terminal 2: Frontend dev server (port 3000)
npm run dev
```

If a port is taken (Windows):
```bash
netstat -ano | findstr :3000
taskkill /F /PID <PID>
```

Custom ports:
```bash
# PowerShell
$env:OPENCHAT_FRONTEND_PORT=3100; $env:OPENCHAT_PORT=3101; npm run dev:all
```

Open [http://localhost:3000](http://localhost:3000) in your web browser.

### 4. Configure a Model
Open Settings (`Ctrl+,`) and add your API key for OpenAI, Ollama, or any compatible provider. Without an API key, the app runs in demo mode with simulated responses.

### 5. Build for Production
To bundle the optimized web assets for deployment:
```bash
npm run build
```
Build assets will be located in the `dist/` directory. The backend can serve `dist/` when present (e.g. Docker).

### 6. CLI
```bash
npm run openchat -- help
npm run openchat -- serve
npm run openchat -- chat "list TypeScript files in this project"
npm run openchat -- health
npm run openchat -- tools
```

### 7. Docker
```bash
docker compose up --build
# Backend + tools on :3001, workspace mounted at /workspace
```

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+,` | Settings |
| `Ctrl+N` | New chat |
| `Ctrl+B` | Toggle session sidebar |
| `Ctrl+E` | Export chat as Markdown |
| `Ctrl+S` | Save active file to disk |
| `Esc` | Stop streaming |
| `/` | Skill picker in chat input |

---

## 🌐 Multi-provider models (CN + global)

Settings → **Add Model** lists domestic and international providers. Each route can set:

| Setting | Why |
|---------|-----|
| **Context strategy** | `minimal` / `balanced` / `full` — controls history packing & token cost |
| **Token param** | `max_tokens` vs `max_completion_tokens` (o1/o3) vs Ollama `num_predict` |
| **API style** | OpenAI-compatible / Anthropic Messages / Ollama |
| **Reasoning mode** | Skip temperature; parse `reasoning_content` |
| **Auth style** | Bearer / Anthropic `x-api-key` / query key |
| **Tool result max chars** | Truncate tool dumps in history |
| **Skill catalog** | Names-only (cheap) vs full descriptions |

**Token packer / context compression (Web + TUI):**

- **Automatic** on every agent turn: keep system core + last user turn, fill newest history until budget, truncate tool outputs, drop older turns into a stub, optionally LLM-summarize when over the compression threshold (uses Settings → Routing → cheap model when set).
- **Manual**: Web header **Compress** / chat footer zip button; TUI `/compress`.
- Live stats via `pack_stats` (`~N tok`, strategy, dropped, `llm-zip` / packed).

## 🛠️ Agent Tools

When the backend is running, the model can call:

| Tool | Description |
|------|-------------|
| `bash` | Run shell commands (sandboxed, danger filters) |
| `file_read` / `file_write` / `file_edit` | Project files with path jail |
| `grep` / `glob` | Code search |
| `git` | Read-only git ops |
| `web_search` / `web_fetch` | Live web (search provider in Settings) |
| `skill` | Load a Claude Code–style skill by name |
| MCP / plugins | Extra tools from config / plugins |

## ⚡ Skills & Plugins (Claude Code compatible)

OpenChat loads the same **Agent Skills** layout as Claude Code:

| Location | Path |
|----------|------|
| Personal | `~/.claude/skills/<name>/SKILL.md` or `~/.openchat/skills/<name>/SKILL.md` |
| Project | `.claude/skills/<name>/SKILL.md` |
| Commands | `.claude/commands/<name>.md` (legacy slash commands) |
| Plugin | `<plugin>/skills/<name>/SKILL.md` → `/plugin:skill` |

**Minimal skill:**

```text
~/.openchat/skills/my-skill/SKILL.md
```

```yaml
---
description: What this skill does and when to use it
---
Instructions for the agent…
$ARGUMENTS
```

**Plugin package:**

```text
my-plugin/
  .claude-plugin/plugin.json
  skills/<name>/SKILL.md
  commands/*.md          # optional
  agents/*.md            # optional
  .mcp.json              # optional MCP servers
```

Copy examples:

```bash
# Personal skill
cp -r examples/skills/summarize-changes ~/.openchat/skills/

# Claude-style plugin
cp -r examples/plugins/team-conventions ~/.openchat/plugins/
```

Then `npm run openchat -- reload` (server running) or restart the backend.

Type `/` in chat to pick skills, or let the agent call the `skill` tool. Project memory lives in `OPENCHAT.md` or `CLAUDE.md`.

---

## Roadmap

Planned / optional next steps (not blocking 2.1.x):

| Priority | Item | Notes |
|----------|------|--------|
| P1 | Task-based model routing | Explore/read with cheap model; coding with strong model |
| P1 | React Context state store | Reduce hook prop drilling after further growth |
| P2 | Hooks runtime for plugins | Full Claude Code–style lifecycle hooks |
| P2 | Skill directory hot-reload | Watch `SKILL.md` without full restart |
| P2 | Marketplace install UX polish | First-class Claude plugin marketplace sources |
| P3 | E2E smoke tests | Playwright against `dev:all` |
| P3 | Credential OS keychain | Optional encrypted key storage |
| — | VS Code extension | **Out of scope** — prefer Claude Code–style plugins/skills |

See [ARCHITECTURE.md](ARCHITECTURE.md) for the current system layout and history.

**Version:** 2.3.0 · **Last updated:** 2026-07-17
