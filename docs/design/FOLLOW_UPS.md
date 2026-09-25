# Follow-ups after the redesign

Remaining work, most important first. Each item has an owner, the gap it closes (see [GAPS.md](GAPS.md)) and the smallest next step. Written 2026-09-24.

## Decisions needed from Jeremy

| # | Decision | Gap | Current behaviour until decided |
|---|---|---|---|
| D1 | Remove full-chapter playback, or keep it as "Play to chapter end"? | G-048 | 15-second spot check, with a "Play to chapter end" button in the preview bar |
| D2 | Can an audiobook-only book (no EPUB) ever be Optimized? | G-016 | No; it stays Verified |
| D3 | BookOrbit: deep-link URL format, and is "Request" an API call or just a link? | G-021 | All BookOrbit buttons disabled with a reason |
| D4 | Keep "Skipped: nothing to convert here" shown as Failed (with no Retry)? | G-043 | Yes |
| D5 | Should "Save to: Library folder" exist at all? | G-039 | Fixed line "Next to source" |
| D6 | Self-host Figtree (no request to Google, works offline) or keep Google Fonts? | G-045 | Google Fonts link |
| D7 | Confirm the sign-off on the Finalize section's placement and wording | G-029 | Shipped as its own collapsible in Needs review |

## P1: the design depends on these

| Item | Owner | Gap | Smallest next step |
|---|---|---|---|
| Summary list endpoint (no full reports, with series, EPUB and MP3 state) | backend | G-008, G-007, G-016, G-047 | Add `GET /api/jobs?view=summary` returning the BookSummary shape in GAPS G-008 |
| Series name and number on every book | backend | G-007 | Add `series` from Audnexus `seriesPrimary` to `engine.summaries()` |
| Clean up source MP3s on demand | backend | G-015 | `POST /api/jobs/{id}/cleanup-sources` with the in-job fingerprint checks; the UI calls `api.cleanupSources()` |
| Suggestions scan (EPUB detection, ignores, pairing) | backend | G-020, G-017 | `POST /api/suggestions/scan` + `GET /api/suggestions`; replace `runScan()` in `screens/suggestions.js` |
| Re-verify with force | backend | G-019 | Accept `{"force": true}` on `POST /api/jobs/{id}/retry`; pass it from `retryJob()` on the Book screen |
| Resolve D1 and D2 | Jeremy | G-048, G-016 | Answer in this file or GAPS.md |

## P2: better behaviour, placeholders in place today

| Item | Owner | Gap | Smallest next step |
|---|---|---|---|
| Live updates instead of polling | backend | G-003 | `GET /api/events` (SSE); the UI swaps polling in `store.js` for an EventSource |
| Global activity log and per-book history | backend | G-010, G-011 | An `events` table written on each status change and user action; `GET /api/activity`, `GET /api/jobs/{id}/history` |
| Converter output for failed jobs | backend | G-005 | `GET /api/jobs/{id}/log?lines=200` from `worker.log`; wire into Queue → Error details |
| Edit details and rewrite tags | backend | G-018 | `PATCH /api/jobs/{id}/details`; enable Save in the Edit modal |
| Edition fields when starting a job | backend | G-040 | Add optional title/author/narrator/asin/region to `JobSubmission`; enable the New job fields |
| Folder counts and metadata guess in the browser | backend | G-022 | Add `mp3_count`, `has_m4b` to browse entries |
| Structured technical detail on review reasons | backend | G-004 | `review_reason.technical = {http_status, url, error}` |
| Raw embedded tags for "Use tags" | backend | G-014 | Save `report.embedded_tags` during inspect |
| Server-wide preferences (default region, BookOrbit address) | both | G-023, G-021 | `GET/PUT /api/settings/preferences`; enable the Settings rows |
| Version in health check | backend | G-024 | Return `version` from `/api/health`; show it in Settings → Server |
| BookOrbit links and requests | backend + Jeremy | G-021 | After D3, add `bookorbit_url` to settings and a link builder in `api.bookOrbitLink()` |

## P3: polish

| Item | Owner | Gap | Smallest next step |
|---|---|---|---|
| Self-host Figtree | frontend | G-045 | After D6, add `app/static/fonts/Figtree[wght].woff2` and drop the Google link |
| Path routes instead of hash routes | both | G-028 | SPA fallback on the server, then switch `router.js` |
| Validate the PWA install on a physical iPhone | Jeremy | G-026 | Add to Home Screen over HTTPS and check the safe areas and theme colour |
| Compare against exported design PNGs | frontend | — | Export `reference/screens/png/` from the design canvas and diff against `screenshots/` |
| Search results for series open a filtered Library; consider a series page | frontend | — | Only if a series view gets designed (see BACKLOG.md) |
