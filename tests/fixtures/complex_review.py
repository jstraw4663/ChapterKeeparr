"""Expand ONLY the synthetic Frankenstein job created by ui_seed.py.
Usage: python tests/fixtures/complex_review.py /tmp/ck-marker-review
Generated tone excerpts and illustrative transcripts; deliberately non-publishable.
"""
import json
from pathlib import Path
import sqlite3
import subprocess
import sys
import time


def expand(root):
    root=Path(root).resolve();config=root/'config'
    with sqlite3.connect(config/'chapterkeeper.sqlite3') as db:
        matches=[]
        for job_id,raw in db.execute('SELECT id,result FROM jobs'):
            result=json.loads(raw or '{}');report=result.get('report',{})
            if report.get('edition',{}).get('asin')=='B000FIXT05' and report.get('identity',{}).get('narrator')=='Eve Fixture':
                matches.append((job_id,result,report))
        if len(matches)!=1:raise SystemExit('Expected exactly one synthetic Eve Fixture Frankenstein job. No changes made.')
        job_id,result,report=matches[0]
        # Local time, published time (None = no match), published title, scenario.
        cases=[
            (0,0,'Opening Credits','Clear recommendation; first marker cannot be removed'),
            (60,62,'Letter I','Clear recommendation, two seconds away'),
            (120,120,'Chapter 1','Speech confirmed'),
            (180,178,'Letter II','Ambiguous: two published sections equally close'),
            (240,240,'Chapter 2','Speech confirmed'),
            (300,None,None,'Extra boundary: no eligible published section; try rename or remove'),
            (360,360,'Chapter 3','Speech confirmed'),
            (420,445,'Letter III','Nearest option is 25 seconds away; manual selection required'),
            (480,480,'Chapter 4','Speech confirmed'),
            (540,541,'Interlude','Two local markers compete for one published section'),
            (542,None,None,'Competing local marker; keep, rename or remove after review'),
            (600,600,'Chapter 5','Speech confirmed'),
            (660,662,'Letter IV','Clear recommendation after first page'),
            (720,720,'Chapter 6','Speech confirmed'),
            (780,None,None,'No transcript or excerpt; manual review required'),
            (840,840,'Chapter 7','Speech confirmed'),
            (900,905,'Afterword','Clear recommendation at five-second boundary'),
            (960,960,'Chapter 8','Speech confirmed'),
            (1020,1020,'Interlude','Same published title as another section; distinct identity'),
            (1080,1080,'Chapter 9','Speech confirmed'),
            (1140,1150,'Epilogue','Ten-second distance; do not bulk apply'),
            (1200,1200,'Chapter 10','Speech confirmed'),
            (1260,1261,'End Credits','Clear recommendation near the end'),
        ]
        refs=[{'start':remote,'title':title} for _,remote,title,_ in cases if remote is not None]
        refs += [{'start':182,'title':'Letter II — alternate section'}, {'start':1040,'title':'Interlude'}, {'start':1320,'title':'Bonus scene — no local marker'}]
        refs.sort(key=lambda c:c['start'])
        for i,c in enumerate(refs):c['end']=refs[i+1]['start'] if i+1<len(refs) else 1380
        markers=[];guide=['# Frankenstein complex review fixture','',
            'Synthetic UI scenarios only. Excerpts are generated tones; quoted text is illustrative, not real transcription. Final publication is intentionally blocked.','',
            '| Marker | Local time (seconds) | Scenario |','|---|---:|---|']
        folder=config/'jobs'/job_id;clips=folder/'recovery-clips';clips.mkdir(parents=True,exist_ok=True)
        tone=clips/'complex-tone.wav'
        subprocess.run(['ffmpeg','-v','error','-y','-f','lavfi','-i','sine=frequency=440:duration=15','-ar','16000','-ac','1',str(tone)],check=True)
        for i,(at,remote,title,scenario) in enumerate(cases):
            supported=scenario=='Speech confirmed'
            markers.append(dict(old_title=f'Original marker {i+1}',old_seconds=at,new_seconds=at,title=title if supported else None,
                reference_start=remote if supported else None,status='supported' if supported else 'unresolved',
                confidence='spoken heading' if supported else 'unconfirmed',source='Synthetic fixture',reason=scenario,
                transcript='' if i==14 else f'[Test scenario] {scenario}.',audio_excerpt=None if i==14 else 'recovery-clips/complex-tone.wav'))
            guide.append(f'| {i+1} | {at} | {scenario} |')
        report['recovery_draft']=dict(complete=True,markers=markers,total_markers=len(markers),reference_chapters=refs,
            timeline_hash='synthetic-nonpublishable-complex-v1',source_sha256='synthetic-no-real-audio',duration_seconds=1380)
        report['source_duration_seconds']=1380
        report['edition']['publisher']='Synthetic UI fixture — tone excerpts, illustrative text'
        report['review_reason']={'category':'chapters','detail':'Complex synthetic fixture: 23 markers, clear and ambiguous matches, extra boundaries, unavailable evidence and unmatched bonus content. No real audiobook.'}
        result['report']=report
        (folder/'report.json').write_text(json.dumps(report,indent=2))
        db.execute('UPDATE jobs SET result=?,updated_at=? WHERE id=?',(json.dumps(result),time.time(),job_id))
        (root/'COMPLEX-REVIEW-SCENARIOS.md').write_text('\n'.join(guide)+'\n')
        print(f'Updated synthetic job {job_id}: {len(markers)} markers, {len(refs)} published sections')

if __name__=='__main__':expand(sys.argv[1])
