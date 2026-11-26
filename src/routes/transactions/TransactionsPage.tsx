import { useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Trash2Icon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { deleteTransactions } from '../../application/delete-transactions';
import { db } from '../../infrastructure/database/db';
import { addDays, localMidnight, type DateSelection } from '../../domain/dates';
import { ledgerSortOrders, type LedgerSortOrder } from '../../domain/ledger-sort';
import { formatMoney, formatSignedMoney } from '../../domain/money';
import { entriesInRange } from '../../domain/statistics';
import type { LedgerEntry } from '../../domain/transaction';
import { DateRangePicker } from '../../components/DateRangePicker';
import { PageHeader } from '../../components/PageHeader';
import { EntryList } from '../../components/EntryList';
import { EntrySortSelect } from '../../components/EntrySortSelect';

export function TransactionsPage() {
  const entries = useLiveQuery(
    () => db.ledgerEntries.orderBy('occurredAt').reverse().toArray(),
    [],
    [],
  );
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [dateRange, setDateRange] = useState<DateSelection>();
  const [sortOrder, setSortOrder] = useState<LedgerSortOrder>('date');
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [deleteRequest, setDeleteRequest] = useState<LedgerEntry[] | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [deleteMessage, setDeleteMessage] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const deleteTrigger = useRef<HTMLButtonElement | null>(null);
  const categories = useMemo(
    () => [...new Set(['全部', ...entries.map((entry) => entry.category), category])],
    [entries, category],
  );
  const filtered = useMemo(() => {
    const from = dateRange && localMidnight(dateRange.start);
    const to = dateRange && addDays(localMidnight(dateRange.end), 1);
    const search = query.toLowerCase();
    return entriesInRange(entries, from, to)
      .filter(
        (entry) =>
          (category === '全部' || entry.category === category) &&
          `${entry.merchant}${entry.category}`.toLowerCase().includes(search),
      )
      .sort(ledgerSortOrders[sortOrder].compare);
  }, [entries, dateRange, query, category, sortOrder]);
  const selectedEntries = selecting ? filtered.filter((entry) => selectedIds.has(entry.id)) : [];
  const allSelected = filtered.length > 0 && selectedEntries.length === filtered.length;

  function changeDateRange(range?: DateSelection) {
    setDateRange(range);
    setSelectedIds(new Set());
  }

  function openDeleteDialog(selection: LedgerEntry[], trigger: HTMLButtonElement) {
    deleteTrigger.current = trigger;
    setDeleteMessage('');
    setDeleteError('');
    setDeleteRequest(selection);
  }

  async function confirmDelete() {
    if (!deleteRequest || deleting) return;

    setDeleting(true);
    setDeleteError('');
    try {
      const count = await deleteTransactions(deleteRequest);
      if (count === null) {
        setDeleteError('所选流水已更新。请取消后重新选择。');
        return;
      }
      deleteTrigger.current = null;
      setDeleteRequest(null);
      setSelectedIds(new Set());
      setSelecting(false);
      setDeleteMessage(count ? `已删除 ${count} 笔流水。` : '所选流水已不存在。');
    } catch {
      setDeleteError('删除失败，请重试。');
    } finally {
      setDeleting(false);
    }
  }

  function renderEntryAction(entry: LedgerEntry) {
    if (selecting) {
      return (
        <label className="flex size-9 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            className="size-4 cursor-pointer accent-ring"
            aria-label={`选择 ${entry.merchant}`}
            checked={selectedIds.has(entry.id)}
            onChange={(event) => {
              const checked = event.target.checked;
              setSelectedIds((previous) => {
                const next = new Set(previous);
                if (checked) next.add(entry.id);
                else next.delete(entry.id);
                return next;
              });
            }}
          />
        </label>
      );
    }

    const label = `删除 ${entry.merchant}`;
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        onClick={(event) => openDeleteDialog([entry], event.currentTarget)}
      >
        <Trash2Icon aria-hidden="true" />
      </Button>
    );
  }

  const singleEntry = deleteRequest?.length === 1 ? deleteRequest[0] : undefined;

  return (
    <>
      <PageHeader
        eyebrow="TRANSACTIONS"
        title="所有流水"
        description={`${entries.length} 笔本地记录`}
        action={
          <Button
            type="button"
            variant="outline"
            disabled={!selecting && !filtered.length}
            onClick={() => {
              setSelecting(!selecting);
              setSelectedIds(new Set());
            }}
          >
            {selecting ? '退出批量删除' : '批量删除'}
          </Button>
        }
      />
      <div className="toolbar">
        <div className="flex w-full flex-wrap items-end gap-3">
          <input
            ref={searchRef}
            className="search-input"
            aria-label="搜索商户或分类"
            placeholder="搜索商户或分类…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedIds(new Set());
            }}
          />
          <DateRangePicker value={dateRange} onChange={changeDateRange} />
          {dateRange && (
            <Button type="button" variant="ghost" onClick={() => changeDateRange()}>
              清除日期
            </Button>
          )}
          <EntrySortSelect value={sortOrder} onChange={setSortOrder} />
        </div>
        <div className="filter-pills">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={category === item ? 'selected' : ''}
              onClick={() => {
                if (item === category) return;
                setCategory(item);
                setSelectedIds(new Set());
              }}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className={deleteMessage ? 'inline-message mb-3' : undefined} role="status">
        {deleteMessage}
      </div>
      <section className="panel transaction-list">
        {selecting && (
          <div className="flex flex-wrap items-center gap-2 border-b border-input py-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!filtered.length}
              onClick={() =>
                setSelectedIds(new Set(allSelected ? [] : filtered.map((entry) => entry.id)))
              }
            >
              {allSelected ? '取消全选' : '全选当前结果'}
            </Button>
            <span className="mr-auto text-sm text-muted-foreground" role="status">
              已选 {selectedEntries.length} 笔
            </span>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!selectedEntries.length}
              aria-haspopup="dialog"
              onClick={(event) => openDeleteDialog(selectedEntries, event.currentTarget)}
            >
              删除所选
            </Button>
          </div>
        )}
        {filtered.length ? (
          <EntryList entries={filtered} renderAction={renderEntryAction} />
        ) : (
          <div className="empty-state">
            <p>没有找到匹配的流水。</p>
          </div>
        )}
        <div className="list-footer">
          当前显示 {filtered.length} 笔 · 合计{' '}
          {formatMoney(
            filtered
              .filter((entry) => entry.direction === 'expense')
              .reduce((sum, entry) => sum + entry.amountMinor, 0),
          )}
        </div>
      </section>
      {deleteRequest && (
        <Dialog open onOpenChange={(open) => !open && !deleting && setDeleteRequest(null)}>
          <DialogContent
            showCloseButton={false}
            aria-busy={deleting}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const trigger = deleteTrigger.current;
              (trigger?.isConnected && !trigger.disabled ? trigger : searchRef.current)?.focus({
                preventScroll: true,
              });
            }}
          >
            <DialogHeader className="text-left">
              <DialogTitle>删除 {deleteRequest.length} 笔流水？</DialogTitle>
              <DialogDescription className="break-words">
                {singleEntry && (
                  <>
                    {singleEntry.merchant} ·{' '}
                    {formatSignedMoney(singleEntry.amountMinor, singleEntry.direction)}
                    <br />
                  </>
                )}
                删除后，这些流水将从账本和统计中移除，此操作无法撤销。
              </DialogDescription>
            </DialogHeader>
            {deleteError && (
              <p role="alert" className="m-0 text-sm text-destructive">
                {deleteError}
              </p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={deleting}
                onClick={() => setDeleteRequest(null)}
              >
                取消
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={deleting}
                onClick={() => void confirmDelete()}
              >
                {deleting ? '删除中…' : '确认删除'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
