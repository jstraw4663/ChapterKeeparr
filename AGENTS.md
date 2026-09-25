# ChapterKeeparr

Read PROJECT-CONTEXT.md and ALIGNMENT-RECOVERY-PLAN.md before continuing recovery work. Update project context and validation notes as milestones change.

Preserve the distinction between recording identity, timing compatibility and speech verification. A draft or fitted timing curve is not publication approval. Retain existing safe publication checks and source backups.

Run the relevant unittest suite and JavaScript syntax check for changes. Use generated media for write tests; keep actual audiobook diagnosis read-only unless the user requests publication/repair.

## Design (UI)

The UI follows an approved redesign. Full spec: [docs/design/DESIGN.md](docs/design/DESIGN.md) and [docs/design/SCREENS.md](docs/design/SCREENS.md); gaps between design and build: [docs/design/GAPS.md](docs/design/GAPS.md); remaining work: [docs/design/FOLLOW_UPS.md](docs/design/FOLLOW_UPS.md). The frontend is plain ES modules in `app/static/js/` with no build step; `tokens.css` is the only colour source. `tests/test_frontend.py` enforces the rules below and runs the JavaScript unit tests (`node --test tests/js/*.test.mjs`).

### Must
1. **Use tokens, not colors.** Every color, shadow and easing comes from `docs/design/tokens.css` custom properties. The only raw hex values allowed are cover placeholder colors and on-cover status pills.
2. **Use the shared components.** Buttons, fields, switches, segmented controls, tabs, pills, panels, collapsibles, sheets, modals, notifications, log rows. Don't hand-roll a new variant; extend the component.
3. **One family, Figtree.** Sizes and weights from DESIGN.md §4.
4. **Status words are fixed:** Queued, Converting, Needs review, Failed, Verified, Optimized, Cancelled. Steps are Inspect → Match edition → Check audio → Save.
5. **Every screen works on a 390px phone** with the same capabilities as desktop. Touch targets ≥ 44px. Test both themes.
6. **One primary button per screen region.** Destructive actions always confirm (inline on desktop, sheet on phone).
7. **Motion follows DESIGN.md §7 and §9,** and falls back to fades when reduced motion is on.
8. **New backend fields surface through existing patterns:** a status detail line, a History/Activity entry, a Details row, or a Settings row. If none fits, add a `DESIGN-GAP:` note to `docs/design/GAPS.md` instead of inventing UI.
9. **Accessible by default:** real buttons/links/labels, visible focus, `aria-label` on icon buttons, status never by color alone.

### Never
- No teal, neon, glows, gradients-as-backgrounds, left-border accent cards, or emoji.
- No media-player features (play from start, playlists, scrubbing a whole book). Audio is 15-second spot checks only.
- No breadcrumb bar, stat-card dashboards, or marketing copy inside the app.
- No persistent notifications. Status notes minimize into the Queue or Needs review badge.
- No invented numbers in the UI. Unknown is `—`.
- No uploads from the device. Paths are server paths.
- No new UI dependency (component kit, CSS framework, animation library) without asking.

### When the design and the build disagree
- The design wins for look, layout and interaction.
- The build wins for what data exists. If the design needs data the server doesn't provide, build the UI behind a clearly marked placeholder and log it in `docs/design/GAPS.md` (see that file's format). Don't fake it silently.

## Codex

Frontend is owned by Claude. When you add or change API fields, update `docs/design/GAPS.md` and don't edit UI files unless asked.
