import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { db } from '../../infrastructure/database/db';
import { addDays, dateInputValue, localMidnight, type DateSelection } from '../../domain/dates';
import { entriesInRange, summarize } from '../../domain/statistics';
import { formatMoney } from '../../domain/money';
import type { LedgerEntry, TransactionDirection } from '../../domain/transaction';
import { AnnualSummary } from '../../components/AnnualSummary';
import { DateRangePicker } from '../../components/DateRangePicker';
import { PageHeader } from '../../components/PageHeader';
import { CategoryBar } from '../../components/EntryRow';
import { StatCard } from '../../components/StatCard';
import { AnalyticsDetailsDialog, type AnalyticsDetails } from './AnalyticsDetailsDialog';

const fullDate = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'long' });

function countDays(start: string, end: string) {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1;
}

export function AnalyticsPage() {
  const entries = useLiveQuery(() => db.ledgerEntries.toArray(), [], []);
  const today = dateInputValue(new Date());
  const defaultRange = { start: `${today.slice(0, 8)}01`, end: today };
  const [customRange, setCustomRange] = useState<DateSelection | null>(null);
  const [details, setDetails] = useState<AnalyticsDetails | null>(null);
  const start = customRange?.start ?? defaultRange.start;
  const end = customRange?.end ?? defaultRange.end;
  const fromTime = localMidnight(start).getTime();
  const toTime = addDays(localMidnight(end), 1).getTime();
  const summary = useMemo(
    () => summarize(entries, new Date(fromTime), new Date(toTime)),
    [entries, fromTime, toTime],
  );
  const dayCount = countDays(start, end);
  const expenseLabel = customRange ? '区间支出' : '本月支出';

  function openDetails(
    title: string,
    direction: TransactionDirection,
    from: Date,
    to: Date,
    trigger: HTMLButtonElement,
    category?: string,
  ) {
    setDetails({ title, direction, from, to, trigger, category });
  }

  function openRangeDetails(title: string, trigger: HTMLButtonElement, category?: string) {
    openDetails(title, 'expense', new Date(fromTime), new Date(toTime), trigger, category);
  }

  return (
    <>
      <PageHeader
        eyebrow="ANALYTICS"
        title="看见钱去了哪里。"
        description="实时汇总已确认和待确认流水。"
      />
      <Card className="panel analytics-range-card gap-0 shadow-none">
        <div className="flex flex-wrap items-end gap-3" role="group" aria-label="支出统计日期范围">
          <DateRangePicker value={{ start, end }} onChange={setCustomRange} />
          <Button type="button" variant="outline" onClick={() => setCustomRange(null)}>
            恢复默认
          </Button>
        </div>
      </Card>
      <div className="stat-grid">
        <StatCard
          label={expenseLabel}
          value={formatMoney(summary.expenseMinor)}
          onOpenDetails={(event) => openRangeDetails(expenseLabel, event.currentTarget)}
        />
        <StatCard
          label="单笔最高"
          value={formatMoney(summary.largest?.amountMinor ?? 0)}
          hint={summary.largest?.merchant ?? '暂无记录'}
          tone="orange"
        />
        <StatCard
          label="日均支出"
          value={formatMoney(Math.round(summary.expenseMinor / dayCount))}
          tone="green"
          onOpenDetails={(event) => openRangeDetails('日均支出', event.currentTarget)}
        />
      </div>
      <AnnualSummary entries={entries} onOpenDetails={openDetails} />
      <ExpenseTrend
        key={`${start}/${end}`}
        entries={entries}
        start={start}
        dayCount={dayCount}
        onOpenDay={(date, trigger) =>
          openDetails(
            `${fullDate.format(date)} 日结支出`,
            'expense',
            date,
            addDays(date, 1),
            trigger,
          )
        }
      />
      <Card className="panel gap-0 shadow-none">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CATEGORIES</span>
            <h2>分类支出</h2>
          </div>
        </div>
        {summary.byCategory.map(([name, amount]) => (
          <CategoryBar
            key={name}
            name={name}
            amount={amount}
            total={summary.expenseMinor}
            onOpenDetails={(event) => openRangeDetails(`${name}支出`, event.currentTarget, name)}
          />
        ))}
        {!summary.byCategory.length && (
          <div className="empty-state">
            <p>所选日期内没有支出记录。</p>
          </div>
        )}
      </Card>
      {details && (
        <AnalyticsDetailsDialog
          entries={entries}
          details={details}
          onClose={() => setDetails(null)}
        />
      )}
    </>
  );
}

function ExpenseTrend({
  entries,
  start,
  dayCount,
  onOpenDay,
}: {
  entries: LedgerEntry[];
  start: string;
  dayCount: number;
  onOpenDay: (date: Date, trigger: HTMLButtonElement) => void;
}) {
  const days = useMemo(() => {
    const from = localMidnight(start);
    const totals = new Map<string, number>();
    for (const entry of entriesInRange(entries, from, addDays(from, dayCount))) {
      if (entry.direction !== 'expense') continue;
      const key = dateInputValue(new Date(entry.occurredAt));
      totals.set(key, (totals.get(key) ?? 0) + entry.amountMinor);
    }
    return Array.from({ length: dayCount }, (_, index) => {
      const date = addDays(from, index);
      const key = dateInputValue(date);
      return { date, key, amount: totals.get(key) ?? 0 };
    });
  }, [entries, start, dayCount]);
  const max = days.reduce((highest, day) => Math.max(highest, day.amount), 1);

  return (
    <Card className="panel chart-panel gap-0 shadow-none">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">
            {fullDate.formatRange(days[0].date, days[days.length - 1].date)}
          </span>
          <h2>消费趋势</h2>
        </div>
      </div>
      <div className="bar-chart" role="region" aria-label="每日支出" tabIndex={0}>
        {days.map(({ date, key, amount }) => (
          <Button
            className="chart-column"
            type="button"
            variant="ghost"
            key={key}
            aria-haspopup="dialog"
            aria-label={`${fullDate.format(date)} 日结支出 ${formatMoney(amount)}`}
            title={formatMoney(amount)}
            onClick={(event) => onOpenDay(date, event.currentTarget)}
          >
            <span
              className="chart-value"
              style={{ height: `${Math.max((amount / max) * 100, amount ? 5 : 1)}%` }}
            />
            <small>
              {date.getMonth() + 1}/{date.getDate()}
            </small>
          </Button>
        ))}
      </div>
    </Card>
  );
}
