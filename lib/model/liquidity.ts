import type { Workspace } from './types';
import { currentCycle, daysBetween, liquidCash } from './engine';

/** Conservative buying-today check. Pending activity may already be in the
 * available balance; until the adapter certifies that, protect it again. */
export function currentLiquidity(workspace: Workspace, today: string) {
  const cycle = currentCycle(workspace, today);
  const accounts = workspace.accounts.filter(a => !a.archived && ['Checking', 'Cash'].includes(a.type));
  const known = accounts.length > 0 && accounts.every(a => Number.isFinite(a.available) && a.status !== 'attention' && !!a.lastSynced && daysBetween(a.lastSynced.slice(0, 10), today) >= 0 && daysBetween(a.lastSynced.slice(0, 10), today) <= 3);
  const cash = liquidCash(workspace);
  const pending = workspace.transactions.filter(t => t.pending && !t.excluded && t.type === 'expense').reduce((sum, t) => sum + t.amount, 0);
  const obligations = workspace.buckets.filter(b => b.kind === 'reserve' && (!b.dueDate || !cycle || b.dueDate < cycle.end)).reduce((sum, b) => sum + (b.amountDue ?? 0), 0);
  const earmarks = workspace.claims.reduce((sum, c) => sum + c.fundedAmount, 0);
  const available = Math.round((cash - pending - obligations - workspace.profile.bufferFloor - earmarks) * 100) / 100;
  return { known, cash, pending, obligations, earmarks, available: known ? Math.max(0, available) : 0 };
}
