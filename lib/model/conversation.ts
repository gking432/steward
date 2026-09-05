export type PendingIntent = { kind: 'purchase' | 'goal'; name: string; missing: 'amount'; wantBy?: string };
/** Resolve short answers before extracting a fresh intent. */
export function resolveFollowup(pending: PendingIntent | null, text: string) {
  if (/^(cancel|never mind|nevermind|stop)$/i.test(text.trim())) return { cancelled: true as const };
  const match = text.trim().match(/^(?:(?:actually|make it|no[, ]*)\s*)?\$?([\d,]+(?:\.\d{1,2})?)\s*(?:dollars)?$/i);
  if (!pending || !match) return null;
  const amount = Number(match[1].replaceAll(',', ''));
  return Number.isFinite(amount) && amount > 0 ? { ...pending, amount } : null;
}
