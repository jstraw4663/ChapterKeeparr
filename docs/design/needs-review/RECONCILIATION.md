# Review redesign reconciled with the deployed baseline

## Baseline and ownership

On 2026-10-23, Jeremy authorized merging PR #3 (`feat/responsive-review-workspace`, c974bb1bf2d40326517fcfc202073ca094f20bcf) into main. Merge commit: 0d63dc617c8c5d37b34b8b0a7ebd6f018f0567d2. The new branch `redesign/review-on-current-main` starts there. The former `redesign/chapter-review` branch is stale and must not be merged wholesale. The original uncommitted backend work is not presumed newer than the deployed implementation.

The supplied HTML and prompt are design references, not deployment instructions. Current Manrope/Chapter C branding and the current evidence-backed scoring contract supersede older Figtree and audio-only assumptions. No image or container was released by the feature merge.

## Implementation mapping and parity

| Surface | Implementation | Preserved behavior |
| --- | --- | --- |
| Focused workspace | chapter-review.js / chapter-review-view.js | Existing marker options, canonical section IDs, duplicate/order validation, first-marker protection, missing-section assignment to an existing marker |
| Marker list | Four filters, folded runs, progressive reveal, before/after titles | Every original marker remains inspectable; confirmed markers can be overridden/restored |
| Navigation | Explicit Continue plus previous/next | Decisions retain focus, per-book state binds to evidence token, original hash routes and edition links |
| Queue | Persisted optional dock, existing phone queue controls | Current reason labels, no invented readiness counts; dock at 1200px, adjacent editor only at 1040px available workspace |
| Summary/evidence | Current Changes at a glance, Chapter checks and server details | Current quality warnings, transcripts, shared 15-second playback and original audio support distinct from validated matches |
| Recovery | Existing request controllers, path buttons and redraft confirmation | Metadata/edition corrections, rerun, redraft, cancel and checkpoint semantics |
| Persistence/history | Existing draft storage plus focus/path/local actions | Token invalidation, storage failures, partial server history honestly identified |
| Save | Existing consent and acceptanceState contract | Decimal 1–100 minimum, canonical payload, positive evidence, server recomputation; failed requests retain edits, changed evidence resets approval |
| API additions | acceptance.py / engine.py | Nullable real duration, section seconds, raw embedded-tag provenance; older reports use honest file-detail fallback |
| Shell | Existing Manrope, tokens, router, offline controls | PWA controlled activation and serialized screen updates; cache advanced to v18 |

## Deliberate differences from the old proposal

- Keep the deployed Changes at a glance summary instead of reintroducing the discarded dual timeline. Timeline clustering helpers are tested but no timeline is displayed.
- Keep real review-reason labels in the rail. Lazy per-book attention counts are not implemented; incomplete summaries never claim readiness.
- Keep current evidence-backed match scoring, including eligible user selections. A selection does not become original audio confirmation.
- Keep locally hosted Manrope rather than bundling Figtree.
- Keep current consent-gated save visibility and current global navigation.

## Validation and release gates

119 Python unittest tests and 75 JavaScript tests passed on the reconciled implementation. The dedicated generated-fixture browser harness checks six widths in both themes, accessibility, stable focus/Continue, confirmed restoration, suggestions/Undo, docking persistence, decimal minimum, consent and redraft confirmation. See VALIDATION.md for recorded results.

Remaining release validation: Docker/Compose build against disposable data (Docker unavailable on this host), physical Safari/VoiceOver, installed-device behavior, and hosted Linux CI. The full existing browser workflow matrix now passes locally after the focused-editor driver repair (see VALIDATION.md). Browser drivers now assert persistent focus and explicit navigation instead of auto-collapsing cards. No actual audiobook publication or deployment is performed by these checks.
