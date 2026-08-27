import { formatMoney, formatSignedMoney } from '../domain/money';
import type { LedgerEntry } from '../domain/transaction';

export function EntryRow({ entry }: { entry: LedgerEntry }) {
  return <div className="entry-row"><div className="merchant-avatar">{entry.merchant.slice(0, 1)}</div><div className="entry-main"><strong>{entry.merchant}</strong><span>{entry.category} · {new Date(entry.occurredAt).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span></div><div className={`entry-amount ${entry.direction}`}>{formatSignedMoney(entry.amountMinor, entry.direction)}</div>{entry.status === 'needs-review' && <span className="review-pill">待确认</span>}</div>;
}

export function CategoryBar({ name, amount, total }: { name: string; amount: number; total: number }) {
  const percent = total ? Math.round((amount / total) * 100) : 0;
  return <div className="category-bar"><div><span>{name}</span><strong>{formatMoney(amount)}</strong></div><div className="bar-track"><span style={{ width: `${Math.max(percent, 2)}%` }} /></div><small>{percent}%</small></div>;
}
