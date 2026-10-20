"""Delayed reads, background polls and navigation must not reload/reset screens.

Generated fixture only; mutations blocked. PWA checks use a real service worker.
"""
import argparse,copy,json,time
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright,expect


def main():
    p=argparse.ArgumentParser();p.add_argument('--base',default='http://127.0.0.1:8767');p.add_argument('--chromium');p.add_argument('--output',default='/tmp/ck-flow-browser');p.add_argument('--axe');p.add_argument('--pwa-only',action='store_true')
    args=p.parse_args();base=args.base.rstrip('/');out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    jobs=json.load(urlopen(base+'/api/jobs'))['jobs']
    rid=next(j['id'] for j in jobs if j.get('result',{}).get('report',{}).get('recovery_draft'))
    vid=next(j['id'] for j in jobs if j['status']=='complete')
    detail=json.load(urlopen(base+'/api/jobs/'+rid));errors=[];results=[]
    def wait_held(page,held,kind):
        deadline=time.monotonic()+5
        while not held[kind] and time.monotonic()<deadline:
            page.wait_for_timeout(10)  # Pump transport events until the explicit gate is reached.
        assert len(held[kind])==1,(kind,len(held[kind]))
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path=args.chromium,headless=True)
        for theme in ([] if args.pwa_only else ['light','dark']):
            for width in [390,1024]:
                for motion in ['reduce','no-preference']:
                    summary=copy.deepcopy(jobs);current_detail=copy.deepcopy(detail)
                    flags={'detail':False,'chapters':False,'failChapters':False};held={'detail':[],'chapters':[]};calls={'detail':0,'chapters':0}
                    chapters={'chapters':[{'title':f'Chapter {i+1}','start_seconds':i*20,'end_seconds':(i+1)*20} for i in range(16)],'duration_seconds':320}
                    ctx=browser.new_context(viewport={'width':width,'height':900},color_scheme=theme,reduced_motion=motion,service_workers='block')
                    ctx.add_init_script("sessionStorage.setItem('flowBoots',String(Number(sessionStorage.getItem('flowBoots')||0)+1));localStorage.setItem('chapterkeeparr.prefs.v1',"+json.dumps(json.dumps({'theme':theme,'reduceMotion':motion=='reduce'}))+');')
                    ctx.route('**/*',lambda r:r.continue_() if r.request.method=='GET' and r.request.url.startswith(base+'/') else r.abort())
                    ctx.route('**/api/jobs?limit=1000',lambda r:r.fulfill(json={'jobs':summary}))
                    def read_detail(r):
                        calls['detail']+=1
                        if flags['detail']:held['detail'].append(r)
                        else:r.fulfill(json=current_detail)
                    def read_chapters(r):
                        calls['chapters']+=1
                        if flags['failChapters']:r.fulfill(status=503,json={'detail':'Temporary chapter refresh failure'})
                        elif flags['chapters']:held['chapters'].append(r)
                        else:r.fulfill(json=chapters)
                    ctx.route('**/api/jobs/'+rid,read_detail);ctx.route('**/api/jobs/'+vid+'/chapters',read_chapters)
                    page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                    page.goto(base+'/#/review/'+rid,wait_until='networkidle')
                    first=page.locator('.cr-card:not(.decided)').first
                    first.locator('[data-act="cr-rename"]').click();field=page.locator('input[data-cr-name]');field.fill('My unsaved title')
                    field.evaluate('e=>{e.focus();e.setSelectionRange(3,8);window.flowField=e;}')
                    page.evaluate("window.flowHeader=document.querySelector('.review-detail');window.flowScroll=scrollY;window.fieldTop=flowField.getBoundingClientRect().top;window.flowMutations=0;window.flowObserver=new MutationObserver(r=>window.flowMutations+=r.length);flowObserver.observe(document.getElementById('view'),{subtree:true,childList:true,attributes:true,characterData:true});")
                    # A different job progresses: shell counters may update, the
                    # selected evidence tree and focused field must not patch.
                    other=next(j for j in summary if j['id']==vid);other['updated_at']+=1
                    page.evaluate("async()=>{await (await import('/static/js/store.js')).refresh()}")
                    page.evaluate('()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))')
                    assert page.evaluate('flowMutations')==0
                    assert page.evaluate('flowField===document.activeElement && flowField.selectionStart===3 && flowField.selectionEnd===8')
                    # The selected report changes: retain old content while the
                    # one current read is delayed, and block publication.
                    flags['detail']=True;next(j for j in summary if j['id']==rid)['updated_at']+=1
                    page.evaluate("async()=>{await (await import('/static/js/store.js')).refresh()}")
                    expect(page.get_by_text('Checking for updated chapter evidence…')).to_be_attached()
                    expect(field).to_have_value('My unsaved title');assert page.evaluate('flowHeader===document.querySelector(".review-detail") && flowField===document.activeElement')
                    assert page.evaluate('Math.abs(scrollY-flowScroll)<2 && Math.abs(flowField.getBoundingClientRect().top-fieldTop)<1')
                    wait_held(page,held,'detail');assert calls['detail']==2,calls
                    page.locator('#accept-gap').check();expect(page.locator('[data-act="accept"]')).to_be_disabled()
                    current_detail['updated_at']=next(j for j in summary if j['id']==rid)['updated_at']
                    flags['detail']=False;held['detail'].pop().fulfill(json=current_detail)
                    expect(page.get_by_text('Checking for updated chapter evidence…')).to_have_count(0)
                    expect(field).to_have_value('My unsaved title');expect(page.locator('#accept-gap')).to_be_checked()
                    # An actual changed evidence token must still reset consent.
                    flags['detail']=True;next(j for j in summary if j['id']==rid)['updated_at']+=1
                    page.evaluate("async()=>{await (await import('/static/js/store.js')).refresh()}")
                    wait_held(page,held,'detail')
                    current_detail['recovery_acceptance_preview']['token']+='-changed';flags['detail']=False
                    held['detail'].pop().fulfill(json=current_detail)
                    expect(page.locator('#accept-gap')).not_to_be_checked()
                    # Chapter reads also keep the loaded list during refresh.
                    page.evaluate('id=>location.hash="#/books/"+id',vid);expect(page.locator('#ch-filter')).to_be_visible()
                    page.locator('#ch-filter').fill('Chapter');expect(page.locator('.chrow').get_by_text('Chapter 1',exact=True)).to_be_visible()
                    page.locator('#ch-filter').evaluate('e=>{e.focus();e.setSelectionRange(2,5);window.chapterField=e;}')
                    flags['chapters']=True;other['updated_at']+=1
                    page.evaluate("async()=>{await (await import('/static/js/store.js')).refresh()}")
                    expect(page.locator('.chrow').get_by_text('Chapter 1',exact=True)).to_be_visible();assert page.evaluate('chapterField===document.activeElement && chapterField.selectionStart===2')
                    wait_held(page,held,'chapters');assert calls['chapters']==2,calls
                    chapters['chapters'][0]['title']='Chapter 1 refreshed';flags['chapters']=False
                    held['chapters'].pop().fulfill(json=chapters);expect(page.locator('.chrow').get_by_text('Chapter 1 refreshed',exact=True)).to_be_visible()
                    # A read failure keeps the list and permits a bounded, explicit retry.
                    flags['failChapters']=True;other['updated_at']+=1
                    page.evaluate("async()=>{await (await import('/static/js/store.js')).refresh()}")
                    expect(page.locator('[data-act="chapters-reload"]')).to_be_visible()
                    expect(page.locator('.chrow').get_by_text('Chapter 1 refreshed',exact=True)).to_be_visible()
                    flags['failChapters']=False;page.locator('[data-act="chapters-reload"]').click()
                    expect(page.locator('[data-act="chapters-reload"]')).to_have_count(0)
                    # Late data after leaving does not force a patch of Settings.
                    flags['chapters']=True;other['updated_at']+=1
                    page.evaluate("async()=>{await (await import('/static/js/store.js')).refresh()}")
                    wait_held(page,held,'chapters')
                    page.evaluate('location.hash="#/settings"');expect(page.locator('#set-token')).to_be_attached()
                    page.evaluate('window.settingsNode=document.querySelector("#view").firstElementChild')
                    flags['chapters']=False;held['chapters'].pop().fulfill(json=chapters)
                    page.evaluate("async()=>{await (await import('/static/js/store.js')).refresh()}")
                    assert page.evaluate('settingsNode===document.querySelector("#view").firstElementChild')
                    # Rapid changes settle on the most recent destination.
                    page.evaluate('location.hash="#/queue";setTimeout(()=>location.hash="#/",0);setTimeout(()=>location.hash="#/settings",5)')
                    expect(page.locator('#view h1')).to_have_text('Settings');page.wait_for_function('!document.documentElement.dataset.vt')
                    assert page.evaluate('sessionStorage.getItem("flowBoots")')=='1'
                    if args.axe:
                        from browser_support import audit_accessibility
                        audit_accessibility(page,args.axe,out,f'flow-{theme}-{width}-{motion}')
                    ctx.close();results.append({'theme':theme,'width':width,'motion':motion,'passed':True})
                    print(f'{theme} {width}px {motion}: polls, held reads, input/consent and latest navigation passed',flush=True)
        # Real worker lifecycle: controlling/updated/offline app navigations must
        # keep a single document; only the test's explicit reload adds a boot.
        ctx=browser.new_context(service_workers='allow');ctx.add_init_script("sessionStorage.setItem('pwaBoots',String(Number(sessionStorage.getItem('pwaBoots')||0)+1))")
        page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)));page.goto(base+'/',wait_until='networkidle')
        page.wait_for_function('navigator.serviceWorker.getRegistration().then(r=>r?.active?.state==="activated")',timeout=15000);page.wait_for_function('navigator.serviceWorker.controller')
        assert page.evaluate('sessionStorage.getItem("pwaBoots")')=='1'
        page.reload(wait_until='networkidle');assert page.evaluate('sessionStorage.getItem("pwaBoots")')=='2'
        page.evaluate('async()=>{await navigator.serviceWorker.register("/sw.js?flow-update=1");}')
        page.wait_for_function('navigator.serviceWorker.getRegistration().then(r=>Boolean(r.waiting))')
        for route,title in [('#/queue','Queue'),('#/settings','Settings'),('#/','Library')]:
            page.evaluate('route=>location.hash=route',route);expect(page.locator('#view h1')).to_have_text(title)
        assert page.evaluate('sessionStorage.getItem("pwaBoots")')=='2'
        page.evaluate('location.hash="#/settings/about"')
        expect(page.locator('[data-act="reload-assets"]')).to_be_visible()
        page.locator('[data-act="reload-assets"]').click()
        with page.expect_navigation(wait_until='networkidle'):
            page.get_by_role('button',name='Reload tab',exact=True).click()
        assert page.evaluate('sessionStorage.getItem("pwaBoots")')=='3'
        page.evaluate('location.hash="#/"');expect(page.locator('#view h1')).to_have_text('Library')
        ctx.set_offline(True);page.reload(wait_until='domcontentloaded');expect(page.locator('#view h1')).to_have_text('Library')
        assert page.evaluate('sessionStorage.getItem("pwaBoots")')=='4'
        ctx.close();browser.close();print('Real PWA: worker control, waiting update and cached offline shell passed',flush=True)
    assert not errors,errors
    (out/'results.json').write_text(json.dumps(results,indent=2))


if __name__=='__main__':main()
