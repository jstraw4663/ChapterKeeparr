# ChapterKeeparr design system

This is the source of truth for how ChapterKeeparr looks, moves and behaves. If code and this file disagree, this file wins until someone updates it on purpose.

- Screen-by-screen behavior: [SCREENS.md](SCREENS.md)
- Short rules every agent must follow: [RULES.md](RULES.md)
- Known gaps between design and build: [GAPS.md](GAPS.md)
- Reference prototypes (source of the mockups): [reference/](reference/)

---

## 1. What the app is

ChapterKeeparr is a **front end** for a service on a home server. The server converts folders of MP3s into one M4B with chapters, matches the book to a published edition, and verifies chapter boundaries against the audio. The app lets one person watch that work, decide on anything that can't be confirmed, and keep the library tidy.

It is **not** a media player and **not** a metadata manager.
- Audio playback exists only as a **15-second spot check** of a chapter boundary.
- Deep metadata editing lives in **BookOrbit**. ChapterKeeparr links out to it.
- Nothing is uploaded from the device. Every path is a path on the server.

The goal state for every book: **one verified M4B and one EPUB, paired in the same folder, with source MP3s removed.** The app calls that **Optimized**.

## 2. Principles

1. **Covers carry the color. The UI is ink on paper.** No brand hue in the chrome. Status is the only other color.
2. **One primary action per screen.** Everything else is a ghost or icon button.
3. **Status is words first, color second.** Every colored dot has a text label next to it.
4. **Motion has a job.** It explains where something came from or went. Nothing loops for decoration (the only loops are "work is happening" indicators).
5. **Honest states.** Never show invented numbers. Unknown values are `—` or a clearly marked placeholder.
6. **Nothing is saved until it's verified,** and the UI says so wherever a user commits an action.
7. **Mobile is fully capable.** Anything you can do on desktop you can do on a phone. Density changes, capability doesn't.

## 3. Tokens

All color comes from CSS custom properties. Components never use raw hex values except for cover art and the on-cover status pills (which sit on arbitrary artwork and so use fixed light values).

Theme is set on the root element: `data-theme="light" | "dark"`, resolved from the user setting `system | light | dark` (system follows `prefers-color-scheme`). Theme changes cross-fade: `background-color`, `border-color`, `color` transition 0.45s ease.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#FAFAF8` | `#0F0F0E` | Page background |
| `--surface` | `#FFFFFF` | `#171716` | Panels, cards, sheets, inputs' container |
| `--raised` | `#F2F2EF` | `#1F1F1D` | Selected nav item, segmented control track, activity card |
| `--ink` | `#121211` | `#F4F4F1` | Text, primary icons |
| `--muted` | `#62625D` | `#9D9D97` | Secondary text (passes 4.5:1 on `--bg` and `--surface`) |
| `--line` | `#E5E5E0` | `#292927` | Borders, dividers |
| `--hover` | `#EFEFEB` | `#222220` | Hover fill |
| `--track` | `#E3E3DE` | `#2C2C2A` | Progress tracks, switch off state, empty dots |
| `--field` | `#FBFBF9` | `#141413` | Text input fill |
| `--primary` | `#121211` | `#F4F4F1` | Primary button fill (ink) |
| `--primary-ink` | `#FFFFFF` | `#0F0F0E` | Primary button text |
| `--warn` | `#8F5E00` | `#E9B34E` | Needs review, paused |
| `--warn-bg` | `#F7EACB` | `#2E2513` | Review alert background, review badge |
| `--warn-line` | `#EAD3A0` | `#4A3A18` | Review alert border |
| `--ok` | `#2B6A39` | `#7FC98C` | Verified, optimized, passed |
| `--ok-bg` | `#E2EFE4` | `#16291B` | Success chips |
| `--bad` | `#B23A1C` | `#F08A6C` | Failed, destructive |
| `--bad-bg` | `#FBE4DC` | `#33180F` | Failed background |
| `--shadow` | `0 16px 40px rgba(0,0,0,.14)` | `0 20px 50px rgba(0,0,0,.6)` | Floating things only (toasts, sheets, hovered covers) |
| `--bar` | `rgba(250,250,248,.88)` | `rgba(15,15,14,.86)` | Blurred mobile header / tab bar (`backdrop-filter: blur(16px)`) |
| `--ease` | `cubic-bezier(.32,.72,0,1)` | same | Layout motion (sidebar, sheets, morphs) |

A ready-to-use file is in [tokens.css](tokens.css).

### Status vocabulary

These are the only statuses. Use these exact words.

| Status | Label | Dot | Meaning |
|---|---|---|---|
| `queued` | Queued | `--muted` | Waiting for the converter |
| `converting` | Converting | `--ink` (pulsing) | Running. Always shows step `n of 4` and a percentage |
| `review` | Needs review | `--warn` | Paused for a human decision. Always shows the reason |
| `failed` | Failed | `--bad` | Stopped with an error. Always shows the step it failed at and offers Retry |
| `verified` | Verified | `--ok` (light) | M4B saved and all chapter checks passed |
| `optimized` | Optimized | `--ok` | Verified **and** EPUB paired **and** source MP3s removed |
| `cancelled` | Cancelled | `--muted` | Stopped by the user. Source files untouched |

The four job steps, always in this order and with these names: **Inspect → Match edition → Check audio → Save**.

On-cover status pills (they sit on artwork, so they use fixed colors, not tokens):

| Status | Background | Text | Dot |
|---|---|---|---|
| Needs review | `#FFF6E3` | `#6B4500` | `#C98A12` |
| Converting | `rgba(255,255,255,.92)` | `#121211` | `#121211` |
| Failed | `#FDE7E0` | `#8A2A12` | `#C4451E` |
| Verified | `rgba(255,255,255,.92)` | `#1F5A2D` | `#7FA88A` |
| Optimized | `#E4F2E6` | `#1F5A2D` | `#2B6A39` |

## 4. Typography

One family: **Figtree** (Google Fonts, variable weight 300–900). Fallback: `ui-sans-serif, system-ui, -apple-system, sans-serif`. Numbers that change or align (times, percentages, counts) use `font-variant-numeric: tabular-nums`.

| Role | Desktop | Phone | Weight | Tracking |
|---|---|---|---|---|
| Page title (h1) | 40px / 1.05 | 30px | 800 | -0.03em |
| Book title on book page | 48px / 1.02 | 26px | 800 | -0.035em |
| Section title (h2) | 18–20px | 16–17px | 750 | -0.015em |
| Card / row title | 15–16px | 14–15px | 650–700 | 0 |
| Body | 15px / 1.5 | 14–15px | 400–500 | 0 |
| Meta | 13px | 12–13px | 400–600 | 0 |
| Eyebrow | 12px caps | 11px caps | 700 | 0.08em |
| Badge | 11–12px | 11px | 750 | 0 |

No other typefaces. No Inter, Roboto, Arial.

## 5. Space, shape, size

- Base unit 4px. Common gaps: 8, 12, 14, 16, 20, 24, 28.
- Desktop main content padding: `24px 48px 48px`. Sections are separated by 28px.
- Phone gutters: 16px (content) / 20px (titles).
- Radii: panel 20 · large cover 14 · grid cover 12 · list cover 8–10 · input 12 · segmented 12 (inner 9) · sheet top 26 · pills and buttons 999.
- **Touch targets are at least 44×44px** everywhere (desktop too). Icon-only buttons have an `aria-label`.
- Panels: `--surface` fill, 1px `--line` border, radius 20, no shadow. Shadow is only for things that float.

## 6. Layout

### Breakpoints
| Width | Shell |
|---|---|
| ≥ 1024px | Desktop shell, sidebar expanded by default |
| 768–1023px | Desktop shell, sidebar collapsed by default |
| < 768px | Mobile shell |

The mockups are drawn at 1440px and 390px. Between those, keep the structure and let grids reflow (library grid: 6 columns at 1440 → fewer as width shrinks).

### Desktop shell
- **Sidebar** 248px, collapses to a 76px icon rail (width transition 0.55s `--ease`; labels fade out, 0.25s). The collapse control is the last item at the bottom of the sidebar.
- **Nav order:** Library · Suggestions · Queue · Needs review · New job · Settings.
  - Suggestions badge: neutral, count of open suggestions.
  - Queue badge: neutral, count of active jobs (converting + needs review + failed).
  - Needs review badge: amber, count of books waiting for a decision.
  - In the collapsed rail, badges shrink to 18px and sit on the icon's top-right.
- **Activity card** sits at the bottom of the expanded sidebar: the converting book's cover, title, step text and progress bar. When the sidebar collapses, the card shrinks and flies into the Queue icon, and a thin progress ring appears around that icon instead.
- **Top bar** (inside main): search on the left, **New job** primary button on the right.
- Main content scrolls independently; the sidebar does not scroll.

### Mobile shell
- **Header** (60px, fixed, blurred `--bar`): logo + "ChapterKeeparr" wordmark, a search icon, a settings gear. Detail screens replace it with a back button header.
- **Search** expands out of the search icon: the wordmark collapses and the logo scales to 0.8, the field grows across the header, a Cancel button appears, and results cover the screen below the header.
- **Gear** opens a bottom sheet: Appearance (System / Light / Dark), Status notifications switch, and "All settings ›". Theme lives in Settings only; there is no theme toggle anywhere else.
- **Tab bar** (fixed, blurred): **Suggestions · Library · Queue · Needs review**. Queue shows the active count and a progress ring while converting; Needs review shows the amber count.
- **New job** is a floating round button (58px, bottom-right, above the tab bar). It hides while searching and on detail screens.
- Sheets slide up from the bottom (0.5s), with a grab handle and a scrim that closes them.
- Respect safe areas: pad the tab bar and FAB with `env(safe-area-inset-bottom)`.

## 7. Motion

Durations and curves are part of the design. Keep them.

| Moment | Spec |
|---|---|
| Page/section entrance | Fade + rise 16px, 0.7s `cubic-bezier(.2,.7,.2,1)`. Lists stagger 30–60ms per item, capped at 0.8s total |
| Cover hover | `translateY(-5px) scale(1.03)` + `--shadow`, 0.45s. On touch: press scales to 0.96 |
| Sidebar collapse | Width 0.55s `--ease`; labels fade 0.25s (delayed 0.2s on expand) |
| Activity card → Queue icon | Transform to the icon's position at scale 0.08 + fade, 0.6s `--ease` |
| Progress bar | Grows from 0 over 1.4s on first show; while live, a soft highlight sweeps across every 2s |
| Current step dot | Opacity pulse 1.6s, infinite, while converting |
| Theme switch | Colors cross-fade 0.45s |
| Search dropdown / results | Drop in: fade + `translateY(-8px) scale(.98)` → none, 0.28s |
| Mobile search expand | Field width 0.45s `--ease`; wordmark collapses; logo scales to 0.8 |
| Bottom sheet | Slide up 0.5s `cubic-bezier(.2,.9,.2,1)`; scrim fades 0.3s |
| Modal | Fade + scale .97→1, 0.4s |
| FAB entrance | Scale .4→1 with a quarter turn, 0.6s spring `cubic-bezier(.3,1.3,.5,1)` |
| Disclosure | Chevron rotates 90° (0.35s `--ease`); content fades down 6px, 0.35s |
| Chapter spot check | 15s countdown ring on the button; preview bar with 15s progress line; stops by itself |
| Row leaving (ignored suggestion) | Fade + slide right 24px, 0.35s |

**Notifications** have their own choreography, see section 9.

**Reduced motion:** when `prefers-reduced-motion: reduce` or the "Reduce motion" setting is on, replace every translate/scale/fly animation with a 0.2s opacity fade, and stop all looping indicators except the progress percentage text.

## 8. Components

Build these once and reuse them. Names are suggestions; match the codebase's conventions.

**Buttons**
- `Primary`: ink fill, 44px tall, pill, 15px/700. One per screen region.
- `Ghost`: transparent, 1px `--line` border, pill.
- `IconButton`: 44×44, round, `aria-label` required.
- `Destructive confirm`: never a one-click delete. First click turns the control into an inline "Are you sure?" row (or a sheet on phone) with **Keep** and a `--bad`-colored confirm.

**Inputs**
- `Field`: 46px, radius 12, `--field` fill, label above in 13px `--muted`. Focus: 2px `--ink` outline.
- `Select` (pill style for toolbars): 40px, pill, custom chevron.
- `Switch`: 48×28 track, 22px knob, `role="switch"`, hit area extended to 44px.
- `SegmentedControl`: `--raised` track, selected segment is `--surface` with a soft shadow.
- `Tabs`: text tabs with a 2px `--ink` underline for the active one, count in `--muted` after the label.

**Search**
- Desktop: field in the top bar with a `/` shortcut hint. Dropdown (540px) shows up to 7 results: books matched by title (matched text bold), author or ASIN, then series rows. Empty query shows "Recent". ↑/↓ moves, Enter opens, Esc closes. Footer shows those key hints.
- Phone: the expanding header field described in the shell, full-screen results, "Jump to" shortcuts (Needs review, Suggestions) when empty.
- A result opens the book's screen for its status: verified/optimized → Book, needs review → Needs review detail, converting/failed → Queue.

**Cover**
- Square. Real cover art when available. Without art: a flat muted color derived from the book id, a large faint numeral (series number, or first letter of the title), and the title in white 800.
- Status pill top-left (desktop sizes), or a small status dot on tiny phone covers.
- A converting book shows a 4px white progress bar along the cover's bottom edge.

**Status pill / badge / dot**: see the status table. Pills always include the label.

**StepTracker**: 4 dots on a line with labels under each. Done = filled ink; current = ink ring + pulse; paused = filled `--warn`; todo = `--track` ring. The line fills to the current step (`--ink` while converting, `--warn` when paused).

**Panel**: section container (see Space). **Collapsible** is a panel whose header is a full-width button with a rotating chevron, title, optional count and a right-aligned summary; `aria-expanded` set.

**Notification** (toast): see section 9.

**ActivityCard** (sidebar): see shell.

**Sheet** (phone) and **Modal** (desktop): same content, different container. Edit details and the folder browser use a modal on desktop and a sheet on phone.

**ActionSheet** (phone "…" menu): full-width rows, 56px, icon + label, destructive rows in `--bad`.

**LogRow**: time · status icon in a 28px tinted circle (check / ! / × / play / person) · text + detail. Used for the global activity log and per-book history.

**Checklist** (book status): 22px circles, filled `--ok` with a check when done, empty ring when not, label and a right-aligned note.

**ChapterRow**: preview button (44px) · chapter name · start time (tabular). The playing row gets `--raised` fill and a countdown ring.

**FolderRow** (folder browser): folder icon tile · name · meta ("12 folders", "24 MP3 files", "Already has an M4B" = disabled) · chevron for folders, check for the selected one.

**OfflineBanner**: floating pill at the top of main (desktop) or under the header (phone): pulsing `--bad` dot, "Can't reach the server. Showing the last known state.", **Retry now**.

**Empty states**: dashed 1.5px `--line` box, one sentence, one action if there is one. Examples: "Nothing else is queued" → New job; "You're all caught up" → Open queue; "Your library looks tidy."

**Icons**: one set, 24px grid, 1.8px stroke, round caps and joins, `currentColor`. Use Lucide if the project already has it or can add it; otherwise inline SVGs matching that spec. No emoji anywhere in the UI.

## 9. Notifications

Status changes from the server surface as short notifications that never stay on screen.

1. **Arrive**
   - Desktop, sidebar expanded: the note unfolds out from just under the Settings item in the sidebar (clip reveal + 16px drop, 0.6s).
   - Desktop, sidebar collapsed: floats in at the bottom-left of main (rise 28px + fade, 0.55s).
   - Phone: floats in above the tab bar and FAB.
2. **Hold** for 6 seconds of visible, unattended time. Hover, keyboard focus, scrolling the panel, a hidden tab or a clipped card pauses its timer. A thin line along the bottom shows time left. Up to three cards occupy fixed slots; later events wait (bounded at 100), with an overflow count. Dismissal refills the same slot without moving the other cards. Polling preserves card nodes and timers. Small screens scroll the panel above navigation and the review save bar.
3. **Minimize**: the note shrinks and flies into its destination badge (0.72s, `cubic-bezier(.55,0,.25,1)`), then the badge pops (scale 1.7 → 0.9 → 1, 0.55s) with a halo ring (0.7s).
   - "Needs review" notes go to the **Needs review** badge.
   - Everything else about a job goes to the **Queue** badge.
   - Confirmations of the user's own actions (details saved, MP3s removed, job cancelled) have no destination: they shrink in place and fade.
4. Clicking × minimizes immediately (same animation).
5. Every notification is also written to the **Activity** log (Queue page), and job events to that book's **History**.

Content: authenticated book cover thumbnail, hydrated when the card arrives, with a small status icon, one-line title ("A Parade of Horribles needs review"), one-line detail, and an action link (Review / Watch / Open) when there's somewhere useful to go. Notifications respect the "Status notifications" setting; when it's off, events still go to the log and badges still update.

## 10. Accessibility

- Real elements only: `<button>`, `<a href>`, `<input>` + `<label>`. No clickable divs.
- Text contrast 4.5:1 (3:1 for 24px+). The tokens above pass; don't introduce lighter greys.
- Status never relies on color alone (labels, icons).
- Focus is always visible (2px `--ink` outline, offset 2–6px).
- Notifications use `role="status"` and `aria-live="polite"`; the offline banner uses `role="alert"`.
- Sheets and modals trap focus, close on Esc and scrim tap, and return focus to the trigger.
- Keyboard: `/` focuses search; search results are a listbox with `aria-selected`.

## 11. Copy

- Plain, calm, specific. Say what happened and what the user can do: "We couldn't confirm this edition" + "Try another region".
- Hide technical detail behind a "Technical details" disclosure (HTTP codes, URLs, raw errors).
- Sentence case everywhere. No exclamation marks. No "Oops".
- Say "source MP3s", "M4B", "EPUB", "edition", "chapter checks", "spot check". Don't say "job ID" in primary UI (it belongs in details).

---

## 12. Implementation notes (2026-09-24)

Changes made while building the redesign against the real server, one line each with the reason. Decisions still open are in [FOLLOW_UPS.md](FOLLOW_UPS.md).

- **Tokens live in `app/static/tokens.css`** (`docs/design/tokens.css` is a symlink to it). Added tokens for the shadows, scrim, knob and on-cover colours used by components, so no raw colour exists outside tokens.css and the cover palette in `js/books.js`. On-cover pill colours (§3) are now `--cp-*` tokens.
- **Figtree loads from Google Fonts** for now (G-045). Self-hosting is possible since the static route was widened (G-027).
- **Routes are hash routes** (`#/books/<id>`), because the server only serves `/` (G-028). Old hashes redirect.
- **The step tracker keeps 4 dots**, but the current "Check audio" step always names its sub-check ("timing" from the server's Align gate or "speech" from Verify), and the five server gates plus evidence grades are shown under "Checks the server ran". Reason: AGENTS.md requires timing compatibility and speech verification to stay distinct (G-031). Compact trackers in rows omit the sub-check label to fit.
- **Chapter checks offer Spot checks and Every chapter only.** "Off" was removed because publication requires passing speech checks (G-038).
- **Needs review has an extra collapsible, "Finalize with accepted exceptions"**, between Chapter checks and Fix the edition, shown only when the server offers a recovery acceptance preview. It keeps every explicit consent from the previous UI (G-029). "Resume checks" is the Problem panel's action for non-edition pauses, and "Review markers from audio" sits next to "Save and re-verify" (G-030).
- **The spot-check preview bar has a "Play to chapter end" button.** It preserves the pre-redesign full-chapter playback until the removal is approved (G-048). Default behaviour is the 15-second check.
- **Notifications** follow §9. Events come from polling diffs (G-003). An own action that causes a status change is announced once, not twice.
- **Search** matches title, ASIN, author, narrator and series; a series result opens the Library filtered to that series.
- **Library defaults to grouping by author** while the server has no series data (G-007); the Group: Series option still works and explains the gap.
- **Icons** are an inline SVG set in `js/icons.js` (the prototype's paths), with no icon dependency.
- **Updates patch the page in place** (`js/morph.js`). Only a route change renders a screen fresh with its entrance; polling and local changes update just what changed, so covers, progress bars and animations don't restart. Screens must not add listeners in `mount()` with `addEventListener` on elements that survive re-renders; assign `onkeydown`/`onchange` instead. (2026-09-25)
- **Navigation uses the View Transitions API** (`js/transitions.js`; Safari/iOS 18+, Chrome 111+, Firefox 144+). The old page stays on screen until the new one is ready, so there is no blank frame. Top-level tabs slide left or right by their order; opening a detail pushes in from the right and back reverses; changes within a screen (another review item, a settings section) patch in place with a short crossfade. The tapped book's cover and title morph into the next screen (`data-vt-cover` / `data-vt-title`, named only for the duration of the transition). The sidebar, phone header, tab bar and FAB are named so they hold still. Per-element entrance animations (§7 "Page/section entrance") now play only on first load. Reduced motion gets a 0.2s fade; browsers without the API get a short fade. Tabs, segmented controls and the phone tab bar have one sliding "ink" each (`syncInks()`, `syncTabbarInk()`). Tabs and lists restore their scroll position when you return; details open at the top. Pressing a link to a book starts its data requests (`prefetch(route)` on Book and Needs review). Reason: every tap re-built the page from invisible, which read as a flash. (2026-09-25)
- **Each book is in one bucket.** Queue = converting + queued (its badge counts only those); Needs review = paused for a decision; failed jobs sit in the Queue's "Didn't finish" section with Retry and don't count toward the badge. The Queue's filter tabs were replaced by a sticky Queue · Activity jump bar. Reason: resuming a review should visibly move a book from one count to the other. (2026-09-25)
- **Phone tab bar marks the current tab with a pill behind the icon** and a bolder label, not colour alone. (2026-09-25)
- **Needs review detail is organised as What happened → What to do next → Evidence.** "What happened" is plain language per pause reason with the key facts (edition, checks passed); the server's sentence, technical details, timing diagnostics and gates sit under one "Details from the server" link. "What to do next" is a short list of exclusive choices (`choices()`), each with a one-line explanation and one button: for chapter timing, Draft chapters from the audio / Choose a different edition / Run the checks again, and once a draft is ready, Save using the draft first (the accepted-exceptions form, all consents kept). Chapter checks and History are collapsed under Evidence. The phone's sticky Skip / Save bar is gone; Cancel job is the header's trash button on both layouts. Reason: the previous layout showed up to seven buttons at once with no order, and the chapter-recovery steps looked like alternatives rather than a sequence. (2026-09-25)
- **Edition search has an explicit Search button and a "Fill from" drop-down** (Use filename, Use tags) instead of two chips; icon-only on phone. It uses the shared `menuButton()`. (2026-09-25)
- **Sending a book back from Needs review opens the next book** (CHAPTER_REVIEW.md §6). Accept and save, Save and re-verify, Resume checks and Finalize show "<Title> went back to the queue" with **Open queue** (opens that book in the Queue; on phone the whole notification is tappable; it flies into the Queue badge as usual). The current book fades out (180ms, up 6px), the next book in Needs review opens in place and scroll glides to the top; with none left, "Nothing left to review" with Open queue. Reduced motion skips the fade. Supersedes the 2026-09-25 "returns to the list" rule. (2026-10-03)

## 13. Component index

| Component (§8) | File | Function / class |
|---|---|---|
| Tokens | `app/static/tokens.css` | custom properties |
| Button (primary / ghost / danger / warn / chip) | `app/static/js/ui.js` | `button()` · `.btn`, `.btn-primary` |
| IconButton | `app/static/js/ui.js` | `iconButton()` · `.icb` |
| Exclusive choices (What to do next) | `app/static/js/ui.js` | `choices()` · `.choice`, `.choicehead` |
| Drop-down menu | `app/static/js/ui.js` | `menuButton()` · `.menu`, `.menuitem` (open state in `ui.menu`; closing in `main.js`) |
| Destructive confirm (desktop row / phone sheet) | `app/static/js/ui.js`, `app/static/js/overlay.js` | `confirmRow()`, `confirmSheet()` |
| Field, Select | `app/static/js/ui.js` | `field()`, `selectField()` · `.fld`, `.sel` |
| Switch | `app/static/js/ui.js` | `toggle()` · `.switch` |
| SegmentedControl | `app/static/js/ui.js` | `segmented()` · `.segctl` |
| Tabs | `app/static/js/ui.js` | `tabs()` · `.tabs` |
| StatusPill, status line, dot | `app/static/js/ui.js` | `statusPill()`, `statusLine()` · `.pill`, `.dot` |
| On-cover pill / dot | `app/static/js/ui.js` | `cover({ pill, dot })` · `.cpill`, `.cdot` |
| Badge (nav, tab bar) | `app/static/js/shell.js` | `.nbadge`, `.pbadge` |
| Cover (art or generated) | `app/static/js/ui.js`, `app/static/js/covers.js` | `cover()`, `hydrateCovers()` |
| StepTracker | `app/static/js/ui.js` | `stepTracker()` · `.steps` |
| Progress bar | `app/static/js/ui.js` | `progressBar()` · `.bar` |
| Panel, Collapsible | `app/static/js/ui.js` | `collapsible()` · `.panel`, `.gh` |
| Sheet, Modal | `app/static/js/overlay.js` | `open()`, `head()` |
| ActionSheet | `app/static/js/overlay.js` | `actionSheet()` · `.actrow` |
| LogRow, History list | `app/static/js/ui.js` | `logRow()`, `historyList()` |
| Checklist | `app/static/js/ui.js` | `checklistRow()` · `.chk` |
| ChapterRow + spot check | `app/static/js/ui.js`, `app/static/js/audio.js`, `app/static/js/player.js` | `spotButton()`, `playChapter()`, `playerBar()` |
| Chapter-check rows, timeline, gates | `app/static/js/screens/evidence.js` | `checkRows()`, `checkTimeline()`, `gatesDetail()` |
| FolderRow, folder browser | `app/static/js/screens/newjob.js` | `openBrowser()` · `.fbrow` |
| OfflineBanner | `app/static/js/shell.js` | `.offline`, `.moffline` |
| EmptyState | `app/static/js/ui.js` | `emptyState()` · `.empty` |
| Skeleton | `app/static/js/ui.js` | `skeletonRows()`, `skeletonGrid()` |
| Notification | `app/static/js/notify.js` | `notify()` · `.note-card` |
| ActivityCard, sidebar, top bar, phone header, tab bar, FAB | `app/static/js/shell.js` | `shellMarkup()`, `updateShell()` |
| Search overlay | `app/static/js/shell.js`, `app/static/js/search.js` | `searchLibrary()` |
| Screen transitions, sliding ink | `app/static/js/transitions.js` | `transition()`, `kindOf()`, `syncInks()`, `syncTabbarInk()` |
| In-place re-render | `app/static/js/morph.js` | `morphInto()` |
| Status model adapter | `app/static/js/status.js` | `toStatus()` |
| Book derivation, grouping, sorting | `app/static/js/books.js` | `deriveLibrary()`, `groupBooks()`, `sortBooks()` |
| Notification destinations | `app/static/js/events.js` | `destinationFor()`, `diffJobs()` |
| Icons | `app/static/js/icons.js` | `icon()`, `logo()` |


## Responsive workspace refinement (2026-10-19)

The approved UI/UX plan in `docs/plans/ui-ux-optimization.md` extends the existing design. Selecting a review book collapses its list to an 80px cover rail. A separate accessible expand button overlays the readable title list; pointer/focus previews and Escape supplement it. When the workspace is too narrow for a useful detail pane, the compact covers move to a horizontal row. Phones retain list/detail navigation. Review navigation occupies its own row above the cover/title metadata.

Gap consent controls visibility of Accept and save: unchecked hides it completely, checked shows the named white review-save variant in both themes. A dashed border and nearby explanation distinguish a blocked white action. The full acceptance predicate, current draft token and server fingerprint/publication checks still govern authorization. No threshold is changed automatically.

Shared interactive targets use 44px minimums. Container queries adapt Library tools, New job, Settings, book metadata and review headers to available workspace width. An explicit sidebar preference is retained; the automatic mode adapts during resizing. Hidden activity cards are inert. Native disclosure state, focus, form values and previews survive ordinary updates; resizing across the phone breakpoint does not navigate or stop playback.

Settings adds About and updates. Build metadata comes from the server’s embedded build identity, while this tab has its own shipped asset marker. Update checks are manual and read-only. Waiting service workers never force a reload of unsaved review work. Figtree is bundled locally under the OFL license.
