import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EntryList } from '../../components/EntryList';
import { EntrySortSelect } from '../../components/EntrySortSelect';
import { ledgerSortOrders, type LedgerSortOrder } from '../../domain/ledger-sort';
import { formatMoney } from '../../domain/money';
import { entriesInRange } from '../../domain/statistics';
import type { LedgerEntry, TransactionDirection } from '../../domain/transaction';

export type AnalyticsDetails = {
  title: string;
  from: Date;
  to: Date;
  direction: TransactionDirection;
  trigger: HTMLButtonElement;
  category?: string;
};

const dateFormatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' });

export function AnalyticsDetailsDialog({
  entries,
  details,
  onClose,
}: {
  entries: LedgerEntry[];
  details: AnalyticsDetails;
  onClose: () => void;
}) {
  const sortId = useId();
  const [sortOrder, setSortOrder] = useState<LedgerSortOrder>('date');
  const { from, to, direction, category } = details;
  const filtered = useMemo(
    () =>
      entriesInRange(entries, from, to).filter(
        (entry) =>
          entry.direction === direction && (category === undefined || entry.category === category),
      ),
    [entries, from, to, direction, category],
  );
  const sorted = useMemo(
    () => [...filtered].sort(ledgerSortOrders[sortOrder].compare),
    [filtered, sortOrder],
  );
  const total = filtered.reduce((sum, entry) => sum + entry.amountMinor, 0);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="analytics-details flex flex-col gap-0"
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          details.trigger.focus({ preventScroll: true });
        }}
      >
        <DialogHeader className="analytics-details-heading flex-row items-center justify-between text-left">
          <DialogTitle>{details.title}明细</DialogTitle>
          <DialogClose asChild>
            <Button variant="outline">关闭</Button>
          </DialogClose>
        </DialogHeader>
        <div className="analytics-details-toolbar">
          <div>
            <DialogDescription>
              {dateFormatter.formatRange(from, new Date(to.getTime() - 1))}
            </DialogDescription>
            <p>
              {filtered.length} 笔 · 合计 {formatMoney(total)}
            </p>
          </div>
          <div className="analytics-sort">
            <label htmlFor={sortId}>排序</label>
            <EntrySortSelect id={sortId} value={sortOrder} onChange={setSortOrder} />
          </div>
        </div>
        <div className="analytics-details-list">
          {sorted.length ? (
            <EntryList entries={sorted} showYear />
          ) : (
            <div className="empty-state">
              <p>没有符合条件的流水。</p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
