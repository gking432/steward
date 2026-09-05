import test from 'node:test';
import assert from 'node:assert/strict';
import { goldenWorkspace, demoWorkspace, FIXTURE_TODAY } from '../fixtures/golden-workspace';
import { toModel } from '../lib/model/convert';
import { evaluatePurchase, dailyInsights } from '../lib/model/decide';
import { projectArrivals, planCycle } from '../lib/model/engine';
import { defaultPolicy } from '../lib/model/policy';
import { fallbackIntent } from '../lib/model/ai';
import { resolveFollowup, type PendingIntent } from '../lib/model/conversation';
import { previewAIOnboarding, EMPTY_AI_ONBOARDING_STATE } from '../lib/model/onboarding-ai';
import { migrateWorkspace } from '../lib/model/persistence';

test('one cent outside an allowance does not erase a goal completed this cycle',()=>{
 const w=toModel(goldenWorkspace());
 const before=projectArrivals(w,FIXTURE_TODAY);
 const after=projectArrivals(w,FIXTURE_TODAY,defaultPolicy,0.01);
 const keyboard=w.claims.find(c=>/keyboard/i.test(c.name))!;
 assert.ok(before.find(a=>a.claimId===keyboard.id)?.arrivalDate);
 assert.equal(after.find(a=>a.claimId===keyboard.id)?.arrivalDate,before.find(a=>a.claimId===keyboard.id)?.arrivalDate);
 assert.ok(!evaluatePurchase(w,FIXTURE_TODAY,{item:'unplanned item',price:0.01})!.tradeoff.includes('beyond a year'));
 assert.deepEqual(projectArrivals(w,FIXTURE_TODAY,defaultPolicy,0),before);
});
test('groceries use the remaining allowance and only excess competes with goals',()=>{
 const w=toModel(goldenWorkspace());
 for(const price of [0.01,50,67.60]) {
  const verdict=evaluatePurchase(w,FIXTURE_TODAY,{item:'groceries',price})!;
  assert.equal(verdict.answer,'yes');assert.deepEqual(verdict.consequences,[]);
  assert.match(verdict.checks.find(c=>c.label==='Groceries')!.detail,/67.60 left/);
 }
 const extra=evaluatePurchase(w,FIXTURE_TODAY,{item:'groceries',price:75})!;
 const unplanned=evaluatePurchase(w,FIXTURE_TODAY,{item:'unplanned item',price:7.40})!;
 assert.deepEqual(extra.consequences,unplanned.consequences);
 assert.equal(extra.checks.find(c=>c.label==='Groceries')!.status,'warn');
 // Zero goal capacity is not a reason to reject an already-budgeted purchase.
 w.profile.takeHomePay-=planCycle(w,FIXTURE_TODAY)!.freeCapacity;
 assert.equal(evaluatePurchase(w,FIXTURE_TODAY,{item:'groceries',price:50})!.answer,'yes');
});
test('a correction retains the current topic and deadline, not an earlier purchase',()=>{
 let context:PendingIntent={kind:'purchase',name:'groceries',missing:'amount'};
 assert.equal((resolveFollowup(context,'50') as {amount:number}).amount,50);
 assert.equal((resolveFollowup(context,'actually 75') as {amount:number}).amount,75);
 const camera=fallbackIntent('I want a camera for $200',FIXTURE_TODAY)!;
 assert.equal(camera.name,'Camera');assert.equal(camera.amount,200);
 context={kind:'goal',name:camera.name,missing:'amount',wantBy:'2026-12-25'};
 assert.deepEqual(resolveFollowup(context,'actually 250'),{...context,amount:250});
 assert.deepEqual(resolveFollowup(context,'cancel'),{cancelled:true});
 assert.equal(resolveFollowup(null,'actually 300'),null);
});
test('detected subscriptions become recurring obligations and do not produce allowance overspending',()=>{
 const w=previewAIOnboarding(toModel(demoWorkspace()),FIXTURE_TODAY,EMPTY_AI_ONBOARDING_STATE);
 const netflix=w.buckets.find(b=>b.name==='Netflix')!;
 assert.equal(netflix.kind,'reserve');assert.equal(netflix.amountDue,15.49);assert.equal(netflix.frequency,'monthly');
 assert.ok(netflix.dueDate!>FIXTURE_TODAY);assert.equal(netflix.perCycle,undefined);
 assert.ok(planCycle(w,FIXTURE_TODAY)!.reserves.some(r=>r.bucket.id===netflix.id));
 assert.ok(!dailyInsights(w,FIXTURE_TODAY).some(i=>/Netflix.*(hot|over)/i.test(i.headline)));
 const old={...w,buckets:w.buckets.map(b=>b.id===netflix.id?{...b,kind:'spend' as const,perCycle:7.75,amountDue:undefined,dueDate:undefined}:b)};
 const migrated=migrateWorkspace(old);
 assert.equal(migrated.buckets.find(b=>b.id===netflix.id)!.kind,'reserve');
 assert.deepEqual(migrateWorkspace(migrated),migrated);
});

test('a real first-cycle funding shortfall delays a goal by a cycle, not beyond the horizon',()=>{
 const w=toModel(goldenWorkspace());w.buckets=[];w.profile.takeHomePay=10;w.profile.bufferFloor=0;
 w.claims=[{...w.claims.find(c=>/keyboard/i.test(c.name))!,targetAmount:10,fundedAmount:0,delayCost:{type:'none'},wantBy:undefined,pinned:undefined}];
 const before=projectArrivals(w,FIXTURE_TODAY)[0];
 const after=projectArrivals(w,FIXTURE_TODAY,defaultPolicy,1)[0];
 assert.ok(before.arrivalDate);assert.ok(after.arrivalDate);assert.ok(after.arrivalDate>before.arrivalDate);
 assert.equal(after.beyondHorizon,false);
});
