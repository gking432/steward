import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { before, after, test } from 'node:test';
let server;
const origin=process.env.STEWARD_TEST_URL ?? 'http://localhost:3002';
before(async()=>{
 if(!process.env.STEWARD_TEST_URL) server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-p','3002'],{env:{...process.env,VERCEL:'1'},stdio:'ignore'});
 for(let n=0;n<50;n++){try{if((await fetch(origin+'/fixture')).ok)return;}catch{}await new Promise(r=>setTimeout(r,200));}
 throw Error('Production server did not become ready. Build the Vercel target first.');
});
after(()=>server?.kill());
const page=async path=>{const r=await fetch(origin+path);assert.equal(r.status,200);return r.text();};
test('sample home renders a reconciled allowance and explicit demo identity',async()=>{const html=await page('/fixture');assert.match(html,/83\.95/);assert.match(html,/synthetic data/);assert.match(html,/Net spending allowance/);assert.match(html,/26\.15/);});
test('entry offers immediate demo and manual routes',async()=>{const html=await page('/');assert.match(html,/href="\/fixture"/);assert.match(html,/href="\/manual"/);});
test('full setup remains a distinct reachable route',async()=>{const html=await page('/demo');assert.match(html,/Explore a sample plan/);assert.match(html,/Let.{0,15}s talk about your money/);assert.match(html,/setup-message/);});
test('unverified private requests fail closed instead of sharing a local identity',async()=>{const r=await fetch(origin+'/api/steward',{headers:{'oai-authenticated-user-email':'spoof@example.com'}});assert.equal(r.status,503);assert.ok(!(await r.json()).workspace);});
test('critical phrasing is deterministic and explicitly reports its origin',async()=>{const r=await fetch(origin+'/api/steward-ai',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({kind:'phrase',headline:'Wait.',verdict:'wait',tradeoff:'Balances are stale.',checks:[]})});const body=await r.json();assert.equal(body.origin,'deterministic');assert.equal(body.enhanced,false);});
test('receipt parser rejects unsupported image data',async()=>{const r=await fetch(origin+'/api/receipt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({image:'data:text/html;base64,'+'a'.repeat(40),total:10,categories:['Groceries']})});assert.equal(r.status,400);});
