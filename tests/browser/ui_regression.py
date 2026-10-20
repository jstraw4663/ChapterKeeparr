"""Browser regressions against tests/fixtures/ui_seed.py; never use a real library.

Run with an ENABLE_WORKERS=0 fixture server. All writes are intercepted; acceptance
and error flows are simulated in the browser without touching audiobook files.
"""
import argparse
import json
from pathlib import Path
from urllib.request import urlopen

from playwright.sync_api import sync_playwright, expect


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:8767')
    parser.add_argument('--output', default='/tmp/chapterkeeparr-browser-results')
    parser.add_argument('--chromium', default=None)
    parser.add_argument('--interactions-only', action='store_true')
    parser.add_argument('--axe', help='Path to the pinned axe-core script (development only)')
    args = parser.parse_args()
    base = args.base_url.rstrip('/')
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    jobs = json.load(urlopen(base + '/api/jobs', timeout=10))['jobs']
    rid = next(j['id'] for j in jobs if 'Frankenstein' in j['path'])
    eid = next(j['id'] for j in jobs if 'Moby-Dick' in j['path'])
    bid = next(j['id'] for j in jobs if 'Dracula' in j['path'])
    routes = ['#/', '#/suggestions', '#/queue', '#/review', '#/review/' + rid,
              '#/review/' + eid, '#/books/' + bid, '#/new', '#/settings/about']
    sizes = [(320, 740), (360, 800), (390, 844), (430, 932), (667, 375),
             (768, 1024), (820, 1180), (1024, 768), (1100, 800), (1280, 800), (1440, 900), (1920, 1080)]
    errors = []; observations = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chromium, headless=True)
        for theme in ['dark', 'light']:
            context = browser.new_context(color_scheme=theme, reduced_motion='reduce', service_workers='block')
            context.add_init_script("localStorage.setItem('chapterkeeparr.prefs.v1',JSON.stringify({theme:'" + theme + "',reduceMotion:true}));")
            def guard(route):
                if not route.request.url.startswith(base + '/') or route.request.method != 'GET':
                    route.abort()
                else:
                    route.continue_()
            context.route('**/*', guard)
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))

            def ready(route, width=1024, height=844):
                page.set_viewport_size({'width': width, 'height': height})
                page.goto(base + '/' + route, wait_until='networkidle')
                expect(page.locator('#view h1')).to_be_visible()
                page.evaluate('document.fonts.ready')
                # These are settled layout/color snapshots. Offscreen entrance
                # fades can remain pending until painted, so freezing them is
                # more reliable than waiting for every animation to finish.
                # Live motion is tested separately in reconciled_workflows.py.
                page.add_style_tag(content='*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}')
                page.wait_for_function("!document.documentElement.dataset.vt")

            for width, height in ([] if args.interactions_only else sizes):
                for route in routes:
                    ready(route, width, height)
                    if route == '#/review/' + rid:
                        expect(page.locator('#accept-gap')).to_be_attached()
                    measured = page.evaluate('''() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
                      duplicates: [...document.querySelectorAll('[id]')].map(e=>e.id).filter((id,i,all)=>all.indexOf(id)!==i),
                      titleWidth: document.querySelector('.revhead h2')?.getBoundingClientRect().width,
                      fontLoaded: document.fonts.check('15px Figtree') })''')
                    assert measured['scrollWidth'] <= width + 1, (theme, route, measured)
                    assert measured['duplicates'] == [], (route, measured)
                    assert measured['fontLoaded'], route
                    if measured.get('titleWidth') is not None:
                        assert measured['titleWidth'] >= 180, (route, measured)
                    observations.append({'theme': theme, 'route': route, **measured})
                    if args.axe and width in [390, 1024]:
                        page.add_script_tag(path=args.axe)
                        violations = page.evaluate("async()=>{const r=await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa']}});return r.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}));}")
                        assert violations == [], (theme, width, route, violations)

            print(f'{theme}: {len(observations)} viewport observations passed', flush=True)
            ready('#/review/' + rid, 390)
            gap = page.locator('#accept-gap'); save = page.locator('[data-act="accept"]')
            expect(save).to_be_hidden()
            gap.check(); expect(save).to_be_visible(); expect(save).to_be_disabled()
            save.scroll_into_view_if_needed()
            page.screenshot(path=str(output / ('review-consent-' + theme + '.png')), full_page=False, animations='disabled')
            assert save.evaluate("e=>getComputedStyle(e).backgroundColor") == 'rgb(255, 255, 255)'
            expect(gap).to_be_focused()
            gap.uncheck(); expect(save).to_be_hidden()
            gap.check()
            page.locator('[data-act="toggle"][data-arg="chapter-advanced"]').click()
            page.locator('#accept-min').fill('80')
            for _ in range(30):
                choices = page.locator('.cr-card:not(.decided) .cr-options [data-act="cr-pick"]')
                if not choices.count(): break
                choices.first.click()
            try:
                expect(save).to_be_enabled()
            except Exception:
                page.screenshot(path=str(output / ('decision-failure-' + theme + '.png')), full_page=True)
                print('Decision failure:', page.locator('#view').inner_text(), flush=True)
                print('Saved fixture draft:', page.evaluate("async id=>(await import('/static/js/review-drafts.js')).loadDraft(id)", rid), flush=True)
                raise
            # Failed submit retains approvals; a second click while pending is blocked.
            writes = []
            def fail_submit(route):
                writes.append(route.request.post_data_json)
                route.fulfill(status=503, json={'detail': 'Simulated server failure'})
            page.route('**/api/jobs/*/accept-recovery', fail_submit)
            save.evaluate('button=>{button.click();button.click()}'); expect(page.locator('.accept')).to_contain_text('Simulated server failure')
            assert len(writes) == 1 and writes[0]['accept_possible_gap'] is True
            expect(gap).to_be_checked(); expect(save).to_be_enabled()
            page.unroute('**/api/jobs/*/accept-recovery', fail_submit)
            # Native disclosures and approvals survive unrelated store updates.
            disclosure = page.locator('details.more')
            disclosure.locator(':scope > summary').click()
            page.evaluate("async()=>{const s=await import('/static/js/store.js');s.touch()}")
            expect(disclosure).to_have_attribute('open', '')
            expect(gap).to_be_checked()
            changed = json.load(urlopen(base + '/api/jobs/' + rid, timeout=10))
            changed['recovery_acceptance_preview']['token'] += '-changed'
            def new_draft(route): route.fulfill(json=changed)
            page.route('**/api/jobs/' + rid, new_draft)
            changed_jobs = json.loads(json.dumps(jobs))
            for job in changed_jobs:
                if job['id'] == rid: job['updated_at'] += 1
            changed['updated_at'] += 1
            def new_list(route): route.fulfill(json={'jobs': changed_jobs})
            page.route('**/api/jobs?limit=1000', new_list)
            page.evaluate("async()=>{const s=await import('/static/js/store.js');await s.refresh()}")
            expect(gap).not_to_be_checked(); expect(save).to_be_hidden()
            expect(page.locator('.accept')).to_contain_text('The draft changed')
            page.unroute('**/api/jobs/' + rid, new_draft)
            page.unroute('**/api/jobs?limit=1000', new_list)
            # Keyboard skip navigation keeps the current hash route.
            ready('#/queue', 390)
            page.locator('.skip').focus(); page.keyboard.press('Enter')
            assert page.evaluate('location.hash') == '#/queue'
            expect(page.locator('#view')).to_be_focused()
            # Cover rail expansion, Escape, and responsive resizing preserve selection.
            ready('#/review/' + rid, 1024)
            toggle = page.locator('#review-list-toggle')
            page.screenshot(path=str(output / ('review-windowed-' + theme + '.png')), full_page=False, animations='disabled')
            width_before = page.locator('.review-detail').bounding_box()['width']
            toggle.click(); expect(toggle).to_have_attribute('aria-expanded', 'true')
            page.screenshot(path=str(output / ('review-expanded-' + theme + '.png')), full_page=False, animations='disabled')
            assert abs(page.locator('.review-detail').bounding_box()['width'] - width_before) < 1, (width_before, page.locator('.review-detail').bounding_box())
            page.keyboard.press('Escape'); expect(toggle).to_have_attribute('aria-expanded', 'false')
            expect(toggle).to_be_focused()
            ready('#/review', 1024)
            page.locator('.review-overview a[href="#/review/' + rid + '"]').click()
            expect(page.locator('.revhead h2')).to_be_focused()
            for width in [1440, 1101, 1100, 1099, 1024, 1023, 900, 820, 768, 767, 390, 900, 1440]:
                page.set_viewport_size({'width': width, 'height': 844})
                page.wait_for_timeout(500)
                assert page.evaluate('document.documentElement.scrollWidth') <= width + 1
                assert page.evaluate('location.hash') == '#/review/' + rid
            # Explicit expanded sidebar also reflows at tablet widths.
            sidebar = page.locator('[data-act="collapse"]')
            if sidebar.get_attribute('aria-expanded') == 'true': sidebar.click()
            sidebar.click()  # Save an explicit expanded preference, not automatic mode.
            for width in [1024, 900, 820, 768]:
                page.set_viewport_size({'width': width, 'height': 844}); page.wait_for_timeout(500)
                expect(sidebar).to_have_attribute('aria-expanded', 'true')
                assert page.evaluate('document.documentElement.scrollWidth') <= width + 1
            # Long words and multiple narrators must reflow, including with the sidebar expanded.
            for width in [768, 1024, 390, 320]:
                ready('#/review/' + rid, width)
                page.evaluate("""() => {
                  document.querySelector('.revhead h2,.review-mobile-head h1').textContent = 'Frankenstein; or, The Modern Prometheus — An Unabridged Dramatic Reading ' + 'LongUnbrokenTitle'.repeat(5);
                  const metadata = document.querySelector('.revhead p,.review-mobile-head .meta');
                  metadata.textContent = 'Narrated by Eve Fixture, Second Fixture, Third Fixture, Fourth Fixture and Fifth Fixture';
                }""")
                assert page.evaluate('document.documentElement.scrollWidth') <= width + 1
            # Editing state survives path changes and Settings diagnostics remain redacted.
            ready('#/review/' + eid, 390)
            page.locator('#rv-find').fill('A deliberately long edition search')
            page.locator('[data-act="choose"][data-arg="resume"]').click()
            page.locator('[data-act="choose"][data-arg="edition"]').click()
            expect(page.locator('#rv-find')).to_have_value('A deliberately long edition search')
            ready('#/settings/about', 390)
            page.locator('[data-act="copy-diagnostics"]').click()
            text = page.locator('.diagnostics').text_content()
            assert '/tmp/' not in text and 'library_roots' not in text and 'api_token' not in text
            page.screenshot(path=str(output / ('settings-' + theme + '.png')), full_page=False, animations='disabled')
            context.close()
        browser.close()
    assert not errors, errors
    report = {'observations': observations, 'page_errors': errors, 'interaction_checks': 'passed'}
    (output / 'results.json').write_text(json.dumps(report, indent=2))
    print(f"Passed {len(observations)} viewport/theme observations and focused workflow checks.")


if __name__ == '__main__':
    main()
