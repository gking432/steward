import type { Workspace } from './types';

export type EditPlanRow = { id: string; name: string; amount: number; dueDate?: string; reserved?: number; frequency?: Workspace['buckets'][number]['frequency'] };
/** Explicit draft commit. A blur never calls this command. */
export function editPlanRow(workspace: Workspace, draft: EditPlanRow): Workspace {
  if (!draft.name.trim() || !Number.isFinite(draft.amount) || draft.amount < 0 || Math.abs(draft.amount * 100 - Math.round(draft.amount * 100)) > .00001) throw new Error('Enter a name and a nonnegative amount with at most two decimal places.');
  if (draft.reserved !== undefined && (!Number.isFinite(draft.reserved) || draft.reserved < 0)) throw new Error('Reserved amount must be nonnegative.');
  if (draft.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate)) throw new Error('Choose a valid due date.');
  if (!workspace.buckets.some(b => b.id === draft.id) && !workspace.claims.some(c => c.id === draft.id)) throw new Error('This plan item no longer exists.');
  return { ...workspace,
    buckets: workspace.buckets.map(b => b.id !== draft.id ? b : { ...b, name: draft.name.trim(), ...(b.kind === 'spend' ? { perCycle: draft.amount } : { amountDue: draft.amount, dueDate: draft.dueDate ?? b.dueDate, reserved: draft.reserved ?? b.reserved, frequency: draft.frequency ?? b.frequency }) }),
    claims: workspace.claims.map(c => c.id !== draft.id ? c : { ...c, name: draft.name.trim(), pinned: draft.amount }),
  };
}

export function reorderGoal(workspace: Workspace, id: string, direction: -1 | 1): Workspace {
  const ordered = [...workspace.claims].sort((a,b) => a.rank - b.rank);
  const index = ordered.findIndex(c => c.id === id), next = index + direction;
  if (index < 0 || next < 0 || next >= ordered.length) return workspace;
  [ordered[index], ordered[next]] = [ordered[next], ordered[index]];
  return { ...workspace, claims: ordered.map((c, rank) => ({ ...c, rank })) };
}
