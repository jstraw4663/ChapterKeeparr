# ChapterKeeparr redesign handoff

1. Copy the `docs/design/` folder into the root of the ChapterKeeparr repo.
2. Optional but useful: from the design canvas, export PNGs of the App design page's artboards into `docs/design/reference/screens/png/`.
3. Open Claude Code at the repo root and paste the contents of `HANDOFF_PROMPT.md` (everything below its line).

What's inside:
- `HANDOFF_PROMPT.md`: the instructions for Claude (frontend).
- `docs/design/RULES.md`: short rules; Claude copies them into AGENTS.md and CLAUDE.md so Codex keeps the design.
- `docs/design/DESIGN.md`: the design system (tokens, type, layout, motion, components, notifications).
- `docs/design/SCREENS.md`: every screen, desktop and phone, and the data each needs.
- `docs/design/GAPS.md`: seed list of what the design assumes from the backend; Claude verifies and fills it in.
- `docs/design/BACKLOG.md`: phase-2 ideas, deliberately not designed yet.
- `docs/design/tokens.css`: production-ready tokens, light and dark.
- `docs/design/reference/`: prototype source for all 20 screens plus the full prototype stylesheet.


## Finalized optimization plans

- [UI/UX optimization and visual mockups](plans/ui-ux-optimization.md) — implement first.
- [Backend optimization and hardware validation](plans/backend-optimization.md) — agreed direction, deferred until UI validation.
- [Audit evidence and plan index](plans/README.md).

