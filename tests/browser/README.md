# UI regression checks

Use a disposable fixture server with workers disabled. Never point these checks at a real audiobook library. Browser writes are intercepted; real save/publication invariants remain covered by the generated-media unittest suite.

```sh
python -m pip install -r requirements-dev.txt -r requirements-browser.txt
python -m playwright install chromium
python tests/fixtures/ui_seed.py /tmp/ck-ui-check
CONFIG_DIR=/tmp/ck-ui-check/config LIBRARY_ROOTS=/tmp/ck-ui-check/library ENABLE_WORKERS=0 python -m uvicorn app.api:create_app --factory --port 8767
```

In another terminal:

```sh
python tests/browser/ui_regression.py --output /tmp/ck-ui-results
python tests/browser/reconciled_workflows.py --output /tmp/ck-ui-results/reconciled
python tests/browser/bedlam_workflow.py --output /tmp/ck-ui-results/bedlam
python tests/browser/match_quality.py --output /tmp/ck-ui-results/quality
```

Use `--chromium /usr/bin/chromium` for an installed system browser, `--interactions-only` while iterating on a workflow, and `--axe /path/to/axe.min.js` for WCAG 2.2 AA checks at 390 and 1024 px. CI supplies the pinned axe-core 4.10.3 script and checks its SHA-256 before use.

The complete run checks nine route states at twelve viewport sizes in both themes, plus consent visibility/style/blockers, failed submissions, changed-draft approval reset, native disclosures, skip-link navigation, cover-rail expansion/Escape, live resize, explicit sidebar preference, form retention and redacted diagnostics. It makes no provider calls or real acceptance writes.

The generated screenshots and JSON report are development evidence. They do not replace physical iPhone/Safari, VoiceOver, desktop screen-reader or native browser zoom validation before release.

The reconciled workflows additionally check ordered chapter choices, inline rename/Change, reload persistence, token invalidation, save handoff, hydrated notification covers and three simultaneous stable notification slots across polling, dismissal and viewport changes. They intercept all writes.

A synthetic 180-marker override also checks the initial 30-card bound, progressive reveal, explicit order override, bulk Undo, first-marker protection, desktop scroll stability, reduced motion, and notification hover/focus pause and resumed expiry.

The synthetic Bedlam workflow exercises decorated and part-prefixed identities, a formerly false automatic Prologue match, current-draft precedence over stale checks, paired titles, filters and editable matched rows in both themes at 320/390/820/1024/1440px. It checks shared unselected suggestions, accepted-title synchronization, stable original audio counts, aligned 44px actions and axe scans at all five sizes. Screenshots disable finite CSS animations to capture settled states; live motion stays covered by reconciled_workflows.py. Its transcripts are illustrative; the actual two-clip validation is documented separately in the Bedlam guide.

## Accessibility snapshots and intermittent failures

Every axe scan goes through `browser_support.audit_accessibility()`: wait for fonts and the route transition, apply a temporary high-specificity timing override, paint the settled state, run all existing WCAG 2/2.1/2.2 A/AA rules once, then remove the override even on failure. No contrast rule, element or assertion is excluded, no palette changes, and no automatic retry is used. The 216-layout snapshots use the same override; live motion, scrolling and notification timers retain normal CSS in the dedicated workflows.

Why the specificity matters: the app's `html[data-motion="reduce"] *` declarations use `!important` and retain 200 ms fades. An ordinary `* { animation-duration:0s!important }` loses the cascade. Rapid viewport changes reveal the Activity card while its text and ancestors fade, so a scan can observe low effective contrast even though the final theme tokens pass. `networkidle` and the route-transition flag do not wait for CSS resize/element fades.

`accessibility_stability.py` runs in CI before the full browser sweep. It repeats the rapid resize sequence three times in each theme, deliberately holds the actual Activity-card fade to reproduce the contrast failure, and verifies the settled scan passes. An isolated static low-contrast document must still fail, and success/failure paths must restore normal CSS. Run it against the disposable server with:

```sh
python tests/browser/accessibility_stability.py --axe /tmp/axe.min.js --output /tmp/ck-ui-results/stability
```

Each scan now stores its complete `*-axe.json` report, including selectors, contrast data and failure summaries. Unexpected failures also save `*-axe-failure.png` to the existing `ui-regression-results` workflow artifact. Files named `expected-negative-*` and `raw-fade-*` are deliberate negative controls; their recorded violations are expected when the script succeeds. Other violations fail the job immediately.

If the test job fails, the dependent image job is skipped and no replacement image is published. Compare the failed/passed run's commit and inspect the first assertion/report, rather than treating repeated workflow runs as a repair. Earlier failures may have a different cause (for example the already-corrected Playwright actionability-scroll baseline).


The synthetic match-quality workflow runs both themes at 320/390/820/1440 px with live motion. It checks 80% original audio -> 100% validated coverage after two eligible choices, Undo, arbitrary-name non-credit, consent/save readiness, empty unselected radios, equal-height wrapping title pairs, change-summary counts and links/Changed filtering, and sequence-warning navigation. All eight contexts receive axe scans when `--axe` is supplied. Only generated fixtures are used and writes are intercepted. The Python suite separately tests server/client scoring parity and a real generated-media save at the combined minimum, with original backups and unchanged AAC. The frontend suite now imports/renders the view as well as parsing JavaScript; ten JS test files run in CI.


`branding.py` checks all four explicit/system preference combinations at 320/390/820/1440px, loads both local Manrope faces, verifies the correct original mark/wordmark and matching Paper/Ink background, and captures the real shell. Browser requests are restricted to local GETs. The full sweep checks Paper save-button color while retaining unchecked/checked consent and readiness checks; match-quality scans cover balanced wrapping under the new font. Updated PWA assets have separate `any` / `maskable` purposes. App branding uses no remote font or image hosts.
