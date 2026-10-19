# Container source reconciliation — 2026-10-19

The active-container source ZIP supplied by Jeremy contained critical unpublished review work. It was reconciled with `feat/responsive-review-workspace` at `28d37ae6cec364e248587236f95807c7eaeded0d`, using shared ancestor `5055ded953e6c4b3269e9efb3b5500b859d32d35` for three-way comparison.

- Input: `source.zip`, SHA-256 `33150fead5b4ab854fbdd8b4eebab3ddd34403656fa3950695bdcf16313a650a`.
- The supplied [build manifest](uploaded-container-build-manifest.json) identifies `2026-10-02-review-decisions` and includes uncommitted changes. It is historical provenance, not the identity of this new build.
- All runtime files covered by that manifest matched their recorded hashes. Four documentation files differed: `docs/design/DESIGN.md`, `GAPS.md`, `SCREENS.md`, and `reference/README.md`; their supplied content was reviewed alongside the branch changes.
- No database, private configuration, actual audiobook, Git history or archive-specific agent instructions were imported. macOS metadata was excluded.

## Preserved from the container

The acceptance/database/engine/recovery/worker modules and their additional tests retain the deployed implementations. These include manual published-section assignment, rename/removal, explicit order overrides, validation and provenance, preserved retry evidence, monotonic progress, word-timestamp recognition and fingerprinted browser drafts. Manual choices remain separate from speech coverage and cannot bypass publication safety checks.

The supplied chapter-review model, local draft helpers, synthetic complex/large fixtures, ordered-card specification, prototypes and reference screenshots are retained. `CHAPTER_REVIEW_PROMPT.md` is historical design documentation, not a new execution instruction.

## Preserved from the branch

Responsive layouts and the compact/expandable cover rail, accessible tokens and local fonts, build/frontend diagnostics and update information, public GHCR/Unraid templates and migration guide, modern CI actions, PyAV 18.1.0 pin and real mono/stereo decode smoke tests remain. API changes combine both contracts. Docker runs both runtime checks before model download. The service-worker shell includes the new modules; image builds still stamp the actual commit/assets.

## Decisions and integration

Jeremy explicitly chose to finish the supplied ordered-card/sticky-footer design and to hide **Accept and save** until gap consent is checked, then reveal it white. Those decisions resolve the two behavior conflicts; the older disabled-visible mockup rule has been updated.

The new editor uses the supplied decision contract with ordered problems, manual choices, inline chapter search, bulk suggestions/Undo, local persistence, token invalidation and a shared guarded approval footer. No deployed acceptance capability was intentionally removed. Mobile advances through decisions; desktop preserves reading position. Large drafts render in batches.

Notifications hydrate authenticated cover art, occupy three stable simultaneous slots, queue a bounded number of later events and pause expiry during reading/interaction. Polling preserves their DOM and remaining timers. Activity continues to retain events.

The historical manual deployment note is retained as `DEPLOY-TOWER.md`, with a pointer to the current versioned installation guide. Release authorization remains with Jeremy: this branch/PR does not merge, tag or publish an image automatically.
