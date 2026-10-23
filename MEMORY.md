# ChapterKeeparr durable project memory

## Standing instruction from Jeremy — 2026-10-23
Before ANY ChapterKeeparr development, check GitHub for the latest build and active work, fetch current branches, and compare with the deployed commit. Do not start from an unverified local snapshot. AGENTS.md contains the mandatory procedure.

## Latest user-confirmed Docker deployment
- Commit: c974bb1bf2d40326517fcfc202073ca094f20bcf
- Build date: 2026-10-20T23:37:18.798Z
- Source: feat/responsive-review-workspace; Jeremy confirmed this in the redesign chat.
- This records the actual deployment, not whatever branch currently points to latest.

## Reconciliation authorization and state
Jeremy explicitly authorized merging feat/responsive-review-workspace into main, then implementing the new Review layout from freshly pulled main. PR #3 merged on 2026-10-23 as 0d63dc617c8c5d37b34b8b0a7ebd6f018f0567d2. Its head was exactly the deployed commit above; CI test passed. No image/tag/container update was performed by that merge.

The earlier redesign/chapter-review branch (6a9e430) began at f52cf50 plus uncommitted backend changes and is stale relative to the deployed branch. Use it only as design implementation reference, never wholesale replacement. New work: redesign/review-on-current-main.

Preserve current Manrope/Chapter C branding, quality-policy scoring, section-identity repairs, explicit consent, fingerprint/publication safeguards, async/PWA fixes, build diagnostics and release infrastructure while adapting the focused list/panel design. Future releases/merges require Jeremy's authorization; the PR #3 authorization was specific.
