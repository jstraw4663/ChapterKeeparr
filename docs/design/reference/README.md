# Reference prototypes

These are the source files of the approved mockups (a design-canvas format). They are **reference, not production code**. Read them for exact layout, copy, spacing, states and interactions.

How to read a `.dc.html` file:
- The markup inside `<x-dc>` is the screen. `{{name}}` is a value computed in the script at the bottom (`renderVals()`); `<sc-for list="{{items}}" as="b">` repeats; `<sc-if value="{{flag}}">` shows conditionally; `onClick="{{handler}}"` binds an event.
- The script at the bottom holds the prototype's sample data (`BASE`, `SUGG`, `TIME`, …) and every interaction (filters, grouping, notifications, confirmations). Sample data is illustrative. Never copy it into the app.
- Styles come from `prototype.css` (scoped under `.ck`; `.ck.dark` is dark theme, `.ck.collapsed` is the collapsed sidebar). Production tokens are in `../tokens.css`.
- Each screen has a desktop file (1440px wide, sidebar shell) and a `-Mobile` file (390×844 phone shell). Desktop files also contain the phone layout behind a `mobile` flag.

| Screen | Desktop | Phone |
|---|---|---|
| Library | `Library.dc.html` | `Library-Mobile.dc.html` |
| Search (open, query "carl") | `Search.dc.html` | `Search-Mobile.dc.html` |
| Suggestions | `Suggestions.dc.html` | `Suggestions-Mobile.dc.html` |
| Queue | `Queue.dc.html` | `Queue-Mobile.dc.html` |
| Needs review | `Review.dc.html` | `Review-Mobile.dc.html` |
| Book (verified) | `Book.dc.html` | `Book-Mobile.dc.html` |
| Book, edit details open | `Book-Edit.dc.html` | `Book-Edit-Mobile.dc.html` |
| New job | `NewJob.dc.html` | `NewJob-Mobile.dc.html` |
| New job, folder browser open | `NewJob-Browse.dc.html` | `NewJob-Browse-Mobile.dc.html` |
| Settings | `Settings.dc.html` | `Settings-Mobile.dc.html` |
| Needs review · chapter draft review (spec: `../CHAPTER_REVIEW.md`) | `ChapterReview.dc.html` | `ChapterReview-Mobile.dc.html` |

Screenshots: if `screens/png/` exists, the PNGs there were exported from the design canvas and show the intended rendering in dark theme.
