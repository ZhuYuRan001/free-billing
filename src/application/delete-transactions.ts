import type { LedgerEntry } from '../domain/transaction';
import { db } from '../infrastructure/database/db';

export async function deleteTransactions(selection: LedgerEntry[]): Promise<number | null> {
  return db.transaction('rw', db.ledgerEntries, db.transactionEvents, async () => {
    const entries = await db.ledgerEntries.bulkGet(selection.map((entry) => entry.id));
    const entryIds: string[] = [];
    const sourceIds = new Set<string>();

    for (const [index, entry] of entries.entries()) {
      if (!entry) continue;
      const selectedSources = selection[index].sourceEventIds;
      if (
        entry.sourceEventIds.length !== selectedSources.length ||
        entry.sourceEventIds.some((id) => !selectedSources.includes(id))
      ) {
        return null;
      }
      entryIds.push(entry.id);
      for (const id of entry.sourceEventIds) sourceIds.add(id);
    }

    await db.ledgerEntries.bulkDelete(entryIds);
    if (sourceIds.size) {
      const now = new Date().toISOString();
      await db.transactionEvents
        .where('id')
        .anyOf([...sourceIds])
        .modify({ ledgerDeletedAt: now });
      await db.ledgerEntries
        .where('status')
        .equals('needs-review')
        .modify((entry) => {
          const candidates = entry.matchCandidateEventIds;
          if (!candidates) return false;
          const remaining = candidates.filter((id) => !sourceIds.has(id));
          if (remaining.length === candidates.length) return false;
          entry.matchCandidateEventIds = remaining.length ? remaining : undefined;
          entry.status = remaining.length ? 'needs-review' : 'confirmed';
          entry.updatedAt = now;
        });
    }
    return entryIds.length;
  });
}
