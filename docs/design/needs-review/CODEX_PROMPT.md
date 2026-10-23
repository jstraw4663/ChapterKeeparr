# Codex task: build the ChapterKeeparr "Needs review" page

## 1. What you're building

ChapterKeeparr is a self-hosted book-server file manager. It runs on Unraid and its main job is converting and fixing audiobook chapters. When a job can't finish on its own (the chapter draft needs a human, or the edition lookup failed), the book lands in **Needs review**. This task rebuilds that page from a finished interactive design.

The page has four regions:

1. **Queue rail.** A collapsible sidebar of books waiting for review. It shows covers only when collapsed and pops out over the page on hover. A pin button docks it open.
2. **Book workspace.** Header, status banner, and "What to do next" path tabs. Below that comes either:
   - the draft review: brief and timeline, filterable marker list, and decision panel, or
   - one of the other paths: edition picker, draft again, or run the checks again.
3. **History and settings.** Collapsible History, Details from the server, and Advanced.
4. **Save bar.** A sticky bar with the attention count, the "next item" button, the gaps acknowledgement checkbox, and **Accept and save**.

Desktop and phone share one state model with two layouts.

**Product rules that override anything else:**

- This is **not a media player.** Audio plays only as a 15-second verification clip at a marker.
- Nothing gets uploaded from the phone. Files already live on the server.
- Saving writes new chapter names and markers. **Audio is never changed.**
- Choosing an option **marks it and does not auto-advance.** It lights up "Next" instead. This is a deliberate design decision, so don't "improve" it.
- Every marker row opens in the decision panel, confirmed (green) ones included, so the user can overrule a match.

## 2. Design reference files

These are in `design/` next to this prompt. Copy them into the repo under `docs/design/needs-review/` and commit them with your work.

| File | What it is |
|---|---|
| `design/Review.dc.html` | **Source of truth.** The full interactive page: desktop at 1440×1080 and phone at 390×844, driven by one state model. |
| `design/States.dc.html` | Static "situations" sheet. It shows every decision-card variant, the phone Needs review list, a non-draft book, and the empty state after the last save. |

**How to read a `.dc.html` file.** It won't render on its own, because the `support.js` runtime isn't included. Read it as source:

- Markup lives inside `<x-dc>`.
- `{{name}}` holes are values returned by `renderVals()` in the `<script type="text/x-dc">` block at the bottom.
- `<sc-if value>` means conditional rendering. `<sc-for list as>` means a loop.
- `onClick="{{fn}}"` binds a handler.
- **The `renderVals()` logic is the behavioral spec.** Port its derivations (status, after-text, filters, folding, pins, attention count, save gating) as tested pure functions.
- The CSS classes in `<helmet><style>` (`.btn`, `.icb`, `.opt`, `.row`, `.rail`, `.qitem`, `.cov`, `.pinb`, and so on) are the exact visual specs.
- The `bedlam()`, `feral()` and `carl()` functions are **mock data only.** Use them as test fixtures. Never ship them as content.
- Ignore the page chrome around the two mockups: the heading, the description and the "Reset the demo" button.

## 3. Step 0: discovery and mapping (do this first, before changing code)

I have not given you component names because the design was made outside the repo. Map the design onto the real codebase yourself, then write `docs/design/needs-review/MAPPING.md` with:

1. **Stack facts.** Framework and version, router, state management, styling approach (CSS modules, Tailwind, styled-components or other), component library if any, test runners, build and deploy scripts.
2. **What exists today.** The current Needs review / review route and its components, the API client, and the theme or token files. Note whether a light theme already exists.
3. **A mapping table.** One row per design component in section 5, with columns: design component → existing file to modify, or new file path → notes.
4. **The data gap list.** For each field in section 6, record which endpoint or model already provides it and **which fields the backend doesn't provide yet.**
5. **Assumptions you're making.**

Then carry on building. **Stop and report without guessing** if any of these is true:

- The backend lacks something the page can't function without: the marker list with old and new names and times, open decisions with options, saving decisions, or the edition search and select.
- Building the page would require changing backend behavior or the database schema.
- The app's navigation or global layout would need to change in a way that affects other pages.

For data that's nice to have but missing (for example the spoken-text excerpt, or the "outside the usual order" chapter list), build the UI so that section **hides cleanly** when the field is absent. List it in MAPPING.md. Never fill it with fake data.

## 4. Out of scope (don't do these)

- Don't change the global app nav. The mockup's left nav (Library, Queue, Needs review, Settings) and the phone bottom nav (Suggestions, Library, Queue, Needs review) are context, and they don't match each other. Keep whatever the app has now. Only wire the Needs review count badge if it isn't already wired.
- Don't use the "C" square in the mockup nav. It's a placeholder for the real brand mark.
- Don't make backend, schema or job-pipeline changes beyond what section 3 allows.
- Don't add a full audio player, scrubber or waveform.
- Don't add push notifications.
- Don't ship the mock books or the demo reset button.

## 5. Components to build

Names are suggestions. Match the repo's conventions. Exact sizes, colors and copy are in `Review.dc.html`; when this prompt and the file disagree on a visual detail, **the file wins.**

### 5.1 `NeedsReviewPage`, the layout shell

- **Desktop:** `[app nav] [QueueRail wrapper] [scrolling workspace]`. The workspace scrolls independently. The SaveBar is sticky at its bottom (16px inset, radius 20, blurred translucent `rgba(23,23,22,.94)`).
- **Phone (<768px):** top bar (back to the Needs review list, "Needs review" plus "{n} of {count}", ⋯ more button), a scrolling body, a sticky bottom save bar, then the app's bottom nav. There's no rail on phone. The list page from `States.dc.html` #6 is the entry point instead.
- The selected book belongs in the URL (for example `/review/:bookId`) so back, refresh and deep links work. Switching books keeps each book's undecided work (see 7.9).

### 5.2 `QueueRail` (desktop and tablet only)

The rail is built from a wrapper div plus `<aside class="rail" aria-label="Waiting for you">`.

**States:**

| State | Wrapper width | Rail width | Behavior |
|---|---|---|---|
| Collapsed | 84px | 84px | Shows **only the covers**. The header row is hidden (opacity 0). The current book's row background is suppressed (`background: transparent !important`), so the white ring on its cover is the only "current" indicator. |
| Hover or `:focus-within` while unpinned | 84px | 320px, absolutely positioned over the content, `z-index` above it | Shadow `20px 0 50px rgba(0,0,0,.55)`. Overlays without pushing the layout. |
| Pinned | 320px | 320px | Docked: the workspace reflows narrower. No shadow. Text always visible. |

- **Width transition:** 260ms, `cubic-bezier(.32,.72,0,1)`, on both the rail and the wrapper.
- **Text reveal:** opacity over 160ms, `cubic-bezier(.2,.8,.2,1)`, with an 80ms delay on reveal.
- **Header (expanded only):** "Waiting for you", then the count in amber `#E9B34E`, then the pin button pushed right with `margin-left: auto`.
- **Pin button (`.pinb`):** 36×36, round, icon-only.
  - `aria-pressed` true or false.
  - `aria-label` and `title` read "Pin sidebar open" or "Unpin sidebar".
  - The pushpin SVG is stroked when off and filled (`fill: currentColor`) when on.
  - The pressed state has a `#222220` background and a `#3A3A37` border.
- **Persist pinned state per browser** in `localStorage`, wrapped in try/catch with a default of unpinned. It survives reloads and isn't reset by anything else on the page.
- **Below a 1200px viewport, ignore the pinned state** (collapsed plus hover overlay only), so the decision panel and table don't get squeezed. This is an assumption Jeremy may change, so put the breakpoint in one constant.
- **Rows (`.qitem`, a `<button>`):** 300px wide, at least 72px tall, radius 14.
  - Cover `.cov` is 48×62.
  - Current row: `aria-current="true"` and a 2px ring `0 0 0 2px #0F0F0E, 0 0 0 4px #F4F4F1`. Other covers sit at opacity .75.
  - The badge `.cbadge` sits at the cover's top-right corner. It shows `✓` on green `#7FC98C` when a draft is ready to save, `!` on amber when the problem is the edition, and otherwise the undecided count on amber.
  - Text (expanded only): title (14/700, ellipsis), then `need` in amber or green, then "{left} · {when}" in grey. `left` is "1 step" for edition books, "Ready to save" when nothing is left to decide, and otherwise "{n} to decide".
  - `aria-label` reads "{title}, {need}", plus ", open" when the row is current.
- Use real cover art when the API provides it. The colored block with the short title is the **fallback** when there's no art.
- **Touch devices** (`pointer: coarse`) have no hover. A tap on a collapsed cover selects that book; the pin is how a touch user keeps the rail open.

### 5.3 `BookHeader`

- Cover 92×120, the series eyebrow (12px, uppercase, .08em tracking), the title (30/800), and "{author} · Narrated by {narrators}".
- On the right:
  - "{pos} of {count}" in tabular numbers.
  - Previous and next book `.icb` buttons, disabled when only one book is in the queue.
  - A ⋯ button with `aria-expanded` that opens the **BookMenu** popover (300px). The popover holds "Details from the server" and "Cancel job…", which opens an inline confirmation: "Cancel this job? The files stay where they are." with **Cancel job** (`.btn.bad`) and **Keep it**.
- **Phone:** a compact header (cover 56×74, title 19/800, `need` in amber). The ⋯ menu becomes a **BottomSheet** (5.14).

### 5.4 `StatusBanner`

An amber notice: background `#2E2513`, border `#4A3A18`, radius 16. It contains:

- an info icon,
- `happened` (15/700) and `happenedSub`,
- "Edition: {edition}",
- a "Details from the server" link on the right.

### 5.5 `PathTabs` ("What to do next")

- `role="tablist"` pill group. The selected tab is filled white with dark text.
- **Draft books:** Review and save the draft · Draft the chapters again · Choose a different edition · Run the checks again.
- **Edition-problem books:** Choose the edition · Run the checks again.
- **Phone:** short labels (Review draft, Draft again, Edition, Run again) in a horizontally scrolling row.
- The selected path is remembered per book.

### 5.6 `DraftBrief` (Review path only)

- **Headline:** "{n} need you", "1 needs you", or "Every marker has a decision".
- **Subline:** "{audio} of {total} confirmed by audio · {n} decided by you".
- **"Accept {n} suggestions" button:** shown only when **two or more** undecided items have a suggested option. Applying it adds a note, "Applied {n} suggestions. Each one is marked in the list.", with an **Undo** link that restores the exact prior decisions.
- **Timeline (`TimelineLanes`):** a grid with 72px labels and two 16px lanes.
  - **Edition lane:** one 2px tick per edition chapter in `#4A4A46`. Chapters missing from the file get a 4px full-height tick in red `#F08A6C`, which turns white once decided.
  - **File lane ("Your file"):** markers colored by status. "Needs you" markers are 4px and full height. Removed markers are `#5A5A55`. The focused marker gets a 2px white ring.
  - **Pin row above the lanes:** undecided items clustered when they sit within **2.5% of the book's length on desktop (8% on phone)**.
    - A pin shows "!" for a single item or the count for a cluster.
    - It's amber when any item in the cluster needs a decision, otherwise red. It's white when it contains the focused item.
    - Its position is clamped to 3–97%.
    - Clicking cycles focus through the cluster.
    - `aria-label` reads "{n} to decide near {time}".
  - **Axis labels:** 0:00, the ¼, ½ and ¾ marks (h:mm), and the total length.
  - Both lanes need text alternatives via `role="img"` with an `aria-label`.
- **Blocked warning:** shown when the percentage identified by audio is below the book's minimum. It's red text with the bold "{pct} identified by audio, below your {min} minimum." and "Saving stays blocked unless you change the minimum for this book.", plus a **Change in Advanced** link that opens Advanced and scrolls to it.

### 5.7 `MarkerFilterChips`

A 4-column grid of `.fchip` toggle buttons with `aria-pressed` (two columns on phone):

- **Needs you:** count "{undecided} of {open}".
- **Changing**
- **Unchanged**
- **All**

Each chip carries a 6px **mini-strip** showing where its matches fall across the book. The default filter is **Needs you**. Changing the filter collapses every folded run.

### 5.8 `MarkerList` with `MarkerRow` and `FoldedRun`

- **Desktop columns** (`.cols`): `72px | 1fr | 18px | 1fr | 96px`, labelled Time · In your file now · (arrow) · After you save · Evidence.
- **`MarkerRow`:** a main `<button>` that focuses the marker in the decision panel, plus a separate 36px listen button.
  - **Before** column: grey. It's struck through when the name is changing. It shows "—" for a missing chapter (phone: "Not in your file").
  - **Arrow:** "→" when the name changes or a decision is pending, "=" when it doesn't.
  - **After** column:
    - pending: italic, amber or red, showing the suggestion with "?";
    - changing: white, weight 650;
    - removed: red "Removed";
    - otherwise: dim "No change".
  - **Evidence** column: a status dot plus label (Audio, Needs you, Missing, or a check icon with "By you").
  - **Row tints:**
    - focused: white border, `#171716`;
    - undecided: amber `#1D1A14` and `#4A3A18`;
    - missing: dashed `#5A2A1A` on `#1C1513`.
  - Missing-chapter rows hide the listen button with `visibility: hidden`, which keeps the column aligned.
  - `aria-label` reads "{time}, {old} becomes {after}, {status}. Open in the decision panel."
- **`FoldedRun`:** consecutive markers that don't match the filter collapse into one dashed `.fold` button.
  - Title: "{n} markers · {h:mm} – {h:mm}".
  - Subtitle: "{x} changing · {y} unchanged".
  - It has a 4px mini-strip and a chevron, plus `aria-expanded`. Expanding it inlines the rows.
- **Phone:** stacked rows (time and status on top, old name small, new name 15px).
- This list can hold more than 100 markers. Keep rows cheap and memoized. Virtualize only if profiling shows a problem.

### 5.9 `DecisionPanel` and `DecisionCard`

- **Desktop:** a 440px sticky aside (`top: 16px`) to the right of the list.
- **Phone:** the same card placed between the brief and the list. Its prev, next and continue actions smooth-scroll the card into view.
- **Header row:** step eyebrow, previous button, next button.
  - Open item: "Needs you · {i} of {open} · {left} left" (or "Decided · …"), amber while undecided.
  - Confirmed marker: "Not in the review count · you can still change it".
  - Previous and next cycle through **open items by time** and wrap.
- **Card variants** set the border and background. See `States.dc.html` #1–#5.

  | Variant | Border | Background | Kind label |
  |---|---|---|---|
  | Suggested match / Two close matches / No chapter starts here / Nearest chapter is far | `#4A3A18` | `#1D1A14` | green for Suggested, amber otherwise |
  | In the edition, not in your file | 1.5px dashed `#F08A6C` | `#1C1513` | red |
  | Decided | `#3A3A37` | `#171716` | "Decided by you" in white |
  | Confirmed by audio, not an open item | `#2B4A33` | `#131A14` | "Confirmed by audio" in green, or "Decided earlier" |

- **Card contents, in order:**
  1. Time and kind label.
  2. The **before → after** box: "IN YOUR FILE" and "AFTER YOU SAVE". The after value is amber while pending and red when removed.
  3. The **between line**: previous chapter name ─●─ next chapter name, with `aria-label` "Sits between X and Y".
  4. **ListenButton** (5.13) with the spoken-text excerpt in italics. It's hidden for missing chapters.
  5. A note for confirmed markers. Either "The audio here matches the name already in your file, so nothing changes." or "The audio here matched "{new}", so it's renamed. If that's wrong, keep your name or pick another."
  6. **Options:** `.opt` radio-style buttons with `aria-pressed`, the suggested one first.
     - Selected: filled white.
     - Suggested but not selected: white border on `#222220` with an uppercase "SUGGESTED" tag.
     - A confirmed match shows a "MATCHED" tag.
     - A sub line that needs a warning ("listen first") is amber.
  7. **Secondary links**, as applicable:
     - Keep "{old}"
     - Rename
     - Remove marker (red; never offered on the first marker)
     - All chapters
  8. A **Continue** button appears just after a decision when undecided items remain: a full-width primary button reading "Next: {time} · {name}". At the same time the header's next button gets the `.hi` highlight, a white fill and a 1.6s pulse played twice.
  9. When the decision just made was the last one, show the green note "That was the last one. Check the list, then save."
- **In-place editors** replace the options inside the card. There's no modal and the card keeps its position.
  - **Rename:** a labelled "New name" input, prefilled, with **Use name** and **Cancel**.
  - **All chapters:** a labelled "Find a chapter" filter input and up to 6 in-order candidates, plus a link "Show 3 chapters outside the usual order". That link reveals an amber warning ("These break the published order. Only use one if you've listened and you're sure.") and the out-of-order list. **Back to the options** returns to the normal view.
- **Choosing a confirmed match again** after overriding it restores the audio match and removes the user's decision.

### 5.10 `SaveBar`

**Desktop** (sticky, Review path only):

- Left side:
  - with attention items: "{n} need attention" in amber, plus "Next: {time} · {name}" in grey;
  - when the book is blocked: "Below your {min}% minimum · open Advanced".
- With zero attention items, show the checkbox "I accept possible gaps or edition differences. Matching chapters doesn't prove the audio is complete." Until it's ticked the line reads "Tick the box to save" (white). Once ticked it reads "Ready to save" (green).
- A next button (only while attention items remain). It jumps to the next undecided item, or opens Advanced when only the minimum is blocking.
- **Accept and save** (primary). It's disabled while attention items remain or the box is unticked.

**Phone:**

- With attention items: a 32px count pill (amber when there are undecided items, red when only blocked) with "needs/need attention" and the next item, plus a 48px next button.
- With none: the checkbox ("I accept possible gaps or edition differences.") and a full-width 50px **Accept and save**.

### 5.11 Other path panels

- **`EditionPicker`** ("Choose the edition you have" or "Choose a different edition"):
  - Quick-fix buttons (**Try another region**, **Use the embedded audiobook ID**) appear only when the lookup failed.
  - A "Title or ASIN" input with a visually hidden label, prefilled with the title, plus **Fill from ▾** and **Search**.
  - A `role="radiogroup"` of editions, each showing title, sub (ASIN · region · narrator) and a fit line colored by fit: green for a match, amber for shorter, red for much shorter. The current edition is preselected.
  - **Save and re-verify** stays disabled until a *different* edition is picked.
  - An "Edit the details by hand" link.
  - Phone uses icon buttons for Fill and Search.
- **`RedraftPanel`:** explanatory copy, then **Draft the chapters again**. That opens a confirmation: "This replaces the current draft and your {n} decisions. The book goes back to the queue while it drafts." with **Draft again** (`.btn.warn`) and **Keep this draft**. On phone the confirmation is a bottom sheet.
- **`RerunPanel`:** "Only if something changed outside ChapterKeeparr…" plus a **Run the checks again** button.

### 5.12 `HistoryAndSettings`

Three collapsible `.panel` sections. Each has a `.coll` button with `aria-expanded`, a chevron and a sub line.

- **History:**
  - When there are unsaved decisions, a "NOT SAVED YET" group lists this visit's actions, newest first. Examples: Chose "X" at 1:02:03 (was "Y"); Accepted 4 suggestions; Undid 4 suggestions; Set the minimum to 88% for this book.
  - Then the "EARLIER" server events (when, what, sub).
  - Sub line: "{n} unsaved changes · {m} earlier events", or "{m} events · last: {what}".
- **Details from the server:** a key/value list (Reason, Timing check, Speech check, Edition, …), taken straight from the API.
- **Advanced** (desktop anchor `data-adv="d"`, phone `data-adv="p"`, so "Change in Advanced" can scroll to it):
  - **Minimum identified by audio:** a per-book −/+ stepper, clamped to 50–100. Copy: "This book only. The default of 95% is in Settings. This draft: {pct}."
  - When blocked, a red **Set to {floor(pct)}% so this draft can save** button. Pressing it logs a history line.
  - The coverage note.
  - "Your choices are kept in this browser until you save."
  - Sub line: "Below your {min}% minimum" in red, or "Minimum {min}% for this book".
  - For non-draft books the sub line is "Nothing to set yet".

### 5.13 `ListenButton` / `useClipPlayer`

- Plays **15 seconds** of the book's audio starting at the marker time, served by the backend. Find the existing endpoint or flag it in MAPPING.md.
- Only one clip plays at a time across the whole page. Clicking the playing one stops it, and it auto-stops at 15s.
- **Icons:** play triangle when idle, three bars while playing.
- Row buttons get the `aria-label` "Play 15 seconds at {time}".
- Stop playback when switching books or leaving the page.

### 5.14 Shared pieces

- **`Toast`:** `role="status"`. Desktop: bottom-right, 360px wide. Phone: top. It shows a title and a body plus an "Open queue" link (phone: the whole toast is the link) and auto-dismisses after 4.2s.
- **`BottomSheet`** (phone): a scrim button labelled "Close", a 26px top radius and a grab handle. Variants: more, cancel-confirm, redraft-confirm, server details. Trap focus inside, close on Esc, and return focus to the opener.
- **`EmptyState`:** "Nothing left to review" / "Everything you saved is in the queue." / **Open queue**.
- **`NeedsReviewList`** (phone entry, `States.dc.html` #6):
  - Heading "Needs review", then "{n} books need you before they can finish."
  - Rows show the cover, the title, "{reason} · {when}", and a right-hand action label: "{n} to decide" in amber, "Ready to save" in green, or "Pick edition" in amber.

## 6. Data the UI needs (view model)

Shape these from the real API in a single adapter (e.g. `toReviewViewModel()`) so components never touch raw API responses.

```ts
type MarkerStatus = 'audio' | 'you' | 'need' | 'missing';

interface ReviewBook {
  id: string;
  kind: 'draft' | 'edition';           // draft = chapter draft needs review; edition = edition lookup failed
  title: string; series: string; author: string; narrators: string;
  coverUrl?: string; coverFallback: { short: string; bg: string; fg: string };
  queuedAt: string;                    // shown as "Yesterday", "Oct 2"
  need: string;                        // "Review the chapter draft" | "Choose the edition"
  happened: string; happenedSub: string;
  edition: string;                     // "Title · ASIN · Region" or "—"
  lengthSec: number;
  totalMarkers?: number; identifiedByAudio?: number;   // drafts only
  minPctDefault?: number;              // from Settings (95) or the per-book override
  coverageNote: string;
  markers?: Marker[];                  // drafts only, ordered by time
  openItems?: Record<string, OpenItem>;// keyed by marker key
  editions: Edition[];
  history: { when: string; what: string; sub: string }[];
  serverDetails: { k: string; v: string }[];
  lookupFailed?: boolean;              // shows the quick-fix buttons
}
interface Marker {
  key: string; t: number;              // seconds
  old: string;                         // name in the file now ('' if missing)
  proposed: string;                    // drafted name
  keptAsIs: boolean;                   // the proposed name equals the old name
  status: 'audio' | 'you' | 'missing'; // server status before this visit's decisions
  heard?: string;                      // spoken-text excerpt (optional)
}
interface OpenItem {
  kind: string;                        // 'Suggested match' | 'Two close matches' | 'No chapter starts here' | 'Nearest chapter is far' | 'In the edition, not in your file'
  tone: 'audio' | 'need' | 'missing';
  missing?: boolean;
  excerpt?: string;
  options: { id: string; label: string; sub: string; suggested?: boolean; warn?: boolean;
             result?: { name: string; note: string; removed?: boolean } }[];
  allowKeep: boolean; allowRemove: boolean;
  prevName: string; nextName: string;
  allChapters?: { label: string; sub: string }[];   // in-order candidates (optional)
  outOfOrder?: string[];                            // optional
}
interface Edition { id: string; title: string; sub: string; fit: string; fitTone: 'audio'|'need'|'missing'; current?: boolean }
interface Decision { optId: string; name: string; note: string; removed?: boolean }
```

**Actions the page calls.** Map each one to a real endpoint or flag it as missing:

- save decisions
- choose an edition and re-verify
- redraft
- rerun the checks
- cancel the job
- edition search
- fetch a 15s clip
- set the per-book minimum

## 7. Behavior rules (port from `renderVals()` and unit-test each one)

1. **Live status** of a marker:
   - It's an open item: `you` if decided, `missing` if it's a missing chapter, otherwise `need`.
   - It isn't an open item: `you` if decided this visit, otherwise its server status.
2. **After text** (`afterOf`):
   - decided: the decision name, or "Removed";
   - open and undecided: "{suggested}?", or "Not decided";
   - otherwise: the proposed name.
3. **Undecided** = open items without a decision. **Attention count** = undecided + 1 if blocked. **Blocked** = `identifiedByAudio / total * 100` (one decimal) < the current minimum.
4. **Save is disabled** while attention > 0 or the gaps checkbox is unticked. The checkbox only appears once attention reaches 0.
5. **Initial focus** is the first undecided item, falling back to the first open item. Focus is remembered per book.
6. **Decide:** record the decision, keep focus on the same marker, close the editors, set `justDecided`, and push a history line. **Don't move focus.** The next or continue control moves on to the next *undecided* item after the current time, wrapping.
7. **Accept suggestions** applies the suggested option to every undecided, non-missing item that has one. It's offered only when there are two or more. Undo restores the snapshot taken before.
8. **Filters:**
   - Needs you = any open item, decided or not.
   - Changing = not pending and the after text differs from the old name.
   - Unchanged = not pending and the after text equals the old name.
   - All.
   - Non-matching runs fold. Fold expansion state resets whenever the filter changes.
9. **Persistence:** undecided work (decisions, focus, chosen path, minimum override, gaps checkbox, log) is kept **per book in `localStorage`** until it's saved or the job is cancelled or redrafted. Then it's cleared. Switching books never loses it. Wrap all storage access in try/catch.
10. **Send back to the queue** (after save, re-verify, redraft, rerun or cancel):
    - remove the book from the local queue;
    - select the next remaining book;
    - show the toast "{title} went back to the queue" with the action's body text, or "Job cancelled for {title}" when the job was cancelled;
    - scroll the workspace to the top;
    - when nothing remains, show EmptyState.
11. **Minimum stepper** is clamped to 50–100. The "Set to floor" button sets `floor(pct)` and logs the change.

## 8. Visual tokens

These come from the design. If the repo already has a token or theme system, add them there under semantic names. Don't scatter the hex values through components.

| Token | Dark value | Use |
|---|---|---|
| `bg` | `#0F0F0E` | page |
| `surface` | `#171716` | panels, popovers |
| `surface-2` | `#1A1A19` / `#1F1F1D` / `#222220` | options, hover, toasts, pressed |
| `field` | `#141413` | inputs, before/after box |
| `border` | `#292927` | default border |
| `border-strong` | `#3A3A37` | buttons, decided card |
| `text` | `#F4F4F1` | primary text, primary button fill |
| `text-2` | `#CFCFC9` | secondary body |
| `text-muted` | `#9D9D97` | labels, meta |
| `text-dim` | `#5A5A55` | "No change", removed |
| `audio` (confirmed) | `#7FC98C` | green |
| `need` (needs you) | `#E9B34E` | amber; tint bg `#1D1A14` / border `#4A3A18`; banner bg `#2E2513` |
| `missing` (problem) | `#F08A6C` | red; tint bg `#1C1513` / border `#5A2A1A` |
| `confirmed tint` | `#131A14` / `#2B4A33` | confirmed card |

- **Type:** Figtree 400–800. Use the app's existing font loading if Figtree is already there. Otherwise self-host it rather than pulling from Google at runtime.
- **Timestamps** use `font-variant-numeric: tabular-nums`.
- **Radii:** pills 999, cards 18–20, options 14, rows 12, covers 8.
- **Touch targets:** 44px minimum, 48–52px for the phone's primary actions.

**Light mode is required** (the app supports light and dark), but the design is dark only. Derive a light set from the same semantic tokens, keeping the same hue roles and checking 4.5:1 contrast for text. If the app already has a light theme, map onto it. List the light values you chose in MAPPING.md so Jeremy can review them.

## 9. Responsive rules

- **≥1200px:** full desktop. The rail is pinnable, and the list and the 440px decision panel sit side by side.
- **768–1199px:** the rail is collapsed with the hover/tap overlay and pinning is ignored. The decision card moves **above** the list (phone order) while keeping desktop typography.
- **<768px:** phone layout as in the mockup (390 wide). No horizontal page scroll at 360px.

These breakpoints are assumptions. Keep them in one constants file.

## 10. Accessibility (required, not polish)

- Use real `<button>`, `<a>`, `<input>` and `<label>` elements. Never put click handlers on divs.
- `aria-pressed` on chips, options and the pin. `aria-expanded` on collapsibles, folds and the ⋯ menu. `aria-current` on the current queue item. `role="tablist"` and `aria-selected` on the path tabs. `role="radiogroup"` and `aria-checked` on editions.
- Every icon-only button has an `aria-label`. Decorative SVGs have `aria-hidden="true"`.
- Visible focus ring: `outline: 2px solid` the text color, `outline-offset: 2px`.
- Keyboard: the rail expands on `:focus-within`, and Tab order runs rail → header → banner → tabs → brief → chips → list → decision panel → save bar.
- Toasts are `role="status"`.
- `prefers-reduced-motion`: disable the fade-up, the next-button pulse, and the rail and wrapper transitions.

## 11. Motion

| Motion | Spec |
|---|---|
| Content fade-up on change | 300ms, `cubic-bezier(.2,.7,.2,1)`, 6px |
| Rail width | 260ms, `cubic-bezier(.32,.72,0,1)` |
| Rail text reveal | 160ms, 80ms delay |
| Option and button hover | 150–160ms |
| Next button `.hi` pulse | 1.6s, played twice |
| Scroll-to-card / scroll-to-Advanced | `scrollTo({behavior: 'smooth'})` |

Keep it fluid and quiet. No bounces, no gradient washes.

## 12. Testing

Use the repo's existing runners. Add them only if none exist, and say so in the report.

- **Unit (pure logic):** live status, `afterOf`, the attention and blocked math, save gating, the filter predicates, run folding, pin clustering (2.5% and 8% thresholds, the 3–97% clamp, cycling), next and previous wrap, accept-all plus undo, minimum clamping, per-book persistence (including storage that throws). Use the `bedlam` (78 markers, 6 open, 1 missing), `feral` and `carl` (edition) data from `Review.dc.html` as fixtures.
- **Component tests:** DecisionCard renders every variant in `States.dc.html` #1–#5. Choosing an option doesn't move focus and does show Continue. Rename and All chapters replace the options in place. SaveBar gating works.
- **End-to-end (Playwright) at 1440×900 and 390×844:**
  - Decide every item, tick the box, then save. The toast appears and the next book loads.
  - Pin the rail, reload, and it's still pinned. Unpinned, hovering expands it over the content without shifting layout. Collapsed, only covers are visible (assert the header and row text are not visible).
  - An edition-kind book shows the edition picker first, and Save and re-verify stays disabled until another edition is picked.
  - The blocked flow: Change in Advanced → Set to floor → save is enabled once the box is ticked.
  - The phone bottom sheets open and close with Esc, and focus returns to the opener.
- **Accessibility:** run axe on both viewports, in both light and dark themes. Zero serious or critical violations.
- **Visual check:** screenshot both viewports, compare them against `Review.dc.html` by eye, and attach them to the report.

## 13. Deployment

- Use the repo's **existing** build and deploy path: the Docker image and compose or Unraid template, CI workflow, or scripts. Record what you found in MAPPING.md.
- Work on a feature branch (e.g. `feat/needs-review-redesign`) and open a PR containing the summary, MAPPING.md, screenshots and test results.
- Deploy only through the documented path. If there's no documented deploy, or it would push to Jeremy's live Unraid server without a staging step, **stop after the PR and the built image** and say what's needed to deploy. Don't invent a deploy process.
- Don't commit secrets, server paths or tokens.

## 14. Definition of done and report back

Done means all of these are true:

- [ ] MAPPING.md is written: stack, component mapping, data gaps, light-mode values, assumptions.
- [ ] Every component in section 5 is built and wired to real data. Missing optional data hides cleanly.
- [ ] The section 7 rules are implemented as pure, unit-tested functions.
- [ ] Unit, component, e2e and axe tests all pass. Screenshots are attached.
- [ ] Dark and light modes both pass contrast.
- [ ] The PR is open, plus either a deploy through the existing path or a clear note on why it stopped.

The final report must cover:

- what was built,
- the files changed,
- the backend gaps found,
- every assumption made, especially the breakpoints, the light-mode colors and the pin-ignored-below-1200 rule,
- anything in the design you couldn't match and why.
