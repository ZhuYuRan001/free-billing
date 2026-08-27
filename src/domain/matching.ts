import type { LedgerEntry, MerchantRule, TransactionEvent } from './transaction';
import { classifyMerchant } from './classification';

const MAX_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;

function merchantSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  if (a === b) return 10;
  if (a.includes(b) || b.includes(a)) return 8;
  return [...a].some((char) => char.trim() && b.includes(char)) ? 3 : 0;
}

export function scoreMatch(left: TransactionEvent, right: TransactionEvent): number {
  if (left.source === right.source || left.direction !== right.direction || left.amountMinor !== right.amountMinor) return 0;
  const timeDelta = Math.abs(new Date(left.occurredAt).getTime() - new Date(right.occurredAt).getTime());
  if (timeDelta > MAX_MATCH_WINDOW_MS) return 0;
  const timeScore = timeDelta <= 5 * 60 * 1000 ? 30 : timeDelta <= 60 * 60 * 1000 ? 20 : 8;
  return 60 + timeScore + merchantSimilarity(left.merchant, right.merchant);
}

export function sourceEventKey(sourceEventIds: string[]): string {
  return JSON.stringify([...sourceEventIds].sort());
}

export function rebuildLedger(
  events: TransactionEvent[],
  rules: MerchantRule[],
  now = new Date().toISOString(),
  previousEntries: LedgerEntry[] = [],
): LedgerEntry[] {
  const previousStatusBySourceEvents = new Map(
    previousEntries.map((entry) => [sourceEventKey(entry.sourceEventIds), entry.status]),
  );
  const excludedMatchKeys = new Set(previousEntries.flatMap((entry) => entry.excludedMatchKeys ?? []));
  const candidates: Array<{ left: number; right: number; score: number }> = [];
  for (let left = 0; left < events.length; left += 1) {
    for (let right = left + 1; right < events.length; right += 1) {
      const score = scoreMatch(events[left], events[right]);
      if (score >= 65) candidates.push({ left, right, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  const used = new Set<number>();
  const entries: LedgerEntry[] = [];
  for (const candidate of candidates) {
    if (used.has(candidate.left) || used.has(candidate.right)) continue;
    const first = events[candidate.left];
    const second = events[candidate.right];
    const matchKey = sourceEventKey([first.id, second.id]);
    if (excludedMatchKeys.has(matchKey)) continue;
    used.add(candidate.left);
    used.add(candidate.right);
    const representative = first.source === 'bank' ? second : first;
    entries.push({
      id: `entry_${first.id}_${second.id}`,
      amountMinor: representative.amountMinor,
      currency: 'CNY',
      direction: representative.direction,
      occurredAt: new Date(Math.min(new Date(first.occurredAt).getTime(), new Date(second.occurredAt).getTime())).toISOString(),
      merchant: representative.merchant || first.merchant || second.merchant || '未命名商户',
      category: classifyMerchant(representative.merchant || first.merchant || second.merchant, rules),
      sourceEventIds: [first.id, second.id],
      status: previousStatusBySourceEvents.get(matchKey) ?? (candidate.score < 90 ? 'needs-review' : 'confirmed'),
      createdAt: now,
      updatedAt: now,
    });
  }
  events.forEach((event, index) => {
    if (!used.has(index)) {
      const previousEntry = previousEntries.find((entry) => sourceEventKey(entry.sourceEventIds) === sourceEventKey([event.id]));
      entries.push({
        ...eventToEntry(event, rules, now),
        excludedMatchKeys: previousEntry?.excludedMatchKeys,
        status: previousStatusBySourceEvents.get(sourceEventKey([event.id])) ?? 'confirmed',
      });
    }
  });
  return entries.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}

function eventToEntry(event: TransactionEvent, rules: MerchantRule[], now: string): LedgerEntry {
  return {
    id: `entry_${event.id}`,
    amountMinor: event.amountMinor,
    currency: 'CNY',
    direction: event.direction,
    occurredAt: event.occurredAt,
    merchant: event.merchant || '未命名商户',
    category: classifyMerchant(event.merchant, rules),
    sourceEventIds: [event.id],
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  };
}
