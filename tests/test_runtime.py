"""Exercise real speech imports: mocked workflow tests cannot detect missing packages."""
import subprocess
import sys
import unittest


class RuntimeTests(unittest.TestCase):
    def test_speech_dependencies_import_in_fresh_process(self):
        result = subprocess.run(
            [sys.executable, '-c', 'import requests; from faster_whisper import WhisperModel'],
            capture_output=True, text=True, timeout=60,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
