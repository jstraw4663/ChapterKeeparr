"""Synthetic Bedlam regression: false matched section, full timeline and edits.

No real recording is loaded. GETs are local only; all writes are blocked.
"""
import argparse
import copy
import json
from pathlib import Path
import sys
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from app import acceptance, recovery


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:8767');parser.add_argument('--chromium');parser.add_argument('--axe');parser.add_argument('--output',default='/tmp/ck-bedlam-browser')
    args=parser.parse_args();base=args.base.rstrip('/');output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    jobs=json.load(urlopen(base+'/api/jobs?limit=1000'))['jobs']
    rid=next(j['id'] for j in jobs if j.get('result',{}).get('report',{}).get('recovery_draft'))
    detail=json.load(urlopen(base+'/api/jobs/'+rid))
    titles=['Opening Credits','OMG. What a floor!','1. Prologue','I. Havana - Chapter 1','Chapter 2','Chapter 3','Chapter 4']
    starts=[0,31.903,581.333,1918.059,3107.849,4781.589,6265.39]
    remote=[dict(title=t,start=at,end=starts[i+1] if i+1<len(starts) else at+1000) for i,(at,t) in enumerate(zip(starts,titles))]
    markers=[dict(old_title=f'File marker {i+1}',old_seconds=at,new_seconds=at,
        title=t if i>=4 else '1. Prologue' if i==3 else None,
        reference_start=at if i>=4 else starts[2] if i==3 else None,
        status='supported' if i>=3 else 'unresolved', confidence='spoken heading' if i>=3 else 'unconfirmed',
        transcript='Synthetic speech evidence; no actual recording.',audio_excerpt=None) for i,(at,t) in enumerate(zip(starts,titles))]
    report=detail['result']['report'];report.update(checks=[dict(title='Stale old check',boundary_seconds=0,passed=False)],
        recovery_draft=dict(complete=True,markers=markers,total_markers=len(markers),reference_chapters=remote,timeline_hash=recovery.digest(remote)))
    detail['recovery_acceptance_preview']=acceptance.preview(report)
    errors=[];results=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=args.chromium,headless=True)
        for theme in ['light','dark']:
            for width in [320,390,820,1024,1440]:
                ctx=browser.new_context(viewport={'width':width,'height':900},reduced_motion='reduce',service_workers='block',color_scheme=theme)
                ctx.add_init_script("localStorage.setItem('chapterkeeparr.prefs.v1',JSON.stringify({theme:'"+theme+"',reduceMotion:true}));")
                ctx.route('**/*',lambda route:route.continue_() if route.request.method=='GET' and route.request.url.startswith(base+'/') else route.abort())
                ctx.route('**/api/jobs/'+rid,lambda route:route.fulfill(json=detail))
                page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base+'/#/review/'+rid,wait_until='networkidle')
                expect(page.locator('[data-cr-item="m3"]')).to_contain_text('1. Prologue')
                expect(page.locator('[data-cr-item="m4"]')).to_contain_text('Review conflicting match')
                expect(page.locator('[data-cr-item="m4"]')).to_contain_text('I. Havana - Chapter 1')
                page.locator('[data-act="toggle"][data-arg="checks"]').click()
                expect(page.locator('[data-check-row]')).to_have_count(7)
                expect(page.locator('[data-check-row="4"]')).to_contain_text('Conflicting match')
                first=page.locator('[data-check-row="1"]')
                expect(first.locator('[data-check-proposed]')).to_have_text('Opening Credits')
                expect(first).to_contain_text('Not selected')
                expect(first).to_contain_text('Suggested')
                expect(page.locator('[data-check-row="2"] [data-check-proposed]')).to_have_text('OMG. What a floor!')
                # Rows compact to a stable five-column comparison where space
                # permits; narrow panels stack titles and keep actions inline.
                controls=first.locator('.check-actions button').all()
                play,change=[control.bounding_box() for control in controls]
                assert abs(play['y']+play['height']/2-change['y']-change['height']/2)<1,(play,change)
                assert min(play['height'],play['width'],change['height'],change['width'])>=44
                page.locator('[data-collapsible="checks"]').evaluate("el=>window.scrollTo({top:el.getBoundingClientRect().top+scrollY-90,behavior:'instant'})")
                page.screenshot(path=str(output/f'checks-before-{theme}-{width}.png'),full_page=False,animations='disabled')
                expect(page.locator('#view')).not_to_contain_text('Stale old check')
                page.locator('[data-act="chapter-filter"][data-arg="attention"]').click()
                expect(page.locator('[data-check-row]')).to_have_count(4)
                page.locator('[data-act="chapter-filter"][data-arg="all"]').click()
                page.locator('[data-act="cr-suggestions"]').click()
                expect(page.locator('[data-check-row="3"]')).to_contain_text('1. Prologue')
                expect(page.locator('[data-check-row="4"]')).to_contain_text('I. Havana - Chapter 1')
                expect(page.locator('[data-check-row="4"]')).to_contain_text('Your decision')
                expect(first).not_to_contain_text('Not selected')
                expect(first).to_contain_text('Your decision')
                expect(first.locator('[data-check-proposed]')).to_have_text('Opening Credits')
                # Evidence count describes the original speech result and must
                # not fall as a user accepts or edits a match.
                expect(page.locator('[data-act="toggle"][data-arg="checks"]')).to_contain_text('3/7 audio matches')
                page.locator('[data-act="chapter-filter"][data-arg="attention"]').click()
                expect(page.locator('[data-check-row]')).to_have_count(0)
                page.locator('[data-act="chapter-filter"][data-arg="all"]').click()
                # An originally matched row can be edited without losing the original label.
                page.locator('[data-check-row="5"] [data-act="cr-edit-match"]').click()
                card=page.locator('[data-cr-item="m5"]');expect(card).to_be_visible()
                card.locator('[data-act="cr-rename"]').click();page.locator('#rename-m5').fill('My reviewed title')
                card.locator('[data-act="cr-use-name"]').click()
                expect(card).to_have_class('cr-card decided')
                expect(page.locator('[data-check-row="5"]')).to_contain_text('File marker 5')
                expect(page.locator('[data-check-row="5"]')).to_contain_text('My reviewed title')
                page.evaluate("async()=>{const s=await import('/static/js/store.js');s.touch()}")
                expect(page.locator('[data-check-row="5"]')).to_contain_text('My reviewed title')
                card.locator('[data-act="cr-change"]').click()
                card.locator('[data-act="cr-match-reset"]').click()
                expect(card).to_have_count(0)
                expect(page.locator('[data-check-row="5"]')).to_contain_text('Chapter 2')
                expect(page.locator('[data-check-row="5"]')).to_contain_text('Audio match')
                page.locator('[data-check-row="5"] [data-act="cr-edit-match"]').click()
                card.locator('[data-act="cr-rename"]').click();page.locator('#rename-m5').fill('My reviewed title')
                card.locator('[data-act="cr-use-name"]').click()
                page.locator('[data-act="cr-lower"]').click();page.locator('#accept-gap').check()
                expect(page.locator('[data-act="accept"]')).to_be_enabled()
                page.locator('[data-act="chapter-filter"][data-arg="changed"]').click()
                expect(page.locator('[data-check-row="5"]')).to_be_visible()
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                for row in page.locator('[data-check-row]').all():
                    box=row.bounding_box();assert box['width']>200
                page.screenshot(path=str(output/f'timeline-{theme}-{width}.png'),full_page=False,animations='disabled')
                if args.axe:
                    page.add_script_tag(path=args.axe)
                    violations=page.evaluate("async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))}")
                    assert not violations,violations
                results.append({'theme':theme,'width':width,'result':'passed'});ctx.close()
                print(f'{theme} {width}px: Bedlam collision, timeline, filters and matched edits passed',flush=True)
        browser.close()
    assert not errors,errors
    (output/'results.json').write_text(json.dumps({'results':results,'page_errors':errors},indent=2))


if __name__=='__main__':main()
