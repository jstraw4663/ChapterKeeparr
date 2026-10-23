"""Generated-fixture checks for merged review decisions and stable notifications.

All writes are intercepted. Run against the worker-disabled ui_seed.py preview.
"""
import argparse
import base64
import json
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect
from browser_support import audit_accessibility


def design_edges(browser, base, rid, errors):
    """Exercise motion and bounded rendering with a synthetic 180-marker preview."""
    detail = json.load(urlopen(base + '/api/jobs/' + rid, timeout=10))
    preview = detail['recovery_acceptance_preview']
    preview.update(token='synthetic-large-draft', total=180, supported=2,
                   supported_percent=100 * 2 / 180, default_minimum_percent=1)
    preview['published_sections'] = [{'id': str(i * 100), 'title': f'Chapter {i}'} for i in range(180)]
    preview['markers'] = [dict(index=i + 1, title=f'Original {i}', seconds=i * 100,
        supported=i in (90, 179), reference_id=str(i * 100) if i in (90, 179) else None,
        suggested_title=f'Chapter {i}' if i in (90, 179) else None,
        excerpt=None, transcript='', removable=i > 0) for i in range(180)]
    preview['sections'] = [s for i, s in enumerate(preview['published_sections']) if i not in (90, 179)]
    for width, motion in [(390, 'reduce'), (1024, 'no-preference')]:
        ctx = browser.new_context(viewport={'width': width, 'height': 900}, reduced_motion=motion, service_workers='block')
        ctx.add_init_script("localStorage.setItem('chapterkeeparr.prefs.v1',JSON.stringify({reduceMotion:" + str(motion == 'reduce').lower() + '}));')
        ctx.route('**/*', lambda route: route.continue_() if route.request.method == 'GET' and route.request.url.startswith(base + '/') else route.abort())
        ctx.route('**/api/jobs/' + rid, lambda route: route.fulfill(json=detail))
        page = ctx.new_page(); page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base + '/#/review/' + rid, wait_until='networkidle')
        expect(page.locator('.cr-card')).to_have_count(30)
        first = page.locator('[data-cr-item="m1"]')
        expect(first.locator('[data-act="cr-remove"]')).to_have_count(0)
        bulk = page.locator('[data-act="cr-suggestions"]')
        expect(bulk).to_be_visible(); bulk.click()
        expect(page.locator('.cr-card.decided').first).to_be_attached()
        page.locator('[data-act="cr-undo"]').click()
        expect(page.locator('.cr-card.decided')).to_have_count(0)
        card = page.locator('[data-cr-item="m2"]')
        card.locator('[data-act="cr-all"]').click()
        page.locator('#chapters-m2').fill('Chapter 100')
        card.locator('[data-act="cr-outside"]').click()
        outside = card.locator('[data-act="cr-pick"]').filter(has_text='Chapter 100')
        expect(outside).to_be_visible(); outside.click()
        expect(card).to_have_class('cr-card decided')
        saved = page.evaluate("async id=>(await import('/static/js/review-drafts.js')).loadDraft(id)", rid)
        assert saved['accept']['decisions']['2']['override_order'] is True
        card.locator('[data-act="cr-change"]').click()
        card.locator('[data-act="cr-remove"]').click()
        expect(card).to_have_class('cr-card decided')
        if motion != 'reduce':
            page.wait_for_timeout(500)
            card.locator('[data-act="cr-change"]').click()
            remove = card.locator('[data-act="cr-remove"]')
            # Opening the card changes its height. Playwright can scroll to make
            # Remove clickable; measure the app's decision from pointerdown,
            # after that actionability scroll, rather than before opening it.
            remove.evaluate("el=>el.addEventListener('pointerdown',()=>{window.ckDecisionScrollY=scrollY},{once:true})")
            remove.click()
            expect(card).to_have_class('cr-card decided')
            page.wait_for_timeout(500)
            before = page.evaluate('window.ckDecisionScrollY')
            assert before is not None, 'Decision pointerdown was not observed'
            assert abs(page.evaluate('scrollY') - before) < 2, 'Desktop decision moved page'
        page.locator('[data-cr-more]').evaluate("el=>el.scrollIntoView({block:'center'})")
        page.wait_for_function("document.querySelectorAll('.cr-card').length >= 60")
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        # Timers pause for both pointer and keyboard users, then resume.
        page.goto(base + '/#/queue', wait_until='networkidle')
        page.reload(wait_until='networkidle'); page.set_viewport_size({'width':1440,'height':1400})
        page.evaluate("""async id => {const {notify}=await import('/static/js/notify.js');
          notify({kind:'info',title:'Timer pause check',jobId:id,href:'#/queue',dest:'queue'});
        }""", rid)
        panel = page.locator('#notes'); panel.hover()
        page.wait_for_timeout(6300)
        expect(panel.locator('.note-card')).to_have_count(1)
        panel.locator('[data-note-close]').focus(); page.mouse.move(1000, 20)
        page.wait_for_timeout(6300)
        expect(panel.locator('.note-card')).to_have_count(1)
        page.evaluate('document.activeElement.blur()')
        expect(panel.locator('.note-card')).to_have_count(0, timeout=8500)
        ctx.close()
        print(f'{width}px {motion}: large draft, manual override, bulk undo and notification timers passed', flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:8767')
    parser.add_argument('--chromium', default=None)
    parser.add_argument('--axe')
    parser.add_argument('--output', default='/tmp/chapterkeeparr-reconciled-browser')
    args = parser.parse_args(); base = args.base.rstrip('/')
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    jobs = json.load(urlopen(base + '/api/jobs?limit=1000', timeout=10))['jobs']
    rid = next(j['id'] for j in jobs if j['status'] == 'awaiting_review' and j.get('result', {}).get('report', {}).get('recovery_draft'))
    other = next(j['id'] for j in jobs if j['status'] == 'awaiting_review' and j['id'] != rid)
    pvalue = json.load(urlopen(base + '/api/jobs/' + rid, timeout=10))['recovery_acceptance_preview']
    page_errors, results = [], []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=args.chromium, headless=True)
        for theme in ['light', 'dark']:
            ctx = browser.new_context(color_scheme=theme, reduced_motion='reduce', service_workers='block')
            ctx.add_init_script("localStorage.setItem('chapterkeeparr.prefs.v1',JSON.stringify({theme:'" + theme + "',reduceMotion:true}));")
            ctx.route('**/*', lambda route: route.continue_() if route.request.method == 'GET' and route.request.url.startswith(base + '/') else route.abort())
            page = ctx.new_page(); page.on('pageerror', lambda error: page_errors.append(str(error)))

            def ready(width=390, height=844, route=None):
                page.set_viewport_size({'width': width, 'height': height})
                page.goto(base + '/' + (route or '#/review/' + rid), wait_until='networkidle')
                page.wait_for_function("!document.documentElement.dataset.vt")
                page.evaluate('document.fonts.ready')

            ready()
            gap = page.locator('#accept-gap'); save = page.locator('[data-act="accept"]')
            expect(save).to_be_hidden(); gap.check(); expect(save).to_be_visible(); expect(save).to_be_disabled()
            assert save.evaluate('e=>getComputedStyle(e).backgroundColor') == 'rgb(247, 242, 232)'
            gap.uncheck(); expect(save).to_be_hidden(); gap.check()
            page.locator('[data-act="cr-lower"]').click()
            # Real decision controls, including an inline rename and undo via Change.
            first = page.locator('.cr-card:not(.decided)[data-cr-item^="m"]').first
            item = first.get_attribute('data-cr-item')
            first.locator('[data-act="cr-rename"]').click()
            page.locator('#rename-' + item).fill('My reviewed chapter')
            page.locator('[data-act="cr-use-name"]').click()
            expect(page.locator('[data-cr-item="' + item + '"]')).to_have_class('cr-card decided')
            expect(page.locator('[data-cr-item="' + item + '"]')).to_contain_text('My reviewed chapter')
            page.locator('[data-act="cr-change"][data-arg="' + item + '"]').click()
            for _ in range(100):
                picks = page.locator('.cr-card:not(.decided) .cr-options [data-act="cr-pick"]')
                if not picks.count(): break
                picks.first.click()
            expect(save).to_be_enabled()
            page.screenshot(path=str(output / ('ready-' + theme + '.png')), full_page=False)
            # Individual decisions and consent survive ordinary polling and navigation.
            page.evaluate("async()=>{const s=await import('/static/js/store.js');s.touch()}")
            expect(gap).to_be_checked(); expect(save).to_be_enabled()
            page.goto(base + '/#/queue', wait_until='networkidle')
            page.goto(base + '/#/review/' + rid, wait_until='networkidle')
            page.reload(wait_until='networkidle')
            expect(gap).to_be_checked(); expect(save).to_be_enabled()
            writes = []
            def failed(route):
                writes.append(route.request.post_data_json)
                route.fulfill(status=503, json={'detail': 'Simulated acceptance failure'})
            page.route('**/api/jobs/*/accept-recovery', failed)
            save.evaluate('el=>{el.click();el.click()}')
            expect(page.locator('.accept')).to_contain_text('Simulated acceptance failure')
            assert len(writes) == 1
            assert len(writes[0]['marker_decisions']) == pvalue['total']
            assert writes[0]['draft_token'] == pvalue['token'] and writes[0]['accept_possible_gap']
            expect(gap).to_be_checked(); expect(save).to_be_enabled()
            page.unroute('**/api/jobs/*/accept-recovery', failed)
            # Changed evidence resets both decisions and consent, even with saved browser edits.
            changed = json.load(urlopen(base + '/api/jobs/' + rid, timeout=10))
            changed['recovery_acceptance_preview']['token'] += '-different'; changed['updated_at'] += 1
            changed_jobs = json.loads(json.dumps(jobs))
            for job in changed_jobs:
                if job['id'] == rid: job['updated_at'] = changed['updated_at']
            def new_detail(route): route.fulfill(json=changed)
            def new_list(route): route.fulfill(json={'jobs': changed_jobs})
            page.route('**/api/jobs/' + rid, new_detail); page.route('**/api/jobs?limit=1000', new_list)
            page.evaluate("async()=>{const s=await import('/static/js/store.js');await s.refresh()}")
            expect(gap).not_to_be_checked(); expect(save).to_be_hidden()
            expect(page.locator('.accept')).to_contain_text('The draft changed')
            assert page.locator('.cr-card.decided').count() == 0
            page.unroute('**/api/jobs/' + rid, new_detail); page.unroute('**/api/jobs?limit=1000', new_list)
            # A successful accepted response advances to the next waiting book.
            ready()
            if page.locator('[data-act="cr-lower"]').count(): page.locator('[data-act="cr-lower"]').click()
            for _ in range(100):
                picks = page.locator('.cr-card:not(.decided) .cr-options [data-act="cr-pick"]')
                if not picks.count(): break
                picks.first.click()
            gap.check(); expect(save).to_be_enabled()
            after = json.loads(json.dumps(jobs))
            for job in after:
                if job['id'] == rid: job.update(status='queued', stage='queued', updated_at=job['updated_at'] + 1)
            def queued(route): route.fulfill(json={'jobs': after})
            page.route('**/api/jobs?limit=1000', queued)
            page.route('**/api/jobs/*/accept-recovery', lambda route: route.fulfill(json={'id': rid, 'status': 'queued'}))
            save.click(); page.wait_for_url('**/#/review/' + other + '?continued=1')
            expect(page.locator('[data-act="accept"]')).to_have_count(0)
            page.unroute('**/api/jobs?limit=1000', queued)
            page.unroute('**/api/jobs/*/accept-recovery')
            # Notification covers: use a generated test image, exercising authenticated
            # same-origin blob hydration rather than a provider-only image tag.
            art = Path('app/static/icon-192.png').read_bytes()
            cover_requests = []
            def image(route):
                cover_requests.append(route.request.url)
                route.fulfill(body=art, content_type='image/png')
            page.route('**/api/jobs/*/cover', image)
            ready(1440, 1400, '#/queue')
            page.reload(wait_until='networkidle')
            page.wait_for_function("!document.documentElement.dataset.vt")
            page.evaluate('''async ids => {const {notify}=await import('/static/js/notify.js');
              for(let i=0;i<6;i++) notify({kind:i===0?'plain':'info',title:'Notification '+i,body:'A queued or cancelled test book',jobId:ids[i%ids.length],dest:'queue',href:'#/queue',action:'Watch'});
              window.__notes=[...document.querySelectorAll('#notes .note-card')];
            }''', [j['id'] for j in jobs[:3]])
            expect(page.locator('#notes .note-card')).to_have_count(3)
            expect(page.locator('.note-waiting')).to_have_text('3 more waiting')
            page.locator('#notes').hover()
            page.wait_for_function("[...document.querySelectorAll('#notes .cover img')].every(i=>i.complete&&i.naturalWidth>0&&i.classList.contains('loaded'))")
            assert cover_requests
            positions = page.locator('#notes .note-slot').evaluate_all('els=>els.map(e=>e.getBoundingClientRect().top)')
            page.evaluate("async()=>{const s=await import('/static/js/store.js');s.touch();await s.refresh()}")
            assert page.evaluate("window.__notes.every((el,i)=>el===document.querySelectorAll('#notes .note-card')[i])")
            page.screenshot(path=str(output / ('notifications-' + theme + '.png')), full_page=False)
            page.locator('#notes [data-note-close]').first.click()
            page.wait_for_function("document.querySelector('.note-waiting').textContent==='2 more waiting'")
            assert positions == page.locator('#notes .note-slot').evaluate_all('els=>els.map(e=>e.getBoundingClientRect().top)')
            assert page.evaluate("window.__notes[1]===document.querySelectorAll('#notes .note-card')[1]")
            # Several visible cards, scrollable overflow and keyboard dismiss remain
            # reachable at narrow widths, with no horizontal overflow.
            for width, height in [(320,740),(390,844),(820,1180),(1024,768),(1440,900)]:
                page.set_viewport_size({'width':width,'height':height})
                page.wait_for_function("!document.documentElement.dataset.vt")
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
            if args.axe:
                audit_accessibility(page, args.axe, output, 'notifications-' + theme)
            ctx.close(); results.append({'theme':theme,'workflow':'pass','notifications':'pass'})
            print(theme + ': review decisions, draft reset, handoff and notifications passed', flush=True)
        design_edges(browser, base, rid, page_errors)
        browser.close()
    assert not page_errors, page_errors
    (output/'reconciled-results.json').write_text(json.dumps({'results':results,'page_errors':page_errors},indent=2))


if __name__ == '__main__': main()
