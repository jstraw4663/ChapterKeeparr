"""Reference-design checks: real-duration timeline, resize continuity and dock overlay."""
import argparse,json
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright,expect
from browser_support import audit_accessibility
p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:8767');p.add_argument('--axe',required=True);p.add_argument('--output',default='/tmp/ck-review-design');a=p.parse_args()
out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
jobs=json.load(urlopen(a.base+'/api/jobs'))['jobs'];rid=next(j['id'] for j in jobs if j.get('result',{}).get('report',{}).get('recovery_draft'))
detail=json.load(urlopen(a.base+'/api/jobs/'+rid));detail['recovery_acceptance_preview']['duration_seconds']=320
with sync_playwright() as pw:
 b=pw.chromium.launch()
 for theme in ['light','dark']:
  c=b.new_context(viewport={'width':1440,'height':1000},color_scheme=theme,reduced_motion='reduce',service_workers='block')
  c.route('**/api/jobs/'+rid,lambda r:r.fulfill(json=detail))
  page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto(a.base+'/#/review/'+rid,wait_until='networkidle');expect(page.locator('.rw-timeline')).to_be_visible()
  for width in [1680,1440,1200,1040,900,768,767,640,390,360,800,1440]:
   page.set_viewport_size({'width':width,'height':1000});page.wait_for_timeout(120)
   assert page.evaluate('document.documentElement.scrollWidth')<=width+1
   expect(page.locator('.rw-decision')).to_have_count(1)
   # At every width, the panel must either be wholly above or wholly alongside the list.
   d=page.locator('.rw-decision').bounding_box();m=page.locator('.rw-markers').bounding_box()
   assert d['y']+d['height']<=m['y']+1 or m['x']+m['width']<=d['x']+1,(width,d,m)
  # Hover overlays without narrowing the workspace; dock intentionally reflows it.
  page.mouse.move(1400,0);page.locator('h2[data-vt-title]').focus();page.wait_for_timeout(100)
  before=page.locator('.review-detail').bounding_box()['width']
  page.locator('.revlist-panel').hover();page.wait_for_timeout(100)
  assert abs(before-page.locator('.review-detail').bounding_box()['width'])<1
  page.locator('[data-act="review-dock"]').click();page.reload(wait_until='networkidle')
  expect(page.locator('.revgrid')).to_have_class('revgrid docked')
  page.locator('[data-act="review-dock"]').click()
  sidebar=page.locator('[data-act=collapse]')
  if sidebar.get_attribute('aria-expanded')=='true': sidebar.click()
  page.mouse.move(1400,0);page.locator('h2[data-vt-title]').focus()
  for width in [1440,390]:
   page.set_viewport_size({'width':width,'height':1000 if width==1440 else 844});page.wait_for_timeout(200)
   page.locator('.rw-brief').evaluate("el=>window.scrollTo({top:el.getBoundingClientRect().top+scrollY-20,behavior:'instant'})")
   page.screenshot(path=str(out/f'review-{theme}-{width}.png'),animations='disabled')
   # Same real-duration timeline, clustered hit targets adapt with workspace width.
   pin=page.locator('.rw-pin:visible').first;pin.click();expect(page.locator('.rw-decision')).to_be_focused()
   audit_accessibility(page,a.axe,out,f'{theme}-{width}')
  page.locator('.rw-paths [data-arg="edition"]').click()
  save=page.locator('[data-act="save"]');expect(save).to_be_disabled()
  page.locator('details.tech.plain > summary').click()
  title=page.locator('#rv-title');original=title.input_value();title.fill(original+' corrected')
  expect(save).to_be_enabled()
  asin=page.locator('#rv-asin');original_asin=asin.input_value();asin.fill('bad');expect(save).to_be_disabled()
  asin.fill(original_asin);expect(save).to_be_enabled();title.fill(original);expect(save).to_be_disabled()
  page.locator('.rw-paths [data-arg="edition"]').focus();page.keyboard.press('End')
  expect(page.locator('.rw-paths [data-arg="resume"]')).to_have_attribute('aria-selected','true')
  page.keyboard.press('Home');expect(page.locator('.rw-paths [data-arg="finalize"]')).to_have_attribute('aria-selected','true')
  assert not errors,errors
  c.close()
 b.close()
print('Review design: two themes, continuous resize, docking, timeline focus and axe passed')
