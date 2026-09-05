"use client";
import { useMemo, useState } from 'react';
import type { Workspace } from '../../lib/model/types';
import { buildPaydayProposal, confirmProposal } from '../../lib/model/decide';
import { formatMoney, planCycle, allocate } from '../../lib/model/engine';
import { previewAIOnboarding, EMPTY_AI_ONBOARDING_STATE } from '../../lib/model/onboarding-ai';
import { BucketsScreen } from './buckets';

/** Review facts together, then explicitly confirm the exact calculated plan. */
export function ReviewSetup({workspace,today,onDone,manual=false}: {workspace:Workspace;today:string;onDone:(w:Workspace)=>void;manual?:boolean}) {
  const [draft,setDraft] = useState<Workspace>(() => previewAIOnboarding(workspace,today,EMPTY_AI_ONBOARDING_STATE));
  const [step,setStep] = useState(0);
  const [name,setName] = useState('Emergency cushion');
  const [target,setTarget] = useState('');
  const [contribution,setContribution] = useState('');
  const [error,setError] = useState('');
  const proposal = useMemo(()=>buildPaydayProposal(draft,today),[draft,today]);
  const plan = useMemo(()=>planCycle(draft,today),[draft,today]);
  const update = (fn:(w:Workspace)=>Workspace) => setDraft(w=>({...fn(w),revision:(w.revision??0)+1}));
  const saveGoal = () => {
    const amount = Number(target), pin = contribution === '' ? undefined : Number(contribution);
    if (!name.trim() || !Number.isFinite(amount) || amount < 0 || (pin !== undefined && (!Number.isFinite(pin) || pin < 0))) {setError('Enter a goal name and valid amounts. A target is optional.');return;}
    update(w=>({...w,claims:[...w.claims.filter(c=>c.id!=='claim:setup-savings'),{id:'claim:setup-savings',name:name.trim(),kind:'fund',targetAmount:amount,openEnded:!amount,fundedAmount:0,rank:0,status:'active',horizon:'arrival',divisible:true,delayCost:{type:'none'},protected:false,pinned:pin}]}));
    setStep(2);setError('');
  };
  return <main className="setup-review">
    <header><strong>Steward · {manual ? "Manual plan" : "Sample statement review"}</strong><a href="/demo">Start over</a><h1>{['Review detected amounts','Choose your priority','Review this paycheck'][step]}</h1><p>{manual ? "Session-only plan" : "Synthetic household"} · {today}. No bank connection or transfers. Changes remain in this tab.</p></header>
    {step===0 && <>
      <label>Take-home pay<input type="number" min="0" step="0.01" value={draft.profile.takeHomePay} onChange={e=>update(w=>({...w,profile:{...w.profile,takeHomePay:Number(e.target.value)}}))}/></label>
      <label>Pay frequency<select value={draft.profile.payFrequency} onChange={e=>update(w=>({...w,profile:{...w.profile,payFrequency:e.target.value as Workspace['profile']['payFrequency']}}))}>{['Weekly','Biweekly','Monthly'].map(f=><option key={f}>{f}</option>)}</select></label>
      <label>Next payday<input type="date" value={draft.profile.nextPayday} onChange={e=>update(w=>({...w,profile:{...w.profile,nextPayday:e.target.value}}))}/></label>
      <p>Detected · needs your review. Edit exceptions below. Monthly contributions use 26/12 paychecks for biweekly pay; this is an annualized usual amount.</p>
      <BucketsScreen workspace={draft} today={today} mode="plan" update={update} />
      <button onClick={()=> {if(draft.profile.takeHomePay>0 && draft.profile.nextPayday) setStep(1);else setError('Enter income and a payday first.');}}>These amounts look right</button>
    </>}
    {step===1 && <section>
      <label>Goal name<input value={name} onChange={e=>setName(e.target.value)}/></label>
      <label>Target (optional)<input type="number" min="0" step="0.01" value={target} onChange={e=>setTarget(e.target.value)} placeholder="Open-ended savings"/></label>
      <label>Contribution each paycheck (optional)<input type="number" min="0" step="0.01" value={contribution} onChange={e=>setContribution(e.target.value)} placeholder="Use remaining capacity"/></label>
      <p>Required debt minimums stay in Bills. Extra debt repayment is optional and starts only when you choose it in Plan.</p>
      <button onClick={()=>setStep(0)}>Back</button><button onClick={saveGoal}>Review savings plan</button><button onClick={()=>setStep(2)}>Continue without a new goal</button>
    </section>}
    {step===2 && proposal && plan && <section>
      <p>This is a proposal for {plan.cycle.start} through {plan.cycle.end}. Confirming earmarks money in your plan; it does not pay bills or transfer savings.</p>
      <dl className="review-ledger"><div><dt>Expected income</dt><dd>{formatMoney(proposal.income)}</dd></div>
      {plan.reserves.map(r=><div key={r.bucket.id}><dt>{r.bucket.name}<small>Full bill {formatMoney(r.bucket.amountDue??0)} · due {r.bucket.dueDate??'unknown'}<br/>Usual contribution {formatMoney(r.steadyRate)}{r.required>r.steadyRate ? `; catch-up +${formatMoney(r.required-r.steadyRate)} because the due date is near.`:''}</small></dt><dd>{formatMoney(r.required)}</dd></div>)}
      {proposal.spend.map((r,i)=><div key={i}><dt>{r.name}</dt><dd>{formatMoney(r.amount)}</dd></div>)}
      <div><dt>Buffer top-up</dt><dd>{formatMoney(proposal.bufferTopUp)}</dd></div>
      {proposal.lines.map(r=><div key={r.claim.id}><dt>{r.claim.name}<small>{r.reason}</small></dt><dd>{formatMoney(r.amount)}</dd></div>)}
      <div><dt>Unallocated</dt><dd>{formatMoney(allocate(draft,plan.freeCapacity,today).unallocated)}</dd></div></dl>
      {plan.shortfall && <p role="alert">Shortfall: {formatMoney(plan.shortfall.amount)}. Reduce the plan or correct income before confirming.</p>}
      <button onClick={()=>setStep(1)}>Edit priorities</button><button disabled={!!plan.shortfall} onClick={()=>{const confirmed=confirmProposal(draft,proposal);onDone({...confirmed,profile:{...confirmed.profile,onboardingComplete:true}});}}>Confirm this paycheck, including catch-up amounts</button>
    </section>}
    {error&&<p role="alert">{error}</p>}
  </main>;
}
