// Run `node serve.mjs` alongside the generated-fixture app, then `npm test`.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
const out=process.env.REVIEW_SCREENSHOTS || new URL('../../work/review-browser/',import.meta.url).pathname;
await mkdir(out,{recursive:true});
const browser=await chromium.launch(process.env.REVIEW_CHROME ? {channel:'chrome'} : {});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:8792/__review-tests');
 await page.getByRole('button',{name:'Run generated-fixture checks'}).click();
 await page.waitForFunction(()=>/COMPLETE|FAIL/.test(document.querySelector('#results').textContent),{},{timeout:120000});
 const report=await page.locator('#results').innerText();
 await writeFile(out+'/browser-results.txt',report);
 assert.ok(report.endsWith('COMPLETE'),report);assert.deepEqual(errors,[]);
 const iframe=page.frames().find(f=>f.url().includes('#/review/'));
 const url=iframe.url();
 for(const theme of ['light','dark'])for(const width of [390,1440]){
  await page.setViewportSize({width,height:width===390?844:1000});
  await page.goto(url);await page.locator('[data-act="choose"][data-arg="finalize"]').click();await page.locator('.nr-decision').waitFor();
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await page.waitForTimeout(650);await page.screenshot({path:`${out}/review-${width}-${theme}.jpg`,fullPage:true});
 }
 console.log(report);
}finally{await browser.close()}
