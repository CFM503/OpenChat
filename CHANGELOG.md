# Changelog

All notable changes to the **OpenChat** project will be documented in this file.

---

## [1.2.0] - 2026-06-24

### Added
- **Smart Endpoint URL Normalization**:
  - Added `normalizeEndpoint` utility in `modelRouter.ts` to automatically format base URLs (e.g., `https://token-plan-cn.xiaomimimo.com/v1`) to standard `/v1/chat/completions` endpoints.
  - Implemented real-time `onBlur` URL completion in the `ModelConfigPanel` UI, complete with an information tooltip showing the resolved endpoint.
  - Added unit test cases in `modelRouter.test.ts` covering various edge-case URL formats (trailing slashes, bare domains, whitespace, and correct formats).

### Changed
- Updated the Custom Provider and OpenAI Provider request builders to auto-normalize URLs on the fly as a safety net.
- Expanded the Vitest suite to 31 test cases (all passing).

---

## [1.1.0] - 2026-06-24

### Added
- **Real API Streaming Client** (`apiClient.ts`):
  - Created a robust real-time client implementing OpenAI Server-Sent Events (SSE) stream reader (`data: {...}`).
  - Added support for Ollama line-delimited newline JSON streams.
  - Integrated `AbortController` support to allow cancelling streaming requests mid-generation.
  - Implemented automatic error handling for network timeouts or API errors.
- **Smart API Dispatcher** in `App.tsx`:
  - Connected the real API client to the UI flow. If an API key is configured for the active model (or if Ollama is selected), it will route through the real streaming client.
  - Added an automatic fallback to the simulated offline Demo mode if no API credentials are provided.
- Added comprehensive status feedback in the welcome message explaining the difference between **Real Mode** and **Demo Mode**.

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
