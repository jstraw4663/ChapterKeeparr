# UI/UX proposal mockups

These files illustrate the finalized UI/UX plan. They are not loaded by ChapterKeeparr, make no app/API requests, and do not modify audiobooks.

## Preview

From the repository root:

```sh
python -m http.server 8766 --bind 127.0.0.1 --directory docs/plans/mockups
```

Open http://127.0.0.1:8766/ in a browser. Everything needed for the mockup is local, including Figtree and its [OFL license](FONT-LICENSE.txt).

Supported query parameters:
- `view=review` or `view=settings`
- `theme=dark` or `theme=light`
- `rail=expanded`
- `checked=1`

Use the proposal-bar controls to switch theme and view, the book-list button to expand/collapse the cover rail, Escape to close the temporary expanded list, and the consent checkbox to show/hide the white save action.

The demonstrated 34/37 result is below the default 95% minimum. The shown save button remains disabled with an explanation even after it appears. This intentionally distinguishes visibility from authorization. The prototype does not simulate real chapter edits, submissions, network checks or completed saves.

## Captured states

| Image | CSS viewport |
| --- | --- |
| [Desktop compact review](review-desktop-compact.png) | 1440 x 1100 |
| [Windowed compact review](review-windowed-compact.png) | 1024 x 900 |
| [Windowed expanded list](review-windowed-expanded.png) | 1024 x 900 |
| [Mobile unchecked](review-mobile-unchecked.png) | 390 x 1000 |
| [Mobile checked](review-mobile-checked.png) | 390 x 1000 |
| [Desktop About](settings-about-desktop.png) | 1280 x 1000 |
| [Mobile About](settings-about-mobile.png) | 390 x 1000 |

[Preview checks](preview-checks.json) record captured-state widths and save visibility. Visual proposals still require production implementation, full keyboard/accessibility regression testing, and real-device validation.

