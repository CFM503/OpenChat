---
name: summarize-changes
description: Summarizes uncommitted changes and flags risks. Use when the user asks what changed, wants a commit message, or reviews their diff.
---

## Current changes

!`git status -sb`

!`git diff HEAD --stat`

## Instructions

Summarize the changes above in two or three bullet points, then list any risks
(missing error handling, hardcoded secrets, tests that need updating).
If the working tree is clean, say there are no uncommitted changes.

Optional focus from the user: $ARGUMENTS
