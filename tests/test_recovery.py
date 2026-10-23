import json
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch
from app import engine, recovery


def timeline(n=20):
    return [{'start': i*100., 'end': (i+1)*100., 'title': 'Chapter '+str(i)} for i in range(n)]


def local(remote, offsets=None):
    return [{'start_time': str(c['start']+(offsets[i] if offsets else 0)), 'tags': {'title': 'Track '+str(i)}} for i,c in enumerate(remote)]


class RecoveryTests(unittest.TestCase):
    def test_rounded_timestamps_and_existing_fast_path(self):
        remote=timeline()
        for i,c in enumerate(remote): c['start'] += 0 if i==0 else .013
        outcome=recovery.evaluate(local(timeline()),remote,2000,'audio',[])
        self.assertTrue(outcome['timing_passed'])
        self.assertEqual(len(outcome['diagnostics']['matched_pairs']),19)
        self.assertEqual(outcome['plan'][1]['start_seconds'],100)

    def test_internal_edit_drift_and_chapterless_remain_review(self):
        remote=timeline()
        for chapters in ([], local(remote,[i*.2 for i in range(20)]),local(remote,[0]*10+[-12]*10)):
            outcome=recovery.evaluate(chapters,remote,2000,'audio',[])
            self.assertFalse(outcome['timing_passed'])
            self.assertEqual(outcome['diagnostics']['local_duration_seconds'],2000)
            self.assertEqual(len(outcome['diagnostics']['reference_chapters']),20)

    def test_cache_restart_identity_file_timeline_version_and_force(self):
        remote=timeline(); existing=local(remote)
        with tempfile.TemporaryDirectory() as folder:
            one=recovery.evaluate(existing,remote,2000,'a',['Book'],folder)
            two=recovery.evaluate(existing,remote,2000,'a',['Book'],folder)
            self.assertFalse(one['cached']);self.assertTrue(two['cached'])
            for source,identity,ref in [('b',['Book'],remote),('a',['Other'],remote),('a',['Book'],timeline(19))]:
                self.assertFalse(recovery.evaluate(existing,ref,2000,source,identity,folder)['cached'])
            self.assertFalse(recovery.evaluate(existing,remote,2000,'a',['Book'],folder,True)['cached'])
            with patch.object(recovery,'ALGORITHM_VERSION','next'):
                self.assertFalse(recovery.evaluate(existing,remote,2000,'a',['Book'],folder)['cached'])

    def test_failed_editions_deduplicate_and_timeline_aliases_recorded(self):
        remote=timeline()
        books=[{'asin':x,'title':'Book','authors':[{'name':'Author'}],'narrators':[{'name':'Reader'}],
                'runtimeLengthMin':2000/60,'language':'english','formatType':'unabridged'}
               for x in ('B000000001','B000000001','B000000002')]
        def request(url):
            asin=url.split('/books/')[1].split('/')[0]
            return {'asin':asin,'isAccurate':True,'chapters':[{'startOffsetMs':c['start']*1000,'lengthMs':100000,'title':c['title']} for c in remote]}
        with tempfile.TemporaryDirectory() as folder, patch.object(engine,'search_books',return_value=books),patch.object(engine,'get_json',side_effect=request) as fetch:
            report={'status':'researching','audio_source_sha256':'a'}
            for _ in range(2):
                with self.assertRaises(engine.NeedsReview):
                    engine.research_edition('Book','Author','Reader',2000,'us',None,{'chapters':[]},None,report,Path(folder))
            self.assertEqual(fetch.call_count,2)
            self.assertEqual(len(report['alignment_attempts']),2)
            self.assertTrue(report['alignment_attempts'][0]['identity_compatible'])
            self.assertEqual(report['alignment_attempts'][1]['duplicate_of'],'B000000001:us')
            self.assertEqual(json.loads((Path(folder)/'report.json').read_text())['attempted_editions'],['B000000001:us','B000000002:us'])

    def test_search_404_fallback_is_bounded_and_other_errors_propagate(self):
        with patch.object(engine,'get_json',side_effect=[engine.MetadataNotFound('404'),[{'asin':'B000000001'}]]) as request:
            self.assertEqual(len(engine.search_books('Book','us','Author',10)),1)
            self.assertEqual(request.call_count,2)
            self.assertIn('keywords=Book',request.call_args.args[0])
        with patch.object(engine,'get_json',side_effect=engine.MetadataNotFound('404')) as request:
            with self.assertRaises(engine.MetadataNotFound):engine.search_books('Book')
            self.assertEqual(request.call_count,2)
        with patch.object(engine,'get_json',side_effect=engine.NeedsReview('HTTP 429')) as request:
            with self.assertRaises(engine.NeedsReview):engine.search_books('Book')
            self.assertEqual(request.call_count,1)

    def test_search_404_does_not_claim_missing_asin(self):
        url='https://libexdb.com/search?keywords=Book'
        error=urllib.error.HTTPError(url,404,'not found',{},None)
        with patch.object(engine,'raw_get_json',side_effect=error):
            with self.assertRaisesRegex(engine.MetadataNotFound,'search service'):
                engine.get_json(url)

class LocalMarkerTests(unittest.TestCase):
    def transcript(self,text):
        return {'text':text,'segments':[{'text':text,'start':2,'avg_logprob':-.2,'no_speech_prob':.01}]}

    def test_spoken_identity_not_track_position_or_title(self):
        remote=[{'start':0,'end':100,'title':'Opening Credits'}, {'start':100,'end':200,'title':'Chapter 17'}, {'start':200,'end':300,'title':'Chapter 2'}]
        marker=recovery.identify_marker(self.transcript('Chapter seventeen. Hello.'),50,48,remote)
        self.assertEqual(marker['title'],'Chapter 17');self.assertEqual(marker['reference_start'],100)
        marker=recovery.identify_marker(self.transcript('There were seventeen people.'),50,48,remote)
        self.assertEqual(marker['status'],'unresolved')
        repeated=remote+[{'start':300,'end':400,'title':'Chapter 17'}]
        self.assertEqual(recovery.identify_marker(self.transcript('Chapter seventeen.'),50,48,repeated)['status'],'unresolved')

    def test_conflicting_or_low_confidence_headings_unresolved(self):
        remote=timeline()
        transcript=self.transcript('Chapter 2.')
        transcript['segments'] += self.transcript('Chapter 3.')['segments']
        self.assertEqual(recovery.identify_marker(transcript,100,98,remote)['status'],'unresolved')
        transcript=self.transcript('Chapter 2.');transcript['segments'][0]['avg_logprob']=-2
        self.assertEqual(recovery.identify_marker(transcript,100,98,remote)['status'],'unresolved')

    def test_duplicate_chapter_observations_and_missing_credits_block_publication(self):
        remote=timeline()
        marker=recovery.identify_marker(self.transcript('Chapter 2.'),100,98,remote)
        draft={'markers':[dict(marker),dict(marker)]}
        recovery.finalize_draft(draft,remote)
        self.assertEqual(draft['supported_count'],0)
        self.assertEqual(len(draft['missing_sections']),20)
        self.assertFalse(draft['publication_allowed'])

    def test_cancel_retains_partial_draft_and_does_not_modify_source(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        with tempfile.TemporaryDirectory() as temp:
            folder=Path(temp); source=folder/'book.m4b';source.write_bytes(b'original')
            report={'status':'starting','audio_source_sha256':'hash'}
            data={'format':{'duration':'2000'},'chapters':local(timeline())}
            speech=Mock();speech.transcribe.side_effect=[self.transcript('Chapter 1.'),KeyboardInterrupt()]
            with patch.object(engine,'run'),self.assertRaises(KeyboardInterrupt):
                recovery.scan_markers(source,data,timeline(),speech,SimpleNamespace(ffmpeg='ffmpeg'),report,folder)
            saved=json.loads((folder/'report.json').read_text())
            self.assertEqual(len(saved['recovery_draft']['markers']),1)
            self.assertFalse(saved['recovery_draft']['complete'])
            self.assertEqual(source.read_bytes(),b'original')

    def test_named_heading_and_unique_epub_opening(self):
        remote=[{'start':0,'end':100,'title':'Epigraph'},{'start':100,'end':200,'title':'Chapter Chandra'}]
        marker=recovery.identify_marker(self.transcript('Interlude, Chandra. Hello, friends.'),100,98,remote)
        self.assertEqual(marker['title'],'Chapter Chandra')
        opening='When I was a boy and I would see scary things in the news'
        evidence={'entries':[{'title':'Epigraph','opening':opening}]}
        marker=recovery.identify_marker(self.transcript(opening),0,-2,remote,evidence)
        self.assertEqual(marker['title'],'Epigraph')
        evidence['entries'].append({'title':'Other section','opening':opening})
        self.assertEqual(recovery.identify_marker(self.transcript(opening),0,-2,remote,evidence)['status'],'unresolved')

class WiderRetryTests(unittest.TestCase):
    def run_scan(self, transcripts):
        from types import SimpleNamespace
        from unittest.mock import Mock
        temp=tempfile.TemporaryDirectory();self.addCleanup(temp.cleanup)
        folder=Path(temp.name);source=folder/'book.m4b';source.write_bytes(b'original')
        speech=Mock();speech.transcribe.side_effect=transcripts
        report={'status':'starting','audio_source_sha256':'hash'}
        data={'format':{'duration':'200'},'chapters':[{'start_time':'0'},{'start_time':'100'}]}
        remote=[{'start':0,'end':100,'title':'Chapter 1'},{'start':100,'end':200,'title':'Chapter 2'}]
        with patch.object(engine,'run') as run:
            draft=recovery.scan_markers(source,data,remote,speech,SimpleNamespace(ffmpeg='ffmpeg'),report,folder)
        self.assertEqual(source.read_bytes(),b'original')
        self.assertFalse(draft['publication_allowed'])
        return draft,run,speech
    def text(self,text,start=2):
        return {'text':text,'segments':[{'text':text,'start':start,'avg_logprob':-.2,'no_speech_prob':.01}]}
    def test_only_unresolved_gets_one_wider_retry(self):
        draft,run,speech=self.run_scan([self.text('Chapter 1.'),self.text('Some prose.'),self.text('Chapter 2.',8)])
        self.assertEqual(speech.transcribe.call_count,3)
        self.assertNotIn('retry',draft['markers'][0])
        marker=draft['markers'][1]
        self.assertEqual(marker['status'],'supported')
        self.assertEqual(marker['initial_attempt']['status'],'unresolved')
        self.assertEqual(marker['retry']['clip_start_seconds'],92)
        self.assertEqual(marker['retry']['clip_end_seconds'],128)
        self.assertTrue(marker['audio_excerpt'].endswith('-retry.wav'))
        self.assertEqual(marker['new_seconds'],100)
    def test_retry_does_not_expand_heading_acceptance_or_loop(self):
        draft,_,speech=self.run_scan([self.text('Chapter 1.'),self.text('Prose.'),self.text('Chapter 2.',0)])
        self.assertEqual(speech.transcribe.call_count,3)
        self.assertEqual(draft['markers'][1]['status'],'unresolved')
    def test_conflicting_first_pass_cannot_be_erased(self):
        bad=self.text('Chapter 1.');bad['segments']+=self.text('Chapter 2.')['segments']
        draft,_,_=self.run_scan([self.text('Chapter 1.'),bad,self.text('Chapter 2.',8)])
        self.assertEqual(draft['markers'][1]['status'],'unresolved')
        self.assertEqual(draft['markers'][1]['confidence'],'ambiguous')

class EmbeddedHeadingTests(unittest.TestCase):
    def sample(self, number='61'):
        text = 'oh shit chapter ' + number + ' note added'
        words = [dict(word=w, start=t, end=t+.2, probability=.95)
                 for w,t in [('oh',0),('shit',.3),('chapter',8), (number,8.3),('note',8.6),('added',8.9)]]
        return {'text':text, 'segments':[dict(text=text, start=0, end=10,
                avg_logprob=-.2, no_speech_prob=.01, words=words)]}

    def identify(self, result, remote=None):
        return recovery.identify_marker(result,100,92,remote or [dict(title='Chapter 61',start=10)])

    def test_embedded_heading_uses_word_time_not_segment_start(self):
        result=self.identify(self.sample())
        self.assertEqual(result['title'],'Chapter 61')
        self.assertEqual(result['status'],'supported')

    def test_missing_timing_pause_confidence_or_nearby_heading_stays_unresolved(self):
        for mutation in ('no_words','no_pause','low_word','low_segment','late','nan','reference'):
            with self.subTest(mutation=mutation):
                value=self.sample();s=value['segments'][0];w=s['words']
                if mutation=='no_words':s.pop('words')
                if mutation=='no_pause':w[1]['end']=7.9
                if mutation=='low_word':w[3]['probability']=.2
                if mutation=='low_segment':s['avg_logprob']=-2
                if mutation=='late':
                    for item in w[2:]:item['start']+=20;item['end']+=20
                if mutation=='nan':w[2]['start']=float('nan')
                if mutation=='reference':w[1]['word']='in'
                self.assertEqual(self.identify(value)['status'],'unresolved')

    def test_words_conflicts_and_repeated_published_number(self):
        value=self.sample('sixty')
        value['segments'][0]['words'].insert(4,dict(word='one',start=8.51,end=8.59,probability=.95))
        self.assertEqual(self.identify(value)['title'],'Chapter 61')
        value['segments']+=self.sample('62')['segments']
        self.assertEqual(self.identify(value)['status'],'unresolved')
        self.assertEqual(self.identify(self.sample(),[dict(title='Chapter 61',start=10),dict(title='Chapter 61',start=20)])['status'],'unresolved')

    def test_decimal_and_untimed_text_not_promoted(self):
        self.assertEqual(self.identify(self.sample('61.5'))['status'],'unresolved')
        value=self.sample();value['segments'][0]['words'][3].pop('end')
        self.assertEqual(self.identify(value)['status'],'unresolved')

class WordEvidenceAdapterTests(unittest.TestCase):
    def test_both_backends_request_and_preserve_word_alignment(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        word=dict(word='chapter',start=1.,end=1.3,probability=.95)
        for backend in ('mlx','faster-whisper'):
            with self.subTest(backend=backend):
                speech=engine.LocalSpeech.__new__(engine.LocalSpeech)
                speech.backend=backend;speech.model='test';speech.engine=Mock()
                segment=dict(start=0.,end=2.,text='chapter',avg_logprob=-.2,no_speech_prob=.01,words=[word])
                if backend=='mlx':
                    speech.engine.transcribe.return_value=dict(text='chapter',segments=[segment])
                else:
                    segment['words']=[SimpleNamespace(**word)]
                    speech.engine.transcribe.return_value=([SimpleNamespace(**segment)],None)
                result=speech.transcribe('generated.wav')
                self.assertTrue(speech.engine.transcribe.call_args.kwargs['word_timestamps'])
                self.assertEqual(result['segments'][0]['words'],[word])
