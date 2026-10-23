# Review browser checks (development only)

Use generated data and disabled workers. Requires Python project dependencies, FFmpeg, Node and a Playwright Chromium installation.

From the repository root:

```sh
python tests/fixtures/ui_seed.py /tmp/ck-review-browser
python tests/fixtures/complex_review.py /tmp/ck-review-browser
CONFIG_DIR=/tmp/ck-review-browser/config WORK_DIR=/tmp/ck-review-browser/work LIBRARY_ROOTS=/tmp/ck-review-browser/library ENABLE_WORKERS=0 python -m uvicorn app.api:create_app --factory --host 127.0.0.1 --port 8791
```

In a second terminal:

```sh
cd tests/browser
npm ci
npx playwright install chromium
node serve.mjs
```

In a third terminal, from tests/browser:

```sh
npm test
```

Alternatively visit http://127.0.0.1:8792/__review-tests and press Run generated-fixture checks. This runs the same fixture assertions and axe matrix without the CLI launcher. Acceptance requests are mocked; the harness must never be pointed at personal or production data. REVIEW_SCREENSHOTS controls CLI artifact output. REVIEW_CHROME=1 selects installed Chrome.

The harness checks both themes at six widths, focus retention, confirmed override/restore, persistence, bulk Undo, decimal minimum, failed/successful acceptance payloads, phone sheet focus return and redraft confirmation. Other recovery submissions and actual audio playback require release smoke checks. See docs/design/needs-review/IMPLEMENTATION.md for validation limits.
