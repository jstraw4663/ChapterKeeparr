# ChapterKeeparr project context

## Canonical source

This folder is the development Git project (main branch, committed initial build): `/Users/jeremystraw/Documents/Codex/ChapterKeeparr`.
It was copied from the previous task's `chapterkeeper` 0.2.1 source; that source and its release ZIPs remain unchanged. The recovery design is in `ALIGNMENT-RECOVERY-PLAN.md`.

The user asked to start the alignment recovery build, investigate the Bedlam Bride provider 404, and show current-file runtime in minutes during edition search. Test books are on the Tower SMB share at `/Volumes/Media/chapterkeeparr-test`. Development has read those books, not modified them.

## Implemented in 0.3.0 alpha

- Search 404 messages distinguish catalog search from ASIN/timeline lookup. Title/author search falls back once to keywords on 404 or an empty result. Other service errors do not trigger repeated requests.
- Current-file minutes and HH:MM:SS on the edition search form, including older review jobs using a confined authenticated media probe.
- Detailed timeline diagnostics on success and failure: local/reference chapters and durations, matched pairs, offset/residuals, unmatched boundaries and a difference plot. Authenticated report download works from the saved job record even if the SMB share is unavailable.
- Attempt deduplication by ASIN/region; identical timeline aliases are identified. Metadata compatibility and timing compatibility are separate. At most ten candidate editions per verification attempt. Search lists remain candidates, not compatible recordings.
- Versioned timing cache keyed by source hash, local markers, reference timeline, identity, duration and algorithm. Explicit retry/resume invalidates timing cache; cached timing never bypasses speech verification. Cache limited to 1,000 entries.
- On-demand “Review markers from audio” queue action. This branch never converts, retags or publishes. Short 24-second mono clips at every existing boundary identify unique spoken numbers/named headings or unique distinctive openings in one matching adjacent EPUB. No title assignment by track index.
- Draft marker evidence, transcripts, excerpt playback, old/proposed times, support status, and unresolved published sections in the UI and report. Drafts retain existing timestamps, including unresolved markers. Duplicate/ambiguous headings remain unresolved. Original source fingerprint checked before and after.
- One heavy local-recovery job at a time, per-marker checkpoints, existing transcript-cache reuse, cancellation checks, bounded excerpts and basic disk/RSS checks.

## Implemented in 0.4.0 alpha — gated workflow

- Inspect → Match → Align → Verify → Save persisted gates, API projection, top-of-book timeline and separate recording/coverage/alignment/speech/integrity evidence grades. No fabricated probability. Legacy receipts do not inherit current policy claims.
- SHA-256 source inventory before conversion; track/disc gaps, duplicates, inconsistent totals and tag/file ordering conflict stop for review. Sources are rehashed before commit. Unknown missing content can still evade these heuristics.
- Coverage stops for a published-runtime shortfall over 2 seconds or nearby boundary offsets varying over 2 seconds. These intentionally cautious heuristics are not calibrated probabilities and can flag harmless edits. Missing diagnostics cannot authorize publication.
- After timing failure and bounded edition search, a unique metadata-compatible timeline (or the requested compatible ASIN) automatically gets existing-marker speech/EPUB review. This is always a non-publishable draft. Coverage warnings after a successful timing fit stop directly for review.
- Explicit publication gate requires inspection, matching, alignment, speech, output integrity and no unresolved coverage. Any recovery draft blocks publication. Existing backup and audio-payload/decode checks remain.
- Fingerprinted intermediate conversions survive review retries. Source/artwork/version/options changes or corrupted intermediates invalidate reuse. Source mutations during conversion prevent caching. Retained conversions and transcripts share CACHE_MAX_GB; reports/excerpts are retained separately. Successful jobs remove retained conversions; paused/cancelled caches remain bounded and can be reused.
- Metadata transport/service errors are distinct from identity problems. Non-identity review screens have Resume checks and optional Change recording details. Manual local-marker route remains draft-only for compatibility.
- Heavy processing serialized across workers with a reentrant process lock. Cache reuse does not skip matching/speech/publication checks.
- WORKFLOW-GUIDE.md describes the implemented paths. A GPT-6 Luna documentation agent drafted and revised it; the primary agent verified paths against source.

49 tests pass, including generated-media save and missing-track/automatic-draft worker regressions; responsive UI checks pass at 390/1440 pixels. New coverage policy evaluated on saved real-book diagnostics: Bedlam has no warning; Parade has shortfall/internal-change warnings. No new real-book write or speech benchmark was performed. Unraid/Docker deployment remains unvalidated.

## Real-book findings (2026-09-24)

The Eye of the Bedlam Bride: the exact previously failing libexdb title/author URL returned HTTP 200. ASIN B0CDXWSS5D; catalog runtime 1,606 minutes; file about 1,607.2 minutes. All 77 nonzero boundaries pass the existing timing test; local/published audio-duration difference is about 0.025 seconds. The earlier 404's underlying service cause is not established. Speech verification is still needed before publishing.

A Parade of Horribles, ASIN B0FXY6DVJS: reproduced 58/106 timing anchors. Local duration 73,606.423333 seconds; reference 73,669.057 seconds. Multiple early timing shifts settle near -62.598 seconds later in the book. Do not lower the 80% rule or stretch timestamps to hide this.

Real short-window scan of all 107 markers with existing MLX small.en: 149 seconds, peak RSS 855,261,184 bytes (~816 MiB), source SHA-256 unchanged. Re-evaluation of saved transcripts with conservative named-heading and matching-EPUB support yields 102 supported and 5 unresolved markers. Six published sections remain unresolved: Opening Credits, Chapter Quasar, Chapter Sydney, Chapter Louie, Chapter Credits, Secret Skit. There are 108 reference chapters and 107 local markers. No published section is considered absent from audio merely because its marker is absent.

## Remaining work, in plan order

This is an initial recovery build, not the complete recovery roadmap. Next: focused rescans for unresolved named sections and the missing Secret Skit marker; editable drafts with provenance and revalidation; section/drift diagnosis with independent holdouts; multiple EPUB passages per chapter; chapterless/deeper on-demand scans. Publication of reconstructed plans stays disabled until all boundaries/gaps can be verified and representative negative fixtures are calibrated. Do not automatically accept the 102 supported markers as a complete book.

Unraid's Linux CPU speech backend, actual container rebuild, and its 4 GB RSS target need validation. The Mac MLX measurement does not establish CPU/Unraid performance. No WhisperX or new model dependency was added. No live server deployment was performed.

## Project registration and model

The Codex project list was empty. There is no callable project-creation tool, and Computer Use explicitly blocks controlling Codex. The source folder and these notes are ready; add this existing folder through Codex's project picker. Do not claim it is already registered as an app project. The current task model could not be switched through available controls. GPT-6 Sol at Medium is the balanced starting choice for ongoing implementation; use focused verification before moving to a lighter model. Official guidance: https://developers.openai.com/api/docs/guides/model-selection

## Development

Run `python -m unittest discover -s tests -v` using Python 3.12 with requirements-dev.txt installed. A pre-existing working environment is `/Users/jeremystraw/Documents/Codex/2026-09-22/referenced-chatgpt-conversation-this-is-an/chapterkeeper/.venv/bin/python`.
Use `node --check app/static/app.js`. Preview with ENABLE_WORKERS=0 and a temporary CONFIG_DIR. The regression suite generates its own audio; real media writes require the user's intended processing workflow.

## 0.4.1 automatic wider marker retry

After the initial marker scan, unresolved markers receive one automatic retry using 8 seconds of pre-roll and 28 seconds after the marker, clipped to the recording. The original 2.1 seconds before / 8 seconds after heading acceptance window remains unchanged. Supported markers are not rescanned. First-pass conflicts and duplicates cannot be cleared by the retry; duplicate detection runs again. First-pass evidence is retained in `initial_attempt`; the displayed transcript and excerpt come from the retry. Reports checkpoint before retry inference, and disk/memory/excerpt bounds apply. A wider PCM excerpt gets a distinct transcript cache key; identical wider excerpts may be reused on subsequent runs. Draft publication remains disabled.

This does not add sentence-internal heading parsing. MLX versus Linux speech recognition differences still require real server validation.
