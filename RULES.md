# Repo rules

## Committing

- **Do NOT commit planning or summary Markdown.** Plans, design notes, investigation
  write-ups, status summaries, scratch docs — keep them local. They are git-ignored.
- **Do NOT commit `.claude/` files** (settings, plans, memory, transcripts). Git-ignored.
- The only Markdown that is tracked: `AGENTS.md`, `CLAUDE.md`, and this `RULES.md`.
  There is no committed `README.md`.
- `.gitignore` enforces this: `*.md` is ignored except the whitelist above, and
  `.claude/` is ignored wholesale.

## Why

These docs are working artifacts, not part of the shipped project. Keeping them out
of git keeps the history focused on code.
