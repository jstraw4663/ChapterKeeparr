import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.version import build_info, stamp_build, UpdateChecker


class VersionTests(unittest.TestCase):
    def test_image_stamping_keeps_api_frontend_and_cache_identity_together(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'static/js').mkdir(parents=True)
            (root / 'build-info.json').write_text('{"version":"0.5.0"}')
            (root / 'static/sw.js').write_text("const CACHE = 'old';")
            environment = {'APP_VERSION': '0.6.0', 'BUILD_CHANNEL': 'release', 'BUILD_REVISION': 'abc123', 'BUILD_DATE': '2026-10-19T12:00:00Z'}
            with patch.dict('os.environ', environment): stamp_build(root)
            info = json.loads((root / 'build-info.json').read_text())
            self.assertEqual(info['version'], '0.6.0')
            self.assertEqual(info['revision'], 'abc123')
            self.assertIn('0.6.0@abc123', (root / 'static/js/assets.js').read_text())
            first = (root / 'static/sw.js').read_text()
            self.assertNotIn("'old'", first)
            with patch.dict('os.environ', {**environment, 'BUILD_REVISION': 'def456'}): stamp_build(root)
            self.assertNotEqual(first, (root / 'static/sw.js').read_text())

    def response(self, tag='v0.6.0', status=200):
        response = MagicMock()
        response.status_code = status
        response.__enter__.return_value = response
        response.iter_content.return_value = [json.dumps({'tag_name': tag, 'prerelease': False, 'draft': False}).encode()]
        return response

    def test_installed_identity_is_factual_and_has_no_model_path(self):
        with patch.dict('os.environ', {'MODEL': '/private/models/custom-model'}):
            info = build_info()
        self.assertEqual(info['model'], 'custom-model')
        self.assertEqual(len(info['frontend_assets']), 16)
        self.assertTrue(info['frontend_version'])
        self.assertNotIn('/private', json.dumps(info))

    def test_manual_check_is_cached_and_compares_release_versions(self):
        for tag, state in [('v0.6.0', 'available'), ('v0.5.0', 'current'), ('v0.4.0', 'ahead')]:
            with self.subTest(tag=tag), patch('app.version.requests.get', return_value=self.response(tag)) as get:
                checker = UpdateChecker({'version': '0.5.0', 'channel': 'release'})
                self.assertEqual(checker.check()['state'], state)
                self.assertEqual(checker.check()['state'], state)
                get.assert_called_once()
                self.assertNotIn('Authorization', get.call_args.kwargs['headers'])

    def test_private_rate_limited_development_and_malformed_results_are_never_current(self):
        for status in [401, 403, 404, 429, 500]:
            with self.subTest(status=status), patch('app.version.requests.get', return_value=self.response(status=status)):
                result = UpdateChecker({'version': '0.5.0', 'channel': 'release'}).check()
                self.assertEqual(result['state'], 'unknown')
                self.assertNotIn('Up to date', result['message'])
        for installed, tag in [({'version': '0.5.0', 'channel': 'development'}, 'v0.5.0'), ({'version': 'branch', 'channel': 'development'}, 'v0.6.0'), ({'version': '0.5.0', 'channel': 'release'}, 'v0.6.0-beta')]:
            with patch('app.version.requests.get', return_value=self.response(tag)):
                self.assertEqual(UpdateChecker(installed).check()['state'], 'unknown')

    def test_failed_requests_stay_unknown(self):
        import requests
        with patch('app.version.requests.get', side_effect=requests.Timeout()):
            self.assertEqual(UpdateChecker({'version': '0.5.0'}).check()['state'], 'unknown')
