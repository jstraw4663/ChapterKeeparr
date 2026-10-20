# Chapter draft review (Needs review → "Save using the draft")

Approved 2026-10-04 (design round "C1 · Ordered list"). This spec replaces the current chapter-draft UI in `app/static/js/screens/review.js`: `finalizeBody()`, `markerEditor()` and the `sectionPicker()` overlay. Where this file disagrees with SCREENS.md or DESIGN.md §12, **this file wins**.

Reference prototypes (read them for exact layout, copy and motion values; their sample data is illustrative only):
- `reference/screens/ChapterReview.dc.html`: desktop (1440 wide, "extreme" sample with 8 markers and 1 missing chapter, below the minimum).
- `reference/screens/ChapterReview-Mobile.dc.html`: phone (390×844, "typical" sample with 3 decisions).
Both have a Sample switch (Typical / Extreme) and a working "save → next book → all caught up" flow.

## 1. Goal

The user usually has 2–3 markers to fix, sometimes 10+. They work mostly on a phone and usually listen before deciding. The usual fix is accepting a nearby suggestion. The right chapter is almost never outside the 3 nearest in-order choices; out-of-order assignment is rare.

The page must make three things obvious at a glance: **what still needs me**, **what I already decided**, and **whether I can save**.

## 2. Layout, top to bottom (inside the draft panel)

1. **Summary**
   - Headline: "N markers need you", or "Every marker has a decision".
   - Subline: "X of Y confirmed by audio · Z decided by you".
   - **Accept N suggestions** (ghost button), shown only when 2 or more unique recommendations exist. Pressing it applies all of them at once and shows an inline note: "Applied N suggestions. Each one is marked in the list." with **Undo**.
2. **Completion bar** (segbar): confirmed by audio (`--ok`) · decided by you (`--ink`) · needs you (`--warn`). Below it, a legend with these three plus "Missing from your file" (`--bad`).
3. **Colour timeline**: two lanes across the whole book. Edition (published section ticks, muted) and Your file (confirmed marker ticks, `--ok`). Every problem is a tappable tick: an amber tick in Your file for an unconfirmed marker, a red tick in Edition for a missing chapter, and ink once decided. Tapping a tick scrolls to its card (smooth glide, §4) and highlights it. A footer row reads "Start · Tap a mark to jump to it · End".
4. **Blocked notice**: only when identified % is below the minimum. Text: "**N% identified by audio · your minimum is M%.** Saving is blocked until you lower the minimum for this book." Button: **Lower for this book** (sets the per-book minimum to floor(current %)).
   - Desktop: icon, text and button in one row.
   - Phone: icon and text in a row spanning the full width, with a full-width button **underneath**.
5. **Ordered list**: every item that needs a decision, **in book order**: unconfirmed markers and missing chapters, interleaved by time.
   - An open item is a **card**.
   - A decided item **compacts in place** into a one-line row (§3c, motion in §4). It does not move to another list.
6. **"N markers confirmed by audio"**: a collapsible, closed by default, labelled "No action needed". Inside: time and name rows.
7. **Advanced**: a collapsible, closed. Holds the per-book minimum % field, coverage warnings and the "Edits are saved in this browser" note. The minimum only surfaces outside Advanced when it blocks (item 4).
8. **Save bar** (§5).

Confirmed markers never appear as cards. There is no filter select and no pagination: the list only holds items that need a decision, and confirmed ones sit behind the count.

## 3. Cards

### 3a. Unconfirmed marker card
Border `--warn-line`, radius 18, padding 16, gap 12. Contents in order:

1. **Header row**: time (tabular), a kind tag in colour, and on the right "In your file: **<original name>**". Kind tags (derive these client side):
   - "Suggested match" (`--ok`): `clearRecommendations()` proposes a section for this marker.
   - "Two close matches" (`--warn`): the two nearest in-order sections are within 10 s of each other.
   - "Nearest chapter is far" (`--warn`): nearest in-order section is more than 60 s away. Its first option's subline adds " · listen first", in warn colour.
   - "No chapter starts here" (`--warn`): no unassigned section fits between the neighbours, i.e. a likely extra boundary.
   - "No audio saved" (`--muted`): `!marker.excerpt`. The Listen bar is disabled.
2. **Between line**: one row. The previous chapter's name at the left, a short horizontal line with a dot in the middle, then the next chapter's name at the right.
   - The dot is `--warn` for a marker and `--bad` for a missing chapter.
   - Names ellipsize, each at most 40% wide.
   - No times, and the dot is **not** positioned proportionally: it always sits in the middle.
   - Neighbours are the nearest *anchors* before and after: confirmed markers plus markers the user has assigned. Fallbacks are "Start of book" / "End of book".
   - `aria-label="Sits between X and Y"`.
3. **Listen bar**: full-width button, 52px. On the left a 40px ink circle with play (or the equalizer while playing). Then the transcript excerpt in italics, clamped to 2 lines; when there's no text, "No spoken text saved for this marker." Plays the existing 15-second excerpt (`audio.playExcerpt`) and stops itself. Only one plays at a time.
4. **Options** (radio-style rows, 52px, radius 14):
   - Normal marker: **up to 3 nearest unassigned sections that fit in order** (between the neighbour anchors), nearest first. Each row shows the title, then "Published h:mm:ss · 4s later / 25s earlier".
   - The recommended one (from `clearRecommendations`) sorts first, gets an ink border, raised fill, a filled radio and a "Suggested" tag. If there's no unique recommendation, nothing is tagged.
   - Likely extra boundary: two options, "**Remove this marker** · Its audio joins <previous chapter>" and "**Keep it as its own chapter** · Named "<original>"". Don't tag either as Suggested unless the server says so.
5. **Other choices** (text buttons, one wrapped row):
   - Keep "<original>": hidden when Keep is already an option.
   - **Rename**: opens an inline field with **Use name**. It replaces the card body in place; no modal.
   - **Remove marker**: hidden for the first marker (not removable) and when Remove is already an option.
   - **All chapters**: opens an inline panel with a search field and every unassigned in-order section ("In order here"). Below that is a link, "Show N chapters outside the usual order". Opening it shows a warning in warn colour ("These break the published order. Only use one if you've listened and you're sure.") and then those choices, which save with `override_order: true`.

### 3b. Missing chapter card (section in the edition with no marker)
Dashed 1.5px `--bad` border. Contents:
- Header: time, then "In the edition, not in your file" in `--bad`.
- Section title, 17px / 750.
- The Between line with a red dot.
- Options:
  - "**Save without it** · Its audio stays inside <previous>": marked Suggested. Maps to the existing optional-section consent.
  - "**Start it at <time>** · Uses the marker "<name>" · Ns later": one row for each of the 2 nearest still-undecided unconfirmed markers. Maps to assigning this section to that marker (a `published` decision).

### 3c. Decided row
One line, at least 54px, radius 14, 1px `--line` border, transparent. Contents: an ink check disc, time, the final name (bold, ellipsized), a muted note, and **Change** on the right. Notes:
- "was "Chapter 12"" for a section assignment, with "Out of the usual order · " in front when the assignment overrode the order.
- "Kept its original name".
- "Custom name · was "…"".
- "Audio joins <previous>" when the marker was removed.
- "Saved without its own chapter" or "Starts at h:mm:ss" for a missing chapter.

**Change** reopens the card in place, without moving it.

### Decision mapping to the existing contract (no backend change expected)
| UI choice | Decision sent |
|---|---|
| Pick a section option / All chapters | `{index, action: 'published', section_id}` |
| Pick out-of-order section | `{index, action: 'published', section_id, override_order: true}` |
| Keep | `{index, action: 'keep'}` (explicit) |
| Rename → Use name | `{index, action: 'rename', title}` |
| Remove marker | `{index, action: 'remove', confirmed: true}` |
| Missing chapter → Save without it | section id in the optional-sections list |
| Missing chapter → Start it at <t> | `{index: <that marker>, action: 'published', section_id: <this section>}` |
| Accept N suggestions | `clearRecommendations()` output, same as today |

Keep `review-drafts.js` persistence, `assignmentIssue()` and the draft-token guard as they are.

**Remove no longer has a separate confirm checkbox.** Choosing "Remove marker" from the card is the explicit choice. The option text states the consequence ("Its audio joins …"). The decision is reversible with **Change**, and nothing is written until **Accept and save**. The commit point stays confirmed by the gap checkbox. If you believe AGENTS.md rule 6 or a backend consent check still requires a second confirmation, say so in your report rather than adding one silently.

## 4. Motion (the important part)

Everything is "fluid but crisp": short, eased, never bouncy. Easing is `cubic-bezier(.2,.8,.2,1)` unless stated otherwise.

**Deciding a card (collapse in place), about 300ms in total:**
1. Immediately, the chosen option fills ink (`--ink` background, `--bg` text, radio ring inverted), the other options fade to 40% over 120ms, and pressed rows scale to .985.
2. 60ms later the card collapses. The body animates `grid-template-rows: 1fr → 0fr` and fades out over 140ms. At the same time the decided-row summary, which is already in the card, animates `0fr → 1fr` and fades in starting at 120ms. Padding, radius and border animate to match the decided row exactly (padding 6/6/6/12, radius 14, `--line`, transparent), so there's no size jump when the real row replaces it. Duration is 260ms.
3. At 300ms the decision commits and the decided row replaces the card with **no** entrance animation.
4. **Phone only:** focus moves to the next open card (ink ring with a 0.6s flash) and the page glides there (see Programmatic scrolling below).
5. **Desktop:** nothing else moves. No auto-advance and no scroll.

"Accept N suggestions" collapses all affected cards together with the same timing. **Change** reopens a card with the reverse grid animation (280ms). Cards below the changing one slide naturally because their height changes over time. Set `overflow-anchor: none` on cards and rows so browser scroll anchoring doesn't fight the animation.

Implementation: give the card an inner `.cc-sum` (the decided-row markup, `aria-hidden`, `pointer-events: none`) and `.cc-body` (the card content). Each is a grid with one child that has `min-height: 0; overflow: hidden`. A `closing` class flips both. This needs no height measurement. Grid-row transitions need Chrome 107+ and Safari 17.2+; older browsers simply snap. `js/morph.js` patches in place, so the class change transitions on the same element. Don't re-create the card node when it starts closing.

**Programmatic scrolling (phone auto-advance, timeline ticks, the next-open arrow):** use one helper. Don't use `scrollIntoView({behavior: 'smooth'})`; it's inconsistent on iOS and lands cards under the bottom bar.
- Find the scroll container. Compute a visible zone: from below the fixed header (about 76px on phone, 96px on desktop) to the top of the bottom save bar minus 12px.
- Auto-advance is **skipped** when the target card's top and its first 220px are already inside that zone. Ticks and the arrow always scroll.
- Target: the card's top aligned to the top of the zone, clamped to the scroll range.
- Animate `scrollTop` with requestAnimationFrame, easeInOutCubic. Duration is `min(520, 260 + |distance| × 0.2)` ms.
- Cancel on any `touchstart`, `wheel` or `pointerdown` by the user. A new glide cancels the previous one.

**Reduced motion** (OS setting or the in-app "Reduce motion"): no collapse or grow animation (the decision applies instantly), the scroll jumps, and the book swap has no fade.

## 5. Save bar

**Desktop:** a sticky bar under the panel containing:
- The status line: "Below your minimum" / "N left to decide" / "Tick the box to save" / "Ready to save".
- The gap checkbox.
- **Next open ↓** (ghost), which glides to the next open card after the focused one.
- **Accept and save** (primary).

**Phone:** a blurred bar that overlaps the content just above the tab bar (`bottom: 88px`), padding 10/16/12. In order:
- A row with the status line and a 5px mini completion bar, plus a 48px round **↓** button on the right that glides to the next open card.
- The gap checkbox.
- A full-width 52px **Accept and save** button.

Leave enough bottom padding in the scroll area (about 340px) that the last card can sit above the bar.

**Accept and save** is hidden while the gap checkbox is unchecked. Checking it reveals a white button; unchecking hides it again (user decision, 2026-10-19). It remains disabled with an explanatory status until every item has a decision, identified % meets the minimum, the current draft is valid and the server is connected. Submitting locks the controls against duplicate writes.

## 6. After saving

This replaces DESIGN.md §12 "Sending a book back from Needs review returns to the list", for this flow and for Save and re-verify / Resume checks / Finalize as well.
1. Send the save as today.
2. Show a notification: "<Title> went back to the queue" with body "Saving new chapter names · audio unchanged" and action **Open queue**, which opens that book in the Queue. On phone the whole toast is tappable. It flies into the Queue badge as usual (DESIGN.md §9).
3. The current book's content fades out (180ms, translateY −6px), then the **next book in Needs review** opens in place: its header, its "1 of N", and its content fade in (300ms). Scroll goes smoothly to the top, the left list (desktop) drops the saved book, and nothing is focused.
4. When none are left: "Nothing left to review", "Everything you saved is in the queue", **Open queue**.

## 7. What's removed

- The `sectionPicker()` modal and bottom sheet, the "Show markers" filter select, 15-per-page pagination, the per-row `<details>` editors with their action `<select>`, the separate remove-confirm checkbox, the "Apply Recommended Matches" explanatory paragraphs, and the always-visible minimum % field.
- Any copy that repeats on every row. Explanations live once, in Advanced or as an `aria-describedby` hint.

## 8. Check before building (report anything that doesn't hold)

- `preview.markers`, `published_sections`/`sections`, `missing_sections`, `supported_percent`, `default_minimum_percent`, `coverage_warnings` and `requires_gap_acceptance` give everything above. Kind tags and between-neighbours are derived client side. If something isn't derivable (for example "likely extra boundary"), add a GAPS row with a proposed field.
- Optional sections ("Save without it") keep the consent the server checks today.
- Very large books (hundreds of unconfirmed markers): the list must stay smooth. If more than about 60 cards are open, render the cards for the first 30 and an "N more" row that loads more as you scroll. Don't paginate.

## 2026-10-20: complete timeline and conflicting matches

The Chapter checks evidence panel shows all existing/planned title pairs in timestamp order, with filters and Listen/Change. Automatically matched rows can be corrected and restored; their original speech percentage is never raised by manual decisions. Unknown sections are described as not matched, and skipping a section is not suggested. Counts include decisions, not just local markers. Nearby timeline targets share a 44px group jump while the complete list keeps each chapter individually accessible. Details and remaining audio-validation limits are in `docs/plans/bedlam-identity-repair.md`.
