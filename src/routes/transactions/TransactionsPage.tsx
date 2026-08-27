import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../infrastructure/database/db';
import { formatMoney } from '../../domain/money';
import { PageHeader } from '../../components/PageHeader';
import { EntryRow } from '../../components/EntryRow';

export function TransactionsPage() {
  const entries = useLiveQuery(
    () => db.ledgerEntries.orderBy('occurredAt').reverse().toArray(),
    [],
    [],
  );
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const categories = useMemo(
    () => ['全部', ...new Set(entries.map((entry) => entry.category))],
    [entries],
  );
  const filtered = entries.filter(
    (entry) =>
      (category === '全部' || entry.category === category) &&
      `${entry.merchant}${entry.category}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="TRANSACTIONS"
        title="所有流水"
        description={`${entries.length} 笔本地记录`}
      />
      <div className="toolbar">
        <input
          className="search-input"
          placeholder="搜索商户或分类…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="filter-pills">
          {categories.map((item) => (
            <button
              key={item}
              className={category === item ? 'selected' : ''}
              onClick={() => setCategory(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <section className="panel transaction-list">
        {filtered.length ? (
          filtered.map((entry) => <EntryRow key={entry.id} entry={entry} />)
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
    </>
  );
}
