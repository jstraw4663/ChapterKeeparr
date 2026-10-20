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
```

Use `--chromium /usr/bin/chromium` for an installed system browser, `--interactions-only` while iterating on a workflow, and `--axe /path/to/axe.min.js` for WCAG 2.2 AA checks at 390 and 1024 px. CI supplies the pinned axe-core 4.10.3 script and checks its SHA-256 before use.

The complete run checks nine route states at twelve viewport sizes in both themes, plus consent visibility/style/blockers, failed submissions, changed-draft approval reset, native disclosures, skip-link navigation, cover-rail expansion/Escape, live resize, explicit sidebar preference, form retention and redacted diagnostics. It makes no provider calls or real acceptance writes.

The generated screenshots and JSON report are development evidence. They do not replace physical iPhone/Safari, VoiceOver, desktop screen-reader or native browser zoom validation before release.

The reconciled workflows additionally check ordered chapter choices, inline rename/Change, reload persistence, token invalidation, save handoff, hydrated notification covers and three simultaneous stable notification slots across polling, dismissal and viewport changes. They intercept all writes.

A synthetic 180-marker override also checks the initial 30-card bound, progressive reveal, explicit order override, bulk Undo, first-marker protection, desktop scroll stability, reduced motion, and notification hover/focus pause and resumed expiry.

The synthetic Bedlam workflow exercises decorated and part-prefixed identities, a formerly false automatic Prologue match, current-draft precedence over stale checks, paired titles, filters and editable matched rows in both themes at 390/1024px. Its transcripts are illustrative; real-recording validation requires a populated evidence archive.
