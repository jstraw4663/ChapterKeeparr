"""Resize/fade race regression and a deliberate, expected contrast failure.

Use the disposable worker-disabled ui_seed server. No real library writes.
"""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_support import audit_accessibility


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:8767')
    parser.add_argument('--axe', required=True)
    parser.add_argument('--chromium')
    parser.add_argument('--output', default='/tmp/ck-accessibility-stability')
    args = parser.parse_args(); base = args.base.rstrip('/')
    output = Path(args.output); output.mkdir(parents=True, exist_ok=True)
    observations = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=args.chromium, headless=True)
        for theme in ['light', 'dark']:
            ctx = browser.new_context(viewport={'width':1440,'height':900},
                reduced_motion='reduce', color_scheme=theme, service_workers='block')
            ctx.add_init_script("localStorage.setItem('chapterkeeparr.prefs.v1',JSON.stringify({theme:'"+theme+"',reduceMotion:true}));")
            ctx.route('**/*', lambda route: route.continue_() if route.request.method=='GET' and route.request.url.startswith(base+'/') else route.abort())
            page = ctx.new_page(); page.goto(base+'/#/queue', wait_until='networkidle')
            for attempt in range(3):
                for width in [320,390,820,1024,1440]:
                    page.set_viewport_size({'width':width,'height':900})
                page.wait_for_function("!document.documentElement.classList.contains('collapsed')")
                audit_accessibility(page,args.axe,output,f'resize-{theme}-{attempt}')
            # Hold the app's real Activity-card fade at low opacity so the old
            # race reproduces deterministically, independent of runner speed.
            slow = page.add_style_tag(content='''html[data-motion="reduce"] .act{
              animation-name:fadein!important;animation-duration:60s!important;
              animation-delay:-6s!important;animation-timing-function:linear!important;
              animation-fill-mode:both!important}''')
            page.evaluate("document.querySelector('.act').getBoundingClientRect()")
            opacity = page.locator('.act').evaluate('el=>Number(getComputedStyle(el).opacity)')
            assert 0 < opacity < .5, opacity
            raw = page.evaluate("async()=>{const r=await axe.run(document,{runOnly:{type:'rule',values:['color-contrast']}});return r.violations}")
            assert any(v['id']=='color-contrast' for v in raw), 'Held fade did not reproduce the contrast failure'
            (output/f'raw-fade-{theme}.json').write_text(json.dumps(raw,indent=2))
            audit_accessibility(page,args.axe,output,'settled-fade-'+theme)
            assert page.locator('.act').evaluate('el=>getComputedStyle(el).animationDuration')=='60s', 'Audit left motion disabled'
            slow.evaluate('el=>el.remove()'); ctx.close()
            # A permanent color defect must still fail with all contrast rules
            # enabled. Use an isolated document, so no app polling can affect it.
            ctx = browser.new_context(); page=ctx.new_page()
            page.set_content('''<!doctype html><html lang="en"><head><title>Expected contrast failure</title></head>
              <body style="background:white;color:black"><main><h1>Negative control</h1>
              <p id="bad" style="color:#ddd;background:white">This permanent contrast defect must fail.</p>
              </main></body></html>''')
            try:
                audit_accessibility(page,args.axe,output,'expected-negative-'+theme)
            except AssertionError:
                report=json.loads((output/f'expected-negative-{theme}-axe.json').read_text())
                assert any(v['id']=='color-contrast' for v in report['violations'])
            else:
                raise AssertionError('Static low-contrast text was incorrectly accepted')
            assert page.locator('#bad').evaluate('el=>getComputedStyle(el).color')=='rgb(221, 221, 221)'
            assert page.locator('style').count()==0, 'Failed audit leaked its timing override'
            ctx.close(); observations.append({'theme':theme,'resize_audits':3,'fade_reproduced':True,'static_defect_rejected':True})
            print(theme+': repeated resize/fade audits passed; expected static contrast failure detected',flush=True)
        browser.close()
    (output/'stability-results.json').write_text(json.dumps(observations,indent=2))


if __name__=='__main__':main()
