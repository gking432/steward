import test from 'node:test';
import assert from 'node:assert/strict';
import { goldenWorkspace, FIXTURE_TODAY } from '../fixtures/golden-workspace';
import { toModel, toLegacy } from '../lib/model/convert';
import { addCycle, allocate, bucketActivity, currentCycle, planCycle, upcomingPaydays, nextDueDate } from '../lib/model/engine';
import { buildPaydayProposal, confirmProposal, evaluatePurchase } from '../lib/model/decide';
import { editPlanRow, reorderGoal } from '../lib/model/commands';
import { migrateWorkspace, SaveQueue } from '../lib/model/persistence';
import { workspaceSchema } from '../lib/model/validation';
import { resolveFollowup } from '../lib/model/conversation';
import { csvCell } from '../lib/model/export';
const ws=()=>toModel(goldenWorkspace());

test('open-ended savings keeps its identity and receives the remainder, never silently substituting debt',()=>{
 const w=ws();w.claims=[{...w.claims[0],id:'claim:open',kind:'fund',targetAmount:0,openEnded:true,status:'active',rank:0,wantBy:undefined,delayCost:{type:'none'}}];
 const result=allocate(w,123.45,FIXTURE_TODAY);assert.equal(result.allocations[0].claim.id,'claim:open');assert.equal(result.allocations[0].amount,123.45);assert.equal(result.allocations[0].completes,false);
 const p=buildPaydayProposal(w,FIXTURE_TODAY)!;const saved=toModel(JSON.parse(JSON.stringify(toLegacy(confirmProposal(w,p)))));assert.equal(saved.claims[0].openEnded,true);assert.equal(saved.allocations[0].targetId,'claim:open');
});
test('editing a bill uses its full amount and a no-op preserves financial results',()=>{
 const w=ws(),b=w.buckets.find(b=>b.name==='Rent')!;assert.equal(b.amountDue,1600);
 const next=editPlanRow(w,{id:b.id,name:b.name,amount:b.amountDue!});assert.deepEqual(planCycle(next,FIXTURE_TODAY),planCycle(w,FIXTURE_TODAY));
 const changed=editPlanRow(w,{id:b.id,name:b.name,amount:1700.45});assert.equal(changed.buckets.find(x=>x.id===b.id)!.amountDue,1700.45);assert.equal(w.buckets.find(x=>x.id===b.id)!.amountDue,1600);
 assert.throws(()=>editPlanRow(w,{id:b.id,name:b.name,amount:-1}));assert.throws(()=>editPlanRow(w,{id:b.id,name:b.name,amount:1.001}));
});
test('all goal properties and debt preferences survive JSON compatibility export and import',()=>{
 const w=ws();w.claims=w.claims.map((c,i)=>({...c,pinned:123.45,rank:8-i,status:'someday',wantBy:'2027-03-31',note:'User override'}));
 const saved=toModel(JSON.parse(JSON.stringify(toLegacy(w))));assert.deepEqual(saved.claims,JSON.parse(JSON.stringify(w.claims)));assert.equal(allocate(saved,500,FIXTURE_TODAY).allocations.length,0);
});
test('removed goals stay removed and reorder preserves stable IDs',()=>{let w=ws();const id=w.claims[0].id;w=reorderGoal(w,id,1);assert.equal(w.claims[1].id,id);w.claims=w.claims.filter(c=>c.id!==id);assert.ok(!toModel(toLegacy(w)).claims.some(c=>c.id===id));});
test('merchant subscriptions and category buckets never double-count transactions',()=>{
 const w=ws();w.buckets=[{id:'netflix',name:'Netflix',merchantKey:'netflix',category:'Entertainment',kind:'spend',perCycle:7.75,essential:false,source:'manual'},{id:'spotify',name:'Spotify',merchantKey:'spotify',category:'Entertainment',kind:'spend',perCycle:6,essential:false,source:'manual'},{id:'ent',name:'Entertainment',category:'Entertainment',kind:'spend',perCycle:10,essential:false,source:'manual'}];
 const template=w.transactions[0];w.transactions=[{...template,id:'n',merchant:'Netflix',category:'Entertainment',amount:15.5,type:'expense',date:FIXTURE_TODAY},{...template,id:'s',merchant:'Spotify',category:'Entertainment',amount:12,type:'expense',date:FIXTURE_TODAY}];
 const rows=w.buckets.map(b=>bucketActivity(w,b,currentCycle(w,FIXTURE_TODAY)!));assert.deepEqual(rows.map(r=>r.spent),[15.5,12,0]);assert.deepEqual(rows.map(r=>r.planned),[7.75,6,10]);
});
test('no present positive verdict without current cash, including overdrafts and stale balances',()=>{
 for(const amount of [0,-100,1]) {const w=ws();w.accounts=w.accounts.map(a=>({...a,available:amount}));assert.equal(evaluatePurchase(w,FIXTURE_TODAY,{item:'Groceries',price:25})!.answer,'wait');}
 const w=ws();w.accounts=w.accounts.map(a=>({...a,lastSynced:'2020-01-01'}));assert.equal(evaluatePurchase(w,FIXTURE_TODAY,{item:'Groceries',price:25})!.answer,'wait');
});
test('overspending reduces the net allowance',()=>{const w=ws();const cycle=currentCycle(w,FIXTURE_TODAY)!;const amounts=w.buckets.filter(b=>b.kind==='spend').map(b=>bucketActivity(w,b,cycle).remaining);assert.ok(amounts.some(n=>n<0));assert.equal(Math.round(amounts.reduce((a,b)=>a+b,0)*100)/100,83.95);});
test('monthly dates clamp month-end and preserve leap years in both directions',()=>{
 assert.equal(addCycle('2026-01-31','Monthly'),'2026-02-28');assert.equal(addCycle('2026-02-28','Monthly'),'2026-03-31');assert.equal(addCycle('2026-03-31','Monthly',-1),'2026-02-28');assert.equal(addCycle('2024-01-31','Monthly'),'2024-02-29');assert.equal(nextDueDate('2024-02-29','annual'),'2025-02-28');
 const w=ws();w.profile.payFrequency='Monthly';w.profile.nextPayday='2026-01-30';assert.deepEqual(upcomingPaydays(w,'2026-01-01',3),['2026-01-30','2026-02-28','2026-03-30']);for(const today of ['2026-02-28','2026-03-01','2026-03-30']){const c=currentCycle(w,today)!;assert.ok(c.start<=today && today<c.end);}
});
test('replacement allocations reverse removed targets and retries never double-fund',()=>{
 const w=ws(),p=buildPaydayProposal(w,FIXTURE_TODAY)!,first=confirmProposal(w,p);const removed=p.lines[0];const replacement={...p,lines:p.lines.slice(1)};const next=confirmProposal(first,replacement);assert.equal(next.claims.find(c=>c.id===removed.claim.id)!.fundedAmount,w.claims.find(c=>c.id===removed.claim.id)!.fundedAmount);assert.deepEqual(confirmProposal(next,replacement).claims,next.claims);assert.deepEqual(next.accounts,w.accounts);
});
test('stale and invalid proposals are rejected',()=>{const w=ws(),p=buildPaydayProposal(w,FIXTURE_TODAY)!;assert.throws(()=>confirmProposal({...w,revision:2},p),/changed/);assert.throws(()=>confirmProposal(w,{...p,lines:[{...p.lines[0],amount:Infinity}]}),/Invalid/);});
test('pins are exact contribution limits and zero is an explicit exclusion',()=>{const w=ws();w.claims[0]={...w.claims[0],pinned:12.34,delayCost:{type:"deadline",date:"2026-09-10"}};assert.equal(allocate(w,500,FIXTURE_TODAY).allocations.find(a=>a.claim.id===w.claims[0].id)!.amount,12.34);w.claims[0].pinned=0;assert.ok(!allocate(w,500,FIXTURE_TODAY).allocations.some(a=>a.claim.id===w.claims[0].id));});
test('short replies, corrections, and cancellation preserve pending purchase context',()=>{const pending={kind:'purchase' as const,name:'groceries',missing:'amount' as const};assert.deepEqual(resolveFollowup(pending,'50'),{...pending,amount:50});assert.deepEqual(resolveFollowup(pending,'actually 75'),{...pending,amount:75});assert.deepEqual(resolveFollowup(pending,'cancel'),{cancelled:true});});
test('save queue serializes and coalesces, only acknowledging the latest snapshot',async()=>{
 const writes:number[]=[],states:string[]=[],release:(()=>void)[]=[];
 const queue=new SaveQueue<number>(n=>{writes.push(n);return new Promise<void>(r=>release.push(r));},s=>states.push(s));queue.enqueue(1);queue.enqueue(2);queue.enqueue(3);assert.deepEqual(writes,[1]);release.shift()!();await new Promise(r=>setTimeout(r,0));assert.deepEqual(writes,[1,3]);assert.equal(states.at(-1),'saving');release.shift()!();await new Promise(r=>setTimeout(r,0));assert.equal(states.at(-1),'saved');
});
test('failed save retains the latest snapshot for retry',async()=>{let fail=true;const writes:number[]=[],states:string[]=[];const q=new SaveQueue<number>(async n=>{writes.push(n);if(fail)throw Error('offline');},s=>states.push(s));q.enqueue(8);await new Promise(r=>setTimeout(r,0));assert.equal(states.at(-1),'offline');fail=false;await q.flush();assert.deepEqual(writes,[8,8]);assert.equal(states.at(-1),'saved');});
test('nested state rejects malformed splits, unknown targets and currency mismatches',()=>{const w=JSON.parse(JSON.stringify(migrateWorkspace(goldenWorkspace())));w.transactions[0].split=[{category:'Groceries',amount:99999}];assert.equal(workspaceSchema.safeParse(w).success,false);w.transactions[0].split=undefined;w.allocations=[{id:'a',targetType:'claim',targetId:'unknown',cycleId:'c',amount:1,status:'confirmed',createdAt:'now'}];assert.equal(workspaceSchema.safeParse(w).success,false);w.profile.currency='EUR';assert.equal(workspaceSchema.safeParse(w).success,false);});
test('CSV export protects formula-leading merchant data',()=>{assert.equal(csvCell('=HYPERLINK("bad")'),'"\'=HYPERLINK(""bad"")"');assert.equal(csvCell('ordinary'),'"ordinary"');});

test('valid canonical fixture is accepted after JSON serialization',()=>{assert.ok(workspaceSchema.safeParse(JSON.parse(JSON.stringify(migrateWorkspace(goldenWorkspace())))).success);});
test('bank pagination mutation discards partial pages and restarts at original cursor',async()=>{
 const {collectSync}=await import('../lib/bank-sync');const calls:(string|undefined)[]=[];let failed=false;
 const result=await collectSync('original',async cursor=>{calls.push(cursor);if(cursor==='page2'&&!failed){failed=true;throw Error('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION');}return {added:[],modified:[],removed:[],next_cursor:cursor==='original'?'page2':'done',has_more:cursor==='original'};});
 assert.deepEqual(calls,['original','page2','original','page2']);assert.equal(result.cursor,'done');
});
test('import deduplicates responses and retains manual corrections across pending-to-posted replacement',async()=>{
 const {mergePlaidFinancialData}=await import('../lib/financial-import');const w=goldenWorkspace();const t={transaction_id:'pending1',account_id:w.accounts[0].id,name:'Store',amount:20,date:FIXTURE_TODAY,pending:true};let state=mergePlaidFinancialData(w,{added:[t,t],modified:[],removed:[]});assert.equal(state.transactions.filter(t=>t.plaidTransactionId==='pending1').length,1);
 state.transactions=state.transactions.map(t=>t.plaidTransactionId==='pending1'?{...t,category:'Groceries',categorySource:'manual',note:'Keep me',split:[{category:'Groceries',amount:20}]}:t);
 const posted={...t,transaction_id:'posted1',pending_transaction_id:'pending1',pending:false};state=mergePlaidFinancialData(state,{added:[posted,posted],modified:[],removed:[]});assert.equal(state.transactions.filter(t=>t.plaidTransactionId==='pending1').length,0);const saved=state.transactions.find(t=>t.plaidTransactionId==='posted1')!;assert.equal(saved.category,'Groceries');assert.equal(saved.note,'Keep me');assert.equal(saved.split![0].amount,20);
});
test('semimonthly imports never become a biweekly schedule',async()=>{const {mergePlaidFinancialData}=await import('../lib/financial-import');const w=goldenWorkspace();w.profile.payFrequency='Monthly';const saved=mergePlaidFinancialData(w,{added:[],modified:[],removed:[],recurring:{inflow_streams:[{stream_id:'twice-monthly',account_id:w.accounts[0].id,description:'Employer',frequency:'SEMI_MONTHLY',average_amount:{amount:2000},predicted_next_date:'2026-08-15'}]}});assert.equal(saved.profile.payFrequency,'Monthly');assert.equal(saved.profile.nextPayday,'');});

test('missing bank available balance withholds a buying-today verdict',async()=>{const {mergePlaidAccounts}=await import('../lib/financial-import');const state=mergePlaidAccounts(goldenWorkspace(),[{account_id:'unknown-cash',name:'Checking',type:'depository',subtype:'checking',balances:{available:null,current:9000,limit:null}}],'Sandbox');assert.equal(state.accounts.find(a=>a.id==='plaid-unknown-cash')!.status,'attention');const result=evaluatePurchase(toModel(state),FIXTURE_TODAY,{item:'groceries',price:50});assert.equal(result!.answer,'wait');});
