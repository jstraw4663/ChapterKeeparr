# Prompt: implement the chapter draft review redesign

Paste the text below the line into Claude Code, opened at the root of the ChapterKeeparr repo.

---

You're the frontend engineer on ChapterKeeparr. Implement the approved redesign of the chapter draft review, the part of **Needs review** where the user decides what each unconfirmed chapter marker becomes before **Accept and save**.

## Read first
1. `docs/design/CHAPTER_REVIEW.md`: the spec. It wins over SCREENS.md and DESIGN.md §12 where they disagree.
2. `docs/design/reference/screens/ChapterReview.dc.html` (desktop) and `ChapterReview-Mobile.dc.html` (phone): the approved prototypes. See `reference/README.md` for how to read them. Take exact copy, spacing, colours (as tokens) and motion timings from their CSS and script. Their sample data is illustrative; never ship it.
3. `docs/design/RULES.md`, `DESIGN.md` §7 (motion) and §9 (notifications), and `AGENTS.md` / `CLAUDE.md`.
4. The current code: `app/static/js/screens/review.js` (`finalizeBody`, `markerEditor`, `sectionPicker`, `submit`), `app/static/js/review-drafts.js`, `js/morph.js`, `js/transitions.js`, and the backend preview contract in `app/acceptance.py` `preview()` plus `tests/fixtures/complex_review.py`.

## Before you change anything
- Run `git status`. The working tree has uncommitted work, some of it Codex's backend changes. Don't discard, stash or reformat anyone else's changes. Create a branch (e.g. `redesign/chapter-review`) and commit only your files.
- Confirm that every field in spec §8 exists in the preview contract. Anything missing goes in `docs/design/GAPS.md` as a row with a proposed contract and a `// DESIGN-GAP: G-xxx` placeholder in the UI. Don't edit backend code.

## Build
- Replace the modal picker, filter select, pagination and per-row `<details>` editors with the ordered card list, completion bar, colour timeline, inline options, decided rows and save bar from the spec. Desktop and phone.
- Keep the decision contract, `assignmentIssue()`, `clearRecommendations()`, draft persistence and the draft-token guard as they are. Map UI choices exactly as in the spec's table.
- Motion follows spec §4 exactly:
  - The ~300ms grid-row collapse in place.
  - Auto-advance and the scroll glide on **phone only**; desktop stays put after a pick.
  - Use the shared scroll helper, not `scrollIntoView({behavior:'smooth'})`.
  - Respect reduced motion.
  - Make sure `morph.js` patches the card's class rather than replacing the node, or the transition won't run.
- After a save, use spec §6: the toast "<Title> went back to the queue" with **Open queue**, then fade to the next book in Needs review, or "Nothing left to review". Apply the same rule to Save and re-verify / Resume checks / Finalize, and update DESIGN.md §12 and SCREENS.md to match, with a dated one-line note.
- Remove the dead code and CSS from the old picker and editor. Don't comment it out.

## Verify
- Existing tests pass. Add tests for:
  - Kind-tag derivation.
  - In-order option selection (the 3 nearest between the neighbour anchors).
  - The "Start it at" candidates for missing chapters.
  - The UI choice → decision mapping.
  - Save enablement (all decided + at or above the minimum + gap ticked).
- Use `tests/fixtures/complex_review.py` and add a Bedlam-sized fixture (many unconfirmed markers) to check scrolling performance.
- Take screenshots at 1440×900 and 390×844, light and dark: a typical book, an extreme book, mid-collapse, and a blocked-by-minimum state. Save them under `docs/design/screenshots/chapter-review/`. Compare them against the prototypes.
- Accessibility:
  - Option rows are buttons in a labelled group.
  - The between line has an aria-label.
  - The timeline ticks are labelled buttons.
  - Focus moves to the next card's first option after auto-advance on phone.
  - Everything works by keyboard. Don't add custom shortcuts.

## Report back
What you built, screenshot paths, deviations from the spec and why, new GAPS rows, and anything that should change in the design.
