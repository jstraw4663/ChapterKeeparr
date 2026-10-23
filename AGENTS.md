# ChapterKeeparr

Read MEMORY.md, PROJECT-CONTEXT.md and ALIGNMENT-RECOVERY-PLAN.md before continuing recovery work. Update project context and validation notes as milestones change.

Preserve the distinction between recording identity, timing compatibility and speech verification. A draft or fitted timing curve is not publication approval. Retain existing safe publication checks and source backups.

Run the relevant unittest suite and JavaScript syntax check for changes. For UI interaction changes, update and run every browser suite invoked by .github/workflows/release.yml against disposable fixtures before reporting CI readiness; a focused new harness does not replace the existing matrix. Use generated media for write tests; keep actual audiobook diagnosis read-only unless the user requests publication/repair.

Work on a branch and open a pull request against `main` on GitHub (`jstraw4663/ChapterKeeparr`). Unless Jeremy explicitly authorizes the specific action in the current conversation, don't merge to `main`, push version tags or trigger releases: a `v*` tag publishes the image the Unraid server runs, so only Jeremy merges and tags. Release steps are in README.md → Releasing.

## Mandatory baseline check before every development task

1. Fetch GitHub (`origin`) before editing. Inspect latest main, active development PRs/branches, and relevant image/workflow commits; never assume a local checkout or main is the latest deployed build.
2. Compare those commits with Jeremy's latest deployed Docker commit/build date in MEMORY.md. Preserve newer fixes, branding, scoring/publication contracts and deployment infrastructure. If the deployed branch is ahead of main, reconcile the baseline before implementing; ask only when the intended baseline is unclear.
3. Record the selected commit, working-tree changes and any differences from the deployed build in PROJECT-CONTEXT.md. Start new work from current fetched main once the intended baseline is merged. Do not overwrite newer work with an older local implementation.
4. A merge is not an image release or container update. Record each separately. Update MEMORY.md whenever Jeremy supplies a newer deployed build or changes these rules.

## Design (UI)

The UI follows an approved redesign. Full spec: [docs/design/DESIGN.md](docs/design/DESIGN.md) and [docs/design/SCREENS.md](docs/design/SCREENS.md); gaps between design and build: [docs/design/GAPS.md](docs/design/GAPS.md); remaining work: [docs/design/FOLLOW_UPS.md](docs/design/FOLLOW_UPS.md). The frontend is plain ES modules in `app/static/js/` with no build step; `tokens.css` is the only colour source. `tests/test_frontend.py` enforces the rules below and runs the JavaScript unit tests (`node --test tests/js/*.test.mjs`).

### Must
1. **Use tokens, not colors.** Every color, shadow and easing comes from `docs/design/tokens.css` custom properties. The only raw hex values allowed are cover placeholder colors and on-cover status pills.
2. **Use the shared components.** Buttons, fields, switches, segmented controls, tabs, pills, panels, collapsibles, sheets, modals, notifications, log rows. Don't hand-roll a new variant; extend the component.
3. **One family, Manrope.** User-approved brand kit (2026-10-20) supersedes Figtree; use the supplied Medium/ExtraBold faces and the hierarchy in DESIGN.md §4.
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
