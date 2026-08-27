export function parseAmountMinor(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value * 100);
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/[¥￥,\s]/g, '').replace(/元$/, '');
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

export function formatMoney(amountMinor: number): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export function formatSignedMoney(amountMinor: number, direction: 'expense' | 'income'): string {
  return `${direction === 'expense' ? '-' : '+'}${formatMoney(amountMinor).replace('¥', '¥')}`;
}
