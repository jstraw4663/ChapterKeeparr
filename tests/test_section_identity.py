"""Semantic chapter identity and Bedlam regressions; all speech is synthetic."""
import copy
import unittest
from unittest.mock import patch
from app import acceptance, engine, recovery


def transcript(text, words=None):
    return {'text': text, 'segments': [dict(text=text, start=2 if words is None else 0,
        avg_logprob=-.2, no_speech_prob=.01, **({'words': words} if words is not None else {}))]}


class SectionIdentityTests(unittest.TestCase):
    def test_section_and_part_ordinals_are_not_chapter_numbers(self):
        cases = {'1. Prologue': None, '2. Epilogue': None, 'I. Prolog': None,
            'I. Havana - Chapter 1': 1, 'II. The Father - Chapter 38': 38,
            'III. The Bedlam - Chapter 52': 52, 'Part II: Chapter 38': 38,
            'Chapter 61.5': None, '61.5': None, 'In Chapter 1': None,
            'The year 2023': None, 'Chapter 2': 2, '17. Arrival': 17,
            'Chapter 1 - Arrival': 1, '9. Chapter 17': 17}
        for title, number in cases.items():
            with self.subTest(title=title): self.assertEqual(engine.chapter_number(title), number)
        self.assertEqual(engine.section_identity('1. Prologue')['raw'], '1. Prologue')
        self.assertEqual(engine.section_identity('1. Prologue')['kind'], 'prologue')
        self.assertEqual(engine.section_identity('I. Havana - Chapter 1')['part'], 'i. havana')

    def test_bedlam_numbered_and_named_headings_remain_distinct(self):
        remote = [dict(title='1. Prologue', start=581.333), dict(title='I. Havana - Chapter 1', start=1918.059),
                  dict(title='II. The Father - Chapter 38', start=52354.525), dict(title='III. The Bedlam - Chapter 52', start=70782.617)]
        for text, at, title in [('Prologue.',581.333,'1. Prologue'), ('Prolog.',581.333,'1. Prologue'),
                               ('Chapter one.',1918.059,'I. Havana - Chapter 1'),
                               ('Chapter thirty eight.',52354.525,'II. The Father - Chapter 38'),
                               ('Chapter fifty two.',70782.617,'III. The Bedlam - Chapter 52')]:
            with self.subTest(text=text):
                result = recovery.identify_marker(transcript(text),at,at-2,remote)
                self.assertEqual(result['title'], title)
                self.assertEqual(result['status'], 'supported')
        repeated = remote + [dict(title='II. Elsewhere - Chapter 1', start=80000)]
        self.assertEqual(recovery.identify_marker(transcript('Chapter one.'),1918,1916,repeated)['status'], 'unresolved')

    def test_named_word_timing_quality_pause_and_narrative_guards(self):
        words = [dict(word='team.',start=6,end=7.3,probability=.95), dict(word='Prolog.',start=8,end=8.6,probability=.95),
                 dict(word='Warning.',start=8.8,end=9.2,probability=.95)]
        remote = [dict(title='1. Prologue',start=581.333)]
        self.assertEqual(recovery.identify_marker(transcript('team. Prolog. Warning.',words),581.333,573.333,remote)['title'], '1. Prologue')
        for kind in ['missing', 'low', 'pause', 'far', 'nan', 'narrative', 'badsegment']:
            value = transcript('team. Prolog. Warning.',copy.deepcopy(words)); segment=value['segments'][0]
            if kind=='missing': segment.pop('words')
            if kind=='low': segment['words'][1]['probability']=.2
            if kind=='pause': segment['words'][0]['end']=7.9
            if kind=='far': segment['words'][1]['start']=40;segment['words'][1]['end']=40.6
            if kind=='nan': segment['words'][1]['start']=float('nan')
            if kind=='narrative': segment['words'][0]['word']='the'
            if kind=='badsegment': segment['avg_logprob']=-2
            with self.subTest(kind=kind): self.assertEqual(recovery.identify_marker(value,581.333,573.333,remote)['status'],'unresolved')
        self.assertEqual(recovery.identify_marker(transcript('Prologue to an old book.'),100,98,[dict(title='Prologue',start=100)])['status'],'unresolved')
        value=transcript('Prologue.');value['segments']+=transcript('Epilogue.')['segments']
        self.assertEqual(recovery.identify_marker(value,100,98,[dict(title='Prologue',start=100)])['status'],'unresolved')
        value=transcript('Prologue.');value['segments']+=transcript('Chapter one.')['segments']
        self.assertEqual(recovery.identify_marker(value,100,98,remote+[dict(title='Chapter 1',start=100)])['status'],'unresolved')

    def test_old_false_match_is_released_without_mutating_raw_evidence(self):
        remote=[dict(title='1. Prologue',start=581.333,end=1918.059),dict(title='I. Havana - Chapter 1',start=1918.059,end=3107.849)]
        markers=[dict(old_title='Chapter 3',old_seconds=581.333,new_seconds=581.333,title=None,reference_start=None,status='unresolved'),
                 dict(old_title='Chapter 4',old_seconds=1918.059,new_seconds=1918.059,title='1. Prologue',reference_start=581.333,status='supported',confidence='spoken heading')]
        report={'recovery_draft':dict(markers=markers,reference_chapters=remote,complete=True)}
        raw=copy.deepcopy(report)
        p=acceptance.preview(report)
        self.assertFalse(p['markers'][1]['supported']);self.assertTrue(p['markers'][1]['conflict'])
        self.assertIsNone(p['markers'][1]['reference_id']);self.assertEqual(report,raw)
        self.assertEqual(len(p['sections']),2)
        with patch.object(engine,'SECTION_SEMANTICS_VERSION','future'):
            self.assertNotEqual(p['token'],acceptance.preview(report)['token'])

    def test_joint_conflicts_do_not_change_times_or_force_a_new_identity(self):
        remote=[dict(title=f'Chapter {i+1}',start=i*100,end=(i+1)*100) for i in range(8)]
        markers=[dict(title=c['title'],reference_start=c['start'],old_seconds=c['start']+20,new_seconds=c['start']+20,status='supported',confidence='spoken heading') for c in remote]
        shifted=dict(markers=copy.deepcopy(markers));recovery.finalize_draft(shifted,remote)
        self.assertEqual(shifted['supported_count'],8,'one consistent global offset is retained')
        draft=dict(markers=copy.deepcopy(markers));draft['markers'][3]['old_seconds']+=1000
        before=[m['old_seconds'] for m in draft['markers']]
        recovery.finalize_draft(draft,remote)
        self.assertEqual(draft['markers'][3]['status'],'unresolved')
        self.assertEqual([m['old_seconds'] for m in draft['markers']],before)
        self.assertEqual(draft['markers'][3]['reference_start'],300)
        draft=dict(markers=copy.deepcopy(markers));draft['markers'][2]['reference_start']=300;draft['markers'][3]['reference_start']=200
        recovery.finalize_draft(draft,remote)
        self.assertEqual([m['status'] for m in draft['markers'][2:4]],['unresolved','unresolved'])


if __name__=='__main__': unittest.main()
