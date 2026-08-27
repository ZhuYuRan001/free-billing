import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../infrastructure/database/db';
import { eventToEntry } from '../../domain/classification';
import { sourceEventKey } from '../../domain/matching';
import { formatMoney } from '../../domain/money';
import type { LedgerEntry } from '../../domain/transaction';
import { PageHeader } from '../../components/PageHeader';

export function ReviewPage() {
  const entries = useLiveQuery(
    () => db.ledgerEntries.where('status').equals('needs-review').toArray(),
    [],
    [],
  );
  async function keepMultiple(entry: LedgerEntry) {
    const matchKey = sourceEventKey(entry.sourceEventIds);
    const now = new Date().toISOString();
    await db.transaction(
      'rw',
      db.ledgerEntries,
      db.transactionEvents,
      db.merchantRules,
      async () => {
        const events = (await db.transactionEvents.bulkGet(entry.sourceEventIds)).filter(
          (event): event is NonNullable<typeof event> => Boolean(event),
        );
        if (events.length !== entry.sourceEventIds.length) return;
        const rules = await db.merchantRules.toArray();
        const separateEntries = events.map((event) => ({
          ...eventToEntry(event, rules, now),
          excludedMatchKeys: [matchKey],
        }));
        await db.ledgerEntries.delete(entry.id);
        await db.ledgerEntries.bulkAdd(separateEntries);
      },
    );
  }
  return (
    <>
      <PageHeader
        eyebrow="REVIEW"
        title="处理可能重复的流水"
        description="系统认为这些来源可能是同一笔交易；选择保留多笔后，将按来源分别计入账本。"
      />
      {entries.length ? (
        <section className="review-list">
          {entries.map((entry) => (
            <article className="review-card" key={entry.id}>
              <div className="match-visual">
                <div className="match-node">
                  <b>{entry.merchant.slice(0, 1)}</b>
                  <span>{entry.merchant}</span>
                  <small>{formatMoney(entry.amountMinor)}</small>
                </div>
                <div className="match-line">≈</div>
                <div className="match-node secondary">
                  <b>↔</b>
                  <span>{entry.sourceEventIds.length} 个来源</span>
                  <small>{new Date(entry.occurredAt).toLocaleDateString('zh-CN')}</small>
                </div>
              </div>
              <div className="review-actions">
                <button className="button primary" onClick={() => void keepMultiple(entry)}>
                  保留多笔
                </button>
              </div>
            </article>
          ))}
        </section>
      ) : (
        <section className="panel empty-state large">
          <span className="empty-icon">✓</span>
          <h2>现在没有待确认记录</h2>
          <p>导入多来源账单后，低置信度匹配会出现在这里。</p>
        </section>
      )}
    </>
  );
}
