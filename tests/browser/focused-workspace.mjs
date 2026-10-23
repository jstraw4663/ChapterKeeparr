import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const out=process.env.REVIEW_OUTPUT || '/tmp/ck-focused-results';
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000},serviceWorkers:'block'});
 await page.goto(process.env.REVIEW_TEST_URL || 'http://127.0.0.1:8794/__review-tests');
 await page.locator('#run').click();
 await page.waitForFunction(()=>/COMPLETE|FAIL/.test(document.querySelector('#results').textContent),{},{timeout:90000});
 const result=await page.locator('#results').innerText();
 await writeFile(out+'/results.txt',result);console.log(result);
 if(result.includes('FAIL'))process.exitCode=1;
 const frame=page.frameLocator('#app');
 await frame.locator('[data-act="choose"][data-arg="finalize"]').count().then(async n=>{if(n)await frame.locator('[data-act="choose"][data-arg="finalize"]').click()});
 await page.locator('#app').screenshot({path:out+'/phone.png'});
 await page.locator('#app').evaluate(el=>el.style.width='1440px');
 await page.setViewportSize({width:1500,height:1200});
 await page.waitForTimeout(700);
 await page.locator('#app').screenshot({path:out+'/desktop.png'});
} finally {await browser.close()}
