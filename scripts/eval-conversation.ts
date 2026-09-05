import {execFileSync} from 'node:child_process';
import {writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {demoWorkspace,goldenWorkspace,FIXTURE_TODAY} from '../fixtures/golden-workspace';
import {toModel} from '../lib/model/convert';
import {previewAIOnboarding,EMPTY_AI_ONBOARDING_STATE} from '../lib/model/onboarding-ai';
import type {Workspace} from '../lib/model/types';
import type {Verdict} from '../lib/model/decide';
import {EMPTY_CHAT_DRAFT,type ChatDraft,type ChatTurn} from '../lib/model/chat-plan';
type EvalResponse={origin:string;draft:ChatDraft;preview:Workspace;verdict:Verdict;model?:string;responseId?:string;latencyMs?:number;usage?:unknown;error?:string};
const deployment=process.argv[2];if(!deployment)throw Error('Supply the Vercel deployment URL');
const dir=mkdtempSync(join(tmpdir(),'steward-eval-'));
const results:Record<string,unknown>[]=[];
let draft={...EMPTY_CHAT_DRAFT};let turns:ChatTurn[]=[];
let mode='setup';
const setup=previewAIOnboarding(toModel(demoWorkspace()),FIXTURE_TODAY,EMPTY_AI_ONBOARDING_STATE);
async function run(name:string,text:string,check:(r:EvalResponse)=>boolean){
 turns.push({role:'user',content:text});
 const path=join(dir,'request.json');writeFileSync(path,JSON.stringify({workspace:mode==='setup'?setup:toModel(goldenWorkspace()),today:FIXTURE_TODAY,mode,draft,turns}));
 const output=execFileSync('npx',['--yes','vercel','curl','/api/steward-chat','--deployment',deployment,'--','--silent','--request','POST','--header','Content-Type: application/json','--data-binary','@'+path],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000});
 let result:EvalResponse;try{result=JSON.parse(output);}catch{throw Error('Non-JSON deployment response');}
 const pass=result.origin==='model'&&check(result);
 results.push({name,pass,origin:result.origin,model:result.model,responseId:result.responseId,latencyMs:result.latencyMs,usage:result.usage,input:text,draft:result.draft,error:result.error});
 console.log(JSON.stringify({name,pass,origin:result.origin,message:result.draft?.message,error:result.error}));
 if(result.draft){draft=result.draft;turns.push({role:'assistant',content:result.draft.message});}
 if(result.origin!=='model')throw Error(result.error??'No live model result');
 return result;
}
try{
 await run('open-ended savings','I want an emergency cushion, but I have no target. Please do not put extra money toward debt.',r=>r.draft.goals.some((g:ChatDraft['goals'][number])=>g.kind==='fund'&&g.amount===null)&&r.preview.claims.filter((c:Workspace['claims'][number])=>c.kind==='payoff').every((c:Workspace['claims'][number])=>c.status==='someday'));
 await run('multiple goals','I also want a camera for $200.',r=>r.draft.goals.length===2&&r.draft.goals.some((g:ChatDraft['goals'][number])=>/camera/i.test(g.name)&&g.amount===200));
 await run('latest amount correction','Actually 250.',r=>r.draft.goals.some((g:ChatDraft['goals'][number])=>/camera/i.test(g.name)&&g.amount===250)&&r.draft.goals.some((g:ChatDraft['goals'][number])=>g.kind==='fund'));
 await run('priority negotiation','Put the camera before the cushion.',r=>/camera/i.test(r.draft.goals[0]?.name));
 await run('selective cancellation','Cancel the camera, but keep the cushion.',r=>r.draft.goals.length===1&&r.draft.goals[0].kind==='fund');
 mode='ask';draft={...EMPTY_CHAT_DRAFT};turns=[];
 await run('missing purchase price','Can I afford groceries?',r=>!!r.draft.purchase&&/grocer/i.test(r.draft.purchase.name)&&r.draft.purchase.amount===null);
 await run('numeric follow-up and engine verdict','50',r=>r.draft.purchase?.amount===50&&r.verdict.answer==='yes'&&r.verdict.consequences.length===0);
 await run('new goal changes topic','I want a camera for $200',r=>r.draft.purchase===null&&r.draft.goals.some((g:ChatDraft['goals'][number])=>/camera/i.test(g.name)&&g.amount===200));
 await run('correction stays with camera','Actually 250',r=>r.draft.purchase===null&&r.draft.goals.some((g:ChatDraft['goals'][number])=>/camera/i.test(g.name)&&g.amount===250));
 const report={deployment,ranAt:new Date().toISOString(),passed:results.filter(r=>r.pass).length,total:results.length,results};
 writeFileSync('outputs/live-conversation-evaluation.json',JSON.stringify(report,null,2));
 if(report.passed!==report.total)process.exitCode=1;
}finally{rmSync(dir,{recursive:true,force:true});}
