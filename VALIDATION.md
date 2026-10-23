# Build validation — 2026-09-23

## Stable progress and browser drafts — 2026-10-02

- Seven frontend tests and eight worker tests pass, including generated-media conversion/validated save. JavaScript syntax and diff whitespace checks pass.
- Four database tests pass, including regression from 67% to a 50% checkpoint, subsequent progress, and explicit retry resetting to zero.
- Browser regression with generated fixtures passes: renamed marker, minimum threshold and section acknowledgments survive reload; another book's update/reordering preserves selection; 1440px and 390px have no overflow or JavaScript errors. Fixed a details-toggle/input timing race found during this check.
- Draft storage unit tests cover book isolation, JSON persistence, token mismatch, detached state, removal of transient busy/error fields, successful clearing and storage-failure memory fallback.
- No real media writes or Tower deployment. Autosave is browser-local; clearing site data removes drafts. Existing speech-runtime timeout from the previous milestone is not resolved by these UI/progress changes.

## Review column repair and dense rows

Removed an unmatched closing div in the server-details fragment that pushed actions outside the selected-book column. Browser assertions verify exactly two desktop grid children and action containment in the right column. At 1440px and 390px: no runtime errors/overflow, one transcript per expanded marker, working shared circular playback, and preserved edits across pagination. Seven frontend tests pass. Quoted transcript expands in place; original names appear only when different from the selected save name.

## Compact review — 2026-10-01

- Seven frontend test cases pass, including JavaScript unit and syntax checks. No backend changes.
- Chrome at 1440px and 390px with a 40-marker fixture: pagination limits rows to 15, custom names persist across page changes, no runtime errors or horizontal overflow. Status badges include text as well as color.

## Review filters and short transcripts — 2026-10-01

- 81 tests pass; transcript formatting additionally checked for two-sentence clipping, empty input and long-text bounds.
- Generated-fixture Chrome checks pass at 1440px and 390px: Select All, clear all, mixed selection, confirmed/unconfirmed counts, preserved hidden name edits, transcript display, no runtime errors or horizontal overflow. Publication behavior is unchanged.

## PyAV compatibility fix — 2026-10-01

- Pin `av==18.1.0` for Faster-Whisper 1.1.1: PyAV 19 removed `metadata_errors` from `av.open`, producing the Tower failure.
- Real Faster-Whisper audio decoding of a generated one-second WAV passes with 16,000 samples on PyAV 18.1.0, both inside and outside the local sandbox. No speech model download or real audiobook required.
- Full suite: **81 tests pass**, including the upgraded runtime decode check (28.995 seconds). Previous local import timeout did not recur in this run.
- Docker build now executes the same decoder check, replacing the insufficient import-only check. Docker/Tower image execution remains untested locally; rebuild and recreate the container to install the dependency pin.

## Marker decision editor — 2026-10-01

- 81 tests passed after backend/editor changes, including generated FFmpeg rename/removal publication with original backup and unchanged audio validation. Invalid/missing/duplicate decisions, first-marker removal, unconfirmed removal, invalid names and coverage-threshold bypass are rejected.
- Chrome fixture checks at 1440px and 390px in light/dark: no runtime errors or horizontal overflow; rename and removal state survives responsive rendering; first marker has no removal option. Saved excerpt playback stops after 15 seconds. Phone confirmation and intercepted save payload match selected edits. No real audiobook modified.
- Fixture preview uses generated tones and workers disabled. Live Tower deployment, real recognition quality and physical iPhone playback are not validated here.
- The October 1 full rerun passed 80 tests but timed out in the unchanged fresh-process `faster_whisper` import check (60 seconds), which also timed out in isolation; the earlier 81-test run passed. This is an unresolved local runtime-validation limitation, not a failed marker-save assertion. Dependencies were not changed by this feature. Tower speech startup must be verified before processing books with this build.

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

## Backend contract review — 2026-09-30

- Final full unittest suite: **79 tests pass** (9.326 seconds), including frontend JavaScript syntax and unit checks and the fresh-process speech dependency import. An earlier run overlapped edits and had an import timeout; the completed final run passes unchanged dependency checks.
- Eight new tests exercise API acceptance through an actual generated-audio metadata save, forced Re-verify without approval replay, explicit force override and active-job conflict, changed-edition approval reset, draft-only redrafting with retained coverage warnings, matching-gate error classification, retained MP3 conversion/source mutation guards, converted-folder resolution, and preservation of evidence on unavailable storage. Some tests cover multiple contracts.
- Existing publication tests cover original-file backups, unchanged audio, cancelled acceptance, failed output validation, source changes before/during validation and MP3 retention. Provider and speech responses are mocked for generated-media contract tests.
- No frontend files or real audiobook files changed. No Tower deployment, Docker execution, live provider/model accuracy benchmark or new physical-device UI validation performed.
- API handoff: G-019 documents no-body forced Re-verify and optional `force`; G-030 documents retained-conversion redrafting. The frontend's obsolete Re-verify warning is a separate copy follow-up.
## Embedded heading detection — 2026-10-02

- Recovery suite: 19 tests pass, covering embedded numeric and written headings, word-time acceptance despite an early segment start, missing/malformed/nonfinite alignment, low probabilities, missing pause, distant headings, narrative references, decimals, conflicting headings and repeated published numbers. Both backend adapters request and preserve word alignment (mocked inference).
- Frontend suite: 7 tests pass. Review JavaScript syntax and diff whitespace checks pass. No frontend changes in this milestone.
- Full suite: 86 tests ran, 85 passed; fresh-process speech decoder dependency check exceeded its 60-second timeout. Parser tests and generated-audio publication tests passed. A standalone runtime recheck also timed out at 60 seconds; runtime validation remains incomplete.
- No actual Tower speech inference, performance benchmark or real Chapter 61 validation. No real audiobook writes. Word timing is additional inference work, and conservative pause/context checks may leave genuine headings unresolved.

## Manual published assignments — 2026-10-02

- 16 acceptance tests pass, including canonical title lookup (client title ignored), unknown/duplicate/out-of-order ID rejection, assignment removal/custom rename restoring acknowledgment, and real generated-media finalization preserving timestamp, original backup and manual provenance separately from speech percentage.
- Seven frontend tests pass. Browser verification at 1440px and 390px covers both picker directions, search, assignment badges, reload persistence, duplicate prevention and no overflow/runtime errors. Native input/change double-open regression fixed.
- Preview uses generated fixtures with workers disabled; no real audiobook modification or Tower deployment. Prior speech-runtime startup limitation remains unrelated and unresolved.

### Nearest unassigned picker
Seven frontend tests pass, including unit cases for near-start/late timestamps, stable equal-distance ties, excluding speech/manual assignments and released assignments. Desktop/light and phone/dark browser checks verify only two unassigned fixture sections, nearest first, assigned choices absent, both assignment directions, reload persistence and intercepted final acceptance payload. No media writes.

### Assignment clarity
Seven frontend tests pass. Browser regression includes selected-title visibility, clearing a manual assignment inside the picker, returned section availability, grouped headings and reassignment on desktop/light and phone/dark, in addition to persistence and intercepted-save payload checks. No backend/publication-policy changes.

### Stable unconfirmed filter
Seven frontend tests pass. Desktop/light and phone/dark browser workflow starts under Unconfirmed matches and verifies manual assignment remains visible, including reload, removal/reassignment and intercepted acceptance. No backend changes.

### Main assignment action and no-match alternatives
Seven frontend tests pass. Desktop/light and phone/dark browser checks pass for direct selection, assignment, no-eligible-section rename/removal alternatives, unchecked removal confirmation, first-marker removal protection and no overflow/runtime errors. Syntax and whitespace checks pass. No real media writes.

### Apply Recommended Matches
Seven frontend tests pass. New unit cases cover close matches, preserving edits, order rejection, competing sections, distant choices and competing local markers. Desktop/light and phone/dark browser checks pass for one-click assignment, red-to-yellow state, stable filter, disabled repeat and reload persistence. Syntax/whitespace checks pass after final button-copy adjustment. No file publication performed.

### Review decisions and explicit order overrides
17 acceptance tests and seven frontend tests pass. New backend coverage requires literal boolean order acknowledgment and rejects duplicate IDs even with override. Desktop/light and phone/dark browser flow verifies hidden/toggled scoped search, bulk count recovering from zero to one after unmatch, rename and pending/confirmed removal badges, order-override cancel/confirm and reload persistence, and no overflow/runtime errors. Fixed a nested DOM update error found when leaving a rename input for removal. No real media modified; previous speech runtime limitation remains.


Theme fade update (2026-10-02): removed cascading inherited text transitions; body text and default surfaces fade in 180ms. Frontend suite (7 tests), JS syntax and whitespace checks pass. Headless Chrome dark/light label colors stable by 600ms.
