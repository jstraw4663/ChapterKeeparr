"""Exercise real speech imports: mocked workflow tests cannot detect missing packages."""
import subprocess
import sys
import unittest
from pathlib import Path


class RuntimeTests(unittest.TestCase):
    def test_speech_dependencies_import_in_fresh_process(self):
        result = subprocess.run(
            [sys.executable, str(Path(__file__).resolve().parents[1] / 'scripts' / 'check_speech_runtime.py')],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
