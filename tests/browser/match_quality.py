"""Evidence score, title comparisons, selection state and linked order warnings.

All writes are blocked against a worker-disabled generated fixture.
"""
import argparse
import copy
import json
from pathlib import Path
import sys
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect
from browser_support import audit_accessibility
ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(ROOT),str(ROOT/'tests')]
from app import acceptance
from fixtures.quality_review import fixture


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--base',default='http://127.0.0.1:8767');parser.add_argument('--axe');parser.add_argument('--chromium');parser.add_argument('--output',default='/tmp/ck-quality-browser')
    args=parser.parse_args();base=args.base.rstrip('/');output=Path(args.output);output.mkdir(parents=True,exist_ok=True)
    jobs=json.load(urlopen(base+'/api/jobs'))['jobs'];rid=next(j['id'] for j in jobs if j.get('result',{}).get('report',{}).get('recovery_draft'))
    detail=json.load(urlopen(base+'/api/jobs/'+rid));report=fixture()
    long_title='End Credits — a deliberately long title with a verylongunbrokenwordforwrappingchecks'
    report['recovery_draft']['reference_chapters'][-1]['title']=long_title
    detail['result']['report']=report;detail['recovery_acceptance_preview']=acceptance.preview(report)
    errors=[];results=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=args.chromium,headless=True)
        for theme in ['light','dark']:
            for width in [320,390,820,1440]:
                ctx=browser.new_context(viewport={'width':width,'height':900},reduced_motion='no-preference',color_scheme=theme,service_workers='block')
                ctx.add_init_script("localStorage.setItem('chapterkeeparr.prefs.v1',JSON.stringify({theme:'"+theme+"',reduceMotion:false}));")
                ctx.route('**/*',lambda r:r.continue_() if r.request.method=='GET' and r.request.url.startswith(base+'/') else r.abort())
                ctx.route('**/api/jobs/'+rid,lambda r:r.fulfill(json=detail))
                page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(base+'/#/review/'+rid,wait_until='networkidle')
                score=page.locator('[data-validated-score]');expect(score).to_contain_text('80%')
                overview=page.locator('.cr-overview');expect(overview).to_contain_text('8 title changes')
                expect(overview).to_contain_text('2 titles kept');expect(page.locator('.cr-timeline')).to_have_count(0)
                options=page.locator('.cr-option');assert options.count()>=2
                assert options.evaluate_all("els=>els.every(el=>el.getAttribute('aria-pressed')==='false' && parseFloat(getComputedStyle(el.querySelector('.radio')).borderTopWidth)<=2)")
                page.locator('[data-act="cr-suggestions"]').click();expect(score).to_contain_text('100%')
                page.locator('[data-act="cr-undo"]').click();expect(score).to_contain_text('80%');expect(overview).to_contain_text('8 title changes')
                first=page.locator('[data-cr-item="m1"]');first.locator('[data-act="cr-rename"]').click();page.locator('#rename-m1').fill('A random title')
                first.locator('[data-act="cr-use-name"]').click();expect(first).to_have_class('cr-card decided');expect(score).to_contain_text('80%')
                first.locator('[data-act="cr-change"]').click()
                selected=first.locator('[data-act="cr-pick"]').first.evaluate("el=>{el.click();return document.querySelectorAll('.cr-card.closing .cr-option[aria-pressed=\"true\"]').length}")
                assert selected==1,selected
                expect(first).to_have_class('cr-card decided');expect(score).to_contain_text('90%')
                last=page.locator('[data-cr-item="m10"]');last.locator('[data-act="cr-pick"]').first.click();expect(score).to_contain_text('100%')
                expect(last).to_have_class('cr-card decided');expect(page.locator('.cr-blocked')).to_have_count(0)
                page.locator('#accept-gap').check();expect(page.locator('[data-act="accept"]')).to_be_enabled()
                expect(overview).to_contain_text('10 title changes');expect(overview).to_contain_text('0 titles kept')
                previews=overview.locator('.cr-change-preview').all()
                for preview_row in previews:
                    bounds=preview_row.bounding_box();pair_bounds=preview_row.locator('.title-pair').bounding_box()
                    assert pair_bounds['y']>=bounds['y'] and pair_bounds['y']+pair_bounds['height']<=bounds['y']+bounds['height']+1,(width,bounds,pair_bounds)
                assert all(b.bounding_box()['y']>=a.bounding_box()['y']+a.bounding_box()['height'] for a,b in zip(previews,previews[1:]))
                overview.locator('[data-act="chapter-overview"]').click()
                expect(page.locator('.check-filters [data-arg="changed"]')).to_have_attribute('aria-pressed','true')
                expect(page.locator('[data-check-row="1"] .check-compare')).to_be_focused()
                page.locator('[data-act="chapter-filter"][data-arg="all"]').click()
                overview.locator('.cr-change-preview').first.click()
                expect(page.locator('[data-check-row="1"] .check-compare')).to_be_focused()
                expect(page.locator('[data-act="toggle"][data-arg="checks"]')).to_contain_text('8/10 audio matches')
                expect(page.locator('[data-check-row="1"]')).to_contain_text('Validated choice')
                for owner in [last,page.locator('[data-check-row="10"]'),overview.locator('.cr-change-preview').first]:
                    pair=owner.locator('.title-pair');cells=pair.locator('.pair-cell').all();a,b=[c.bounding_box() for c in cells]
                    assert b['x']>a['x'] and b['x']+b['width']<=width+1,(width,a,b)
                    assert abs(a['height']-b['height'])<1,(width,a,b)
                page.locator('[data-check-row="7"] [data-act="cr-edit-match"]').click()
                changed=page.locator('[data-cr-item="m7"]');changed.locator('[data-act="cr-rename"]').click();page.locator('#rename-m7').fill('Chapter 1')
                changed.locator('[data-act="cr-use-name"]').click();expect(changed).to_have_class('cr-card decided')
                warning=page.locator('.chapter-warnings [data-act="chapter-warning"]').filter(has_text='repeated').first
                expect(warning).to_be_visible();warning.click()
                expect(page.locator('[data-check-row="7"] .check-compare')).to_be_focused()
                expect(page.locator('[data-check-row="7"]')).to_contain_text('Sequence warning')
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                page.screenshot(path=str(output/f'quality-{theme}-{width}.png'),animations='disabled')
                overview.scroll_into_view_if_needed();page.screenshot(path=str(output/f'overview-{theme}-{width}.png'),animations='disabled')
                if args.axe:audit_accessibility(page,args.axe,output,f'quality-{theme}-{width}')
                ctx.close();results.append({'theme':theme,'width':width,'passed':True})
                print(f'{theme} {width}px: qualified score, empty radios, comparisons and linked warnings passed',flush=True)
        browser.close()
    assert not errors,errors
    (output/'results.json').write_text(json.dumps(results,indent=2))


if __name__=='__main__':main()
