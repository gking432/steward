'use client';
import Link from 'next/link';
import { previewAIOnboarding, EMPTY_AI_ONBOARDING_STATE } from '../../lib/model/onboarding-ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Workspace } from '../../lib/model/types';
import { EMPTY_CHAT_DRAFT, type ChatDraft, type ChatTurn, workspaceFromChat } from '../../lib/model/chat-plan';
import { buildPaydayProposal, confirmProposal, type Verdict } from '../../lib/model/decide';
import { formatMoney, planCycle } from '../../lib/model/engine';
import { BucketsScreen } from './buckets';
import './conversation-setup.css';

const welcome='Let’s build a plan around what matters to you. I’ve mapped the starting numbers. What would you like your money to help you do—and what feels hardest right now?';
export function ConversationSetup({workspace,today,onDone,manual=false}:{workspace:Workspace;today:string;onDone:(w:Workspace)=>void;manual?:boolean}){
 const [base,setBase]=useState(()=>previewAIOnboarding(workspace,today,EMPTY_AI_ONBOARDING_STATE));
 const [draft,setDraft]=useState<ChatDraft>({...EMPTY_CHAT_DRAFT,message:welcome});
 const [turns,setTurns]=useState<ChatTurn[]>([{role:'assistant',content:welcome}]);
 const [input,setInput]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 const [origin,setOrigin]=useState('Ready to talk');const [review,setReview]=useState(false);const [editFacts,setEditFacts]=useState(false);
 const [verdict,setVerdict]=useState<Verdict|null>(null);const [loaded,setLoaded]=useState(false);
 const end=useRef<HTMLDivElement>(null);const sourceRevision=useRef(workspace.revision??0);
 const preview=useMemo(()=>workspaceFromChat(base,today,draft),[base,today,draft]);
 const plan=useMemo(()=>planCycle(preview,today),[preview,today]);
 const proposal=useMemo(()=>buildPaydayProposal(preview,today),[preview,today]);
 useEffect(()=>{try{const cache=sessionStorage.getItem('steward-chat:'+location.pathname);if(cache){const saved=JSON.parse(cache);queueMicrotask(()=>{setDraft(saved.draft);setTurns(saved.turns);});}}catch{}queueMicrotask(()=>setLoaded(true));},[]);
 useEffect(()=>{if(loaded)try{sessionStorage.setItem('steward-chat:'+location.pathname,JSON.stringify({draft,turns}));}catch{}},[draft,turns,loaded]);
 useEffect(()=>{end.current?.scrollIntoView({block:'nearest',behavior:'smooth'});},[turns,busy]);
 async function send(text=input){
  if(!text.trim()||busy)return;
  const next:ChatTurn[]=[...turns,{role:'user',content:text.trim()}];setTurns(next);setInput('');setBusy(true);setError('');setReview(false);
  try{
   const response=await fetch('/api/steward-chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({workspace:base,today,mode:'setup',draft,turns:next.slice(-30)}),signal:AbortSignal.timeout(25000)});
   const result=await response.json();if(!response.ok)throw Error(result.error??'Conversation unavailable.');
   setDraft(result.draft);setVerdict(result.verdict);setOrigin('AI conversation · calculated plan');
   setTurns([...next,{role:'assistant',content:result.draft.message}]);
  }catch(err){setError(err instanceof Error?err.message:'The connection failed. Retry your message.');setOrigin('AI unavailable · draft retained');}
  finally{setBusy(false);}
 }
 function confirm(){
  if(!proposal||plan?.shortfall)return;
  if((workspace.revision??0)!==sourceRevision.current){setError('Your source data changed. Reload and review the updated plan before confirming.');return;}
  const next=confirmProposal(preview,proposal);try{sessionStorage.removeItem('steward-chat:'+location.pathname);}catch{}
  onDone({...next,profile:{...next.profile,onboardingComplete:true}});
 }
 const missing=draft.goals.some(g=>g.kind==='purchase'&&(!g.amount||g.amount<=0));
 return <main className="sc-shell">
  <header className="sc-header"><Link href="/">✳ Steward</Link><span>{manual?'Manual workspace':'Demo · synthetic statements'} · {today}</span><a href="/fixture">Explore a sample plan</a></header>
  <div className="sc-layout"><section className="sc-conversation">
   <p className="sc-eyebrow">A plan that starts with you</p><h1>Let’s talk about your money.</h1>
   <p className="sc-intro">Tell me what matters. We’ll work through the tradeoffs together, then you’ll review the numbers.</p>
   <div className="sc-transcript" aria-live="polite">{turns.map((turn,i)=><article className={`sc-message ${turn.role}`} key={i}><small>{turn.role==='user'?'You':i===0?'Steward · welcome':'Steward · AI'}</small><p>{turn.content}</p></article>)}
    {busy&&<p role="status">Steward is thinking through your priorities…</p>}<div ref={end}/></div>
   {turns.length===1&&<div className="sc-starters">{['I want a cushion, but I don’t know how much','I want to pay down debt and still enjoy my money','I’m saving for something specific'].map(text=><button key={text} onClick={()=>send(text)}>{text}</button>)}</div>}
   {error&&<div role="alert" className="sc-error">{error}<button disabled={busy} onClick={()=>send(turns.filter(t=>t.role==='user').at(-1)?.content??'Let’s start')}>Retry conversation</button></div>}
   <form onSubmit={e=>{e.preventDefault();void send();}} className="sc-composer"><label htmlFor="setup-message" className="sc-eyebrow">{origin}</label><div><textarea id="setup-message" maxLength={1000} rows={2} value={input} onChange={e=>setInput(e.target.value)} placeholder="What’s on your mind?" disabled={busy}/><button disabled={busy||!input.trim()} type="submit">Send</button></div></form>
   <p className="sc-note">Messages and the plan summary are sent to OpenAI to interpret your intent. Calculations run in Steward. Nothing moves or changes in your saved plan until you confirm.</p>
  </section>
  <aside className="sc-plan"><p className="sc-eyebrow">Your draft · not yet confirmed</p><h2>Taking shape</h2>
   {plan?<dl><div><dt>Expected paycheck</dt><dd>{formatMoney(plan.income)}</dd></div><div><dt>Bills & recurring reserves</dt><dd>{formatMoney(plan.reservesTotal)}</dd></div><div><dt>Everyday allowances</dt><dd>{formatMoney(plan.spendTotal)}</dd></div><div><dt>Buffer protection</dt><dd>{formatMoney(plan.bufferTopUp)}</dd></div><div><dt>Available for priorities</dt><dd>{formatMoney(plan.freeCapacity)}</dd></div></dl>:<p>Tell me your take-home pay per paycheck, then add your pay schedule under “Check the starting numbers.”</p>}
   <a href="/demo?statements=1">Inspect the sample statements</a><h3>What matters to you</h3>{draft.goals.length?<ol>{draft.goals.map(g=><li key={g.id}><strong>{g.name}</strong><span>{g.amount!==null?formatMoney(g.amount):g.kind==='fund'?'Open-ended savings':'Price needed'}{g.date?` · ${g.date}`:''}</span></li>)}</ol>:<p>Your priorities will appear as we talk. Required bills stay protected.</p>}
   {verdict&&<section className="sc-verdict"><strong>Calculated purchase check</strong><p>{verdict.item} · {formatMoney(verdict.price)}. {verdict.headline}</p><p>{verdict.tradeoff}</p>{verdict.checks.map(c=><p key={c.label}>{c.label}: {c.detail}</p>)}</section>}
   <button className="sc-secondary" onClick={()=>setEditFacts(!editFacts)}>Check the starting numbers</button>
   <button className="sc-primary" disabled={busy||!plan||missing} onClick={()=>setReview(!review)}>{review?'Keep talking':'Review my paycheck plan'}</button>
   {missing&&<p>Add a price for your purchase goal before confirming.</p>}
  </aside></div>
  {editFacts&&<section className="sc-review"><h2>Correct the starting numbers</h2><p>Full bill amounts and paycheck contributions are separate. Save each edit explicitly.</p><label>Take-home per paycheck<input type="number" min="0" step="0.01" value={base.profile.takeHomePay} onChange={e=>setBase(w=>({...w,profile:{...w.profile,takeHomePay:Number(e.target.value)}}))}/></label><label>Next payday<input type="date" value={base.profile.nextPayday} onChange={e=>setBase(w=>({...w,profile:{...w.profile,nextPayday:e.target.value}}))}/></label><label>Pay frequency<select value={base.profile.payFrequency} onChange={e=>setBase(w=>({...w,profile:{...w.profile,payFrequency:e.target.value as Workspace['profile']['payFrequency']}}))}>{['Weekly','Biweekly','Monthly'].map(f=><option key={f}>{f}</option>)}</select></label><BucketsScreen workspace={base} today={today} mode="plan" update={fn=>setBase(w=>fn(w))}/></section>}
  {review&&proposal&&plan&&<section className="sc-review" aria-label="Review paycheck proposal"><p className="sc-eyebrow">Calculated by Steward</p><h2>Here’s what this paycheck would do.</h2><p>{plan.cycle.start} through {plan.cycle.end}. Confirming earmarks money in your plan. It does not pay bills or transfer funds.</p><dl>{plan.reserves.map(r=><div key={r.bucket.id}><dt>{r.bucket.name}<small>Full charge {formatMoney(r.bucket.amountDue??0)} · due {r.bucket.dueDate}<br/>Usual {formatMoney(r.steadyRate)}{r.required>r.steadyRate?` · catch-up +${formatMoney(r.required-r.steadyRate)}`:''}</small></dt><dd>{formatMoney(r.required)}</dd></div>)}{proposal.spend.map(r=><div key={r.name}><dt>{r.name}</dt><dd>{formatMoney(r.amount)}</dd></div>)}<div><dt>Buffer top-up</dt><dd>{formatMoney(proposal.bufferTopUp)}</dd></div>{proposal.lines.map(r=><div key={r.claim.id}><dt>{r.claim.name}<small>{r.reason}</small></dt><dd>{formatMoney(r.amount)}</dd></div>)}</dl>{plan.shortfall&&<p role="alert">This plan is short by {formatMoney(plan.shortfall.amount)}. Correct the amounts before confirming.</p>}<button className="sc-primary" disabled={!!plan.shortfall||busy||missing} onClick={confirm}>Confirm this plan, including catch-up amounts</button><button className="sc-secondary" onClick={()=>setReview(false)}>Back to our conversation</button></section>}
 </main>;
}
