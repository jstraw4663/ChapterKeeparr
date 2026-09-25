# Screens

Every screen exists on desktop and phone with the same capabilities. For each one: what it's for, the one primary action, what matters most, and the data the UI needs from the server. Reference prototypes for each are in `reference/screens/` (desktop file + `-Mobile` file).

## Old → new map

| Old screen / element | New home |
|---|---|
| Overview (stat cards, "How it works", "Current work") | **Library**. Stat cards and "How it works" are removed. Current work → sidebar Activity card and Queue |
| Jobs list | **Queue** (all active work + activity log). Needs-review items also get their own **Needs review** screen |
| Job details, awaiting review | **Needs review** detail |
| Job details, complete | **Book** screen |
| "Verification evidence" | Needs review → Chapter checks; Book → Status card → "Chapter check evidence" (collapsed) |
| "Chapter Details" list with play | Book → Chapters, as 15-second spot checks only |
| "Book details" / "Job details" cards | Book → Details (collapsed) and History |
| "Edition attempts" | History entries |
| "Correct book details" form | Needs review → Fix the edition |
| Breadcrumb "Workspace / …" | Removed |
| "Connected" pill + refresh button | Removed from chrome. Connection lives in Settings → Server; failures show the Offline banner |
| "Local-first review" sidebar card | Removed |
| Teal/neon palette, glow borders | Removed. See DESIGN.md tokens |

---

## Library (home)

**Purpose:** see every book and its state; jump to anything that needs you.
**Primary action:** Start reviewing (only when something needs review). Otherwise none; covers are the content.

Order of content:
1. **Waiting banner** (only if ≥1 book needs review): stacked covers of waiting books, "4 books are waiting on you", one line of why, **Start reviewing →**.
2. **Toolbar**: filter tabs (All · Needs attention · Converting · Verified · Optimized, each with a count) · Group (None / Series / Author / Status) · Sort (Series order / Recently updated / Title / Author) · View (Large / Grid / List).
3. Count line: "20 books · grouped by series".
4. **Groups**, each collapsible: chevron, name, count, summary ("Matt Dinniman · 4 need attention · 2 optimized"). Standalone books group last.
5. Items in the chosen view:
   - Large: 4 columns, big covers with pill, series eyebrow, title, one-line status detail.
   - Grid (default): 6 columns at 1440px.
   - List: cover 48 · title + author/status detail · series + number · status pill · chevron.

Phone: title "Library" + count line; banner as a single tappable row ("4 books need you ›"); filter tabs scroll sideways; a sliders icon opens a sheet with Group / Sort / View; Grid = 3 columns, Large = 2 columns, List = rows.

Tapping a book opens: Book (verified/optimized), Needs review (review), Queue (converting/failed).

Needs from server: book list with id, title, author, series, series number, cover URL, status, status detail (reason / step / error), updated time, EPUB present?, source MP3s present?, ASIN. Must scale to hundreds of books (paging or virtualization; group/sort can be client-side up to ~2k items).

## Search

Not a screen; an overlay available everywhere (desktop top bar, phone header). See DESIGN.md → Search. Matches title, author, series, ASIN.

Needs from server: a search endpoint, or the library list cached client-side (fine up to a few thousand books).

## Suggestions

**Purpose:** things in the library folder that are one action away from the goal state (one M4B + one EPUB per book).
**Primary action:** per row. "Convert all N" is the only bulk action.

Header: title, "The goal: one verified M4B and one EPUB, paired, for every book. Nothing changes until you act.", "Last scan …", **Scan again**.
Tabs: All · Convert · Fix chapters · Pair files · No audiobook.

Groups (collapsible, each with an icon tile, title, count, one-line description):
| Group | Detected | Row action | Done state |
|---|---|---|---|
| Ready to convert | Folder with several MP3s and no M4B | **Convert** (queues a job) | Queued |
| Chapters need a fix | M4B with one chapter marker, or chapter times that don't match the edition | **Re-process** | Queued |
| Pair M4B and EPUB | M4B with no EPUB → **Find EPUB in BookOrbit**; EPUB in another folder → **Pair files** | Requested / Paired |
| No audiobook yet | EPUB with no audiobook | **Request in BookOrbit** | Requested |

Every row: cover or initial tile · title · author · what was detected · server path (monospace) · action · × Ignore (removes it from the list; the scan should remember ignores).

Phone: same groups; action becomes a full-width button under the row; × stays on the row; a refresh icon next to the tabs runs a scan.

Needs from server: scan endpoint + results with kind, book identity, path, detail; actions: queue conversion, re-process, pair (move EPUB next to M4B), request in BookOrbit (or deep link), ignore; last-scan time.

## Queue

**Purpose:** everything in progress, everything that needs attention, and a log of everything processed.
**Primary action:** none globally; each item has its own.

1. Title + subtitle, then tabs: All active · Converting · Needs attention (counts).
2. **Converting**: large card per running job. Cover, title, server path, StepTracker, big percentage, live progress bar, **Cancel** (inline confirm: "Stop this job?" Keep / Cancel job).
3. **Needs attention**: failed jobs first (red detail "Failed at step 3 · Check audio", **Error details** disclosure with the converter's output, **Retry**), then books needing review (reason in amber, StepTracker paused at step 2, time, **Review**). "Review all →" links to Needs review.
4. **Up next**: queued jobs, or the empty state "Nothing else is queued" + New job.
5. **Activity** (collapsible, open by default): the global log, newest first, grouped by day, filter chips (All / Verified / Paused / Failed / Your actions), "Show older activity". Each row links to the book.

Phone: same order; converting card has an × that opens the same confirm; failed rows use icon buttons (error details, retry); activity is a collapsible section.

Needs from server: jobs with status, step index + name, percent, path, reason, error output, timestamps; cancel, retry; an activity/event feed (paged) including user actions; live updates (SSE or WebSocket) for progress and status changes.

## Needs review

**Purpose:** decide, one book at a time, what to do with books the server couldn't confirm.
**Primary action:** **Save and re-verify**.

Desktop: list of waiting books on the left (sticky); detail on the right with ↑/↓ to move through them ("1 of 4").
Detail, in order:
1. Header: cover, series eyebrow, title, author · narrators.
2. **Problem** (amber alert): plain-language title and explanation, quick fixes **Try another region** and **Use embedded audiobook ID** (they fill the form and say so), and a **Technical details** disclosure (HTTP code, provider URL, raw error).
3. **Chapter checks** (collapsible, open): timeline of where each check falls in the book (pass = filled green, needs listening = amber ring), then rows: number, chapter, boundary time, Passed/Listen, 15-second spot-check button; expanding a row shows the transcript of what was heard. If checks haven't run: "Chapter checks haven't run yet. They start once the edition is confirmed."
4. **Fix the edition** (collapsible, open): edition search (title or ASIN) with **Use filename** / **Use tags**; fields Title, Author, ASIN, Region, Narrators; a note line when a quick fix changed something; **Cancel job** (inline confirm) and **Save and re-verify**.
5. **History** (collapsible, closed): this book's events.

After Save: the book leaves the list, a "resumed" notification flies to Queue, and the next book opens. When the list is empty: "You're all caught up" + Open queue.

Phone: list screen → detail screen (slides in). Header: back, "1 of 4", ↑/↓, trash icon (Cancel job → confirm sheet). Sections as above, all collapsible. Edition search uses icon buttons for filename/tags. Sticky bar above the tab bar: **Skip** · **Save and re-verify**. FAB hidden.

Needs from server: review items with reason code + human text + technical detail; chapter checks (name, boundary time, pass/fail, transcript excerpt, 15s audio clip URL); edition search endpoint; values from filename and embedded tags; submit corrected details + region → re-verify; cancel job; per-book history.

## Book (verified / optimized)

**Purpose:** confirm the book is right, hand it off, clean up.
**Primary action (depends on state):**
- Source MP3s still on disk → **Clean up source MP3s** (confirm: "Delete the source MP3s? The verified M4B stays."). Secondary: Open in BookOrbit.
- Already clean → **Open in BookOrbit**.
- Always secondary: **Re-verify**, **Edit details**.

There is **no** "Play" or "Play from start". Audio exists only as 15-second spot checks.

Layout (desktop): back link "Library"; hero with cover (220), series eyebrow, title, author · narrator, status pill (Verified/Optimized) + "80 chapters · 6 of 6 checks passed · Saved Sep 23", actions. Then two columns:
- Left: **Chapters** with "Find a chapter" filter, rows with spot-check buttons, "Show all N chapters".
- Right, in this order: **Status** card (title "Optimized" or "Verified · 1 step from optimized", checklist: M4B verified · Chapters aligned · EPUB paired · Source MP3s removed, mini timeline of check points, "Chapter check evidence" collapsed); **Files** (M4B path with copy button, EPUB path, MP3 state); **History** (this book's events); **Details** collapsed (ASIN, narrator, series, region, edition match, chapter-check mode, attempts).

Spot check: tapping a chapter plays 15 seconds from its start, the button shows a countdown ring, and a "Previewing Chapter 3 · 15-second check" bar appears (bottom-right on desktop, above the tab bar on phone). It stops on its own or with ×.

Edit details: modal (desktop) / sheet (phone) with Title, Author, Narrators, Series, Book number, ASIN, Region, and a link "For covers, descriptions and everything else, edit in BookOrbit." Changing ASIN or region triggers re-verification. Save shows a quiet confirmation and adds a History entry.

Phone: back header with Edit (pencil) and "…" (action sheet: Re-verify, Edit details, Open in BookOrbit, Copy file path, Clean up source MP3s). Hero is compact (cover 128 beside title). Primary button full width + icon buttons for Re-verify and BookOrbit. Chapters, Status, Files, History, Details are collapsible; Files and History start closed on phone.

Needs from server: book detail (all fields above), chapter list with start times, 15s clip URL per chapter, chapter-check evidence, file paths, EPUB pairing, MP3 presence; actions: delete source MP3s, re-verify, update metadata (and rewrite tags); BookOrbit base URL (setting) + a deep link per book.

## New job

**Purpose:** start a conversion from a folder that already lives on the server.
**Primary action:** **Start job**.

1. **Source folder**: a button showing the chosen folder's name and path, "Browse". After choosing: "24 MP3 files found · ordered by track number". Note: "Folders are browsed on your server. Nothing is uploaded from this device."
2. **Edition**: Title, Author (pre-filled from folder name/tags), ASIN (optional), Region.
3. **Options** (collapsible; open on desktop, closed on phone with a summary): Chapter checks (Off / Spot checks / Every chapter), Keep source MP3s (switch), Save to (Next to source / Library folder).
4. Desktop side panel: "What happens next" (the four steps), "If anything can't be confirmed, the book pauses in Needs review instead of saving.", **Start job**. Phone: sticky **Start job** bar.

**Folder browser** (modal / sheet): breadcrumbs starting at "Library", folder rows with counts, folders that already have an M4B are disabled, selecting a leaf shows a check, footer shows the selected path and **Use this folder**.

Needs from server: directory listing under the library root (folders, MP3 count, has-M4B flag), metadata guess from a folder, create job with options.

## Settings

Sections (desktop: left sub-nav + cards; phone: grouped lists reached from the gear sheet):
- **Appearance**: Theme (System / Light / Dark), Reduce motion.
- **Library**: Library folder.
- **Conversion defaults**: Chapter checks, Keep source MP3s, Save to.
- **Metadata**: Default region, Metadata provider (read-only).
- **BookOrbit**: address (used by every "Open in BookOrbit" and "Request in BookOrbit"), connection state.
- **Notifications**: Status notifications.
- **Server**: connection status (Connected / Can't reach server), version.

Changes save automatically ("Changes save automatically." under the title).

Needs from server: settings read/write, health check, version.

## Global states

- **Offline**: banner (see DESIGN.md). Show last known data; disable actions that need the server with a tooltip "Needs a connection".
- **Loading**: skeletons in the shape of the content (cover squares, row bars), never spinners in the middle of a page.
- **First run** (not designed yet, see BACKLOG): until then, if no library folder is set, Library shows an empty state linking to Settings → Library.

---

## Implementation notes (2026-09-24)

What changed from the screens above once they met the real server. Gap IDs are in [GAPS.md](GAPS.md).

- **Routes:** `#/` Library, `#/suggestions`, `#/queue` (`?job=<id>` focuses a job), `#/review` and `#/review/<id>`, `#/books/<id>`, `#/new`, `#/settings` and `#/settings/<section>`. Ids are job ids (G-047).
- **Library:** grouped by author until series data exists (G-007). Renders 120 covers at a time and loads more as you scroll (G-008).
- **Queue:** a book in no active list (for example cancelled) opened with `?job=` shows at the top with Retry. Error details show the recorded error; the converter's output needs G-005. Activity combines each job's latest change with this device's own actions (G-010).
- **Needs review:** adds "Finalize with accepted exceptions" (G-029), "Resume checks" for pauses that aren't about the edition, and "Review markers from audio" (G-030). Technical details include timing diagnostics and the server's five checks (G-031, G-032). "Use tags" fills from the file details the server recorded (G-014). Checks from a local-marker draft read "Heard" instead of "Passed". Edition search: search field, a "Fill from" drop-down (Use filename, Use tags) and a Search button. After Save and re-verify, Resume checks or Finalize, the screen returns to the list (`#/review?resumed=<id>`) rather than opening the next book.
- **Book:** "Clean up source MP3s" (G-015), "Open in BookOrbit" (G-021) and saving Edit details (G-018) are disabled with a reason. Re-verify uses retry (G-019). Details adds "Download report (JSON)" (G-041).
- **New job:** a folder holding several books shows a checklist of them and "Start N jobs" (G-033). Edition fields are read-only (G-040). Options add "Process again" (G-037). "Save to" is a fixed line (G-039). Chapter checks drop "Off" (G-038).
- **Suggestions:** partial (G-020). "Chapters need a fix" became "Chapters need a check", listing M4Bs never checked, because wrong chapters can't be detected before a check. Ignore hides a row on this device only.
- **Settings:** adds Access token, the server readout and the accepted-exceptions minimum (G-034 to G-036). Default region and BookOrbit address are disabled (G-023, G-021). Version shows "—" (G-024).
