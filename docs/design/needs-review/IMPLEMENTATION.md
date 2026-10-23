# Review redesign delivery — 23 October 2026

Implemented in the existing ChapterKeeparr working copy, preserving the pre-existing uncommitted backend changes. Baseline commit: f52cf50. No commit, publication or live deployment was performed. The supplied HTML and prompt are archived under docs/design/needs-review as design references.

## Implementation mapping and parity

| Area | Implementation and retained behavior |
|---|---|
| Workspace | review.js and styles.css provide queue rail, reason banner, recovery paths, before/after marker list, focused decision panel, filters, folded runs, timelines, attention pins and sticky save controls. |
| Responsive shell | Existing global navigation and routes remain. Phone entry is the book list; the editor appears above markers on narrow workspaces. Rail docking and workspace container queries govern desktop layout. |
| Decisions | chapter-review.js retains canonical section IDs, assignment/order validation, protected first marker, keep/rename/remove and missing-section acknowledgments. Confirmed markers can be overridden and restored. Choosing does not advance; Continue does. |
| Missing sections | Placement assigns an existing file marker; it never invents a timestamp. Nearby choices and all-chapter search remain available. |
| Persistence | Existing draft-token binding is retained with focus, path, filter, folds and local unsaved history. Bulk Undo restores the whole prior decision state and is cleared by later manual edits. |
| Acceptance | Existing accept-recovery endpoint receives all original marker decisions, draft token, minimum and required consent. Unrounded coverage, positive supported-marker count and readiness gate saving. Failures preserve edits; acknowledgment advances the queue. |
| Recovery | Edition metadata correction, edition search/region, redraft, resume and cancel retain existing endpoints and confirmations. Queued processing is not described as completed publication. |
| Evidence | Chapter checks, transcripts, timing diagnostics and server details remain available. Shared audio controller enforces a single clip and 15-second stop; saved clips retain pre-roll. |
| Threshold | Decimal values from 1–100 remain valid, with convenient step controls. |
| API additions | acceptance.py adds nullable draft duration and numeric section seconds. engine.py captures embedded tag provenance before identity enrichment. Older reports retain fallbacks. |
| Visual system | Existing semantic tokens, Figtree, shared controls, light/dark themes and modal focus management are reused. Figtree/OFL are bundled locally and service-worker cached. |
| History | Server history is explicitly partial; unsaved actions are local. No database event-log migration. |

The redesign retains existing functional capabilities. It intentionally replaces collapsing decision cards with explicit navigation. The original references cannot be rendered faithfully without their absent support.js runtime; screenshots show the implemented application using generated fixtures, not a rendered original-versus-new comparison.

## Validation completed

- Full Python suite: 94 tests passed, including generated-media backend contract tests.
- JavaScript chapter-review/draft baseline: 14 tests passed; new workspace suite: 5 passed.
- Latest frontend design rules, syntax and JS test wrapper: 7 checks passed.
- Actual-browser harness: all 12 combinations of 360, 390, 768, 1024, 1200 and 1440 pixels in light/dark passed horizontal-overflow and serious/critical axe checks.
- Browser flows passed: stable decision focus/Continue, confirmed rename/restore, rail persistence, suggestions/Undo, decimal minimum 43.25, failed save retaining edits/consent, successful mocked save carrying all 23 marker decisions plus token/consent and advancing, phone sheet Escape/focus return, and redraft replacement confirmation.
- Browser publication requests were mocked; no personal library media was modified by browser testing.

## Remaining release validation

Docker is absent on this host, so a disposable Docker/Compose build and runtime smoke test could not be performed. Static packaging inspection confirms COPY app includes the bundled fonts; browser dependencies are excluded from the Docker context. Unraid preparation/deployment remains pending this validation and separate release authorization.

The standalone Playwright launcher was not usable on this host. The same checked-in runner was executed successfully through the in-app browser. Run the CLI harness on a supported Chromium installation before release. Complete end-to-end browser submissions for edition correction, rerun and cancellation, empty-queue state, all navigation/rail combinations, reduced-motion behavior and an audible 15-second clip stop remain release smoke checks; existing implementations and backend checks do not substitute for those observations.

## Artifacts

- browser-results.txt: actual final browser audit output.
- review-desktop-dark.jpg and review-desktop-light.jpg: desktop captures.
- review-phone-light.jpg: narrow focused decision panel with sticky controls.
- python-tests.txt: full Python suite output.

Repository documentation: docs/design/needs-review/IMPLEMENTATION.md and docs/design/GAPS.md. Development harness: tests/browser (README includes setup). Changes remain uncommitted for review alongside the original working-copy changes.
