# ChapterKeeparr frontend redesign: handoff for Claude

Paste everything below the line into Claude Code, opened at the root of the ChapterKeeparr repo, after copying the `docs/design/` folder from this bundle into the repo.

---

You are the **frontend engineer** on ChapterKeeparr. Your job is to rebuild the app's UI to match an approved redesign, remove the old design completely, and leave the repo in a state where any agent (including Codex) keeps the new design intact.

## Context

- ChapterKeeparr is a self-hosted web app / PWA on an Unraid server. The server converts folders of MP3s into a single M4B with chapters, matches the book to a published edition, and verifies chapter boundaries against the audio. The UI is **only a front end**: nothing is uploaded from the device, and every path is a server path.
- **Codex is building the backend at the same time.** You do not own backend code, API handlers, the database, the job runner or build/deploy config. Don't edit them. If the design needs something the backend doesn't provide, you build the UI against a clearly marked placeholder and write the contract you need into `docs/design/GAPS.md` for Codex.
- The design is final. Your judgment is welcome on implementation, not on the look. If you think a design decision is wrong for a real technical reason, say so in your report instead of silently changing it.

## Read first (in this order)

1. `docs/design/RULES.md`: short, non-negotiable rules.
2. `docs/design/DESIGN.md`: tokens, type, layout, motion, components, notifications, accessibility, copy.
3. `docs/design/SCREENS.md`: every screen, its primary action, content order, phone behavior, and the data it needs. Starts with an old → new map.
4. `docs/design/GAPS.md`: seed list of what the design assumes from the backend.
5. `docs/design/reference/`: the prototype source for every screen (see its README). Use it for exact values and interactions. Its sample data is illustrative; never ship it.
6. `docs/design/BACKLOG.md`: things intentionally **not** designed yet. Don't build them.

Then read the repo: `README`, `AGENTS.md` / `CLAUDE.md` if present, the frontend source, the API client and any API schema/types.

## Phase 0: Recon and gap audit (report before large deletions)

1. Identify the frontend stack (framework, router, styling approach, state/data fetching, build tool, tests). **Keep the stack.** Don't migrate frameworks or add a component kit, CSS framework or animation library without asking. A small icon library (Lucide) is fine if it isn't already there.
2. Inventory the current UI: routes/pages, components, stylesheets, theme code, assets. Mark each as **keep and restyle**, **replace**, or **delete** (legacy).
3. For every row in `docs/design/GAPS.md` and every "Needs from server" line in `SCREENS.md`, check the actual API/client/types and record what exists: endpoint, field, or "missing". Also record the reverse: **functionality in the build that the design doesn't show** (features, settings, statuses, fields). Those need a home or a decision; list them, don't drop them.
4. Write the results to:
   - `docs/design/CURRENT_STATE.md`: stack, route map old → new, component inventory with keep/replace/delete.
   - `docs/design/GAPS.md`: update every seed row (exists / partial / missing, with file or endpoint references) and add new rows. Each gap gets an owner (`frontend`, `backend`, `both`, `Jeremy`) and, for backend gaps, a proposed contract (method, path, request/response shape) that matches the conventions already in the API.
5. Post a short summary: stack, the top gaps, anything in the build the design doesn't cover, and your plan. **Then continue** unless a gap blocks a whole screen or you'd need to change backend code. In those cases, stop and ask.

## Phase 1: Foundation

- Add `docs/design/tokens.css` (or its equivalent in the project's styling system) as the only source of color, shadow, radius and easing. Theme via `data-theme` on `<html>`, resolved from the setting `system | light | dark`.
- Load Figtree (300–900). Set base type.
- Build the shared components listed in DESIGN.md §8: Button (primary / ghost / icon / destructive-confirm), Field, Select, Switch, SegmentedControl, Tabs, StatusPill + dot, Badge, Cover (art or generated placeholder), StepTracker, Panel, Collapsible, Sheet, Modal, ActionSheet, LogRow, Checklist, ChapterRow with spot-check, FolderRow, OfflineBanner, EmptyState, Skeleton.
- Motion primitives from DESIGN.md §7, with the reduced-motion fallback wired to both the OS setting and the in-app "Reduce motion" setting.
- One status model in the frontend: `queued | converting | review | failed | verified | optimized | cancelled`, with the labels and colors in DESIGN.md §3. Map whatever the API returns into it in one place (an adapter), not in each component.

## Phase 2: Shells and navigation

- **Desktop:** collapsible sidebar (248 ↔ 76) with nav Library · Suggestions · Queue · Needs review · New job · Settings, the three badges, the Activity card that flies into the Queue icon on collapse, and a top bar with search + New job.
- **Phone (< 768px):** fixed blurred header (logo, expanding search, settings gear → Settings sheet), tab bar Suggestions · Library · Queue · Needs review, floating New job button, bottom sheets, safe-area insets.
- **Routes:** Library `/`, Suggestions, Queue, Needs review (list + `/:id` detail), Book `/books/:id`, New job, Settings. Keep existing URLs working with redirects where they change.
- **Search** overlay on both shells (DESIGN.md §8): keyboard support on desktop (`/`, ↑ ↓ Enter Esc), expanding field on phone, results route by status.
- **Notifications** exactly as DESIGN.md §9: arrive, hold ~3.6s with a hold line, fly into the Needs review or Queue badge (own-action confirmations fade in place), badge pop + halo. Also write every event into the activity log. Driven by the live update channel if one exists; otherwise by polling diffs, logged as a gap.

## Phase 3: Screens

Build each screen from SCREENS.md, desktop and phone, in this order: Library → Queue → Needs review → Book → New job (with folder browser) → Suggestions → Settings. For each:
- Match the content order and the single primary action.
- Wire every control to a real call where one exists. Where it doesn't, follow the placeholder rules below.
- Include loading (skeletons), empty, error and offline states.
- Library must stay fast with hundreds of books (virtualize or page; group/sort/filter as specified).

## Placeholder rules (for anything the backend can't do yet)

- Render the real UI, then disable or stub the action with honest copy, e.g. a disabled button with a tooltip "Needs server support (G-012)", or a panel reading "Chapter check evidence isn't available from the server yet."
- Put the data behind a typed adapter function (for example `api.getChapterClip()`) that returns a "not available" result, so Codex only has to implement the call.
- Mark each one in code with `// DESIGN-GAP: G-xxx` and make sure the matching row exists in `GAPS.md`.
- **Never fake data** in the shipped UI. Mock data is allowed only in tests, Storybook-style fixtures, or a dev-only flag that's off by default.

## Phase 4: Remove the legacy design

Delete, don't comment out:
- The teal/neon palette and every hard-coded color, glow, gradient background and old theme variable.
- Old components and screens superseded by the redesign: Overview stat cards, "How it works" panel, "Current work" block, breadcrumb bar, "Connected" pill + refresh button, "Local-first review" sidebar card, old job-details layouts, unused icons and assets.
- Dead CSS, unused dependencies that only served the old UI (list them; remove only if nothing else imports them), and duplicate utilities.
Then simplify: one way to do each thing (one button component, one status mapping, one sheet/modal system, one icon source). Search for leftovers (old class names, old hex values, `teal`, `neon`, `glow`) and report the count at zero.

## Phase 5: Docs so the design survives

Create or update, keeping existing content that's still true:
- `AGENTS.md` (Codex reads this) and `CLAUDE.md`: add a **Design** section with the contents of `docs/design/RULES.md` and links to the design docs. Add a line in the Codex section: "Frontend is owned by Claude. When you add or change API fields, update `docs/design/GAPS.md` and don't edit UI files unless asked."
- `docs/design/DESIGN.md` and `SCREENS.md`: fix anything that turned out wrong during implementation (with a one-line note of what changed and why). Add a **component index**: each design component → its file path in the repo.
- `docs/design/GAPS.md`: final state of every gap.
- `docs/design/FOLLOW_UPS.md`: a prioritized list (P1 / P2 / P3) of remaining work, each item with owner (frontend / backend / Jeremy), the gap ID if any, and the smallest next step. Include decisions Jeremy needs to make.
- `README`: a short "UI" section pointing at `docs/design/`.
- Changelog entry if the repo keeps one.

## Phase 6: Verify

- Build, lint, type-check and existing tests pass. Add tests for the status adapter, search matching, grouping/sorting, and the notification destination logic.
- Take screenshots of every screen at **1440×900 and 390×844, light and dark** (Playwright if available), save them under `docs/design/screenshots/`, and compare against the reference prototypes (and `reference/screens/png/` if present). List any intentional differences in your report.
- Accessibility pass: keyboard through each screen, focus visible, labels on icon buttons, sheets/modals trap focus and close on Esc, contrast holds in both themes, reduced motion works.
- Grep checks: no hex colors outside tokens/cover code, no `DESIGN-GAP` without a matching GAPS row, no leftover legacy class names.

## Working agreement

- Work on a branch, e.g. `redesign/frontend`. Small commits by phase. Don't touch files Codex owns; if a merge conflict appears in shared files (types, API client), keep Codex's backend changes and adapt the frontend.
- Ask before: changing backend code, adding a dependency, removing a user-facing feature that exists in the build but not in the design, or changing a URL without a redirect.
- Don't build anything in `BACKLOG.md`.

## Report back with

1. What was built, per screen (desktop / phone), with screenshot paths.
2. What was deleted (files, dependencies, CSS) and what was simplified.
3. Where the design differs from the build: module and functionality gaps, both directions, with GAP IDs.
4. Placeholders now in the UI (screen → gap ID → what the user sees).
5. `FOLLOW_UPS.md` top 10 and the decisions needed from Jeremy.
6. Anything in the design you think should change, and why.
