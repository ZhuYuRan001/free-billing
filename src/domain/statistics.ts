import type { LedgerEntry } from './transaction';

export function entriesInRange(entries: LedgerEntry[], from?: Date, to?: Date) {
  if (!from && !to) return entries;
  return entries.filter((entry) => {
    const time = new Date(entry.occurredAt);
    return (!from || time >= from) && (!to || time < to);
  });
}

export function summarize(entries: LedgerEntry[], from?: Date, to?: Date) {
  const filtered = entriesInRange(entries, from, to);
  const expenses = filtered.filter((entry) => entry.direction === 'expense');
  const income = filtered.filter((entry) => entry.direction === 'income');
  const byCategory = Object.entries(expenses.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.category] = (acc[entry.category] ?? 0) + entry.amountMinor;
    return acc;
  }, {})).sort((a, b) => b[1] - a[1]);
  return {
    count: filtered.length,
    expenseMinor: expenses.reduce((sum, entry) => sum + entry.amountMinor, 0),
    incomeMinor: income.reduce((sum, entry) => sum + entry.amountMinor, 0),
    byCategory,
    largest: expenses.sort((a, b) => b.amountMinor - a.amountMinor)[0],
  };
}
