import { formatMoney } from '../domain/money';
import { summarize } from '../domain/statistics';
import type { LedgerEntry, TransactionDirection } from '../domain/transaction';
import { StatCard } from './StatCard';

type Props = {
  entries: LedgerEntry[];
  onOpenDetails?: (
    title: string,
    direction: TransactionDirection,
    from: Date,
    to: Date,
    trigger: HTMLButtonElement,
  ) => void;
};

export function AnnualSummary({ entries, onOpenDetails }: Props) {
  const year = new Date().getFullYear();
  const from = new Date(year, 0, 1);
  const to = new Date(year + 1, 0, 1);
  const { incomeMinor, expenseMinor } = summarize(entries, from, to);
  const incomeLabel = `${year} 年收入`;
  const expenseLabel = `${year} 年支出`;

  return (
    <section className="stat-grid annual-summary" aria-label="年度收支">
      <StatCard
        label={incomeLabel}
        value={formatMoney(incomeMinor)}
        tone="green"
        onOpenDetails={
          onOpenDetails &&
          ((event) => onOpenDetails(incomeLabel, 'income', from, to, event.currentTarget))
        }
      />
      <StatCard
        label={expenseLabel}
        value={formatMoney(expenseMinor)}
        onOpenDetails={
          onOpenDetails &&
          ((event) => onOpenDetails(expenseLabel, 'expense', from, to, event.currentTarget))
        }
      />
    </section>
  );
}
