import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.api import create_app
from app.db import Store
from app.media import MediaService, MediaError
from app.covers import cover_url


@unittest.skipUnless(shutil.which('ffmpeg'), 'FFmpeg required')
class MediaTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)
        self.root = self.base / 'library'; self.root.mkdir()
        self.book = self.root / 'Book.m4b'
        meta = self.base / 'chapters.txt'
        meta.write_text(';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=1000\ntitle=Opening credits\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=1000\nEND=3000\ntitle=Chapter 1: Arrival\n')
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=440:duration=3','-i',str(meta),'-map_metadata','1','-c:a','aac',str(self.book)],check=True)
        self.store = Store(self.base / 'jobs.db'); self.store.initialize()
        job,_ = self.store.enqueue(self.book); self.id = job['id']
        self.store.claim('test'); self.store.finish(self.id,'complete',{'report':{'output':str(self.book)}})
        self.media = MediaService(self.store,[self.root],self.base / 'cache')
        self.env = patch.dict(os.environ,{'CONFIG_DIR':str(self.base),'LIBRARY_ROOTS':str(self.root),'CHAPTERKEEPER_API_TOKEN':'secret','ENABLE_WORKERS':'0'})
        self.env.start(); self.addCleanup(self.env.stop)
        self.client = TestClient(create_app(self.store)); self.headers={'Authorization':'Bearer secret'}

    def test_actual_chapters_and_authenticated_range_playback(self):
        path=f'/api/jobs/{self.id}'
        self.assertEqual(self.client.get(path+'/chapters').status_code,401)
        chapters=self.client.get(path+'/chapters',headers=self.headers).json()['chapters']
        self.assertEqual([c['title'] for c in chapters],['Opening credits','Chapter 1: Arrival'])
        self.assertEqual(chapters[1]['start_seconds'],1)
        self.assertEqual(self.client.post(path+'/media-token').status_code,401)
        ticket=self.client.post(path+'/media-token',headers=self.headers).json()['token']
        response=self.client.get(path+'/audio',params={'ticket':ticket},headers={'Range':'bytes=0-99'})
        self.assertEqual(response.status_code,206); self.assertEqual(response.content,self.book.read_bytes()[:100])
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(self.client.get(path+'/audio',params={'ticket':ticket+'x'}).status_code,403)

    def test_ticket_expiration_job_scope_and_changed_file(self):
        ticket=self.media.issue_ticket(self.id)['token']
        with patch('app.media.time.time',return_value=10**12), self.assertRaises(MediaError): self.media.verify_ticket(self.id,ticket)
        with self.assertRaises(MediaError): self.media.verify_ticket('other-job',ticket)
        self.book.write_bytes(self.book.read_bytes()+b'changed')
        with self.assertRaises(MediaError): self.media.verify_ticket(self.id,ticket)

    def test_output_symlink_outside_root_is_denied(self):
        outside=self.base/'outside.m4b'; self.book.rename(outside); self.book.symlink_to(outside)
        with self.assertRaises(MediaError) as error: self.media.chapters(self.id)
        self.assertEqual(error.exception.status_code,403)
        with self.assertRaises(MediaError) as error: self.media.source_info(self.id)
        self.assertEqual(error.exception.status_code,403)

    def test_review_source_duration_and_report_require_auth(self):
        self.store.retry(self.id)
        self.store.claim('test')
        self.store.finish(self.id, 'awaiting_review', {'report': {'reason': 'Timing unresolved'}})
        path=f'/api/jobs/{self.id}'
        self.assertEqual(self.client.get(path+'/source-info').status_code,401)
        value=self.client.get(path+'/source-info',headers=self.headers)
        self.assertEqual(value.status_code,200)
        self.assertAlmostEqual(value.json()['duration_seconds'],3,places=1)
        self.assertEqual(self.client.get(path+'/report').status_code,401)
        report=self.client.get(path+'/report',headers=self.headers)
        self.assertEqual(report.status_code,200)
        self.assertIn('attachment',report.headers['content-disposition'])

    def test_cover_and_no_source_mutation(self):
        cover=self.root/'cover.png'
        shutil.copy(Path(__file__).parents[1]/'app/static/icon-192.png',cover)
        before=self.book.read_bytes(); artwork=cover.read_bytes()
        output=self.media.cover(self.id)
        self.assertTrue(output.is_file()); self.assertEqual(output.suffix,'.jpg')
        self.assertEqual(self.book.read_bytes(),before); self.assertEqual(cover.read_bytes(),artwork)
        self.assertEqual(output,self.media.cover(self.id))

    def test_provider_artwork_allowlist(self):
        for url in ['http://m.media-amazon.com/image.jpg','https://evil.example/a','https://m.media-amazon.com@evil.example/a','https://m.media-amazon.com:444/a']:
            self.assertIsNone(cover_url({'imageUrl':url}))
        self.assertEqual(cover_url({'imageUrl':'https://m.media-amazon.com/a.jpg'}),'https://m.media-amazon.com/a.jpg')
