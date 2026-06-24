# OpenChat — AI Coding Workspace Platform

OpenChat is a premium, high-performance prototype of an AI coding platform (similar to OpenAI Codex/Canvas) built with **React**, **TypeScript**, **Vite**, and **Vanilla CSS**.

It features an immersive dual-pane layout: a **Chat & Thinking Console** on the left and a **Code & Task Workspace** on the right. It includes a dynamic model routing gateway (supporting OpenAI/Ollama) and a finite-state machine-driven Agent Task Manager.

---

## 🌟 Features

1. **Immersive Dual-Pane Layout**
   - **Left Panel (Chat Console)**: High fidelity chat feed featuring real-time stream chunk compilation, automatic code syntax highlighting, and expandable thinking blocks (collapsing `<thinking>` tags into sleek UI elements).
   - **Right Panel (Workspace)**: Toggleable tabs between a Code Editor (supporting tabbed file sheets) and a Task Kanban Board.

2. **File Upload & Model Attachment Support**
   - **Asynchronous Staging**: Select and stage files asynchronously using `FileReader` pipelines. Displays image thumbnails or document badges with file sizes before sending.
   - **Inline Code Expanders**: Clickable file cards inside the chat bubble list toggle open/closed to preview code file content.
   - **Vision & Prompt Injections**: Maps attachments to OpenAI multimodal payloads (`image_url`), Ollama vision arrays, and appends text file contents as formatted markdown blocks in text prompts.

3. **Real Streaming API Client**
   - Full support for OpenAI-compatible Server-Sent Events (SSE) streaming (`text/event-stream`).
   - Native support for local Ollama newline-delimited JSON streams.
   - Built-in `AbortController` cancellation to stop response generation on the fly.
   - Automatic fallback to simulated offline Demo mode when API credentials are not provided.

4. **Smart Endpoint Auto-Completion**
   - Normalizes and auto-completes base URLs (e.g. `https://example.com/v1`) to standard completion paths (`/v1/chat/completions`) automatically on input blur and request dispatch.

5. **Model Routing Gateway**
   - Built-in adapter system mapping payloads to standard OpenAI completions or local Ollama instances.
   - Comprehensive model validation panel allowing users to live-edit, delete, add, and switch default router choices.

6. **Persistent Client Configuration**
   - Saves and loads custom model configurations, endpoints, API keys, and the active model selection automatically using browser `localStorage` to survive page reloads.

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
Make sure you have Node.js (v18+) installed.

### 1. Install Dependencies
Navigate to the root directory and run:
```bash
npm install
```

### 2. Run Tests
Verify modules and state machines with the automated test suites:
```bash
npm run test
```

### 3. Launch Development Server
Launch the hot-reloading development server locally:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your web browser.

### 4. Build for Production
To bundle the optimized web assets for deployment:
```bash
npm run build
```
Build assets will be located in the `dist/` directory.
