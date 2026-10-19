# ChapterKeeparr project context

## Reconciled container source and testable review UI — 2026-10-19

Merged Jeremy's uploaded active-container source with the responsive-review branch using shared ancestor `5055ded`. The prior GitHub branch was missing deployed manual-assignment/retry/recognition work; those implementations and tests are now preserved alongside the existing build diagnostics, public GHCR/Unraid installation kit and PyAV compatibility fix. The archive manifest is historical provenance in `docs/provenance`, not this build's identity. See [the reconciliation record](docs/provenance/container-source-reconciliation.md).

Jeremy chose to complete the ordered-card/sticky-footer review design, with Accept and save hidden until consent is checked, then white. The editor supports explicit published assignments, rename/removal, missing-section decisions, order overrides, conservative bulk suggestions/Undo, browser-local token-bound drafts and guarded save handoff to the next book. Large lists render in batches; manual choices do not increase speech coverage. Field updates are deferred and the render loop guards against nested DOM updates during blur.

Notifications hydrate book covers and display up to three stable simultaneous cards with a bounded waiting queue. Polling preserves nodes and remaining time. Hover, focus, panel scrolling, hidden tabs and clipped cards pause expiry. The panel reflows above mobile navigation/save controls.

Validation: 100 Python tests passed, including generated-media acceptance/backup/audio checks and real mono/stereo speech decoding; seven frontend/design/syntax cases and all nine JavaScript test files passed. The full browser sweep passed 216 viewport/theme observations and 36 axe scans. Dedicated workflows passed in both themes; synthetic 180-marker checks passed on 390px reduced-motion and 1024px animated desktop, including override selection, bulk Undo, progressive rendering, stationary desktop decisions and notification timer pause/resume.

This is a branch/PR update only. Jeremy must run the branch image workflow and pull the resulting tag/digest before testing on Unraid; no production deployment, image publication or real-library write was performed. Physical Safari/assistive technology, real model resource use and deployed PWA upgrade remain field checks.

## Stable progress and browser review drafts — 2026-10-02

Worker progress updates are now monotonically increasing in SQLite within a run; claim/retry resets remain explicit. Local listening uses 50–68%, wider retries 68–74%, before existing validation/save stages. Retry detail is distinct from first-pass listening. This remains a phase-weighted estimate, not elapsed-time prediction.

Review selection stays on the current book when the waiting list is reordered by a background completion. Input changes persist immediately in per-book browser localStorage, with an in-tab fallback and storage-failure notice. Recovery edits/threshold/acknowledgments restore only for the same server draft token. Changed evidence starts a clean acceptance form with a notice; successful acceptance clears saved edits. No file mutation occurs through autosave. Browsers/devices do not share edits. Service-worker cache is v16.

## Embedded heading detection — 2026-10-02

Local-marker recovery now considers explicit chapter headings inside speech segments using retained word timestamps from both speech backends. Additional matches require the existing -2.1/+8 second proximity window, word probabilities >=0.7, a preceding pause >=0.35 seconds, ordered finite word intervals, and a heading duration <=4 seconds. Common narrative references are excluded. Missing alignment stays unresolved; existing bounded wider retries still apply. Unique published identity, conflicting evidence, duplicate-marker detection, and all publication guards remain in force. This extension is draft recovery only; standard verification's heading parser is unchanged. Speech cache is versioned v2 to regenerate word evidence, and recovery version is 5. Word alignment adds inference work; Tower performance and the actual Chapter 61 recording remain unvalidated. Redraft after deployment to apply the new evidence rules; saved drafts are not silently rewritten.

## Canonical source

Latest layout repair: removed an unmatched closing div in the server-details template. Desktop book list is the sole left column; header/actions/evidence/history stay in the right. Dense marker rows use shared circular spot-play controls and one quoted italic transcript, unwrapped in place when expanded. Original names are shown only when they differ from the proposed save name. Browser DOM containment, playback, pagination and mobile checks passed; see VALIDATION.md.

### Compact review — 2026-10-01

Marker review uses expandable rows, green Confirmed/amber Unconfirmed text badges, one-line speech previews, and 15-row pagination within the selected filter. Decisions and expanded state survive page changes; all-marker save counts remain unchanged. Full transcript preview, playback and edits are inside each row.

### Review conveniences — 2026-10-01

Added Select All for unmatched published sections, short verbatim saved-transcript previews, and All/Unconfirmed/Confirmed marker filtering. Filters retain edits and global save counts; manual renaming does not change confirmation status. No new speech processing or publication-policy changes.

### Speech decode compatibility fix — 2026-10-01

Tower reported `open() got an unexpected keyword argument 'metadata_errors'`. Faster-Whisper 1.1.1 calls PyAV with this argument; PyAV 19 removed it, but Faster-Whisper's dependency constraint permits that release. Pin PyAV to 18.1.0 (the local installed version). Docker now runs `scripts/check_speech_runtime.py` to decode generated WAV data with the real Faster-Whisper decoder before model installation, instead of checking imports alone. Runtime unittest invokes the same check. Rebuild the image and recreate the container; retry the failed book afterward. No chapter policy changes.

### Marker decisions — 2026-10-01

User requested an interactive implementation of per-marker keep/rename/remove decisions. The recovery review screen now exposes original names/times, identified names, saved excerpts and explicit navigation removal. Backend validates a complete decision set, protects the first marker, keeps the original recognition denominator and records edits in acceptance. Audio, source identity, backup and output validation safeguards still apply. Unmatched published sections remain separate acknowledgments. Frontend edits were explicitly requested for this work.

### Backend review of redesigned UI — 2026-09-30

Reviewed the four Needs review actions against API and worker behavior. Fixed completion-receipt reuse on Re-verify, stale finalization approval on retry, converted-folder retry resolution, retained-conversion redrafting, and lost coverage warnings during manual redrafting. Redrafting now holds the book lock and checkpoints invalidation/identity failures. Early storage failures retain prior review evidence. No frontend files or real audiobook files were changed. API handoff details are in `docs/design/GAPS.md` (G-019/G-030); validation is in `VALIDATION.md`.

This folder is the development Git project (main branch, committed initial build): `/Users/jeremystraw/Documents/Codex/ChapterKeeparr`.
It was copied from the previous task's `chapterkeeper` 0.2.1 source; that source and its release ZIPs remain unchanged. The recovery design is in `ALIGNMENT-RECOVERY-PLAN.md`.

The user asked to start the alignment recovery build, investigate the Bedlam Bride provider 404, and show current-file runtime in minutes during edition search. Test books are on the Tower SMB share at `/Volumes/Media/chapterkeeparr-test`. Development has read those books, not modified them.

## Historical implementation record: 0.3.0 alpha

- Search 404 messages distinguish catalog search from ASIN/timeline lookup. Title/author search falls back once to keywords on 404 or an empty result. Other service errors do not trigger repeated requests.
- Current-file minutes and HH:MM:SS on the edition search form, including older review jobs using a confined authenticated media probe.
- Detailed timeline diagnostics on success and failure: local/reference chapters and durations, matched pairs, offset/residuals, unmatched boundaries and a difference plot. Authenticated report download works from the saved job record even if the SMB share is unavailable.
- Attempt deduplication by ASIN/region; identical timeline aliases are identified. Metadata compatibility and timing compatibility are separate. At most ten candidate editions per verification attempt. Search lists remain candidates, not compatible recordings.
- Versioned timing cache keyed by source hash, local markers, reference timeline, identity, duration and algorithm. Explicit retry/resume invalidates timing cache; cached timing never bypasses speech verification. Cache limited to 1,000 entries.
- On-demand “Review markers from audio” queue action. This branch never converts, retags or publishes. Short 24-second mono clips at every existing boundary identify unique spoken numbers/named headings or unique distinctive openings in one matching adjacent EPUB. No title assignment by track index.
- Draft marker evidence, transcripts, excerpt playback, old/proposed times, support status, and unresolved published sections in the UI and report. Drafts retain existing timestamps, including unresolved markers. Duplicate/ambiguous headings remain unresolved. Original source fingerprint checked before and after.
- One heavy local-recovery job at a time, per-marker checkpoints, existing transcript-cache reuse, cancellation checks, bounded excerpts and basic disk/RSS checks.

## Historical implementation record: 0.4.0 alpha — gated workflow

- Inspect → Match → Align → Verify → Save persisted gates, API projection, top-of-book timeline and separate recording/coverage/alignment/speech/integrity evidence grades. No fabricated probability. Legacy receipts do not inherit current policy claims.
- SHA-256 source inventory before conversion; track/disc gaps, duplicates, inconsistent totals and tag/file ordering conflict stop for review. Sources are rehashed before commit. Unknown missing content can still evade these heuristics.
- Coverage stops for a published-runtime shortfall over 2 seconds or nearby boundary offsets varying over 2 seconds. These intentionally cautious heuristics are not calibrated probabilities and can flag harmless edits. Missing diagnostics cannot authorize publication.
- After timing failure and bounded edition search, a unique metadata-compatible timeline (or the requested compatible ASIN) automatically gets existing-marker speech/EPUB review. In 0.4.0 this always produced a non-publishable draft; 0.5.0 adds a separate explicit-acceptance route described below. Coverage warnings after a successful timing fit stop directly for review.
- At the 0.4.0 stage, the explicit publication gate required no recovery draft and no unresolved coverage. 0.5.0 supersedes that rule only for fingerprint-bound recovery acceptance; standard publication checks remain.
- Fingerprinted intermediate conversions survive review retries. Source/artwork/version/options changes or corrupted intermediates invalidate reuse. Source mutations during conversion prevent caching. Retained conversions and transcripts share CACHE_MAX_GB; reports/excerpts are retained separately. Successful jobs remove retained conversions; paused/cancelled caches remain bounded and can be reused.
- Metadata transport/service errors are distinct from identity problems. Non-identity review screens have Resume checks and optional Change recording details. At the 0.4.0 stage, the manual local-marker route remained draft-only; 0.5.0 adds explicit accepted-exception finalization.
- Heavy processing serialized across workers with a reentrant process lock. Cache reuse does not skip matching/speech/publication checks.
- WORKFLOW-GUIDE.md describes the implemented paths. A GPT-6 Luna documentation agent drafted and revised it; the primary agent verified paths against source.

49 tests pass, including generated-media save and missing-track/automatic-draft worker regressions; responsive UI checks pass at 390/1440 pixels. New coverage policy evaluated on saved real-book diagnostics: Bedlam has no warning; Parade has shortfall/internal-change warnings. No new real-book write or speech benchmark was performed. Unraid/Docker deployment remains unvalidated.

## Real-book findings (2026-09-24)

The Eye of the Bedlam Bride: the exact previously failing libexdb title/author URL returned HTTP 200. ASIN B0CDXWSS5D; catalog runtime 1,606 minutes; file about 1,607.2 minutes. All 77 nonzero boundaries pass the existing timing test; local/published audio-duration difference is about 0.025 seconds. The earlier 404's underlying service cause is not established. Speech verification is still needed before publishing.

A Parade of Horribles, ASIN B0FXY6DVJS: reproduced 58/106 timing anchors. Local duration 73,606.423333 seconds; reference 73,669.057 seconds. Multiple early timing shifts settle near -62.598 seconds later in the book. Do not lower the 80% rule or stretch timestamps to hide this.

Real short-window scan of all 107 markers with existing MLX small.en: 149 seconds, peak RSS 855,261,184 bytes (~816 MiB), source SHA-256 unchanged. Re-evaluation of saved transcripts with conservative named-heading and matching-EPUB support yields 102 supported and 5 unresolved markers. Six published sections remain unresolved: Opening Credits, Chapter Quasar, Chapter Sydney, Chapter Louie, Chapter Credits, Secret Skit. There are 108 reference chapters and 107 local markers. No published section is considered absent from audio merely because its marker is absent.

## Remaining roadmap from the 0.4.0 recovery plan

This is an initial recovery build, not the complete recovery roadmap. Next: focused rescans for unresolved named sections and the missing Secret Skit marker; editable drafts with provenance and revalidation; section/drift diagnosis with independent holdouts; multiple EPUB passages per chapter; chapterless/deeper on-demand scans. The planned editable/reconstructed timing workflow remains unsupported. The 0.5.0 acceptance path is narrower: it retains original times and requires explicit per-book exceptions. Publication of plans with new or moved boundaries stays unavailable until those boundaries and gaps can be verified and representative negative fixtures are calibrated. Never infer completeness from the 102 supported markers.

Unraid's Linux CPU speech backend, actual container rebuild, and its 4 GB RSS target need validation. The Mac MLX measurement does not establish CPU/Unraid performance. No WhisperX or new model dependency was added. No live server deployment was performed.

## Project registration and model

The Codex project list was empty. There is no callable project-creation tool, and Computer Use explicitly blocks controlling Codex. The source folder and these notes are ready; add this existing folder through Codex's project picker. Do not claim it is already registered as an app project. The current task model could not be switched through available controls. GPT-6 Sol at Medium is the balanced starting choice for ongoing implementation; use focused verification before moving to a lighter model. Official guidance: https://developers.openai.com/api/docs/guides/model-selection

## Development

Run `python -m unittest discover -s tests -v` using Python 3.12 with requirements-dev.txt installed. A pre-existing working environment is `/Users/jeremystraw/Documents/Codex/2026-09-22/referenced-chatgpt-conversation-this-is-an/chapterkeeper/.venv/bin/python`.
Use `node --check app/static/app.js`. Preview with ENABLE_WORKERS=0 and a temporary CONFIG_DIR. The regression suite generates its own audio; real media writes require the user's intended processing workflow.

## Historical implementation record: 0.4.1 automatic wider marker retry

After the initial marker scan, unresolved markers receive one automatic retry using 8 seconds of pre-roll and 28 seconds after the marker, clipped to the recording. The original 2.1 seconds before / 8 seconds after heading acceptance window remains unchanged. Supported markers are not rescanned. First-pass conflicts and duplicates cannot be cleared by the retry; duplicate detection runs again. First-pass evidence is retained in `initial_attempt`; the displayed transcript and excerpt come from the retry. Reports checkpoint before retry inference, and disk/memory/excerpt bounds apply. A wider PCM excerpt gets a distinct transcript cache key; identical wider excerpts may be reused on subsequent runs. At the 0.4.1 stage drafts remained non-publishable; see the 0.5.0 acceptance path below.

This does not add sentence-internal heading parsing. MLX versus Linux speech recognition differences still require real server validation.


## Implemented in 0.5.0 — explicit recovery acceptance

- A complete, fingerprint-valid local-marker draft can be finalized through a separate user approval. The global default minimum is 95% supported existing markers; each book can set its own minimum for that approval. Meeting the threshold alone never authorizes publication.
- Approval lists every unlocated published section for an explicit per-section optional designation; named narrative chapters are not presumed optional. The user separately confirms retaining unresolved original marker labels/times and accepts possible content gaps or edition differences. The accepted choices, threshold, support percentage, and draft token are recorded.
- Finalization only applies supported labels at the existing marker timestamps. It creates or moves no markers. Validation binds acceptance to the unchanged source hash, full original marker inventory, unchanged reference timeline, unchanged MP3 inventory where relevant, and a token for the reviewed draft.
- Before commit, the staged output's chapter metadata is checked, the full file is decoded, and the audio payload is verified unchanged. Existing M4B output is backed up and committed atomically. MP3 sources are retained. An MP3-folder approval requires the exact retained prepared conversion; if it is unavailable, resume/recheck is required before accepting again.
- This is an explicit accepted-exceptions outcome, not evidence that the whole recording is complete. Thresholds never auto-publish. Editable marker times, new/moved boundaries, deeper audio/EPUB reconstruction, and independent verification of reconstructed boundaries remain unsupported.

Validation totals and deployment status are not established by this context update.

## UI redesign (2026-09-24)

The frontend was rebuilt to the approved design in `docs/design/` (Claude owns `app/static/`). The only backend change is the widened static-file route (GAPS G-027). Every build feature kept a home, including explicit recovery acceptance, which still requires each consent and never auto-publishes. Placeholders for missing server support are listed in `docs/design/GAPS.md`; next steps in `docs/design/FOLLOW_UPS.md`. UI previews use the generated fixture `tests/fixtures/ui_seed.py`; no real audiobook was read or modified for the redesign.



## UI/UX implementation (2026-10-19; awaiting PR review/deployment)

Implementation is based on freshly fetched GitHub main `c94c052` plus the saved plan commits. The previous audit directory was a partial source snapshot; the complete Git checkout is `/workspace/ChapterKeeparr-implementation`. Main is 15 commits ahead of tag v0.5.0. The deployed container and MacBook checkout identities remain unknown.

The review workspace now gives selected books a compact expandable cover rail, readable adaptive header and responsive details. Gap consent immediately hides/reveals the white save action, while all existing server publication gates remain unchanged. UI approvals are draft-token-bound; polling/resizing preserve valid edits, native disclosures and playback. Shared responsive layouts and 44px hit areas were improved, and the skip link keeps the current route.

Settings now shows server build identity and client/frontend identity, a manual cached release check and redacted diagnostics. Docker/release builds embed their version/channel/commit/date; source checkouts remain development builds. Figtree ships locally. Hidden tabs poll more slowly; PWA updates wait for a user-confirmed reload. No conversion/matching backend optimization, real-media publication, merge, tag, release or production deployment was performed.

See VALIDATION.md for actual regression evidence and remaining physical-device/accessibility/PWA checks.

## Public-image installation preparation (2026-10-19)

The owner chose public GHCR pulls while keeping the GitHub source repository
private. `deploy/UNRAID-INSTALL.md` documents the owner-run branch-preview build,
one-time package visibility change, anonymous-pull verification, Docker Manager
template import, copied/test-library checks, stopped-state migration and rollback.
No public image availability is established by preparing these files.

Both Unraid templates use host port 8787 per the owner's latest instruction;
stop the existing container before starting the test replacement. The test template
uses a separate config and dedicated test-library mapping. The production template
requires preserving the existing actual mappings. Workers start paused, with one
book slot, four speech threads, a four-CPU quota and 4 GB memory cap. Pull-only
Compose and an example env file provide equivalent test defaults and require an
explicit published image reference. The prior instructions to save registry
credentials to flash were removed for the public-pull workflow.

XML and Compose configuration validation does not validate an actual image build,
Unraid import, inference performance or deployment. No release workflow was
triggered, no image pushed, and no running installation changed during this work.

## Build warning follow-up (2026-10-19)

The owner subsequently ran workflow `39290834143` on commit `94ee511`;
GitHub reports both test and image jobs succeeded. This establishes a successful
owner-run image build/push, not public anonymous access or an Unraid installation.
Its Node 20 action-runtime warnings and constant FROM platform lint warning were
nonfatal. Follow-up changes pin verified Node 24 versions of all workflow actions
and select linux/amd64 through CI/Compose rather than the Dockerfile FROM line.
Install documentation now includes an authenticated direct XML download link,
MacBook SSH/SCP commands and a clear workspace-versus-host distinction. No new
release/image workflow or deployment was triggered by the agent.

## Speech decoder dependency regression (2026-10-19)

The owner installed the preview and enabled its paused worker. A later book failed
at Check audio with `open() got an unexpected keyword argument 'metadata_errors'`.
Reproduced exactly with generated mono/stereo WAVs: faster-whisper 1.1.1 calls
`av.open(metadata_errors='ignore')`, which PyAV 19 removed. Its unconstrained
`av>=11` dependency allowed the incompatible PyAV 19.0.1 install. PyAV upstream's
19.0.0 release notes confirm removal; upgrading to faster-whisper 1.2.1 alone
would retain the same call.

Pin PyAV 18.1.0, the latest release before that removal, without changing the
speech model, inference options or publication policy. A real decoder regression
now checks mono/stereo WAV decoding, 48-to-16 kHz resampling, float32 shape and
signal validity, and unchanged source bytes. The Docker build runs these runtime
tests before downloading the model. No model or external service is needed for
the regression. Existing verified receipts can skip decoding, so the first book's
unchanged result did not establish decoder compatibility. See VALIDATION.md for
results. The owner must build/pull the updated preview before retrying the job.

## Manual published assignments — 2026-10-02

Implemented assigning published section IDs to existing marker timestamps in either direction using a searchable desktop modal/mobile sheet with excerpt context. Unassigned published sections appear first; duplicate and out-of-order placements are disabled and rejected by the backend. Outstanding acknowledgments exclude manual assignments and return when those assignments are changed/removed. Custom names remain distinct. Manual badges and filters, collapsed outstanding-section list and previous/next unresolved controls reduce scrolling. Autosave retains decisions; canonical names and manual provenance are recorded on finalization without raising speech recognition coverage. Existing source, backup and unchanged-audio checks remain. Worker-disabled generated-data preview is on port 8777; service-worker cache v17. No Tower deployment or real-book writes.

### Nearest unassigned picker — 2026-10-02
Published-section picker now hides retained speech/manual assignments and sorts remaining sections by absolute published-start versus local-marker-time distance (stable published-order ties). Reverse picker shows unassigned, retained timestamps in nearest-first order. Small closest-available and published-time/distance text is advisory only; no auto-selection or confirmation change. Replaced/removed assignments release their old published identity. Service-worker cache v18.

### Assignment clarity — 2026-10-02
Expanded manually assigned rows explicitly show Selected section and its canonical title. Picker shows current manual selection and Remove assignment, which keeps the marker/time/audio and restores the original name, immediately returning the released section to available choices. Picker groups Recommended (closest available, advisory), Other available and Out of chapter order, retaining distance sorting within groups and disabled invalid choices. Cache v19.

### Stable unconfirmed filter — 2026-10-02
Unconfirmed matches now reflects the original speech result throughout a draft review, retaining manually assigned rows and their badges. Unresolved navigation still skips assigned decisions, but uses the full unconfirmed list for page positions. Service-worker cache v20.

Removed Previous/Next unresolved controls and their handlers at user request. Marker filters and pagination remain. Cache v21.

### Main assignment action and no-match alternatives
Marker rows lead with Select Unmatched Section (Change selected section for assigned rows) beside an Other options selector. When no eligible section exists, the picker offers custom naming or navigation removal with explanatory copy. Removal stages an unconfirmed decision in the existing row, preserving the explicit checkbox and phone save confirmation; the first marker cannot be removed. Cache v22.

### Apply Recommended Matches — 2026-10-02
User-triggered bulk assignment acts across the book, preserving explicit edits. Only unique unassigned published matches within five seconds, with ten-second separation from competing sections/local markers and consistent published order, are applied from a single snapshot. Combined-order revalidation precedes mutation. No cascade by elimination. These remain manually assigned evidence and require Accept and save. Red Unconfirmed and yellow Manually assigned distinguish remaining work; unconfirmed-filter membership stays stable. Cache v23.

### Complex Frankenstein local fixture
`tests/fixtures/complex_review.py` expands only the synthetic Eve Fixture/B000FIXT05 job in an explicit ui_seed config. Local port 8777 now exposes 23 markers and 23 reference sections: six bulk timing recommendations, ambiguous/distant/competing cases, extra boundaries, no-evidence marker, same-title distinct references, unmatched bonus content, and pagination. Tone excerpts and illustrative transcripts, with deliberately invalid publication fingerprints. Scenario guide is written beside the fixture config. Never applied to deployment config automatically.

### Review decisions and explicit order overrides — 2026-10-02
Picker search is collapsed behind the Out of chapter order search icon and filters only that group. Manual out-of-order selection requires an inline confirmation with the section/time and warning; `override_order: true` is recorded on that explicit published decision and in acceptance provenance. Backend permits inversions involving explicitly overridden manual decisions but still rejects duplicate/unknown IDs and retains all source/time/audio guards. Recommendations never set overrides. Unmatch deletes the prior decision so valid recommendations become eligible again. Manual rename/removal/keep have distinct badges; incomplete names/removals remain action-needed. Input renders are microtask-deferred to prevent nested DOM morphing during blur. Cache v24.


Theme fade update (2026-10-02): removed cascading inherited text transitions; body text and default surfaces fade in 180ms. Frontend suite (7 tests), JS syntax and whitespace checks pass. Headless Chrome dark/light label colors stable by 600ms.
