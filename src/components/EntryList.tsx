import type { ReactNode } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { TRANSACTION_SOURCE_LABELS, type LedgerEntry } from '../domain/transaction';
import { getSourceEvents } from '../infrastructure/database/db';
import { EntryRow } from './EntryRow';

export function EntryList({
  entries,
  showYear,
  renderAction,
}: {
  entries: LedgerEntry[];
  showYear?: boolean;
  renderAction?: (entry: LedgerEntry) => ReactNode;
}) {
  const eventsById = useLiveQuery(() => getSourceEvents(entries), [entries]);

  return entries.map((entry) => {
    const labels = eventsById && new Set(entry.sourceEventIds.map((id) => {
      const source = eventsById.get(id)?.source ?? 'unknown';
      return TRANSACTION_SOURCE_LABELS[source] ?? TRANSACTION_SOURCE_LABELS.unknown;
    }));
    const sourceLabel = labels ? [...labels].join('、') || TRANSACTION_SOURCE_LABELS.unknown : '读取中…';

    return (
      <EntryRow
        key={entry.id}
        entry={entry}
        showYear={showYear}
        sourceLabel={sourceLabel}
        action={renderAction?.(entry)}
      />
    );
  });
}
