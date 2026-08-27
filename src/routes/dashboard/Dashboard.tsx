import { Link } from 'react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../infrastructure/database/db';
import { summarize } from '../../domain/statistics';
import { formatMoney } from '../../domain/money';
import { PageHeader } from '../../components/PageHeader';
import { StatCard } from '../../components/StatCard';
import { CategoryBar, EntryRow } from '../../components/EntryRow';

export function Dashboard() {
  const entries = useLiveQuery(
    () => db.ledgerEntries.orderBy('occurredAt').reverse().toArray(),
    [],
    [],
  );
  const summary = summarize(entries, new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  return (
    <>
      <PageHeader
        eyebrow="OVERVIEW"
        title="今天，花钱也有章法。"
        description="所有账目在你的设备上整理，不上传、不追踪。"
        action={
          <Link className="button primary" to="/import">
            ＋ 导入账单
          </Link>
        }
      />
      <section className="hero-card">
        <div>
          <span className="hero-label">本月支出</span>
          <strong>{formatMoney(summary.expenseMinor)}</strong>
          <p>
            {summary.count} 笔记录 · {summary.byCategory[0]?.[0] ?? '等待第一笔账目'}
          </p>
        </div>
        <div className="hero-orb">¥</div>
      </section>
      <div className="stat-grid">
        <StatCard
          label="今日支出"
          value={formatMoney(
            summarize(entries, new Date(new Date().setHours(0, 0, 0, 0))).expenseMinor,
          )}
          hint="本地实时计算"
        />
        <StatCard
          label="本月收入"
          value={formatMoney(summary.incomeMinor)}
          hint="已识别收入"
          tone="green"
        />
        <StatCard
          label="待确认"
          value={`${entries.filter((entry) => entry.status === 'needs-review').length} 笔`}
          hint="检查后计入统计"
          tone="orange"
        />
      </div>
      <div className="dashboard-columns">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">RECENT</span>
              <h2>最近流水</h2>
            </div>
            <Link to="/transactions">查看全部 →</Link>
          </div>
          {entries.slice(0, 5).length ? (
            entries.slice(0, 5).map((entry) => <EntryRow key={entry.id} entry={entry} />)
          ) : (
            <EmptyState />
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">BREAKDOWN</span>
              <h2>分类分布</h2>
            </div>
            <Link to="/analytics">详细统计 →</Link>
          </div>
          {summary.byCategory.slice(0, 5).map(([name, amount]) => (
            <CategoryBar key={name} name={name} amount={amount} total={summary.expenseMinor} />
          ))}
          {!summary.byCategory.length && <EmptyState text="导入账单后，这里会出现你的消费分布。" />}
        </section>
      </div>
    </>
  );
}

function EmptyState({ text = '还没有流水，先导入一份账单吧。' }: { text?: string }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">○</span>
      <p>{text}</p>
      <Link className="button secondary" to="/import">
        开始导入
      </Link>
    </div>
  );
}
