# Current state of the build (Phase 0 audit, 2026-09-24)

> This is the audit taken **before** the rebuild, kept as the record of what was replaced. The legacy `app.js`, stylesheet and screens listed below are now deleted. For the new structure see DESIGN.md §13 (component index); for open items see GAPS.md and FOLLOW_UPS.md.

Audit of the repo at `4fe9b61` (ChapterKeeparr 0.5.0 alpha) against the redesign in `DESIGN.md` / `SCREENS.md`. The design was drawn without access to the repo. This file records what the build actually is, so the redesign is implemented against it rather than against assumptions.

## 1. Stack

| Concern | What exists | Notes for the redesign |
|---|---|---|
| Framework | None. One vanilla-JS IIFE, `app/static/app.js` (562 lines, ~61 KB, string-template `innerHTML` rendering) | Keep vanilla JS. The prompt assumed a component framework, type-checker, linter and Storybook. None exist, and adding one would be a new dependency and a build step. "Components" will be plain render functions and one small DOM helper. |
| Markup | `app/static/index.html`, every page pre-rendered as a hidden `<section>` | Will be replaced by a minimal shell. Screens render from JS. |
| Styling | `app/static/styles.css`, one minified file with teal/navy palette, `Inter` font, about 180 hard-coded hex values | Delete it all. Replace with `tokens.css` and component CSS. |
| Routing | Hash routes: `#overview`, `#jobs?filter=…`, `#new-job`, `#settings`, `#job/<id>[?match]` | The server only serves `/` (`app/api.py` `index()`), so path routes like `/books/:id` would 404 on reload. **Keep hash routing** (`#/books/:id`) and redirect the old hashes. See G-028. |
| Data fetching | `api()` wrapper over `fetch` with an optional bearer token from `localStorage` (`chapterkeeparr.api_token`), plus polling `/api/jobs` every 3 s (active) / 10 s (idle) | Keep the client and the polling. Notifications are driven by polling diffs, since there is no push channel (G-003). |
| Build tool | None. Files are served as-is by FastAPI | No bundler. |
| Static serving | `GET /static/{filename}` with a **hard-coded allowlist**: `app.js, styles.css, favicon.svg, icon-*.png` (`app/api.py`) | **Blocker for any additional frontend file** (ES modules, `tokens.css`, self-hosted Figtree). G-027. |
| PWA | `manifest.webmanifest` (teal/navy colours), `sw.js` shell cache `chapterkeeparr-shell-v7`, teal PNG icons 180/192/512 | Keep the mechanism. Restyle the manifest and icons from the design's logo SVG, and bump the cache. |
| Frontend tests | None. Project rule: `node --check app/static/app.js` | Node 24 is installed, so pure logic (status adapter, search, grouping, notification routing) can be unit-tested with the built-in `node --test`, with no new dependency. This needs logic in an importable module (G-027). |
| Backend tests | 63 Python `unittest` tests, all passing (`python -m unittest discover -s tests`) | Must stay green. |
| Screenshots | No Playwright (neither npm nor Python) | Screenshots will use the in-app browser. Installing Playwright needs approval. |
| Icons | Unicode glyphs (`▦ ☷ ＋ ⚙ ⌕ ▶ ■ ↻ ☰`) | Replace with inline SVG in Lucide style (24 grid, 1.8 stroke), with no dependency. |

## 2. Backend model vs the design's model (the root gap)

**The design is book-centric; the build is job-centric.** That is the biggest mismatch and drives most rows in GAPS.md.

- The only entity is a **job**: `{id, path, status, stage, progress 0–1, options, result{report,…}, review, review_answer, error, created_at, updated_at, started_at, finished_at, attempts, cancel_requested}` (`app/db.py`).
- Job statuses are `queued · running · awaiting_review · complete · skipped · failed · cancelled`.
- There is **no book record, no library index, no series, no EPUB pairing state, no activity log, no settings store** (only `recovery_minimum_percent` in `preferences`).
- A "book" in the UI has to be **derived**: the latest job per canonical `path`. Identity comes from `result.report.identity` / `result.report.edition`, and status from the job status plus the report.
- `GET /api/jobs` returns the full `result.report` for every job (checks, transcripts, alignment diagnostics), with `limit` defaulting to 100 and capped at 1000. That's fine for tens of books and too heavy for "hundreds" (G-008).
- The server's workflow has **five gates** (`app/flow.py`: Inspect files → Match recording → Align chapters → Verify → Save) plus five evidence grades (recording, coverage, alignment, speech, integrity). The design has **four steps** (Inspect → Match edition → Check audio → Save). See G-031.

## 3. Route map, old → new

| Old hash | Old screen | New route | New screen | Redirect |
|---|---|---|---|---|
| `#overview` (default) | Overview: stat cards, current work, recent jobs, "How it works" | `#/` | Library | `#overview` → `#/` |
| `#jobs`, `#jobs?filter=active\|review\|complete\|done\|all` | Jobs table | `#/queue` | Queue | `#jobs*` → `#/queue` (filter `review` → `#/review`, `complete` → `#/?filter=verified`) |
| `#job/<id>` (awaiting review) | Job details + review form | `#/review/<id>` | Needs review detail | `#job/<id>` resolves by status once the job loads |
| `#job/<id>` (complete / skipped) | Job details + chapter player | `#/books/<id>` | Book | same |
| `#job/<id>` (queued / running / failed / cancelled) | Job details | `#/queue?job=<id>` | Queue with that card focused | same |
| `#job/<id>?match` | Job details, edition search focused | `#/review/<id>?match` | Needs review, "Fix the edition" focused | same |
| `#new-job` | New job form | `#/new` | New job | `#new-job` → `#/new` |
| `#settings` | Settings | `#/settings` (+ `#/settings/<section>`) | Settings | `#settings` → `#/settings` |
| (none) | (none) | `#/suggestions` | Suggestions | new |
| (none) | (none) | `#/review` | Needs review list | new |

`<id>` is a **job id** everywhere, because the build has no book id (G-047).

## 4. Inventory: keep, replace or delete

### `index.html`
| Element | Decision | Notes |
|---|---|---|
| `<head>` meta, manifest link, apple-touch-icon | Keep and restyle | `theme-color` per theme, Figtree link, new title "ChapterKeeparr" |
| Skip link | Keep | Restyled |
| Sidebar brand (teal bar mark) | Replace | Logo SVG from the prototype |
| Sidebar nav (Overview / Jobs / New job / Settings) | Replace | Library · Suggestions · Queue · Needs review · New job · Settings, with badges and collapse |
| "Local-first review" sidebar card | **Delete** | Removed by design |
| Sidebar footer version "0.5.0" (hard-coded) | Move | Settings → Server. The version should come from the server (G-024) |
| Topbar: hamburger, breadcrumb, "Connected" pill, refresh button | **Delete** | Replaced by the top bar with search + New job (desktop) and the mobile header |
| `#global-alert` | Replace | With notifications and inline errors |
| `#offline-banner` | Replace | With the OfflineBanner component |
| `#overview` (metric cards, current work, recent jobs, "How it works") | **Delete** | Replaced by Library, the Activity card and Queue |
| `#jobs` (filter group, search, table) | Replace | Queue |
| `#new-job` form | Replace | New job. **Keep the behaviour:** browse, discover several books, select a subset, and the keep/verify-all/force options |
| `#settings` (server list, token form, recovery minimum) | Replace | Settings. **Keep** the token form, server readout and recovery minimum |
| `#job-detail` | Replace | Split into Needs review detail and Book |
| `<dialog id="browse-dialog">` | Replace | Folder browser as a Modal (desktop) or Sheet (phone) |

### `app.js` modules (logical)
| Piece | Decision | Notes |
|---|---|---|
| `api()` fetch wrapper + token | **Keep** | Move into `api` module. Add typed adapter functions per endpoint and `DESIGN-GAP` stubs |
| Status sets `ACTIVE/REVIEW/DONE`, `names`, `statusClass`, `badge` | **Replace** | One status adapter (`toStatus(job)`) mapping onto the 7-status model |
| Cover loader (IntersectionObserver, 3 concurrent, blob-URL LRU of 150) | **Keep** | Wrap it in the Cover component with a generated placeholder |
| `renderOverview`, `renderCurrentWork`, `setMetric` | **Delete** | |
| `filteredJobs`, `renderJobs` (table) | Replace | Queue and Library |
| `route()` | Replace | Hash router with legacy redirects |
| `refresh()` / `schedulePoll()` | **Keep** | Add diffing for notifications and badges |
| `renderSettings` | Replace | Settings screen |
| `workflowMarkup` (5 gates + grades) | Replace | StepTracker plus a "Checks" detail. Keep the information (G-031) |
| `reviewForm`, `searchEditions`, `renderEditions`, `selectEdition`, filename fill | **Keep the logic**, re-render | Needs review → Fix the edition |
| `targetedReview` ("Resume checks" for non-identity reviews) | **Keep**, re-render | Needs review Problem panel (G-030) |
| `acceptanceForm` + submit handler (recovery finalization) | **Keep**, re-render | Safety-critical. Needs a home in Needs review (G-029) |
| `recoveryDraft`, `alignmentDetails`, `alignmentPlot`, attempts, rejected editions | **Keep the information**, re-render | Technical details / History / Details (G-032). The plot uses hard-coded teal and amber and must use tokens |
| `checkMarkup` + `openAudio` (excerpt `.wav` via artifacts) | Keep and restyle | Chapter checks rows and 15-second spot check (G-012) |
| Chapter player (`player`, tickets, `playChapter` plays to chapter end) | Keep the mechanism, change the behaviour | **Stop after 15 s** (design: spot checks only). This reduces an existing feature (see G-048) |
| `downloadReport` | Keep | Book "…" menu / Needs review Technical details (G-041) |
| `sourceMinutes` / `loadSourceDuration` | Keep | Fix the edition: "Current file: 1,607 minutes" (G-042) |
| `scanBooks`, selection, `submitJob` | Keep the logic | New job (G-033) |
| `browse()` | Keep the logic | FolderBrowser |
| Token form | Keep | Settings → Server (G-034) |
| Service-worker registration | Keep | |

### `styles.css`
Delete in full. Every rule uses the legacy palette. Legacy tokens: `--bg:#0b1220 --side --surface:#111d2d --surface-2 --stroke --text --muted:#8ea2b2 --teal --teal-dark --amber --red --radius`. Legacy class families to reach zero afterwards: `metric-*`, `overview-*`, `policy-card`, `process-*`, `current-work`, `recent-*`, `breadcrumb`, `connection*`, `refresh-button`, `sidebar-note`, `jobs-table`, `table-*`, `badge.(active|review|success|neutral)`, `workflow-timeline`, `gate-*`, `edition-card`, `browse-*`, `detail-*`, `info-card`, `muted-card`, `disabled-tag`, `button-(secondary|quiet)`.

### Assets
| Asset | Decision |
|---|---|
| `icon-180/192/512.png` (teal) | Replace, regenerated from the prototype logo (ink tile, bg-coloured book glyph) |
| `manifest.webmanifest` | Keep; set `background_color`/`theme_color` to design `--bg` |
| `sw.js` | Keep; update `SHELL` list and bump the cache version |

## 5. Features in the build that the design doesn't show

These can't be dropped (RULES: "ask before removing a user-facing feature"; AGENTS.md: "retain existing safe publication checks"). Each has a proposed home in GAPS.md.

| Feature | Where today | GAP |
|---|---|---|
| Finalize with accepted exceptions (recovery acceptance: per-section optional flags, keep unresolved markers, accept possible gap, per-book minimum %) | Job detail, awaiting review | G-029 |
| "Review markers from audio" (local-marker draft) and "Resume checks" | Job detail review card | G-030 |
| Five workflow gates and five evidence grades | Job detail top card | G-031 |
| Alignment diagnostics plot, edition attempts, rejected editions, recovery draft markers with transcripts and excerpts | Job detail | G-032 |
| Discover several books under a folder and queue a chosen subset | New job | G-033 |
| API bearer token (stored per browser) | Settings | G-034 |
| Server readout (library roots, workers, CPU threads, cache budget, work/config dirs, auth required) | Settings | G-035 |
| Global recovery minimum % | Settings | G-036 |
| Force reprocessing | New job | G-037 |
| Download report (JSON) | Job detail | G-041 |
| Current-file duration during edition search | Job detail review | G-042 |
| `skipped` status ("Unchanged: previous verification retained" / "Skipped: no processable source") | All lists | G-043 |
| "Cancelling" (running job with `cancel_requested`) | Implicit | G-006 |
| Full-chapter playback | Job detail | G-048 |
| Live worker activity line ("Listening locally 12/40: Chapter 9") | Overview current work | G-046 |
