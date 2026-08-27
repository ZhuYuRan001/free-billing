import { describe, expect, it } from 'vitest';
import { rebuildLedger, scoreMatch, sourceEventKey } from './matching';
import type { TransactionEvent } from './transaction';

const event = (overrides: Partial<TransactionEvent>): TransactionEvent => ({
  id: crypto.randomUUID(), batchId: 'batch', source: 'wechat', direction: 'expense', amountMinor: 3250, currency: 'CNY', occurredAt: '2026-08-24T02:00:00.000Z', merchant: '瑞幸咖啡', rawText: '', fingerprint: crypto.randomUUID(), createdAt: '2026-08-24T02:00:00.000Z', ...overrides,
});

describe('matching engine', () => {
  it('scores same-amount cross-source events highly when close in time', () => {
    expect(scoreMatch(event({}), event({ source: 'bank', merchant: '瑞幸' }))).toBeGreaterThanOrEqual(90);
  });
  it('never matches two events from the same source', () => {
    expect(scoreMatch(event({}), event({ merchant: '瑞幸' }))).toBe(0);
  });
  it('matches each event at most once', () => {
    const entries = rebuildLedger([event({ id: 'wechat-1' }), event({ id: 'wechat-2', occurredAt: '2026-08-24T02:01:00.000Z' }), event({ id: 'bank-1', source: 'bank', merchant: '' })], []);
    expect(entries.filter((entry) => entry.sourceEventIds.length === 2)).toHaveLength(1);
    expect(new Set(entries.flatMap((entry) => entry.sourceEventIds)).size).toBe(3);
  });
  it('preserves a resolved match when rebuilding with new rules', () => {
    const first = event({ id: 'wechat-1', merchant: 'Example Shop' });
    const second = event({ id: 'bank-1', source: 'bank', merchant: 'Bank Shop', occurredAt: '2026-08-24T04:00:00.000Z' });
    const initial = rebuildLedger([first, second], [], '2026-08-24T05:00:00.000Z');
    const resolved = initial.map((entry) => ({ ...entry, status: 'confirmed' as const }));
    const rebuilt = rebuildLedger([first, second], [{ id: 'rule-1', keyword: 'Example', category: '购物', createdAt: '2026-08-24T06:00:00.000Z' }], '2026-08-24T06:00:00.000Z', resolved);

    expect(initial[0].status).toBe('needs-review');
    expect(rebuilt[0].status).toBe('confirmed');
    expect(rebuilt[0].category).toBe('购物');
  });
  it('keeps a user-split match from being merged again', () => {
    const first = event({ id: 'wechat-1', merchant: 'Example Shop' });
    const second = event({ id: 'bank-1', source: 'bank', merchant: 'Bank Shop', occurredAt: '2026-08-24T04:00:00.000Z' });
    const matchKey = sourceEventKey([first.id, second.id]);
    const separateEntries = rebuildLedger([first], []).concat(rebuildLedger([second], [])).map((entry) => ({ ...entry, excludedMatchKeys: [matchKey] }));
    const rebuilt = rebuildLedger([first, second], [], '2026-08-24T06:00:00.000Z', separateEntries);

    expect(rebuilt).toHaveLength(2);
    expect(rebuilt.every((entry) => entry.sourceEventIds.length === 1)).toBe(true);
    expect(rebuilt.every((entry) => entry.excludedMatchKeys?.includes(matchKey))).toBe(true);
  });
});
