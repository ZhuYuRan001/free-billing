import type { LedgerEntry } from './transaction';

const byDate = (a: LedgerEntry, b: LedgerEntry) =>
  Date.parse(b.occurredAt) - Date.parse(a.occurredAt);

export const ledgerSortOrders = {
  date: { label: '日期时间从新到旧', compare: byDate },
  'amount-desc': {
    label: '金额从高到低',
    compare: (a: LedgerEntry, b: LedgerEntry) => b.amountMinor - a.amountMinor || byDate(a, b),
  },
  'amount-asc': {
    label: '金额从低到高',
    compare: (a: LedgerEntry, b: LedgerEntry) => a.amountMinor - b.amountMinor || byDate(a, b),
  },
};

export type LedgerSortOrder = keyof typeof ledgerSortOrders;
