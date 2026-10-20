# Design ↔ build gaps

Living list of places where the redesign needs something the build doesn't have yet, or where the build has something the design doesn't cover. Claude (frontend) writes entries; Codex (backend) picks up the `backend` ones.

**Status:** `open` · `placeholder in UI` · `in progress` · `done` · `won't do`
**Owner:** `frontend` · `backend` · `both` · `Jeremy` (a decision)
**Build today:** `exists` · `partial` · `missing`

In code, mark every placeholder with a searchable comment: `// DESIGN-GAP: G-012`.

API conventions used by the proposed contracts, matching `app/api.py`: JSON under `/api/`, bearer auth on everything except `/api/health` and ticketed audio, collections wrapped in an object (`{"jobs": [...]}`), actions as `POST /api/jobs/{id}/<verb>`, `404` for unknown ids, `409` for state conflicts, `422` for validation, `503` for unavailable storage or providers.

Last verified against commit `4fe9b61` on 2026-09-24; statuses updated after the rebuild on the same day. See `CURRENT_STATE.md` for the stack and model summary.

## Summary

### Chapter draft review — 2026-10-03

The marker editor, section picker, filter, pagination and removal checkbox described in the two entries below (and G-049) are replaced by the ordered card list in `CHAPTER_REVIEW.md`. The decision contract is unchanged: `{index, action: published|keep|rename|remove, section_id?, override_order?, title?, confirmed: true}` plus `optional_sections`. Removal is chosen explicitly on its card and sent with `confirmed: true`; the phone confirmation sheet at save time is gone (the gap checkbox stays the commit point). Client-side derivations: kind tags, between-neighbours, likely extra boundaries, and which `sections` count as missing (one an open marker already offers as its nearest choice isn't shown as missing until that marker is decided). New gap: G-050 (book length).

### Review conveniences — 2026-10-01

Acceptance preview markers now include the saved `transcript`. The editor displays up to two sentences (360-character maximum, with an ellipsis for long speech), adds All/Unconfirmed/Confirmed filtering based on original speech support, and preserves all hidden decisions. Published exceptions have Select All with mixed-selection state; bulk selection still sends every individual reference ID through existing server validation. No publication rules change.

### Marker decision editor — 2026-10-01

User-authorized frontend/backend change. Recovery preview now includes `markers` (index, original title/time, suggested title, supported, excerpt, removable). Acceptance optionally accepts `marker_decisions`, one per original marker: `{index, action: keep|suggested|rename|remove, title?, confirmed?}`. Legacy approvals remain supported. Removal requires confirmation and cannot remove the first marker. No timestamps move and no audio is deleted. Recognition percentage retains the original denominator, independent of edits. Decisions and resulting marker counts are recorded in the acceptance report. The UI defaults to identified names for supported markers and original names otherwise, displays a save summary, exposes saved excerpts with a 15-second playback limit, and confirms removal in a phone sheet. Unlocated references have no fabricated preview or inferred mapping to local markers. Changing drafts clears unsaved decisions.

| ID | Area | Build today | Owner | Status | Blocks |
|---|---|---|---|---|---|
| G-001 | Status vocabulary | partial | frontend | done | — |
| G-002 | Step + percent | partial | frontend | done | — |
| G-003 | Live updates (push) | missing | backend | placeholder in UI | — (polling fallback) |
| G-004 | Review reasons | partial | backend | placeholder in UI | — |
| G-005 | Failed: step + error output | partial | backend | placeholder in UI | — |
| G-006 | Cancel | exists | frontend | done | — |
| G-007 | Book model (series, narrators, cover…) | partial | backend | placeholder in UI | Library grouping by series |
| G-008 | Library list at scale | partial | backend | placeholder in UI | Library beyond ~200 books |
| G-009 | Search | partial | frontend | done | — |
| G-010 | Global activity feed | missing | backend | placeholder in UI | Queue → Activity (partial) |
| G-011 | Per-book history | partial | both | placeholder in UI | — |
| G-012 | 15 s spot-check audio | exists (via existing endpoints) | frontend | done | — |
| G-013 | Chapter-check evidence | exists | frontend | done | — |
| G-014 | Edition search, filename, tags | partial | both | placeholder in UI | — |
| G-015 | Clean up source MP3s | missing | backend | placeholder in UI | Book primary action |
| G-016 | Optimized rule | partial | both + Jeremy | placeholder in UI | — |
| G-017 | EPUB pairing | partial | backend | placeholder in UI | — |
| G-018 | Edit details | missing | backend | placeholder in UI | — |
| G-019 | Re-verify | exists | frontend | backend done; remove old warning | — |
| G-020 | Suggestions scan | missing | backend | placeholder in UI | Suggestions is partial |
| G-021 | BookOrbit | missing | backend + Jeremy | placeholder in UI | — |
| G-022 | Folder browser counts + guess | partial | backend | placeholder in UI | — |
| G-023 | Settings persistence | partial | both | placeholder in UI | — |
| G-024 | Health + version | exists | frontend + backend | implemented; device validation pending | — |
| G-025 | Queued jobs ("Up next") | exists | frontend | done | — |
| G-026 | PWA | partial | frontend | done | — |
| G-027 | Static file serving allowlist | — | backend (tiny) | done | — |
| G-028 | Path routes vs hash routes | — | frontend | done | — |
| G-029 | Recovery acceptance has no design | — | frontend + Jeremy | done | — |
| G-030 | Review markers from audio / Resume checks | — | frontend | done | — |
| G-031 | 5 server gates vs 4 design steps | — | Jeremy | done | — |
| G-032 | Diagnostics (plot, attempts, drafts) | — | frontend | done | — |
| G-033 | Multi-book discovery in New job | — | frontend | done | — |
| G-034 | API token setting | — | frontend | done | — |
| G-035 | Server readout | — | frontend | done | — |
| G-036 | Recovery minimum % setting | — | frontend | done | — |
| G-037 | Force reprocessing option | — | frontend | done | — |
| G-038 | "Chapter checks: Off" conflicts with publish policy | — | Jeremy | done | — |
| G-039 | "Save to" option unsupported | missing | Jeremy | placeholder in UI | — |
| G-040 | Edition fields at job submit | missing | backend (tiny) | placeholder in UI | — |
| G-041 | Download report | — | frontend | done | — |
| G-042 | Current-file duration | — | frontend | done | — |
| G-043 | `skipped` status not in vocabulary | — | Jeremy | done | — |
| G-045 | Figtree hosting | exists | frontend | done | bundled variable WOFF2 + OFL |
| G-046 | Worker activity line | exists | frontend | done | — |
| G-047 | No stable book id | missing | backend | open | — |
| G-048 | Chapter playback reduced to 15 s | — | Jeremy | open | — |
| G-050 | Book length in the draft preview | partial | backend | placeholder in UI | — |

---

## Decisions (2026-09-24)

- **G-027** approved and done: the static route serves `.js/.css/.woff2/.png/.svg` inside `app/static` (the only backend edit in the redesign).
- **G-020**: Suggestions ships partial, built from `/api/discover` and the job list.
- **G-031 / G-038**: keep 4 dots with the timing/speech sub-check named, and show all 5 gates in details; chapter checks are Spot checks or Every chapter, with no "Off".
- **G-029**: "Finalize with accepted exceptions" gets its own collapsible in Needs review.
- **G-048**: not decided. The spot check plays 15 seconds; "Play to chapter end" keeps the old behaviour available until Jeremy decides.

## Seed rows (verified)

### G-001 · Status vocabulary
- Screens: all
- Design expects: `queued · converting · review · failed · verified · optimized · cancelled`
- Build today: **partial.** `jobs.status ∈ queued, running, awaiting_review, complete, skipped, failed, cancelled` (`app/db.py` CHECK constraint). `stage` holds the finer engine state (`starting, converting, researching, checking_speech, validating_output, committing, saved, checking_completion`) and is overwritten with the status when a job finishes. `workflow.overall` (`app/flow.py present()`) gives a human sentence. A running job with `cancel_requested` is effectively "Cancelling".
- UI plan: one adapter (`status.js → toStatus(job)`): `queued→queued`, `running→converting`, `awaiting_review→review`, `failed→failed`, `cancelled→cancelled`, `complete→verified|optimized` (G-016), `skipped→` see G-043.
- Owner: frontend · Status: done

### G-002 · Current step and percent
- Screens: Queue, Library cover bar, sidebar Activity card
- Design expects: step `n of 4` + percent while converting
- Build today: **partial.** `progress` is a 0–1 estimate from a fixed stage table (`app/worker.py STAGES`), interpolated during speech checks (`.5 + .24·i/n`). The current step comes from `workflow.gates[].state == 'working'`.
- UI plan: map the gates onto the 4 design steps (see G-031). Percent = `round(progress·100)`. Label it an estimate in Details, as the server already does ("estimated workflow progress").
- Owner: frontend · Status: done

### G-003 · Live updates
- Design expects: SSE or WebSocket
- Build today: **missing.** The client polls `GET /api/jobs` (3 s with active jobs, 10 s idle).
- UI now: notifications and badges come from diffing successive polls (`js/store.js` + `js/events.js`). No placeholder is visible.
- Proposed contract: `GET /api/events` → `text/event-stream`, `event: job` / `data: {"id","status","stage","progress","updated_at","cancel_requested"}`. Bearer auth via `?ticket=` (EventSource can't set headers), mirroring media tickets.
- Owner: backend · Status: placeholder in UI

### G-004 · Review reasons
- Screens: Needs review → Problem
- Design expects: reason code + human sentence + technical detail (HTTP code, provider URL)
- Build today: **partial.** `result.report.review_reason = {category: identity|chapters|source_inventory|source_changed|service|operational, detail}`, plus `workflow.next_action`, `report.reason` and `job.error`. HTTP status and URL only appear inside the `detail` string.
- UI now: category → plain title ("We couldn't confirm this edition"), detail → explanation, raw strings under Technical details.
- Proposed contract: add `review_reason.technical = {"http_status": 404, "url": "https://api.audnex.us/…", "error": "…"}` when a provider call caused the pause.
- Owner: backend · Status: placeholder in UI

### G-005 · Failed jobs
- Design expects: failed step, last N lines of converter output, Retry
- Build today: **partial.** `status=failed`, `error` string. The failed gate is derivable (`present()` marks the working gate `blocked`). `stage` is overwritten with `failed`. The worker log exists on disk at `CONFIG_DIR/jobs/{id}/attempt-NNN/worker.log` but has no endpoint. Retry exists: `POST /api/jobs/{id}/retry`.
- UI now: "Failed at step n · <step>" from the gates. Error details show `job.error` and `report.reason`. A log panel reads "Converter output isn't available from the server yet."
- Proposed contract: `GET /api/jobs/{id}/log?lines=200` → `{"attempt": 3, "lines": ["…"], "truncated": true}`
- Owner: backend · Status: placeholder in UI

### G-006 · Cancel
- Build today: **exists.** `POST /api/jobs/{id}/cancel`. Queued and awaiting-review jobs are cancelled at once. Running jobs set `cancel_requested` and stop at the next safe checkpoint, and never during publication. Source files are never touched.
- UI plan: after cancelling a running job, show "Cancelling at the next safe point" until the status flips.
- Owner: frontend · Status: done

### G-007 · Book model
- Design expects: series name + number, author, narrators, cover URL, ASIN, region on every book
- Build today: **partial.** `report.identity = {title, author, narrator, asin}` (from tags/EPUB/answers), `report.edition = {asin, cover_url, title, authors, narrators, publisher, runtime_seconds}` once matched (`engine.summaries`), `report.selected_recording.region`. Cover also via `GET /api/jobs/{id}/cover` (local cover file or embedded art). **No series or series number anywhere.**
- UI now: the Library groups by author by default. Group: Series still works and says every book is Standalone until series data exists.
- Proposed contract: add `series: {"name": str, "position": str|null}` to `engine.summaries()` from Audnexus `seriesPrimary`, and surface it in the book summary (G-008).
- Owner: backend · Status: placeholder in UI

### G-008 · Library list at scale
- Design expects: paged or complete list that performs with hundreds of books
- Build today: **partial.** `GET /api/jobs?limit=` (default 100, max 1000), newest first, **each item carrying the full report** (checks, transcripts, alignment diagnostics). There is no book entity. The library is derived client-side as the latest job per `path`.
- UI now: requests `limit=1000`, derives books client-side, and renders 120 covers at a time, loading more on scroll. A note appears if the 1,000-job cap is hit.
- Proposed contract: `GET /api/books?limit=200&cursor=` → `{"books": [BookSummary], "next_cursor": str|null}` with `BookSummary = {id (latest job id), path, title, author, narrators, series, cover_url, asin, region, status, status_detail, step, progress, updated_at, epub_present, mp3s_present}`. Or `GET /api/jobs?view=summary` returning the same shape without `result`.
- Owner: backend · Status: placeholder in UI

### G-009 · Search
- Build today: **partial.** No search endpoint. The old UI filtered path/id/status client-side.
- UI now: client-side over the cached derived library (title, author, narrator, ASIN, path). Series is unavailable until G-007.
- Owner: frontend · Status: done

### G-010 · Global activity feed
- Build today: **missing.** No event table. Timestamps on jobs only.
- UI now: Activity is built from the job list (`finished_at`/`updated_at` → "Verified", "Paused", "Failed", "Cancelled") plus this browser's own actions and notifications from the session. It's labelled "Showing recent job changes. A full activity log needs server support (G-010)." The "Your actions" filter only covers this device, and "Show older activity" is disabled.
- Proposed contract: `GET /api/activity?before=<ts>&limit=50&kind=verified|paused|failed|user` → `{"events": [{"id","at","kind","job_id","title","detail","actor":"server"|"user"}], "next_before": ts|null}`, backed by an `events` table written on every status transition and user action.
- Owner: backend · Status: placeholder in UI

### G-011 · Per-book history
- Build today: **partial.** Derivable: `created_at`, `started_at`, `finished_at`, `attempts`, `report.edition_attempts[]`, `lookup_failures[]`, `rejected_editions[]`, `gates.*.updated_at`, `recovery_acceptance`, `mp3s_deleted`, `backup`. No log of user actions (review answers overwrite each other in `review_answer`).
- UI now: History is assembled from those fields. User edits and cleanup entries appear once G-010 exists.
- Proposed contract: `GET /api/jobs/{id}/history` → `{"events": [...]}` (same event shape as G-010).
- Owner: both · Status: placeholder in UI

### G-012 · 15-second spot-check audio
- Build today: **exists, via existing endpoints.** Book: `POST /api/jobs/{id}/media-token` → ticket, then `GET /api/jobs/{id}/audio?ticket=` streams the full M4B with byte ranges, so the client seeks to the chapter start and stops after 15 s. Chapter list: `GET /api/jobs/{id}/chapters` (complete/skipped only). Needs review: each check has `audio_excerpt` (24 s mono WAV from boundary −2 s) at `GET /api/jobs/{id}/artifacts/<path>` (bearer auth, fetched as a blob).
- UI plan: no new endpoint needed.
- Owner: frontend · Status: done

### G-013 · Chapter-check evidence
- Build today: **exists.** `report.checks[] = {title, boundary_seconds, passed, transcript, audio_excerpt, method, reason, …}`. Recovery drafts: `report.recovery_draft.markers[]`.
- Owner: frontend · Status: done

### G-014 · Edition search, filename, tags
- Build today: **partial.** `GET /api/editions?query=&region=` → `{"editions": [{asin,title,subtitle,authors[],narrators[],runtime_length_min,language,publisher_name,cover_url,format,region}], "region"}` (title or direct ASIN). "Use filename" is client-side (existing). "Use tags" is **missing**: `report.identity` mixes tags, EPUB and prior answers.
- UI now: Use tags fills from `report.identity` and labels it "from the file's details". The button tooltip names G-014 until raw tags are exposed.
- Proposed contract: add `report.embedded_tags = {"title","author","narrator","asin"}` captured during inspect.
- Owner: both · Status: placeholder in UI

### G-015 · Clean up source MP3s
- Build today: **missing.** MP3s are only deleted during the job when `keep_mp3s=false` (`report.mp3s_deleted` counts them). There is no on-demand cleanup.
- UI now: the Book primary action "Clean up source MP3s" is shown disabled with "Needs server support (G-015)" when MP3s are known to remain.
- Proposed contract: `POST /api/jobs/{id}/cleanup-sources` → `{"deleted": 24, "retained": [], "job": Job}`. `409` unless the job is complete and the output hash still matches `report.output_sha256`. Every MP3 is fingerprint-checked against the source manifest before deletion (same safety as the in-job path).
- Owner: backend · Status: placeholder in UI

### G-016 · Optimized
- Build today: **partial.** Derivable: `complete` + `report.epub` present + no source MP3s remaining. Remaining MP3s are only inferable: `mode=='repair_existing'` (no MP3s were involved) or `mp3s_deleted>0 && !options.keep_mp3s`.
- UI plan: compute in the adapter with that rule. When unknown, show Verified, never Optimized.
- Decision needed from Jeremy: can an audiobook-only book be Optimized? Current rule: no.
- Proposed contract: `mp3s_present: bool` and `epub_present: bool` on the book summary (G-008).
- Owner: both + Jeremy · Status: placeholder in UI

### G-017 · EPUB pairing
- Build today: **partial.** `report.epub = {title, path}` is set only when a matching EPUB sits in the book folder and was used as evidence. No detection of an EPUB elsewhere, no pairing action.
- UI now: Checklist "EPUB paired" is ticked when `report.epub` exists. Otherwise it reads "Not found next to the M4B" with no action.
- Proposed contract: part of G-020 (scan kinds `pair`, `epub-only`) plus `POST /api/suggestions/{id}/pair`.
- Owner: backend · Status: placeholder in UI

### G-018 · Edit details
- Build today: **missing.**
- UI now: the Edit details modal/sheet renders with fields filled from the report, and Save is disabled with "Needs server support (G-018)".
- Proposed contract: `PATCH /api/jobs/{id}/details` with `{"title","author","narrators","series","series_position","asin","region"}` → `Job`. Tags are rewritten on a copy and validated like publication. An ASIN or region change requeues verification (`409` if the job is active).
- Owner: backend · Status: placeholder in UI

### G-019 · Re-verify
- Build today (2026-09-30): **exists.** `POST /api/jobs/{id}/retry` without a body forces fresh verification for complete/skipped jobs. Optional body `{"force": true}` explicitly bypasses the completion receipt; `{"force": false}` permits receipt reuse. Active jobs still return 409.
- Retry always clears prior finalization approval. Finished jobs use the normal verification path, never replay an accepted draft. Converted folder jobs resolve their single M4B.
- Frontend follow-up: remove the obsolete warning that Re-verify may keep the previous verification. Existing no-body request already works; no payload change is needed.
- Owner: frontend · Status: in progress (backend done)

### G-020 · Suggestions scan
- Build today: **missing.** The closest building block is `POST /api/discover {path}` → `{"books": [{path,name,kind: m4b|mp3_folder}], "issues"}`, which lists convertible folders and M4Bs under a path but does not classify, remember ignores, or look at EPUBs.
- **Blocks the whole Suggestions screen.**
- UI option A (partial): "Ready to convert" and "Chapters need a fix" rows from `discover` over each library root, minus paths that already have a complete job. Pair/No-audiobook groups and Ignore are placeholders.
- UI option B: full placeholder screen until the backend exists.
- Proposed contract: `POST /api/suggestions/scan` → `{"scanned_at"}` (async), `GET /api/suggestions` → `{"scanned_at", "items": [{"id","kind":"convert"|"chapters"|"pair"|"epub_only","title","author","path","detail","epub_path"}]}`, `POST /api/suggestions/{id}/ignore`, `POST /api/suggestions/{id}/pair`.
- Owner: backend · Status: placeholder in UI

### G-021 · BookOrbit
- Build today: **missing.** `settings.bookorbit_enabled` is hard-coded `false`. The README says BookOrbit's API is unconfirmed.
- UI now: "Open in BookOrbit" and "Request in BookOrbit" are disabled with "Set a BookOrbit address in Settings (G-021)". The Settings row is read-only "Not configured".
- Decision needed from Jeremy: BookOrbit deep-link URL format, and whether requesting a title is an API call or just a link.
- Owner: backend + Jeremy · Status: placeholder in UI

### G-022 · Folder browser
- Build today: **partial.** `GET /api/browse?path=` → `{"path", "roots", "entries": [{name,path,type: directory|file}]}`. Files are limited to mp3/m4b/m4a, so a folder's own MP3 count is known after entering it, but **not per child folder**. There's no has-M4B flag and no metadata guess.
- UI now: rows show "Folder" without counts. After selecting a folder, `POST /api/discover` reports what it contains ("24 MP3 files" isn't available; "1 audiobook to convert" is). Pre-fill of Title/Author is a placeholder.
- Proposed contract: add `mp3_count: int`, `has_m4b: bool` to directory entries, and `GET /api/browse/guess?path=` → `{"title","author","asin","source": "tags"|"folder"}`.
- Owner: backend · Status: placeholder in UI

### G-023 · Settings persistence
- Build today: **partial.** `GET /api/settings` → env-derived `{library_roots, config_dir, work_dir, workers, cpu_threads, work_cache_budget_gb, bookorbit_enabled, auth_required, recovery_minimum_percent}`. Only `PUT /api/settings/recovery` writes.
- UI plan: Theme, Reduce motion and Status notifications are **per device** (`localStorage`), which is arguably correct for a PWA used on several devices. Library folder = `library_roots` (read-only, set by `LIBRARY_ROOTS`). Conversion defaults are remembered per device as New job defaults. Default region and BookOrbit address are placeholders.
- Proposed contract: `GET/PUT /api/settings/preferences` → `{"default_region","default_verify_all","default_keep_mp3s","bookorbit_url"}`.
- Owner: both · Status: placeholder in UI

### G-024 · Health and version
- Implemented (2026-10-19): `GET /api/health` retains its public status-only contract. Authenticated `GET /api/settings` adds `build`: version, release/development channel, commit, optional build date, frontend build marker/content hash, speech backend and model basename. Source builds resolve their Git commit; container builds stamp API, frontend marker and PWA cache identity together from Docker build arguments supplied by the release workflow.
- Settings → About and updates displays both this tab’s frontend marker and the server’s identity, plus manual `GET /api/updates` and Copy diagnostics. Diagnostics exclude credentials and library/config/work paths.
- Manual checks use a fixed GitHub releases endpoint with bounded reads/timeouts, one request at a time and a five-minute cache. Private-repository/auth/rate-limit/no-release failures and development builds remain unknown rather than claiming Up to date. No image pull or restart occurs.
- A waiting PWA update stays waiting until a user confirms reload; existing review tabs keep their cached shell. Unknown build fields stay `—`. Device/PWA rollout validation remains required.
- Owner: frontend + backend · Status: implemented; release/device validation pending

### G-025 · Queued jobs
- Build today: **exists.** `status=queued`, claimed oldest-first. Up to `WORKERS` run at once.
- Owner: frontend · Status: done

### G-026 · PWA
- Build today: **partial.** The manifest, service worker and icons exist but use the legacy teal/navy colours. `theme-color` is static.
- UI plan: regenerate icons from the logo, give the manifest the design colours, set a `theme-color` meta per theme, add safe-area insets, and bump the SW cache.
- Owner: frontend · Status: done

## New rows

### G-027 · Static file allowlist
- Build today: `GET /static/{filename}` only serves `app.js, styles.css, favicon.svg, icon-180/192/512.png` (`app/api.py`). Anything else returns 404.
- Impact: `tokens.css`, ES modules, a self-hosted Figtree `woff2`, and logic modules testable by `node --test` all need either this change or everything packed into the two allowed files.
- Proposed change: serve any file under `app/static/` whose resolved path stays inside it and whose suffix is in `{.js,.css,.woff2,.png,.svg}`, with the same `nosniff` header. Plus one test.
- Owner: backend (tiny) · Status: done

### G-028 · Path routes
- The design says `/`, `/books/:id` and so on. The server has no SPA fallback, so a reload on `/books/x` would 404.
- UI plan: hash routes `#/books/:id`, with legacy hashes redirected (CURRENT_STATE §3). A later backend fallback could switch to path routes.
- Owner: frontend · Status: done

### G-029 · Recovery acceptance has no design
- Build: "Finalize with accepted exceptions" (`POST /api/jobs/{id}/accept-recovery`) with a per-book minimum %, a checkbox for each unlocated section, "keep unresolved markers", and "accept possible content gaps". This is the only way to finalize a local-marker recovery draft (`app/acceptance.py`).
- Proposed home: Needs review detail, a new collapsible section **"Finalize with accepted exceptions"** between Chapter checks and Fix the edition, shown only when `recovery_acceptance_preview` exists. Its primary button is separate from "Save and re-verify", with consent checkboxes and plain wording. It must not be merged into the one-click primary action.
- Owner: frontend + Jeremy (design sign-off) · Status: done

### G-030 · Review markers from audio / Resume checks
- Build: `POST /review {recovery:"local_markers"}` produces a draft. `{action:"resume"}` reruns checks for non-identity pauses (service outage, coverage, source inventory).
- Backend audit (2026-09-30): redrafting also supports a retained MP3-folder conversion after validating its audio hash and source inventory. It holds the book lock, retains runtime/drift coverage warnings, and persists source invalidation and identity failures. Missing or changed retained audio requires normal checks again. No new API fields.
- Proposed home: the Problem panel quick fixes. "Resume checks" is the primary action when `review_category ≠ identity` (the problem isn't the edition). "Review markers from audio" goes in Fix the edition as a ghost button next to "Save and re-verify".
- Owner: frontend · Status: done

### G-031 · 5 gates vs 4 steps
- Server gates: Inspect files → Match recording → **Align chapters → Verify** → Save, plus grades for recording/coverage/alignment/speech/integrity. The design has 4 steps and merges Align + Verify into "Check audio".
- Concern: AGENTS.md requires keeping **timing compatibility** (align) distinct from **speech verification** (verify). A single "Check audio" dot can hide which one paused.
- Proposal: keep the 4-dot StepTracker. Its detail line always names the sub-check ("Check audio · timing" / "Check audio · speech"), and the Status card / Technical details lists all 5 gates and the 5 grades.
- Owner: Jeremy (decision) · Status: done

### G-032 · Diagnostics
- Build: the alignment plot (local − published offsets), edition attempts, rejected editions and lookup failures, recovery-draft markers with transcripts/excerpts, and recorded acceptance.
- Proposed home: Needs review → Problem → Technical details (plot, attempts). Chapter checks (draft markers as rows). History (attempts). Book → Details (recorded acceptance). The plot switches to tokens `--ok`/`--warn`.
- Owner: frontend · Status: done

### G-033 · Multi-book discovery
- Build: New job accepts a parent folder, `POST /api/discover` lists every book below it, and the user picks a subset (`selected_paths`).
- Proposed home: New job → Source folder. When a chosen folder contains more than one book, a Checklist of books (all selected) appears under it and the primary becomes "Start N jobs". Edition fields are hidden in that case, since they apply to one book.
- Owner: frontend · Status: done

### G-034 · API token
- Build: optional bearer token, stored per browser. Required when `CHAPTERKEEPER_API_TOKEN` is set.
- Proposed home: Settings → Server, "Access token" field. A 401 anywhere shows "Access denied" with a link to that field.
- Owner: frontend · Status: done

### G-035 · Server readout
- Proposed home: Settings → Server rows: Library folders, Workers, CPU threads, Cache budget, Work/Config folders, Authentication. Settings → Library shows `library_roots`.
- Owner: frontend · Status: done

### G-036 · Recovery minimum %
- Proposed home: Settings → Conversion defaults, "Minimum supported markers for accepted exceptions", saved with `PUT /api/settings/recovery`.
- Owner: frontend · Status: done

### G-037 · Force reprocessing
- Proposed home: New job → Options, switch "Process again even if already verified".
- Owner: frontend · Status: done

### G-038 · "Chapter checks: Off"
- The design offers Off / Spot checks / Every chapter. The build has only spot checks (`verify_all=false`) and every numbered chapter (`verify_all=true`). Publication **requires** passing speech checks (`flow.assert_publishable`), so "Off" would either do nothing or weaken the publication gate.
- Proposal: ship two options only, Spot checks and Every chapter. Remove "Off" from the design.
- Owner: Jeremy · Status: done

### G-039 · "Save to" option
- The design offers Next to source / Library folder. The build always writes the M4B next to the source (`destination = root / (root.name + '.m4b')`).
- Proposal: omit the control until the backend supports it, and show "Saved next to the source folder" as a static line.
- Owner: Jeremy · Status: placeholder in UI

### G-040 · Edition fields at submit time
- The design's New job has Title, Author, ASIN and Region. `JobSubmission` accepts only `path, keep_mp3s, verify_all, force, selected_paths`. The worker already reads `asin/title/author/narrator/region` from `options` (`worker.arguments()`), so accepting them at submit is a small change.
- Proposed contract: add optional `title, author, narrator, asin, region` to `JobSubmission`, validated like `ReviewAnswer`.
- UI now: the fields render but are disabled with "Needs server support (G-040). You can correct details if the book pauses for review."
- Owner: backend (tiny) · Status: placeholder in UI

### G-041 · Download report
- Proposed home: Book "…" menu / Details, and Needs review → Technical details, "Download report (JSON)".
- Owner: frontend · Status: done

### G-042 · Current-file duration
- Proposed home: Needs review → Fix the edition hint line: "This file: 1,607 min. Compare with each edition's runtime."
- Owner: frontend · Status: done

### G-043 · `skipped`
- `skipped` means either "Unchanged: previous verification retained" (has `output_sha256`, treat as Verified) or "Skipped: no processable source" (fewer than 2 MP3s and no M4B), which fits no design status.
- Proposal: map the first to verified with the detail "Unchanged since last verification". Map the second to failed with the detail "Nothing to convert here" and no Retry.
- Owner: Jeremy · Status: done

### G-045 · Figtree hosting
- Implemented (2026-10-19): variable Figtree WOFF2 is bundled under `app/static/fonts`, preloaded, declared with `font-display: swap`, and included in the versioned PWA shell cache. The OFL license ships alongside it. No Google Fonts request is needed.
- Owner: frontend · Status: done

### G-046 · Worker activity line
- Build: `result.activity` (latest worker message) and `result.speech_check {current,total}`.
- Proposed home: the status detail line on the Queue converting card and the sidebar Activity card ("Listening 12 of 40").
- Owner: frontend · Status: done

### G-047 · Stable book id
- The build has only job ids. Resubmitting a completed path creates a new job, so the "book" moves to a new id.
- UI now: book routes use the latest job id. Old ids still resolve (they load that job).
- Proposed contract: covered by G-008's `BookSummary.id`, or a `book_id` = hash of canonical path.
- Owner: backend · Status: open

### G-048 · Chapter playback reduced to 15 s
- Build: tapping a chapter plays until the chapter ends. The design (RULES: "no media-player features") limits playback to a 15-second spot check.
- Proposal: follow the design (a 15 s stop). This reduces an existing feature, so it's logged here for sign-off.
- Owner: Jeremy · Status: open


### G-049 · Manual published-section assignment (implemented 2026-10-02)
- Recovery preview includes `published_sections` with stable draft-local IDs, and each speech-supported marker's `reference_id`.
- Acceptance `marker_decisions` supports `{index, action: "published", section_id}`. Backend resolves the canonical title, rejects unknown/duplicate/out-of-order assignments, and records manual provenance separately from recognition.
- Explicit assignments resolve corresponding missing-section acknowledgments. Removing/changing an assignment restores that requirement. Custom names alone never imply published identity. Original speech percentage and publication safeguards are unchanged.
- UI uses shared modal/sheet, fields, buttons and spot playback in both directions; compact outstanding-section summary, manual badge/filter and unresolved navigation. Browser drafts preserve IDs with the existing evidence-token binding.
- 2026-10-03: that UI is replaced by the chapter draft review (CHAPTER_REVIEW.md); same contract.
- Owner: backend/frontend · Status: done under user's explicit UI authorization.

### G-050 · Book length in the draft preview
- Build today: **partial.** The chapter draft review's colour timeline (CHAPTER_REVIEW.md §2.3) places every marker and published section across the whole book, but `recovery_acceptance_preview` has no length. The draft itself stores `duration_seconds`.
- UI now: uses the file duration from `GET /api/jobs/{id}/source` (G-042) when it has loaded, otherwise the latest known marker or section time, so ticks near the end can sit slightly too far right until the duration arrives. Marked `// DESIGN-GAP: G-050` in `chapter-review.js`.
- Proposed contract: add `duration_seconds` (number, or null when unknown) to `recovery_acceptance_preview`, copied from `recovery_draft.duration_seconds`. No other change.
- Owner: backend · Status: placeholder in UI

### G-051 · Conflicting section identities and a complete planned-title timeline
- Request: distinguish decorated section labels from chapter ordinals, make automatically matched rows editable, and show Existing / Planned titles throughout the timeline.
- Backend: shared semantic parser; derived conflict validation; preview marker `reason` / `conflict`; versioned draft tokens; automatic-match replacement releases its former section for reassignment or optional-section consent. Raw evidence, original timestamps, audio and backup checks remain.
- UI: chronological paired titles with current-draft precedence, live browser decisions, All / Needs attention / Changed filters, Listen / Change and restore; unknown coverage says not matched, never missing audio. Dense timeline targets are grouped for accessibility; every row is individually editable. Reusing cached speech does not turn timing suggestions/manual edits into audio confirmation.
- Status: implemented; actual Bedlam recording validation pending because the supplied archive was empty. See `docs/plans/bedlam-identity-repair.md` and `VALIDATION.md`.
