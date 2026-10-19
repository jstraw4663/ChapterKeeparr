"""Guards that keep the redesign intact (docs/design/RULES.md).

Runs with the normal suite. The JavaScript checks need Node; they are skipped
when it isn't installed.
"""
import re
import shutil
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
STATIC = ROOT / "app" / "static"
GAPS = ROOT / "docs" / "design" / "GAPS.md"

FRONTEND = [p for p in STATIC.rglob("*") if p.suffix in {".js", ".css", ".html"} and p.is_file()]
HEX = re.compile(r"#[0-9A-Fa-f]{3,8}\b")
RGB = re.compile(r"\b(?:rgba?|hsla?)\(")


class DesignRuleTests(unittest.TestCase):
    def test_colours_only_come_from_tokens(self):
        # tokens.css is the only colour source. books.js holds the generated-cover
        # palette (RULES.md: cover placeholder colours are the one exception).
        allowed = {STATIC / "tokens.css", STATIC / "js" / "books.js"}
        offenders = []
        for path in FRONTEND:
            if path in allowed:
                continue
            text = path.read_text()
            if path.name == "index.html":
                text = re.sub(r"<style>.*?</style>", "", text, flags=re.S)
            for pattern in (HEX, RGB):
                offenders += [f"{path.relative_to(ROOT)}: {m.group(0)}" for m in pattern.finditer(text)]
        self.assertEqual(offenders, [])

    def test_no_legacy_design_left(self):
        legacy = re.compile(r"teal|neon|glow|metric-card|overview-grid|policy-card|current-work|breadcrumb|"
                            r"refresh-button|sidebar-note|jobs-table|workflow-timeline|edition-card|browse-dialog|"
                            r"button-secondary|button-quiet|\bInter\b", re.I)
        hits = [f"{p.relative_to(ROOT)}: {m.group(0)}" for p in FRONTEND for m in legacy.finditer(p.read_text())]
        self.assertEqual(hits, [])
        self.assertFalse((STATIC / "app.js").exists(), "the pre-redesign app.js must stay deleted")

    def test_every_design_gap_is_logged(self):
        logged = set(re.findall(r"^### (G-\d{3})\b", GAPS.read_text(), re.M))
        used = set()
        for path in FRONTEND:
            used |= set(re.findall(r"\bG-\d{3}\b", path.read_text()))
        self.assertTrue(used, "expected DESIGN-GAP references in the frontend")
        self.assertEqual(sorted(used - logged), [], "every G-xxx in the UI needs a row in docs/design/GAPS.md")

    def test_service_worker_caches_every_shell_file(self):
        sw = (STATIC / "sw.js").read_text()
        listed = set(re.findall(r"'(/static/[^']+)'", sw))
        shipped = {"/static/" + str(p.relative_to(STATIC)) for p in STATIC.rglob("*")
                   if p.is_file() and p.suffix in {".js", ".css", ".png", ".svg", ".woff2"} and p.name != "sw.js"}
        self.assertEqual(sorted(shipped - listed), [], "add new frontend files to SHELL in app/static/sw.js")
        self.assertEqual(sorted(listed - shipped), [], "remove deleted files from SHELL in app/static/sw.js")

    def test_index_references_existing_assets(self):
        html = (STATIC / "index.html").read_text()
        for ref in re.findall(r'(?:href|src)="(/static/[^"]+)"', html):
            self.assertTrue((STATIC / ref[len("/static/"):]).is_file(), ref)


@unittest.skipUnless(shutil.which("node"), "Node isn't installed")
class JavaScriptTests(unittest.TestCase):
    def test_syntax(self):
        for path in sorted(STATIC.rglob("*.js")):
            result = subprocess.run(["node", "--check", str(path)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, f"{path}: {result.stderr}")

    def test_unit_tests(self):
        tests = sorted(str(p) for p in (ROOT / "tests" / "js").glob("*.test.mjs"))
        result = subprocess.run(["node", "--test", *tests], capture_output=True, text=True, cwd=ROOT)
        self.assertEqual(result.returncode, 0, result.stdout[-4000:] + result.stderr[-2000:])


if __name__ == "__main__":
    unittest.main()
