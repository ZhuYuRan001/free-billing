import { useState, type ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSourceEvents } from '../../infrastructure/database/db';
import { eventToEntry } from '../../domain/classification';
import { mergeChannelEntries, sourceEventKey } from '../../domain/matching';
import { formatSignedMoney } from '../../domain/money';
import { isBankSource, TRANSACTION_SOURCE_LABELS } from '../../domain/transaction';
import type { LedgerEntry, TransactionEvent } from '../../domain/transaction';
import { PageHeader } from '../../components/PageHeader';

type Resolution = 'single' | 'multiple';

async function resolveEntries(entryIds: string[], resolution: Resolution) {
  const pending = db.ledgerEntries
    .where('id')
    .anyOf(entryIds)
    .and((entry) => entry.status === 'needs-review');
  const now = new Date().toISOString();

  if (resolution === 'single') {
    await db.transaction('rw', db.ledgerEntries, () =>
      pending.and((entry) => !entry.matchCandidateEventIds).modify({ status: 'confirmed', updatedAt: now }),
    );
    return;
  }

  await db.transaction('rw', db.ledgerEntries, db.transactionEvents, db.merchantRules, async () => {
    const entries = await pending.toArray();
    if (!entries.length) return;

    const [eventsById, rules] = await Promise.all([
      getSourceEvents(entries),
      db.merchantRules.toArray(),
    ]);
    const separateEntries: LedgerEntry[] = [];

    for (const entry of entries) {
      if (entry.matchCandidateEventIds) {
        separateEntries.push({
          ...entry,
          matchCandidateEventIds: undefined,
          excludedMatchKeys: [...new Set([
            ...(entry.excludedMatchKeys ?? []),
            ...entry.matchCandidateEventIds.map((id) => sourceEventKey([entry.sourceEventIds[0], id])),
          ])],
          status: 'confirmed',
          updatedAt: now,
        });
        continue;
      }
      if (!entry.sourceEventIds.length) throw new Error('有待确认流水缺少原始记录，无法拆分。');
      const matchKey = sourceEventKey(entry.sourceEventIds);
      for (const id of entry.sourceEventIds) {
        const event = eventsById.get(id);
        if (!event) throw new Error('有待确认流水缺少原始记录，无法拆分。');
        separateEntries.push({
          ...eventToEntry(event, rules, now),
          excludedMatchKeys: [matchKey],
        });
      }
    }

    await db.ledgerEntries.bulkDelete(entries.map((entry) => entry.id));
    await db.ledgerEntries.bulkAdd(separateEntries);
  });
}

async function resolveChannelCandidate(bankId: string, walletEventId: string) {
  await db.transaction('rw', db.ledgerEntries, async () => {
    const bank = await db.ledgerEntries.get(bankId);
    const wallet = await db.ledgerEntries.filter(
      (entry) => entry.sourceEventIds.length === 1 && entry.sourceEventIds[0] === walletEventId,
    ).first();
    if (!wallet || !bank || bank.status !== 'needs-review' || !bank.matchCandidateEventIds?.includes(walletEventId)) {
      throw new Error('这条待确认流水已更新，请重新选择。');
    }

    const now = new Date().toISOString();
    await db.ledgerEntries.put(mergeChannelEntries(bank, wallet, now));
    await db.ledgerEntries.delete(bank.id);
    await db.ledgerEntries.where('status').equals('needs-review').modify((entry) => {
      if (!entry.matchCandidateEventIds?.includes(walletEventId)) return false;
      const remaining = entry.matchCandidateEventIds.filter((id) => id !== walletEventId);
      entry.matchCandidateEventIds = remaining.length ? remaining : undefined;
      entry.status = remaining.length ? 'needs-review' : 'confirmed';
      entry.updatedAt = now;
    });
  });
}

function ReviewSource({ event, action }: { event: TransactionEvent | undefined; action?: ReactNode }) {
  if (!event) return <li className="review-source review-source-missing">原始流水缺失</li>;

  const date = new Date(event.occurredAt);
  const dateLabel =
    isBankSource(event.source)
      ? date.toLocaleDateString('zh-CN')
      : date.toLocaleString('zh-CN', { hour12: false });

  return (
    <li className="review-source">
      <strong>{TRANSACTION_SOURCE_LABELS[event.source] ?? TRANSACTION_SOURCE_LABELS.unknown}</strong>
      <span className={`entry-amount ${event.direction}`}>
        {formatSignedMoney(event.amountMinor, event.direction)}
      </span>
      <div className="review-source-details">
        <span>{event.merchant || '未命名商户'}</span>
        <time dateTime={event.occurredAt}>{dateLabel}</time>
        {event.bankCard && <small>卡尾号 {event.bankCard.last4}</small>}
        {event.externalId && <small>编号 {event.externalId}</small>}
        {action}
      </div>
    </li>
  );
}

export function ReviewPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reviewItems = useLiveQuery(
    () =>
      db.transaction('r', db.ledgerEntries, db.transactionEvents, async () => {
        const entries = await db.ledgerEntries.where('status').equals('needs-review').toArray();
        const eventsById = await getSourceEvents(entries, entries.flatMap((entry) => entry.matchCandidateEventIds ?? []));
        return entries.map((entry) => ({
          entry,
          sources: entry.sourceEventIds.map((id) => ({ id, event: eventsById.get(id) })),
          candidates: (entry.matchCandidateEventIds ?? []).map((id) => ({ id, event: eventsById.get(id) })),
        }));
      }),
    [],
    [],
  );
  const entryIds = reviewItems.map(({ entry }) => entry.id);
  const pairIds = reviewItems.filter(({ candidates }) => !candidates.length).map(({ entry }) => entry.id);

  async function applyResolution(resolve: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await resolve();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '处理失败，请重试。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="REVIEW"
        title="处理可能重复的流水"
        description="同一笔交易可合并。银行流水有候选时，可逐笔选择对应记录。"
        action={
          reviewItems.length > 0 && (
            <div className="page-header-actions" role="group" aria-label="批量处理待确认流水">
              {pairIds.length > 0 && (
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void applyResolution(() => resolveEntries(pairIds, 'single'))}
                >
                  一键保留为一笔
                </button>
              )}
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void applyResolution(() => resolveEntries(entryIds, 'multiple'))}
              >
                一键保留多笔
              </button>
            </div>
          )
        }
      />
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {reviewItems.length ? (
        <section className="review-list">
          {reviewItems.map(({ entry, sources, candidates }) => (
            <article className="review-card" key={entry.id}>
              <ul className="review-sources" role="list" aria-label="原始流水">
                {sources.length ? (
                  sources.map(({ id, event }) => <ReviewSource key={id} event={event} />)
                ) : (
                  <ReviewSource event={undefined} />
                )}
              </ul>
              {candidates.length > 0 && (
                <>
                  <p>请选择与上方银行流水对应的原始记录。</p>
                  <ul className="review-sources" role="list" aria-label="可能对应的流水">
                    {candidates.map(({ id, event }) => (
                      <ReviewSource key={id} event={event} action={
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() => void applyResolution(() => resolveChannelCandidate(entry.id, id))}
                        >
                          与此笔合并
                        </button>
                      } />
                    ))}
                  </ul>
                </>
              )}
              <div className="review-actions">
                {!candidates.length && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void applyResolution(() => resolveEntries([entry.id], 'single'))}
                  >
                    保留一笔
                  </button>
                )}
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void applyResolution(() => resolveEntries([entry.id], 'multiple'))}
                >
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
