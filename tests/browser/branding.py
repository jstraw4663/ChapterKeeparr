"""Local branding, font loading and explicit/system theme precedence."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright


def main():
    p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:8767');p.add_argument('--chromium');p.add_argument('--output',default='/tmp/ck-brand-browser')
    args=p.parse_args();base=args.base.rstrip('/');out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    errors=[]
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=args.chromium)
        for pref,os_theme in [('system','light'),('system','dark'),('light','dark'),('dark','light')]:
            effective=os_theme if pref=='system' else pref
            for width in [320,390,820,1440]:
                ctx=browser.new_context(viewport={'width':width,'height':900},color_scheme=os_theme,reduced_motion='reduce',service_workers='block')
                ctx.add_init_script("localStorage.setItem('chapterkeeparr.prefs.v1',"+json.dumps(json.dumps({'theme':pref,'reduceMotion':True}))+');')
                ctx.route('**/*',lambda r:r.continue_() if r.request.method=='GET' and r.request.url.startswith(base+'/') else r.abort())
                page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+'/',wait_until='networkidle');page.evaluate('document.fonts.ready')
                value=page.evaluate("""() => ({family:getComputedStyle(document.body).fontFamily,bg:getComputedStyle(document.body).backgroundColor,
                    fonts:[...document.fonts].filter(f=>f.family==='Manrope').map(f=>f.status)})""")
                assert 'Manrope' in value['family'] and value['fonts']==['loaded','loaded'],value
                assert value['bg']==('rgb(31, 29, 26)' if effective=='dark' else 'rgb(247, 242, 232)'),value
                owner=page.locator('.mh-brand' if width<768 else '.brand')
                right=owner.locator('.brand-on-'+('dark' if effective=='dark' else 'light'))
                assert right.count()==2
                assert right.evaluate_all("els=>els.every(e=>getComputedStyle(e).display!=='none'&&e.complete&&e.naturalWidth>0)")
                for image in right.all():
                    bounds=image.bounding_box();assert bounds['width']>0 and bounds['x']+bounds['width']<=width+1,bounds
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
                page.screenshot(path=str(out/f'brand-{pref}-{os_theme}-{width}.png'),animations='disabled')
                ctx.close();print(f'{pref}/{os_theme} {width}px: local fonts, theme and brand assets passed',flush=True)
        browser.close()
    assert not errors,errors


if __name__=='__main__':main()
