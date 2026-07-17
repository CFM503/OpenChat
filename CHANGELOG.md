# Changelog

All notable changes to the **OpenChat** project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [2.5.3] - 2026-07-17

### Fixed
- **Markdown tables showing `[object Object]`**: Marked v18 table renderer was stringifying cell token objects; now parses header/rows into real `<th>`/`<td>` HTML
- **Markdown renderer hardening** (`src/lib/markdown.ts`): safe token→string for code/link/image/table; leak detector fallback; ToolOutput avoids `[object Object]` for object args

### Changed
- **Chat density**: slightly tighter message gaps, bubble padding, and markdown line-height so more content fits on screen without feeling cramped

---

## [2.5.2] - 2026-07-17

### Added
- **Right workspace collapse**: header **Hide panel** / workspace chevron; `Ctrl+Shift+B`; preference in localStorage
- **Auto-open AI-edited files**: successful `file_write` / `file_edit` expands Code panel and opens the file

---

## [2.5.1] - 2026-07-17

### Added
- **Reply canvas (Web)**: weather cards, image galleries (lightbox), info cards
  - Parses ` ```canvas weather|gallery|card ` and weather-like ` ```json ` blocks
  - Auto-lifts markdown images into a gallery
- **Thinking auto-scroll**: CoT panel sticks to the latest line while streaming (pauses if you scroll up)
- **Runtime environment block** in agent system prompt (OS, shell, project cwd, Desktop/Documents/Downloads)
- **Smoke scripts**: `scripts/smoke-chat.mjs`, `scripts/smoke-files.mjs`

### Fixed
- **Doubled stream text** (`OkayOkay,, the the user user`): SSE parser no longer concatenates multiple mirrored reasoning fields on the same delta
- **CoT monologue shown as the reply**: promote-to-answer refuses long internal planning text
- **Empty assistant recovery**: extract generic ` ```canvas ` fences / final-answer markers; never exit silently on empty tool_calls
- **Tool-call reliability**: normalize OpenAI `function.name` / `function.arguments`; domain-agnostic nudge when model only describes a tool call
- **file_read crash**: `isPathAllowed is not defined` → `resolveSafePath`
- **file_write to new Desktop paths**: walk-up realpath so new files under allowed roots work
- **Port check false free on Windows**: check IPv4 + IPv6 (`0.0.0.0`, `::`, loopbacks)
- **index.html restored**: root entry was overwritten by an unrelated game page (broke Vite app)

### Changed
- Distinct UI for **Think** (amber) vs **Reply** (indigo) in chat
- Path jail allows user Desktop/Documents/Downloads/home by default
- No domain-hardcoded chat paths for weather; use general prompt + `web_search` / tools

---

## [2.5.0] - 2026-07-17

### Fixed
- **Web UI “only thinking, no reply”**: reasoner models that stream only `reasoning_content` now promote CoT to a visible answer when `content` is empty; broader SSE parsing; tiny `max_tokens` floor for pure reasoners; Thinking panel collapses once a reply exists
- **Bulb off → total silence**: no longer drop `thinking` stream chunks at the gateway when deep thinking is disabled (that discarded the only tokens some models emit); promote CoT to reply; stop sending incompatible disable flags to pure reasoners
- **TUI same silence/CoT-only issues**: client-side promote when content empty; `/think off` hides thinking panel but still recovers reply; wait cue while streaming with think off

### Changed
- OpenAI-compatible stream parser accepts more reasoning/content field shapes (arrays, OpenRouter-style details)
- Soft floor: pure reasoners with `max_tokens` &lt; 2048 are raised to 2048 so CoT cannot consume the entire budget

---

## [2.4.0] - 2026-07-17

### Added
- **Interactive TUI** (`openchat tui` / `openchat --tui` / `npm run tui`)
  - Full-screen ANSI terminal UI: multi-turn chat, streaming content, dim thinking, tool start/result, progress stages + percent bar
  - Slash commands: `/help` `/clear` `/model` `/think` `/compress` `/abort` `/status` `/tools` `/skills` `/sessions` `/reload` `/quit`
  - Keys: Enter send · Esc/Ctrl+C abort · Ctrl+C×2 quit · ↑↓ history · PgUp/PgDn scroll · Ctrl+L redraw
  - Flags: `--port` `--host` `--model` `--cwd` `--serve`/`--no-serve` `--no-thinking`
  - Default auto-starts backend when offline; source under `cli/tui/`
- **Context compression (Web + TUI)** — end-to-end
  - Auto: each chat turn packs history (token budget) + optional LLM summary when over threshold
  - Manual: Web **Compress** button; TUI `/compress`
  - WS `compress` message + richer `pack_stats` (`compressed`, `llmCompressed`, `summary`, dropped/kept/truncated)
  - UI shows ~tok, pack/zip badge, dropped counts; injects summary system note for later turns

### Fixed
- Rolling summary no longer sticks globally across unrelated agent runs (per-request only)

---

## [2.3.0] - 2026-07-17

### Added
- **Server `progress` pipeline events** (`received` → `memory` → `packing` → `compressing?` → `model` → `thinking?` → `tools?` → `generating`) so the UI never sits silent while the agent prepares
- **Chat stage stepper + soft percent bar** driven by live `progress` messages (Chinese labels, elapsed seconds)

### Changed
- **Skip LLM history compression** when context strategy is `minimal` or history is short (avoids an extra model round-trip)
- **Project memory cache** extended to 2 minutes (less disk I/O each turn)
- Immediate WS ack (`received`) as soon as a chat message is accepted

### Performance / UX
- Users always see which stage is active while waiting for the first token
- Fewer unnecessary compression calls under minimal strategy

---

## [2.2.0] - 2026-07-17

### Added
- **Deep thinking toggle** in chat footer (bulb button): disable CoT/reasoning per preference; persisted in `localStorage`
  - Provider-aware body flags (DeepSeek `thinking.disabled`, Qwen `enable_thinking`, o-series `reasoning_effort`, etc.)
  - Server drops `thinking` stream events when disabled
- **Startup port occupancy checks**: `npm run ports`, pre-check in `dev:all`, hard fail on backend bind, Vite frontend hard fail / backend warn
  - Env: `OPENCHAT_PORT`, `OPENCHAT_FRONTEND_PORT`; Windows/Unix kill hints
- **Chat live activity bar** (connecting / searching / packing / tool / streaming) with elapsed timer
- **Connection banner** + softer heartbeat (15s, skip HTTP when WS connected)
- **Stream rAF batching** and lightweight markdown while streaming (full highlight after done)

### Changed
- Session auto-save skipped during streaming; lighter session list refresh
- Markdown no longer uses expensive `highlightAuto`; historical bubbles memoized
- Conversation outbound filter (welcome/empty shells omitted); system messages hidden in feed

### Fixed
- Retry no longer offered on welcome message; stop leaves clear `*(Stopped)*` state

---

## [2.1.0] - 2026-07-17

Minor release consolidating the agent platform work from the 2.0.0-alpha.18–21 line.

### Added
- **Claude Code–compatible skills & plugins** (`SKILL.md`, plugin layout, `skill` tool, project memory via `OPENCHAT.md` / `CLAUDE.md`)
- **Web tools**: `web_search`, `web_fetch`
- **Filesystem workspace**: project file tree, open/edit/save to disk
- **Task Board → real agent execution**
- **Multi-provider dialects** (CN + global) with advanced model params
- **Token-budget context packer** (`minimal` / `balanced` / `full`) + optional cheap-model summarization
- **CLI** (`bin/openchat.mjs`): serve, chat, health, tools, skills, plugins, reload
- **Docker** (`Dockerfile`, `docker-compose.yml`)
- **Panel resize**, session auto-title, chat export, pack_stats (`~N tok` in header)
- **Settings → Routing**: `agentRouting.cheapModelId` for summarizer

### Changed
- **Architecture**: server `runtime` + `routes` + `ws`; frontend hooks; thin `App.tsx` / `index.ts`
- API prefers same-origin `/api` and `/ws` (Vite proxy)

### Fixed
- Gemini / multi-version endpoint normalization
- MCP server restart; config secret merge on round-trip

### Documentation
- Roadmap for future work lives in [README → Roadmap](README.md#roadmap) and [ARCHITECTURE.md](ARCHITECTURE.md)

---

## [2.0.0-alpha.21] - 2026-07-17

### Architecture refactor
- **Server composition root**: `runtime.ts` (DI), `routes/index.ts` (HTTP), `ws/handler.ts` (WebSocket); `index.ts` is a thin entry
- **Frontend hooks**: `useConfig`, `useBackend`, `useChat`, `useSessions`, `useWorkspace`, `useTasks`, `usePanelLayout` — `App.tsx` is shell-only (~350 lines)
- **API base**: prefer same-origin `/api` + `/ws` (Vite proxy) with localhost:3001 fallback
- **Agent routing UI**: Settings → Routing → cheap model for summarization (`agentRouting.cheapModelId`)
- **Live pack stats**: WebSocket `pack_stats` event; header shows `~N tok` after each agent turn

---

## [2.0.0-alpha.20] - 2026-07-17

### Added — Multi-provider dialects + token-budget packing
- **Provider profiles** (CN + global): DeepSeek, Qwen/DashScope, Kimi/Moonshot, GLM, Doubao, SiliconFlow, MiniMax, Baichuan, Yi, StepFun, MiMo, OpenAI, Gemini, Claude, Groq, Mistral, OpenRouter, LM Studio, Ollama
- **Request adapter** (`server/src/providers/`):
  - `max_tokens` vs `max_completion_tokens` (o1/o3)
  - Anthropic Messages API + `x-api-key`
  - Ollama NDJSON
  - Optional: no temperature (reasoning), fold system into user, strict alternation, extra headers/body
- **Per-model params in UI**: context strategy, context window, token param, API style, auth style, reasoning mode, top_p, tool result cap, skill catalog mode
- **Token-budget packer** (`server/src/context/tokenBudget.ts`):
  - Strategies: `minimal` | `balanced` | `full`
  - Priority keep: system core + last user → newest turns → drop older with stub
  - Truncate tool outputs; skill catalog name-only by default
  - Optional LLM summary when still over compression threshold

### Changed
- Agent loop re-packs each tool round; logs pack stats (`est≈N tokens`)
- Summarizer uses adapter + smaller max_tokens for cheap compression

---

## [2.0.0-alpha.19] - 2026-07-17

### Added — Claude Code compatible Skills & Plugins
- **SKILL.md format**: Directory skills at `~/.claude/skills/<name>/SKILL.md`, `~/.openchat/skills/<name>/SKILL.md`, project `.claude/skills/`, `.openchat/skills/`
- **Frontmatter**: `description`, `when_to_use`, `disable-model-invocation`, `user-invocable`, `argument-hint`, `allowed-tools`, `$ARGUMENTS` / `$0` / `${CLAUDE_SKILL_DIR}` / `${CLAUDE_PROJECT_DIR}`
- **Dynamic shell injection**: `` !`command` `` and ` ```! ` blocks expanded before skill content is used
- **Legacy commands**: `.claude/commands/*.md` loaded as skills
- **`skill` tool**: Agent can load skills by name (auto-catalog in system prompt)
- **Claude plugins**: `.claude-plugin/plugin.json` + `skills/` + `commands/` + `agents/` + optional `.mcp.json`
- **Project memory**: `OPENCHAT.md` / `CLAUDE.md` / `AGENTS.md` / `.claude/rules/*.md` injected every agent turn
- **Reload APIs**: `POST /api/skills/reload`, `POST /api/plugins/reload`
- **CLI**: `openchat skills|plugins|reload`
- **Examples**: `examples/skills/summarize-changes`, `examples/plugins/team-conventions/`

### Changed
- Built-in skills renamed to Claude-style short names (`/review`, `/commit`, …)
- Plugin API returns `format`, `skills[]`, `agents[]` (still lists legacy JS tools)

---

## [2.0.0-alpha.18] - 2026-07-17

### Added
- **WebSearchTool + WebFetchTool**: Agent can search the web and fetch page text via tools (uses Search settings: Tavily / SerpAPI / Bing / SearXNG). Private/localhost URLs blocked on fetch.
- **Filesystem Workspace Browser**: Left file tree in Code Canvas loads real project files via `GET /api/fs/tree`; open, edit, save (`Ctrl+S` / Save button), close tabs with dirty indicator.
- **Task Board → Real Agent Execution**: **Run Agent** starts the agent loop with the task description; tool events stream into task logs; completes/fails automatically.
- **MCP Server Restart**: `POST /api/mcp/servers/:name/restart` + Restart button in Extensions panel.
- **Panel Resize**: Drag the center divider to resize chat vs workspace (persisted).
- **Session Auto-Title**: First user message becomes session title; `PATCH /api/sessions/:id` for rename.
- **Export Chat**: Download conversation as Markdown (`Ctrl+E` / Export button).
- **CLI** (`bin/openchat.mjs`): `openchat serve|chat|health|tools|sessions`.
- **Docker**: `Dockerfile` + `docker-compose.yml` for self-hosting.
- **Keyboard Shortcuts**: `Ctrl+,` settings · `Ctrl+N` new chat · `Ctrl+B` sidebar · `Ctrl+E` export · `Esc` stop.
- **Config secret merge**: Empty/masked API keys no longer wipe stored credentials on save.

### Fixed
- **normalizeEndpoint**: Gemini `/v1beta` and `/v1beta/openai` URLs no longer get a spurious `/v1/` segment (frontend + summarizer aligned with provider gateway).

---

## [2.0.0-alpha.12] - 2026-06-28

### Added
- **Allowed Directories**: Configure additional directories AI tools can access (Settings → Network → Allowed Directories)
  - FileTool, BashTool, GrepGlobTool all respect allowed directories
  - Access files outside project root (e.g., `D:\DOWNLOAD`)
- **File Upload Size Limit**: 50MB max with error alert

### Fixed
- **Empty Tool Call Filter**: Skip tool calls with empty names (prevents 400 errors on MiMo/Gemma)
- **normalizeEndpoint**: Fixed regex to handle `/v1beta`, `/v1alpha` paths correctly → `/v1beta/openai/chat/completions`

---

## [2.0.0-alpha.11] - 2026-06-27

### Added
- **Provider Presets** (10 providers): OpenAI, Google Gemini, Anthropic Claude, DeepSeek, Groq, Mistral, OpenRouter, Xiaomi MiMo, LM Studio, Ollama
  - Quick Add grid with icons and descriptions
  - One-click preset fills endpoint, model, provider type

- **Model Auto-Detect**:
  - "🔍 Detect" button fetches available models from endpoint (`/v1/models`, `/api/tags`)
  - Proxied through backend to avoid CORS
  - Click to select from detected model list

- **Backend**: `GET /api/discover-models?url=` proxy endpoint for model discovery

### Changed
- Model config form streamlined: presets → quick add → manual form flow
- Model list shows provider, model name, and "No Tools" badge when applicable

---

## [2.0.0-alpha.10] - 2026-06-27

### Added
- **Conversation History Sidebar**:
  - Session list with new chat button, click to switch, hover to delete
  - Auto-create session on first message, auto-save on message change (debounced 1s)
  - Backend: `POST /api/sessions` (create), `PUT /api/sessions/:id` (update)
  - Sidebar toggles with collapse button

- **Disable Tools Option**:
  - New "Disable tools" checkbox in model config form for models that don't support function calling
  - When enabled, agent loop skips sending tool definitions to the LLM
  - Fixes small models (e.g., Gemma-3-4b) generating empty tool calls
  - Does NOT affect models that support function calling (default: off)

### Fixed
- **Dark Mode Select Dropdown**: Added `color-scheme: dark` and styled `option` elements for model selector and settings form selects
- **LM Studio CORS**: Browser `fetch()` sends OPTIONS preflight which LM Studio rejects; now all API calls route through backend gateway
- **Message History Overflow**: Limit conversation history to 20 messages to prevent context overflow on small models
- **Error Messages**: 500 errors now hint "try reducing Max Tokens"; error body truncated to 500 chars
- **Message Sanitization**: Remove empty messages, merge consecutive same-role messages, ensure strict user/assistant alternation for Gemma compatibility
- **Proxy Toggle**: Added `proxyEnabled` boolean with toggle switch in Network settings
- **Config Sync**: Fixed localStorage→backend sync missing `proxyUrl` and `proxyEnabled` fields
- **API Key Optional**: API key now optional for all providers (LM Studio, local proxies)
- **`tar` Module Import**: Fixed ESM import (lowercase `extract` not `Extract`)
- **`concurrently` Package**: Added as dev dependency for `npm run dev:all`

---

## [2.0.0-alpha.8] - 2026-06-26

### Added
- **Skill System**:
  - 5 built-in skills: `/review`, `/explain`, `/test`, `/refactor`, `/docs`
  - Custom skills via `~/.openchat/skills/*.md` with YAML frontmatter
  - `/` trigger in chat input with SkillPicker dropdown for quick selection
  - Template expansion with `{{selection}}` placeholder support
  - REST API: `GET/POST/DELETE /api/skills`, `POST /api/skills/:name/expand`

- **MCP (Model Context Protocol) Integration**:
  - JSON-RPC over stdio client for MCP protocol communication
  - Multi-server lifecycle management with auto tool discovery
  - Tools registered with `mcp_{server}_{tool}` naming convention
  - Config via `openchat.json` → `mcpServers` field
  - REST API: `GET/POST/DELETE /api/mcp/servers`

- **Plugin System**:
  - Dynamic ESM plugin loading with `manifest.json` + `index.js` format
  - Tools registered with `plugin_{name}_{tool}` naming convention
  - Example plugin included: `examples/plugins/hello-world/`
  - REST API: `GET/DELETE /api/plugins`

- **Registry Marketplace**:
  - Third-party registry support via HTTP API protocol
  - Search across multiple configured registries simultaneously
  - Install/uninstall packages (plugins and skills) from the UI
  - Installed packages tracking with version info and source
  - Config via `openchat.json` → `registries` field
  - Store tab in Extensions settings panel with search and install UI

- **Extension Panel UI**:
  - New `ExtensionPanel` with Installed + Store tabs
  - `SkillPicker` component for slash command shortcuts
  - Extension cards with type badges (built-in, plugin, MCP) and action buttons
  - CSS styles for skill picker, extension cards, and badges

---

## [2.0.0-alpha.7] - 2026-06-26

### Fixed
- **Image Upload OCR**: Restored multimodal image support for vision models
  - OpenAI-compatible: uses `image_url` content blocks with base64 data
  - Ollama: uses native `images` array with raw base64
  - Images now correctly reach vision models (Gemini, GPT-4o, etc.)
- **URL Normalization**: Both frontend and backend `normalizeEndpoint` now handle `/v1beta`, `/v1alpha` paths correctly
  - Google Gemini endpoint: `/v1beta/openai` → `/v1beta/openai/chat/completions`

---

## [2.0.0-alpha.6] - 2026-06-26

### Fixed
- **Endpoint URL Bug**: URLs with API version prefix (`/v1beta`, `/v1alpha`) now correctly append `/chat/completions` instead of being returned as-is
  - Ollama paths (`/api/generate`, `/api/chat`) still preserved as-is

---

## [2.0.0-alpha.5] - 2026-06-26

### Security
- **Config Round-Trip Corruption (Critical)**: Fixed API keys being permanently destroyed when frontend saves masked `***` values back via POST
  - `GET /api/config` returns full unmasked config (CORS localhost restriction is the protection layer)
  - `POST /api/config` uses `saveWithMerge()` to preserve existing keys when incoming values are empty or masked
- **Atomic File Writes**: Config and session files use temp file + `fs.renameSync` pattern for crash-safe persistence
- **CORS Restriction**: Limited to `http://localhost:3000` and `http://127.0.0.1:3000` origins only
- **Path Traversal Prevention**: `safePath()` with `fs.realpath` symlink resolution + `path.sep` prefix matching
- **GitTool Security**: Whitelist of 26 safe arguments (`SAFE_ARGS` Set), `filterArgs()` function, stdout capped at 100KB / stderr at 50KB
- **BashTool Security**: `safeCwd()` workspace boundary check, 10 dangerous command patterns (`rm -rf /`, `mkfs`, `dd`, fork bombs, `curl|sh`, etc.)
- **Input Validation**: `validateConfig()` validates all config fields before writing
- **Error Sanitization**: `sanitizeError()` strips API keys (`sk-*`, `sk-ant-*`, Bearer tokens) from error messages
- **Graceful Shutdown**: SIGINT/SIGTERM handlers close WebSocket clients and HTTP server

### Fixed
- **SSE Reconnect**: Exponential backoff (1s→2s→4s→...→30s) with max 10 attempts, `connectingPromise` guard preventing concurrent `connect()` calls
- **Stale Closure**: `backendAvailableRef` for async callbacks in `App.tsx`
- **Double onDone**: `doneCalled` guard in `readOpenAIStream` and `readOllamaStream` handlers
- **Search Error**: Added missing `return` statement in search error catch block
- **Cleanup**: useEffect cleanup properly aborts active stream

### Added
- **HTTP Proxy Support**: HTTP/HTTPS/SOCKS5 proxy for all LLM API requests
  - Uses undici `ProxyAgent` (zero new dependencies, built into Node.js 24)
  - Config: `proxyUrl` field in settings, persisted to `openchat.json`
  - UI: "🌐 Network Proxy" section in ModelConfigPanel with input and hints
  - Dynamic: reads proxy config per-request, changes apply immediately without restart

---

## [2.0.0-alpha.4] - 2026-06-26

### Added
- **Multi-Provider Web Search**: Users can now choose between Tavily, SerpAPI, Bing Search, and SearXNG (self-hosted) as the search provider. Settings UI updated with provider dropdown and per-provider configuration fields.

---

## [2.0.0-alpha.3] - 2026-06-26

### Fixed
- **Web Search Date Accuracy**: Injected current date into web search context so AI outputs the correct year instead of defaulting to training data cutoff.

---

## [2.0.0-alpha.2] - 2026-06-26

### Added
- **Image Recognition Support (Backend Agent Mode)**:
  - `agentLoop.ts` now converts image attachments to OpenAI multimodal content blocks (`image_url`), so images reach the LLM when using the backend gateway.
  - `providerGateway.ts` Ollama path extracts images from multimodal content blocks into Ollama's native `images` array format (raw base64).
  - `CompletionParams.messages` type broadened to `Record<string, any>[]` to support multimodal message formats.

### Fixed
- **UI Feedback on Message Send**:
  - Added "Thinking..." bouncing dots indicator in empty streaming assistant bubble.
  - Timestamps now include seconds (`HH:MM:SS`) to distinguish individual messages.
  - Backend WebSocket errors now properly reset `isStreaming` state and fall through to direct/demo mode.
  - Connection status indicator in header shows current mode: Agent (green) / Direct / Demo.

---

## [2.0.0-alpha.1] - 2026-06-26

### Added
- **Backend Gateway** (`server/`):
  - Hono + WebSocket server running on port 3001 as the unified API gateway.
  - Replaces direct frontend-to-LLM API calls with a backend-mediated architecture.
  - REST endpoints: `/api/health`, `/api/tools`, `/api/config`, `/api/sessions`.
  - WebSocket endpoint (`/ws`) for full-duplex streaming communication.

- **Tool Execution System** (`server/src/tools/`):
  - `ToolRegistry` — central tool registration and OpenAI function-calling format export.
  - `BashTool` — execute shell commands with timeout, output truncation, and dangerous command blocking.
  - `FileReadTool` / `FileWriteTool` / `FileEditTool` — file operations with path jail (workspace boundary enforcement).
  - `GrepTool` — regex content search via ripgrep (with grep fallback).
  - `GlobTool` — file pattern matching with `**`, `*`, `?`, `{a,b}` glob support.
  - `GitTool` — read-only git operations (status, diff, log, branch).

- **Provider Gateway** (`server/src/providerGateway.ts`):
  - Unified multi-provider LLM routing supporting OpenAI-compatible SSE and Ollama NDJSON.
  - Automatic endpoint normalization.
  - Function calling / tool_use support in streaming responses.

- **Agent Loop** (`server/src/agentLoop.ts`):
  - Core LLM ↔ Tool interaction loop: sends messages + tool definitions → receives tool_calls → executes tools → feeds results back → repeats.
  - Maximum 10 rounds to prevent infinite loops.
  - Abort signal support for cancellation.
  - Full tool execution event streaming (tool_start, tool_result) to frontend.

- **Session Management** (`server/src/sessionManager.ts`):
  - Persistent chat sessions stored as JSON files in `~/.openchat/sessions/`.
  - CRUD operations: create, get, list, update, delete.

- **Frontend Integration**:
  - `src/services/api.ts` — `BackendClient` WebSocket service with auto-reconnect and health check.
  - `src/components/ToolOutput.tsx` — renders tool call events (name, status, input preview, expandable output, duration).
  - `ChatPanel.tsx` updated to render tool events inline in assistant messages.
  - `App.tsx` routes messages through backend when available, falls back to direct LLM / demo mode.
  - CSS styles for tool output UI (`.tool-output`, `.tool-header`, `.tool-status-badge`, etc.).

- **Vite Proxy**:
  - Dev server now proxies `/api/*` and `/ws` to the backend on port 3001.

- **ARCHITECTURE.md**:
  - Comprehensive architecture evolution blueprint documenting the Frontend + Backend + Tools design.

---

## [1.0.6] - 2026-06-26

### Fixed
- **Stream Cancellation**: Stored `AbortController` in a ref so streaming responses can be properly cancelled via the new Stop button (replaces Send while streaming).
- **XSS in Image Preview**: Replaced unsafe `document.write` with DOM API (`createElement` / `appendChild`) to eliminate file-name injection risk when opening image attachments in a new tab.
- **Config Save Debounce**: Added 500ms debounce to `POST /api/config` writes to prevent excessive server requests on rapid UI changes (e.g. slider drags). `localStorage` writes remain immediate.
- **Test Script**: Added `"test": "vitest"` and `"test:run": "vitest --run"` to `package.json` scripts so `npm run test` works as documented.

### Changed
- Deduplicated `buildCustomRequest` in `modelRouter.ts` — now delegates to `buildOpenAIRequest` since the logic was identical.
- Made `ModelRouter.validateConfig` a static method; `ModelConfigPanel` no longer instantiates a new `ModelRouter` on every render.
- Updated `modelRouter.test.ts` to call `ModelRouter.validateConfig` statically.

---

## [1.0.5] - 2026-06-24

### Added
- **Local Config File Persistence (`.openchat`)**:
  - Implemented local config file persistence inside the project workspace directory (saving API keys, search keys, and model routes to `.openchat` in the project root).
  - Developed a custom server-side Vite plugin (`localConfigPlugin`) extending both dev and preview servers with a `/api/config` GET/POST endpoint to read/write config data locally.
  - Configured `App.tsx` with mounts loading configs from `/api/config` and updating local states. Added race-condition prevention utilizing an `isConfigLoaded` flag.
  - Modified `.gitignore` to exclude `.openchat` from version control, ensuring credentials are never committed.

### Changed
- Refactored `App.tsx` config-saving logic to use a single unified `useEffect` synchronization hook.

---

## [1.0.4] - 2026-06-24

### Added
- **Message Bubble Copy Functionality**:
  - Implemented a copy button helper (`MessageCopyButton`) next to timestamps inside the message info row of `ChatPanel.tsx`.
  - Designed the button with dual-state inline SVGs (clipboard icon transforms into a green success checkmark upon click).
  - Styled copy action hover and active behaviors in `index.css`.
  - Added a Vitest component test verifying proper DOM rendering, copy action callback trigger, mocked clipboard execution, and transient status updates.

### Changed
- Expanded the Vitest suite to 44 specs (all passing).

---

## [1.0.3] - 2026-06-24

### Added
- **Web Search Integration (联网搜索)**:
  - Integrated Tavily Search API directly on the client side, utilizing its LLM-optimized search engine for real-time information retrieval (e.g. weather, news, events).
  - Added a global search toggle button (`🌐`) to the chat footer input bar with interactive active/inactive states (neon cyan glow).
  - Created a Tavily API Key settings field in the Model Configuration settings modal with persistence in LocalStorage.
  - Implemented smart web search pre-dispatch fetching inside the chat workflow: when enabled, displays a "🔍 Searching..." status indicator, fetches search snippets, formats search results as a system context prompt block, and injects it into the prompt payload before sending it to the active model.
  - Added component and client tests under `searchClient.test.ts` and `ChatPanel.test.tsx` verifying search client responses, error handling, state triggers, and UI button active states.

### Changed
- Expanded the Vitest suite to 43 specs (all passing).

---

## [1.0.2] - 2026-06-24

### Added
- **File Upload & Attachment Support**:
  - Added file upload triggers (paperclip button) and asynchronous `FileReader` processing to stage image thumbnails and file badges in the Chat Console.
  - Added expandable `TextAttachmentCard` code previewers inside message bubbles to read code files inline.
  - Added model adapters mapping attachments to OpenAI multimodal content blocks, Ollama vision arrays, and markdown text prompt injections.
  - Added JSDOM integration tests in `ChatPanel.test.tsx` verifying file staging, base64 compilation, removal, and send cycles.
- **Startup Port Verification**:
  - Added a pre-startup checking helper in `vite.config.ts` to detect if port 3000 is occupied and output warning banners in the terminal.
- **Config Persistence**:
  - Implemented `localStorage` hooks in `App.tsx` to sync and restore all custom model settings, API credentials, and active selections across page refreshes.

### Changed
- Expanded the Vitest suite to 37 specs (all passing).

---

## [1.0.1] - 2026-06-24

### Added
- **Smart Endpoint URL Normalization**:
  - Added `normalizeEndpoint` utility in `modelRouter.ts` to automatically format base URLs to standard `/v1/chat/completions` endpoints.
  - Implemented real-time `onBlur` URL completion in the `ModelConfigPanel` UI, complete with an information tooltip showing the resolved endpoint.
  - Added unit test cases in `modelRouter.test.ts` covering various edge-case URL formats (trailing slashes, bare domains, whitespace, and correct formats).
- **Real API Streaming Client** (`apiClient.ts`):
  - Created a robust real-time client implementing OpenAI Server-Sent Events (SSE) stream reader.
  - Added support for Ollama line-delimited newline JSON streams.
  - Integrated `AbortController` support to allow cancelling streaming requests mid-generation.
  - Implemented automatic error handling for network timeouts or API errors.
- **Smart API Dispatcher** in `App.tsx`:
  - Connected the real API client to the UI flow. If an API key is configured for the active model (or if Ollama is selected), it will route through the real streaming client.
  - Added an automatic fallback to the simulated offline Demo mode if no API credentials are provided.
- Added comprehensive status feedback in the welcome message explaining the difference between **Real Mode** and **Demo Mode**.

### Changed
- Updated the Custom Provider and OpenAI Provider request builders to auto-normalize URLs on the fly as a safety net.
- Expanded the Vitest suite to 31 test cases (all passing).

---

## [1.0.0] - 2026-06-23

### Added
- **Core Architecture & Types** (`types.ts`): Define message, workspace file, task, and model structure configurations.
- **Stream Parser** (`streamParser.ts`): Stream chunk buffer parser for processing and separating `<thinking>` blocks from assistant content.
- **Model Router** (`modelRouter.ts`): Provider routing adapter format structure mapping requests to Ollama and OpenAI specs.
- **Task State Machine** (`taskStateMachine.ts`): Finite State Machine governing agent task lifecycles: `Pending` -> `Running` -> `Success` / `Failed`.
- **Simulated API** (`simulatedApi.ts`): Custom stream simulator generating thinking and responses.
- **Responsive Workspace Panels**:
  - `ChatPanel.tsx`: Collapsible accordion thinking section, real-time typing indicators, and markdown content parsing.
  - `WorkspacePanel.tsx`: Tab-based layout hosting the file canvas editor and task boards.
  - `TaskBoard.tsx`: Kanban dashboard with status action hooks.
  - `ModelConfigPanel.tsx`: Full settings configuration view allowing custom additions/removals of API endpoint details.
- **Aesthetic Styling** (`index.css`): Modern, glow-accented dark theme with glassmorphic cards and animated states.
- **Vitest Suites**: Unit tests covering task states, config validations, and streaming buffers.
