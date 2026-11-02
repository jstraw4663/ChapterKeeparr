"""Real end-to-end inventory scans against tests/fixtures/library_health.py."""
import argparse
import json
import re
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
from browser_support import SETTLED_CSS, audit_accessibility


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base-url', default='http://127.0.0.1:8768')
    parser.add_argument('--output', default='/tmp/chapterkeeparr-health-results')
    parser.add_argument('--axe')
    parser.add_argument('--chromium', default=None)
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    observations, errors = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=args.chromium, headless=True, args=['--no-sandbox'])
        for theme in ['light', 'dark']:
            context = browser.new_context(color_scheme=theme, reduced_motion='reduce', service_workers='block')
            context.add_init_script("localStorage.setItem('chapterkeeparr.prefs.v1',JSON.stringify({theme:'" + theme + "',reduceMotion:true}));")
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.set_viewport_size({'width': 1440, 'height': 1000})
            page.goto(args.base_url, wait_until='networkidle')
            def open_world():
                toggle = page.locator('.health-book-row').filter(has_text='World War Z (2006)').locator('[data-act="health-expand"]')
                if toggle.get_attribute('aria-expanded') != 'true':
                    toggle.click()
            expect(page.locator('#health-root')).not_to_have_value('')
            page.get_by_role('button', name='Scan library', exact=True).click()
            expect(page.get_by_role('heading', name='Scan results', exact=True)).to_be_visible(timeout=30000)
            expect(page.locator('.health-book-row')).to_have_count(6)
            open_world()
            expect(page.get_by_role('region', name='Details for World War Z (2006)', exact=True)).to_contain_text('Multiple copies to compare')
            expect(page.get_by_role('region', name='Details for World War Z (2006)', exact=True)).to_contain_text('Hardlinked')
            finding = page.locator('.health-finding').filter(has_text='Multiple copies to compare')
            finding.get_by_role('button', name='Keep as is', exact=True).click()
            expect(finding).to_contain_text('Kept as is')
            page.reload(wait_until='networkidle')
            expect(page.locator('.health-book-row')).to_have_count(6)
            open_world()
            finding = page.locator('.health-finding').filter(has_text='Multiple copies to compare')
            expect(finding).to_contain_text('Kept as is')
            finding.get_by_role('button', name='Reopen', exact=True).click()
            expect(finding.get_by_role('button', name='Keep as is', exact=True)).to_be_visible()
            # Covers load locally; selection and exceptions apply to precisely the chosen books.
            first_cover = page.locator('.health-book-row').first.locator('.cover')
            first_cover.scroll_into_view_if_needed()
            expect(first_cover).to_have_class(re.compile('has-art'), timeout=15000)
            for title in ['World War Z (2006)', 'Kindred (1979)']:
                page.get_by_role('checkbox', name='Select ' + title, exact=True).click()
            expect(page.locator('.health-selection-bar')).to_contain_text('2 selected')
            expect(page.locator('thead').get_by_role('checkbox')).to_have_attribute('aria-checked', 'mixed')
            page.locator('[data-act="health-expand-selected"]').click()
            expect(page.get_by_role('region', name='Details for Kindred (1979)', exact=True)).to_be_visible()
            page.locator('[data-act="health-bulk-keep"]').click()
            expect(page.get_by_role('region', name='Confirm exceptions')).to_contain_text('2 selected books')
            page.locator('[data-act="health-bulk-confirm"]').click()
            for title in ['World War Z (2006)', 'Kindred (1979)']:
                expect(page.locator('.health-book-row').filter(has_text=title)).to_contain_text('No open findings')
            page.locator('[data-act="health-bulk-reopen"]').click()
            expect(page.locator('.health-book-row').filter(has_text='World War Z (2006)')).to_contain_text('Needs review')
            page.locator('[data-act="health-collapse-selected"]').click()
            page.locator('[data-act="health-clear-selection"]').click()
            page.get_by_role('checkbox', name='Select World War Z (2006)', exact=True).click()
            page.locator('#health-search').fill('Kindred')
            expect(page.locator('.health-selection-bar')).to_contain_text('1 outside this filter')
            matching = page.locator('thead').get_by_role('checkbox')
            matching.focus()
            matching.press('Space')
            expect(matching).to_have_attribute('aria-checked', 'true')
            expect(page.locator('.health-selection-bar')).to_contain_text('2 selected')
            matching.press('Space')
            expect(page.locator('.health-selection-bar')).to_contain_text('1 selected')
            page.locator('[data-act="health-clear-selection"]').click()
            page.locator('#health-search').fill('')
            page.get_by_role('button', name='Multiple copies', exact=False).first.click()
            expect(page.locator('.health-book-row')).to_have_count(1)
            page.locator('[data-act="health-filter"][data-arg="all"]').click()
            page.locator('#health-search').fill('Kindred')
            expect(page.locator('.health-book-row')).to_have_count(1)
            page.locator('#health-search').fill('')
            expect(page.locator('.health-book-row')).to_have_count(6)
            open_world()
            for width in [390, 768, 1024, 1440]:
                page.set_viewport_size({'width': width, 'height': 1000})
                settled = page.add_style_tag(content=SETTLED_CSS)
                # Media-query callbacks can still be pending after a viewport
                # resize. Audit the settled sidebar, not its expand/collapse fade.
                page.wait_for_function('''() => {
                    const collapsed = innerWidth >= 768 && innerWidth < 1100;
                    const card = document.querySelector('[data-activity-card]');
                    return document.documentElement.classList.contains('collapsed') === collapsed &&
                      card.inert === collapsed && (collapsed || Number(getComputedStyle(card).opacity) === 1);
                }''')
                expect(page.get_by_role('region', name='Details for World War Z (2006)', exact=True)).to_be_visible()
                page.evaluate('document.fonts.ready')
                measured = page.evaluate('''() => ({width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
                    duplicates: [...document.querySelectorAll('[id]')].map(e=>e.id).filter((id,i,a)=>a.indexOf(id)!==i)})''')
                assert measured['scrollWidth'] <= width + 1, (theme, measured)
                assert measured['duplicates'] == [], measured
                if width == 390:
                    toggle = page.locator('.health-book-row').filter(has_text='World War Z (2006)').locator('[data-act="health-expand"]')
                    toggle.click()
                    expect(page.get_by_role('region', name='Details for World War Z (2006)', exact=True)).to_have_count(0)
                    open_world()
                if args.axe:
                    audit_accessibility(page, args.axe, output, f'{theme}-{width}')
                settled.evaluate('el=>el.remove()')
                page.evaluate('window.scrollTo(0,0)')
                page.screenshot(path=str(output / f'library-{theme}-{width}.png'), full_page=True, animations='disabled')
                observations.append({'theme': theme, **measured})
            # Scan history survives a reload and selecting an older report.
            page.set_viewport_size({'width': 1440, 'height': 1000})
            previous = page.locator('#health-history').input_value()
            page.get_by_role('button', name='Scan library', exact=True).click()
            expect(page.get_by_role('heading', name='Scan results', exact=True)).to_be_visible(timeout=30000)
            expect(page.locator('#health-history')).not_to_have_value(previous)
            expect(page.get_by_role('button', name='Scan library', exact=True)).to_be_enabled(timeout=30000)
            options_toggle = page.locator('[data-act="toggle"][data-arg="health-scan-controls"]')
            if options_toggle.get_attribute('aria-expanded') != 'true':
                options_toggle.click()
            page.locator('#health-history').select_option(previous)
            expect(page.locator('.health-book-row')).to_have_count(6)
            # A failed scan submission is actionable and preserves loaded results.
            page.route('**/api/library/scans', lambda route: route.fulfill(status=503, json={'detail': 'Fixture storage unavailable'}) if route.request.method == 'POST' else route.continue_())
            page.get_by_role('button', name='Scan library', exact=True).click()
            expect(page.get_by_role('alert')).to_contain_text('Fixture storage unavailable')
            expect(page.locator('.health-book-row')).to_have_count(6)
            context.close()
        browser.close()
    assert not errors, errors
    (output / 'observations.json').write_text(json.dumps(observations, indent=2))
    print(f'{len(observations)} viewport/theme checks passed; real scans, review/reopen, reload, filters, history and failure handling passed')


if __name__ == '__main__':
    main()
