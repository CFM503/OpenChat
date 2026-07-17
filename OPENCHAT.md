# OpenChat project instructions

This file is always loaded into the agent context (like Claude Code's `CLAUDE.md`).
You can also use `CLAUDE.md` — both are supported.

## Stack

- Frontend: React + TypeScript + Vite (`src/`)
- Backend: Hono + WebSocket (`server/src/`)
- Tests: Vitest (`src/test/`)

## Conventions

- Prefer small, focused changes; match existing code style.
- Do not commit `.openchat` (contains API keys).
- Agent tools: bash, file_*, grep, glob, git, web_search, web_fetch, skill.
- Skills: Claude Code layout under `.claude/skills/<name>/SKILL.md` or `~/.openchat/skills/`.
- Plugins: Claude layout with `.claude-plugin/plugin.json` + `skills/`, or legacy `manifest.json` + `index.js`.

## Useful commands

```bash
npm run dev:all
npm run test:run
npm run openchat -- skills   # list skills (via health/tools after server start)
```
