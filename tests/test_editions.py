"""Edition lookup uses bounded provider results and exposes no unguarded API."""

import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

from fastapi.testclient import TestClient

from app import editions, engine
from app.api import create_app
from app.db import Store


class EditionSearchTests(unittest.TestCase):
    def test_text_search_uses_bounded_query_and_normalizes_cards(self):
        provider_book = {
            "asin": "B123456789",
            "title": "The Chain",
            "authors": [{"name": "Adrian McKinty"}],
            "narrators": [{"name": "January LaVoy"}],
            "runtimeLengthMin": 630,
            "language": "english",
            "publisherName": "Hachette Audio",
            "formatType": "unabridged",
        }
        with patch("app.engine.get_json", return_value=[provider_book]) as request:
            cards = editions.search("The Chain", "us")
        url = urlsplit(request.call_args.args[0])
        self.assertEqual((url.scheme, url.netloc, url.path), ("https", "libexdb.com", "/search"))
        self.assertEqual(parse_qs(url.query), {
            "keywords": ["The Chain"], "region": ["us"], "limit": ["20"]
        })
        self.assertEqual(cards, [{
            "asin": "B123456789", "title": "The Chain", "subtitle": "",
            "authors": [{"name": "Adrian McKinty"}],
            "narrators": [{"name": "January LaVoy"}],
            "runtime_length_min": 630, "language": "english",
            "publisher_name": "Hachette Audio", "cover_url": None, "format": "unabridged", "region": "us",
        }])

    def test_ten_letter_title_is_not_treated_as_asin(self):
        with patch("app.engine.get_json", return_value=[]) as request:
            editions.search("Foundation", "us")
        self.assertIn("keywords=Foundation", request.call_args_list[0].args[0])
        self.assertEqual(request.call_count, 2)

    def test_asin_lookup_uses_audnex_and_invalid_payload_needs_review(self):
        with patch("app.engine.get_json", return_value={"asin": "B123456789", "title": "The Chain"}) as request:
            cards = editions.search("b123456789", "uk")
        self.assertEqual(request.call_args.args[0], "https://api.audnex.us/books/B123456789?region=uk")
        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["asin"], "B123456789")
        self.assertEqual(cards[0]["region"], "uk")
        with patch("app.engine.get_json", return_value={"unexpected": "shape"}):
            with self.assertRaises(engine.NeedsReview):
                editions.search("b123456789", "uk")
        with patch("app.engine.get_json", side_effect=ValueError("invalid JSON")):
            with self.assertRaises(engine.NeedsReview):
                editions.search("The Chain", "uk")


class EditionApiTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        environment = patch.dict(os.environ, {
            "LIBRARY_ROOTS": str(Path(temporary.name)),
            "CHAPTERKEEPER_API_TOKEN": "edition-token",
            "ENABLE_WORKERS": "0",
        })
        environment.start()
        self.addCleanup(environment.stop)
        self.client = TestClient(create_app(Store(Path(temporary.name) / "jobs.sqlite3")))
        self.headers = {"Authorization": "Bearer edition-token"}

    def test_auth_validation_and_provider_failure(self):
        self.assertEqual(self.client.get("/api/editions", params={"query": "The Chain"}).status_code, 401)
        for query in ("a", "a" * 201):
            response = self.client.get("/api/editions", params={"query": query}, headers=self.headers)
            self.assertEqual(response.status_code, 422)
        response = self.client.get(
            "/api/editions", params={"query": "The Chain", "region": "xx"}, headers=self.headers
        )
        self.assertEqual(response.status_code, 422)
        with patch("app.editions.search", side_effect=engine.NeedsReview("Provider unavailable")):
            response = self.client.get(
                "/api/editions", params={"query": "The Chain", "region": "us"}, headers=self.headers
            )
        self.assertEqual(response.status_code, 503)

    def test_success_returns_normalized_cards(self):
        cards = [{"asin": "B123456789", "title": "The Chain", "region": "us"}]
        with patch("app.editions.search", return_value=cards) as search:
            response = self.client.get(
                "/api/editions", params={"query": "The Chain", "region": "us"}, headers=self.headers
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"editions": cards, "region": "us"})
        search.assert_called_once_with("The Chain", "us")

class PwaTests(unittest.TestCase):
    def test_shell_assets_and_private_no_store(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'ENABLE_WORKERS':'0'}):
            client = TestClient(create_app(Store(Path(folder)/'jobs.db')))
            manifest = client.get('/manifest.webmanifest')
            self.assertEqual(manifest.status_code, 200)
            self.assertIn('application/manifest+json', manifest.headers['content-type'])
            self.assertEqual(manifest.json()['display'], 'standalone')
            for icon in manifest.json()['icons']:
                self.assertEqual(client.get(icon['src']).status_code, 200)
            self.assertEqual(client.get('/static/icon-180.png').status_code, 200)
            sw = client.get('/sw.js')
            self.assertEqual(sw.headers['service-worker-allowed'], '/')
            self.assertEqual(client.get('/api/health').headers['cache-control'], 'no-store')

    def test_static_serves_frontend_types_only_inside_static(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {'ENABLE_WORKERS':'0'}):
            client = TestClient(create_app(Store(Path(folder)/'jobs.db')))
            for name, kind in (('tokens.css', 'text/css'), ('js/main.js', 'text/javascript')):
                response = client.get('/static/' + name)
                self.assertEqual(response.status_code, 200, name)
                self.assertIn(kind, response.headers['content-type'])
            for name in ('../api.py', 'js/../../api.py', '%2e%2e/api.py', 'index.html',
                         'manifest.webmanifest', 'missing.js', '.hidden.js'):
                self.assertEqual(client.get('/static/' + name).status_code, 404, name)


if __name__ == "__main__":
    unittest.main()
