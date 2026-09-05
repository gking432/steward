import { addCycle } from './engine';
import { subscriptions, type Stream } from './observations';
import type { Bucket, Workspace } from './types';

/** A predictable charge is an obligation, not a paycheck spending limit. */
export function recurringReserve(bucket: Bucket, stream: Stream, today: string): Bucket {
  const frequency = stream.cadence === 'weekly' ? 'Weekly' : stream.cadence === 'biweekly' ? 'Biweekly' : 'Monthly';
  let step = 1;
  let dueDate = addCycle(stream.lastDate, frequency, step);
  while (dueDate <= today && step < 500) dueDate = addCycle(stream.lastDate, frequency, ++step);
  return {...bucket, kind:'reserve', perCycle:undefined, rollover:undefined,
    amountDue:stream.typicalAmount, reserved:0, dueDate,
    frequency:frequency === 'Weekly' ? 'weekly' : frequency === 'Biweekly' ? 'biweekly' : 'monthly'};
}

/** Upgrade only old automatically created subscription buckets, preserving IDs. */
export function migrateRecurringReserves(workspace: Workspace): Workspace {
  const asOf = workspace.transactions.map(t=>t.date).sort().at(-1);
  if (!asOf) return workspace;
  const streams = subscriptions(workspace, asOf);
  const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g,'');
  return {...workspace, buckets:workspace.buckets.map(bucket=>{
    if (bucket.kind !== 'spend' || bucket.source !== 'derived' || !bucket.merchantKey) return bucket;
    const stream = streams.find(s=>key(s.merchant) === bucket.merchantKey);
    return stream ? recurringReserve(bucket,stream,asOf) : bucket;
  })};
}
