// Disposable local test runner; never included in the application image.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
const upstream=process.env.REVIEW_URL || 'http://127.0.0.1:8791';
http.createServer(async(req,res)=>{
 try {
  const file={'/__review-tests':'runner.html','/__axe.js':'node_modules/axe-core/axe.min.js'}[req.url];
  if(file){res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'text/javascript');res.end(await readFile(new URL(file,import.meta.url)));return;}
  const body=[];for await(const c of req)body.push(c);
  const response=await fetch(upstream+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(body)});
  res.statusCode=response.status;response.headers.forEach((v,k)=>{if(!['content-encoding','content-length','transfer-encoding'].includes(k))res.setHeader(k,v)});res.end(Buffer.from(await response.arrayBuffer()));
 }catch(e){res.statusCode=500;res.end(e.message)}
}).listen(8792,'127.0.0.1',()=>console.log('Review test runner: http://127.0.0.1:8792/__review-tests'));
