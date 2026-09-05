import test from 'node:test';
import assert from 'node:assert/strict';
import {goldenWorkspace,FIXTURE_TODAY} from '../fixtures/golden-workspace';
import {toModel} from '../lib/model/convert';
import {EMPTY_CHAT_DRAFT,validateChatDraft,workspaceFromChat,type ChatDraft} from '../lib/model/chat-plan';
import {buildPaydayProposal,confirmProposal} from '../lib/model/decide';
const w=()=>toModel(goldenWorkspace());
const draft:ChatDraft={...EMPTY_CHAT_DRAFT,goals:[{id:'cushion',name:'Emergency cushion',kind:'fund',amount:null,date:null,accountId:null,evidence:'I need an emergency cushion'}]};
test('AI interpretation creates an unconfirmed open-ended draft, retaining financial facts',()=>{
 const base=w();const preview=workspaceFromChat(base,FIXTURE_TODAY,draft);
 assert.deepEqual(preview.accounts,base.accounts);assert.deepEqual(preview.transactions,base.transactions);
 assert.ok(!base.claims.some(c=>c.name==='Emergency cushion'));
 const goal=preview.claims.find(c=>c.id==='claim:chat:cushion')!;assert.equal(goal.openEnded,true);assert.equal(goal.fundedAmount,0);
 assert.ok(preview.claims.filter(c=>c.kind==='payoff').every(c=>c.status==='someday'));
 const proposal=buildPaydayProposal(preview,FIXTURE_TODAY)!;assert.ok(proposal.lines.some(l=>l.claim.id===goal.id));
 assert.ok(confirmProposal(preview,proposal).claims.find(c=>c.id===goal.id)!.fundedAmount>0);
});
test('unsupported edits and nonexistent debts are rejected without changing the workspace',()=>{
 const base=w();assert.throws(()=>validateChatDraft(draft,base,[{role:'user',content:'Hello'}]),/evidence/);
 const turns=[{role:'user' as const,content:'I need an emergency cushion'}];assert.deepEqual(validateChatDraft(draft,base,turns),draft);
 assert.throws(()=>validateChatDraft({...draft,bucketEdits:[{id:'missing',amount:10,evidence:turns[0].content}]},base,turns));
 assert.throws(()=>validateChatDraft({...draft,goals:[{...draft.goals[0],kind:'payoff',accountId:'unknown'}]},base,turns));
});
test('correcting a draft preserves goal identity and never resets previously funded money',()=>{
 const base=w();const camera={id:'camera',name:'Camera',kind:'purchase' as const,amount:200,date:null,accountId:null,evidence:'Camera for $200'};
 const first=workspaceFromChat(base,FIXTURE_TODAY,{...EMPTY_CHAT_DRAFT,goals:[camera]},false);
 first.claims.find(c=>c.id==='claim:chat:camera')!.fundedAmount=50;
 const corrected=workspaceFromChat(first,FIXTURE_TODAY,{...EMPTY_CHAT_DRAFT,goals:[{...camera,amount:250,evidence:'actually 250'}]},false);
 assert.equal(corrected.claims.filter(c=>c.name==='Camera').length,1);
 assert.equal(corrected.claims.find(c=>c.name==='Camera')!.targetAmount,250);
 assert.equal(corrected.claims.find(c=>c.name==='Camera')!.fundedAmount,50);
});
