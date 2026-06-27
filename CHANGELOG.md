# Changelog

All notable changes to the **OpenChat** project will be documented in this file.

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
