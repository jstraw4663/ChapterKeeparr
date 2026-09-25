# Build validation — 2026-09-23

- 17 Python tests passed with FastAPI 0.115.12 / Uvicorn 0.34.2 web dependencies.
- Generated MP3 fixture converted and repaired using real FFmpeg/ffprobe; MP3s removed after success and NFO preserved. Metadata/speech decisions mocked in this fixture.
- Live public catalog text search found Dungeon Crawler Carl B08V8B2CGV.
- Headless Chrome: 390 px mobile and 1440 px laptop views; no horizontal overflow at 390 px. Search → select → retain selection across refresh → submit review → queued passed.
- PWA service worker activated; shell loaded offline, mutations disabled, no /api responses cached.
- JavaScript syntax, Unraid XML and shell entrypoint checks passed.

Not yet validated: actual Docker build/start, bundled Linux speech model in the container, physical iPhone/Safari installation, Intel iGPU backend, BookOrbit integration. Test against copied books before allowing writes to the primary library.

## 0.1.1 dependency fix

Unraid build and container startup were confirmed by the user. First speech import failed because faster-whisper 1.1.1 imports requests without declaring it directly. Added requests 2.32.5 and build-time pip check / real speech import. Local dependency checks and all 18 tests passed, including a new fresh-process speech import regression. The corrected Linux image must still be rebuilt and exercised on Unraid.


## 0.2.0 validation

- All 24 Python tests passed, including real FFmpeg conversion/repair, chapter extraction, byte-range playback (206), API authentication, ticket expiration/file-change invalidation, media path confinement, cover extraction without modifying inputs, and selective batch submission.
- Headless Chrome at 320, 390, 430, and 1440 px: Jobs has no page-level horizontal overflow; mobile rows are cards with readable status labels.
- Browser checks: attention sort/filter, match shortcut and search selection with fixture provider results, cover rendering, actual chapter seek/play/switch/stop, playback retained through polling, and folder discovery → clear Select all → choose three → submit only those three paths.
- Screenshots reviewed for mobile Jobs, chapter details, and audiobook selection. Test audio was generated locally; no user audiobooks were changed.
- Physical iPhone/Safari and the updated Docker image have not been tested locally. The user confirmed the preceding 0.1.1 container processed a book successfully on Unraid. The 0.2.0 image still needs rebuilding there.

## 0.2.1 validation

JavaScript syntax and focused headless Chrome checks passed for all four dashboard routes/filters, completed-only results, phone-width layout, and filename autofill without an automatic search. No processing-engine changes.

## 0.3.0 initial alignment recovery — 2026-09-24

- 37 Python tests pass, including real FFmpeg conversion/audio preservation, cache invalidation, failed-candidate deduplication, timeline aliases, search 404 fallback, current-file duration and authenticated report downloads.
- New recovery fixtures cover rounded timestamps, small drift/internal edits and chapterless rejection, repeated/conflicting/low-confidence headings, explicit nonsequential numbering, named headings, unique versus duplicate EPUB openings, partial checkpoints on interruption, and the worker's draft-only branch.
- Existing cancellation, restart/lease, path confinement, authentication and media mutation guards pass.
- Headless Chrome at 390 and 1440 px: runtime display, difference plot including unmatched anchors, real 107-marker draft, authenticated report download, edition selection and local-marker recovery queue request. No JavaScript errors or horizontal overflow.
- Read-only real-book comparison reproduces Parade's 58/106 failure and shows Bedlam Bride passing 77/77 timing anchors. The exact formerly failing catalog URL returned HTTP 200 during this investigation; the historical provider cause remains unknown.
- Real MLX small.en scan at all 107 existing Parade markers: 149 seconds, peak RSS 855,261,184 bytes; identical source SHA-256 before/after. Re-evaluated saved transcripts with unique named/EPUB evidence: 102 supported markers, 5 unresolved markers, 6 unresolved reference sections. All remain a draft; nothing published.
- JavaScript syntax passes. Dependencies and container base/model are unchanged.

Not validated here: Linux/amd64 Docker build, Unraid CPU speech performance, the full roadmap's deeper scanning/drift fitting/edit-and-publish UI. A Mac MLX benchmark cannot establish the container's 4 GB memory behavior. Recovery drafts intentionally cannot authorize publication.

## 0.4.0 gated workflow — 2026-09-24

- 49 unittest cases pass. New cases cover mandatory publication gates, missing coverage data, suspected internal gaps, legacy/queued presentation, missing/duplicate/out-of-order tracks and discs, automatic draft-only recovery, conversion-cache reuse/invalidation/corruption, input mutation during conversion, service-error classification, API safe resume, and worker-level early gap/recovery paths.
- Generated FFmpeg fixture performs real conversion, validated retag/commit and configured MP3 cleanup; metadata/speech are mocked in this fixture. Real book files remain unchanged.
- `node --check app/static/app.js`, `node --check app/static/sw.js`, and `git diff --check` pass.
- Headless Chrome on a worker-disabled local preview passes at 390px and 1440px: five gates and expanded detail, evidence labels, targeted review, preserved current-file runtime/search, safe resume payload, no page overflow/errors. New-state display uses a projected fixture over a saved real-book job, not a live repair. Screenshots visually inspected.
- Saved real-book diagnostics re-evaluated with new coverage checks: Bedlam Bride no warnings; Parade of Horribles suspected gap (62.6s shortfall plus internal offset changes). This does not prove missing audio.
- Model inference unchanged; Mac speech timing from 0.3.0 does not establish Linux/Unraid performance. Docker execution and live server deployment were not performed.
- Conservative gap heuristics can increase reviews for legitimate edits; incompleteness can escape detection without numbering/reference evidence. Draft editing, new-boundary reconstruction and draft publication are not implemented.

## 0.4.1 wider retry

52 tests pass, including selective retry, bounded attempts, preserved initial evidence and timestamp, unchanged audio, narrow heading acceptance, and first-pass conflict retention. JavaScript syntax and diff whitespace checks pass. Recognition efficacy on the server's speech backend was not benchmarked; this release changes excerpt context, not the model or publication rules.

## UI redesign validation (2026-09-24)

- `python -m unittest discover -s tests`: 71 tests pass, including `tests/test_frontend.py` (tokens-only colours, gap logging, service-worker list, no legacy design, `node --check`, and 29 `node --test` unit tests for the status adapter, search, grouping/sorting, routing and notification destinations).
- Every screen checked in a browser at 1440×900 and 390×844, light and dark, against a generated fixture DB (`tests/fixtures/ui_seed.py`, workers disabled). Screenshots: `docs/design/screenshots/`.
- Checked by script on every screen: named buttons and links, labelled inputs, no duplicate ids, 44px targets (switches extend their hit area). Keyboard: `/` search with arrows, Enter and Esc; modal focus trap, Esc and focus return. Reduced motion replaces loops with a single fade.
- Spot-check playback verified against a generated M4B with chapters. Not validated: a physical iPhone install, and screen readers beyond the ARIA structure.

