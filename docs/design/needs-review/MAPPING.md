# Review reference implementation — 2026-10-24

Baseline: fetched `redesign/review-on-current-main` at `3648590`; GitHub workflow 40002766633 succeeded. Main remains `0d63dc6`. Continue this branch so its newer fixes are retained. Local tracked tree was clean; unrelated untracked Claude/source archives remain untouched.

The attached prompt and HTML are design inputs, not release authorization. Current approved Manrope/Chapter C branding and evidence-backed validation supersede the reference's older Figtree and audio-only save formula. Retain the 1–100 decimal minimum and every existing acceptance/publication check.

## Stack
Plain JavaScript ES modules, hash router, shared store and keyed DOM morphing; CSS semantic tokens, no frontend build or framework. Python unittest and Node test runner; Python Playwright/axe against generated media fixtures. Docker builds through `.github/workflows/release.yml`; manual branch workflows publish the branch tag. This change does not trigger deployment.

## Component mapping
| Reference | Implementation | Behavior |
|---|---|---|
| Queue rail / phone list | `screens/review.js`, `styles.css` | Cover strip, hover/focus overlay, explicit touch toggle, persisted docking at 1200px; phone list remains entry point. First 20 queue previews load with at most two requests; others show real review reasons. |
| Header / status / paths | `screens/review.js` | Integrated book navigation, compact phone cover, amber notice, horizontally scrollable tabs with arrow/Home/End keyboard navigation. |
| Brief / timeline | `chapter-review.js`, `chapter-review-view.js` | Edition and file lanes, clustered attention pins, real duration only, desktop/phone density. Pin clicks cycle through unresolved items. |
| Filters / folded rows | Same modules | Four filters with time strips; compact before/after/evidence columns, stacked phone rows, folded runs with change counts. Filter changes reset folds. |
| Decision panel | Same modules | Persistent focus, explicit Next, open-item navigation, suggested/missing/confirmed/decided states. Rename and chapter search replace options in place. |
| Suggestions / Undo | Existing pure model | Conservative recommendation eligibility, exact prior acknowledgments retained; subsequent manual edits clear bulk Undo. |
| Save bar | Existing guarded acceptance controller | Consent and readiness remain unchanged. Selected timing-validated matches do not become original speech matches. |
| Edition / redraft / rerun / cancel | Existing request controllers | Existing endpoints, metadata/region edits, failure retention and confirmations. |
| History / server details / Advanced | Existing disclosures | Partial history plus local decisions, full diagnostics, decimal minimum. |

## Data mapping and gaps
- `/api/jobs/{id}` supplies acceptance preview, markers, canonical sections, excerpts, transcripts, token and recorded diagnostics. Existing acceptance/review/cancel endpoints remain authoritative.
- `duration_seconds` in the preview or existing source-info duration drives timeline positions. Unknown duration hides lanes and says why; never use the last marker as the book ending.
- Explicit section seconds are available in new previews; canonical numeric IDs remain a compatibility fallback for older previews.
- Cover/author/narrator metadata comes from the existing book model. Absent art uses the existing brand fallback.
- Queue counts are computed from loaded preview and token-bound local choices, not invented from job summaries. Hydration is intentionally capped at 20 books per displayed queue.
- Embedded provenance and edition runtime remain as previously reconciled. Matching runtime is not recording verification.
- Server event history remains partial; no event-log schema change.

## Responsive/theme decisions
The actual workspace—not viewport alone—must have 1040px before a 440px editor sits beside the list. Below that, the editor precedes the list. At 640px workspace width, rows stack, filters become two columns, and pin clustering uses the phone layout. Below the existing 768px app breakpoint, the phone queue entry replaces the rail. Docking affects layout only from 1200px viewport width. All changes use CSS container/media queries and respond during window resizing without reload.

Both themes use existing tokens, not copied dark-only literals. Light surfaces: paper `#F7F2E8`, panel `#FFFCF7`, ink `#1F1D1A`, muted `#625C53`; attention `#805817` on `#F0E0BE`; confirmation `#2B6A39` on `#E2EFE4`; problem `#B23A1C` on `#FBE4DC`. Dark values remain in the shared token sheet. All controls have at least 44px targets. The expanded global navigation is preserved and can cause the editor to stack sooner than in Claude's narrower mock navigation.

## Retained product differences
Consent remains available before all choices are finished, and Accept and save stays hidden until consent, as previously approved. Advanced remains decimal 1–100%. Cancel uses the existing confirmation controls; server details retain the existing disclosure. The global shell keeps its existing page scrolling and navigation. No new marker timestamps, full media player, backend policy, database migration or production writes are introduced.

Edition submission requires valid changed title/author/narrator/ASIN/region; same-details retry remains Run checks again. Runtime results show numerical differences. The provided support.js runtime is absent, so reference comparison uses the supplied markup/CSS/behavior source. Validation details are in VALIDATION.md.

Publishing limitation: the current GitHub OAuth login lacks workflow scope. The existing release workflow is unchanged; run `python tests/browser/review_design.py --axe /tmp/axe.min.js` alongside it until the extra CI step is applied with workflow permission. All existing CI suites remain active.
