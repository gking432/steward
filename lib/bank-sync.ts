import type { PlaidTransaction } from './financial-import';
export type SyncPage = { added:PlaidTransaction[];modified:PlaidTransaction[];removed:{transaction_id:string}[];next_cursor:string;has_more:boolean };
/** Discard an entire failed pagination attempt and restart at the original cursor. */
export async function collectSync(original:string|undefined,fetchPage:(cursor:string|undefined)=>Promise<SyncPage>) {
  for(let attempt=0;attempt<3;attempt++) {
    let cursor=original;const added:PlaidTransaction[]=[],modified:PlaidTransaction[]=[],removed:{transaction_id:string}[]=[];
    try {
      for(let page=0;page<100;page++) {
        const result=await fetchPage(cursor);added.push(...result.added);modified.push(...result.modified);removed.push(...result.removed);cursor=result.next_cursor;
        if(!result.has_more) return {added,modified,removed,cursor};
      }
      throw Error('Sync exceeded page limit. No cursor was committed.');
    } catch(error) { if(attempt===2 || !(error instanceof Error) || !error.message.includes('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION')) throw error; }
  }
  throw Error('Sync could not complete.');
}
