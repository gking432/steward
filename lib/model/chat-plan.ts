import { z } from 'zod';
import type { Workspace } from './types';
import { previewAIOnboarding, EMPTY_AI_ONBOARDING_STATE } from './onboarding-ai';
import { editPlanRow } from './commands';

const money=z.number().finite().nonnegative().max(10000000);
export const chatGoalSchema=z.object({id:z.string().min(1).max(80),name:z.string().min(1).max(100),kind:z.enum(['fund','purchase','payoff']),amount:money.nullable(),contribution:money.nullable().optional(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),accountId:z.string().max(120).nullable(),evidence:z.string().min(1).max(1000)}).strict();
export const chatDraftSchema=z.object({
  message:z.string().min(1).max(700),goals:z.array(chatGoalSchema).max(8),
  bucketEdits:z.array(z.object({id:z.string().max(120),amount:money,evidence:z.string().min(1).max(1000)}).strict()).max(20),
  income:money.nullable(),incomeEvidence:z.string().max(1000),
  purchase:z.object({name:z.string().min(1).max(100),amount:money.nullable()}).strict().nullable(),
  readyToReview:z.boolean(),
}).strict();
export type ChatDraft=z.infer<typeof chatDraftSchema>;
export const EMPTY_CHAT_DRAFT:ChatDraft={message:'Ready to talk.',goals:[],bucketEdits:[],income:null,incomeEvidence:'',purchase:null,readyToReview:false};
export type ChatTurn={role:'user'|'assistant';content:string};

export function validateChatDraft(raw:unknown, workspace:Workspace, turns:ChatTurn[]) {
 const draft=chatDraftSchema.parse(raw);
 const spoken=turns.filter(t=>t.role==='user').map(t=>t.content);
 const evidence=(quote:string)=>spoken.some(t=>t.includes(quote));
 if(new Set(draft.goals.map(g=>g.id)).size!==draft.goals.length)throw Error('Duplicate goal');
 for(const goal of draft.goals){
  if(!evidence(goal.evidence))throw Error('Goal needs user evidence');
  if(goal.date && !Number.isFinite(Date.parse(goal.date)))throw Error('Invalid goal date');
  if(goal.accountId && !workspace.accounts.some(a=>a.id===goal.accountId))throw Error('Unknown account');
  if(goal.kind==='payoff' && !workspace.claims.some(c=>c.kind==='payoff'&&c.linkedAccountId===goal.accountId))throw Error('Choose a known debt');
 }
 for(const edit of draft.bucketEdits){if(!workspace.buckets.some(b=>b.id===edit.id)||!evidence(edit.evidence))throw Error('Unknown or unsupported bill edit');}
 if(draft.income!==null&&!evidence(draft.incomeEvidence))throw Error('Income needs evidence');
 return draft;
}

/** Unconfirmed model interpretation becomes a deterministic, reviewable draft. */
export function workspaceFromChat(base:Workspace,today:string,draft:ChatDraft,setup=true):Workspace {
 let next=setup?previewAIOnboarding(base,today,EMPTY_AI_ONBOARDING_STATE):structuredClone(base);
 if(draft.income!==null)next={...next,profile:{...next.profile,takeHomePay:draft.income}};
 for(const edit of draft.bucketEdits){const b=next.buckets.find(b=>b.id===edit.id);if(b)next=editPlanRow(next,{id:b.id,name:b.name,amount:edit.amount});}
 const selected=new Set(draft.goals.filter(g=>g.accountId).map(g=>g.accountId));
 if(setup) next={...next,claims:next.claims.map(c=>({...c,status:selected.has(c.linkedAccountId??'')?'active':'someday'}))};
 for(const [rank,g] of draft.goals.entries()){
   const debt=g.kind==='payoff'?next.claims.find(c=>c.kind==='payoff'&&c.linkedAccountId===g.accountId):undefined;
   if(debt){next={...next,claims:next.claims.map(c=>c.id===debt.id?{...c,rank,status:'active'}:c)};continue;}
   const existing=next.claims.find(c=>c.id===`claim:chat:${g.id}`||c.name.toLowerCase()===g.name.toLowerCase());
   if(existing){next={...next,claims:next.claims.map(c=>c.id===existing.id?{...c,name:g.name,targetAmount:g.amount??c.targetAmount,openEnded:g.kind==='fund'&&g.amount===null,status:'active',pinned:g.contribution??c.pinned,rank:setup?rank:c.rank,wantBy:g.date??c.wantBy}:c)};continue;}
   next={...next,claims:[...next.claims,{id:`claim:chat:${g.id}`,name:g.name,kind:g.kind,targetAmount:g.amount??0,openEnded:g.kind==='fund'&&g.amount===null,fundedAmount:0,pinned:g.contribution??undefined,linkedAccountId:g.accountId??undefined,rank,status:g.amount!==null||g.kind==='fund'?'active':'someday',horizon:'arrival',divisible:g.kind==='fund',delayCost:g.date?{type:'deadline',date:g.date}:{type:'none'},wantBy:g.date??undefined,protected:false}]};
 }
 return {...next,revision:(base.revision??0)+1};
}
