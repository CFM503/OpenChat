---
name: pr-checklist
description: Run a PR readiness checklist before opening or merging a pull request.
disable-model-invocation: true
argument-hint: "[branch-or-notes]"
---

# PR checklist

User notes: $ARGUMENTS

Verify before PR:

- [ ] Tests added/updated for behavior changes
- [ ] No leftover debug logs or TODOs that block merge
- [ ] Diff is focused (no unrelated refactors)
- [ ] Docs / CHANGELOG updated if user-facing
- [ ] Secrets not in the diff

Use git tools to inspect the branch, then produce a pass/fail checklist with evidence.
