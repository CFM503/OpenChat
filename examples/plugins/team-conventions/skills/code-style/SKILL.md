---
name: code-style
description: Apply team coding style and naming conventions when writing or reviewing code. Use when the user asks about style, conventions, or clean code.
---

# Team code style

When writing or reviewing code in this workspace:

1. Prefer TypeScript strict types; avoid `any` unless justified.
2. Use descriptive names; no 1–2 letter variables except loop indices.
3. Keep functions small; extract helpers when a block exceeds ~40 lines.
4. Match existing file patterns (imports, error handling, logging).
5. Never commit secrets (API keys, tokens) — warn if found.

## For the current request

$ARGUMENTS

Follow the style above and call out any violations in existing code you touch.
