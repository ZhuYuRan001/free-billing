import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../infrastructure/database/db';
import { summarize } from '../../domain/statistics';
import { formatMoney } from '../../domain/money';
import { PageHeader } from '../../components/PageHeader';
import { CategoryBar } from '../../components/EntryRow';

export function AnalyticsPage() {
  const entries = useLiveQuery(() => db.ledgerEntries.toArray(), [], []);
  const month = useMemo(
    () => summarize(entries, new Date(new Date().getFullYear(), new Date().getMonth(), 1)),
    [entries],
  );
  const days = useMemo(
    () =>
      Array.from({ length: 14 }, (_, index) => {
        const date = new Date();
        date.setDate(date.getDate() - 13 + index);
        const next = new Date(date);
        next.setDate(date.getDate() + 1);
        return {
          label: `${date.getMonth() + 1}/${date.getDate()}`,
          value: summarize(entries, date, next).expenseMinor,
        };
      }),
    [entries],
  );
  const max = Math.max(...days.map((day) => day.value), 1);
  return (
    <>
      <PageHeader
        eyebrow="ANALYTICS"
        title="看见钱去了哪里。"
        description="按本月已确认和待确认流水实时聚合。"
      />
      <div className="stat-grid">
        <div className="stat-card blue">
          <span className="stat-label">本月支出</span>
          <strong>{formatMoney(month.expenseMinor)}</strong>
        </div>
        <div className="stat-card orange">
          <span className="stat-label">单笔最高</span>
          <strong>{month.largest ? formatMoney(month.largest.amountMinor) : '¥0.00'}</strong>
          <span className="stat-hint">{month.largest?.merchant ?? '暂无记录'}</span>
        </div>
        <div className="stat-card green">
          <span className="stat-label">日均支出</span>
          <strong>
            {formatMoney(Math.round(month.expenseMinor / Math.max(new Date().getDate(), 1)))}
          </strong>
        </div>
      </div>
      <section className="panel chart-panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">LAST 14 DAYS</span>
            <h2>消费趋势</h2>
          </div>
        </div>
        <div className="bar-chart">
          {days.map((day) => (
            <div className="chart-column" key={day.label}>
              <div
                className="chart-value"
                style={{ height: `${Math.max((day.value / max) * 100, day.value ? 5 : 1)}%` }}
                title={formatMoney(day.value)}
              />
              <small>{day.label}</small>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <span className="eyebrow">CATEGORIES</span>
            <h2>分类支出</h2>
          </div>
        </div>
        {month.byCategory.map(([name, amount]) => (
          <CategoryBar key={name} name={name} amount={amount} total={month.expenseMinor} />
        ))}
        {!month.byCategory.length && (
          <div className="empty-state">
            <p>导入账单后生成分类统计。</p>
          </div>
        )}
      </section>
    </>
  );
}
