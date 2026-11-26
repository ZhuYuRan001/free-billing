import type { MouseEventHandler, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { formatMoney, formatSignedMoney } from '../domain/money';
import type { LedgerEntry } from '../domain/transaction';

export function EntryRow({
  entry,
  showYear,
  sourceLabel,
  action,
}: {
  entry: LedgerEntry;
  showYear?: boolean;
  sourceLabel: string;
  action?: ReactNode;
}) {
  return (
    <div className="entry-row">
      <div className="merchant-avatar">{entry.merchant.slice(0, 1)}</div>
      <div className="entry-main">
        <strong>{entry.merchant}</strong>
        <span>
          {entry.category} ·{' '}
          {new Date(entry.occurredAt).toLocaleString('zh-CN', {
            year: showYear ? 'numeric' : undefined,
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
        <span className="entry-source">导入来源 {sourceLabel}</span>
      </div>
      <div className={`entry-amount ${entry.direction}`}>
        {formatSignedMoney(entry.amountMinor, entry.direction)}
      </div>
      {entry.status === 'needs-review' && <span className="review-pill">待确认</span>}
      {action}
    </div>
  );
}

type CategoryBarProps = {
  name: string;
  amount: number;
  total: number;
  onOpenDetails?: MouseEventHandler<HTMLButtonElement>;
};

export function CategoryBar({ name, amount, total, onOpenDetails }: CategoryBarProps) {
  const percent = total ? Math.round((amount / total) * 100) : 0;
  const content = (
    <>
      <span className="category-bar-label">
        <span>{name}</span>
        <strong>
          {formatMoney(amount)}
          {onOpenDetails && <span aria-hidden="true"> →</span>}
        </strong>
      </span>
      <span className="bar-track">
        <span style={{ width: `${Math.max(percent, 2)}%` }} />
      </span>
      <small>{percent}%</small>
    </>
  );

  if (onOpenDetails) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="category-bar h-auto font-normal whitespace-normal"
        aria-haspopup="dialog"
        onClick={onOpenDetails}
      >
        {content}
      </Button>
    );
  }

  return <div className="category-bar">{content}</div>;
}
