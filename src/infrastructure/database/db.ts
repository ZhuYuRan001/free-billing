import Dexie, { type Table } from 'dexie';
import { getAutomaticMatchCorrections, reconcileChannelMatches } from '../../domain/matching';
import type { ImportBatch, LedgerEntry, MerchantRule, TransactionEvent } from '../../domain/transaction';

export class BillingDatabase extends Dexie {
  importBatches!: Table<ImportBatch, string>;
  transactionEvents!: Table<TransactionEvent, string>;
  ledgerEntries!: Table<LedgerEntry, string>;
  merchantRules!: Table<MerchantRule, string>;

  constructor() {
    super('free-billing');
    this.version(1).stores({
      importBatches: 'id, createdAt, source',
      transactionEvents: 'id, batchId, fingerprint, occurredAt, source',
      ledgerEntries: 'id, occurredAt, category, status, direction',
      merchantRules: 'id, keyword, category',
    });
    this.version(2).stores({
      importBatches: 'id, createdAt, source',
      transactionEvents: 'id, batchId, fingerprint, occurredAt, source',
      ledgerEntries: 'id, occurredAt, category, status, direction',
      merchantRules: 'id, keyword, category, createdAt',
    });
    this.version(3).stores({});
    this.version(4).stores({});
    this.version(5).stores({});
    this.version(6).stores({});
    this.version(7).stores({});
    this.version(8).stores({});
    this.version(9).stores({}).upgrade(async (transaction) => {
      const ledger = transaction.table<LedgerEntry, string>('ledgerEntries');
      const entries = await ledger.toArray();
      if (!entries.some((entry) => entry.status === 'needs-review' || entry.cardAutoConfirmed || entry.bookingDateAutoConfirmed)) return;

      const [events, rules] = await Promise.all([
        transaction.table<TransactionEvent, string>('transactionEvents').toArray(),
        transaction.table<MerchantRule, string>('merchantRules').toArray(),
      ]);
      const corrections = getAutomaticMatchCorrections(entries, events, rules);
      if (!corrections.size) return;

      await ledger.bulkDelete([...corrections.keys()]);
      await ledger.bulkAdd([...corrections.values()].flat());
    });
    this.version(10).stores({});
    this.version(11).stores({});
    this.version(12).stores({}).upgrade(async (transaction) => {
      const ledger = transaction.table<LedgerEntry, string>('ledgerEntries');
      const [entries, events] = await Promise.all([
        ledger.toArray(),
        transaction.table<TransactionEvent, string>('transactionEvents').toArray(),
      ]);
      const updated = reconcileChannelMatches(entries, events);
      const updatedIds = new Set(updated.map((entry) => entry.id));
      const originalEntries = new Set(entries);
      await ledger.bulkDelete(entries.filter((entry) => !updatedIds.has(entry.id)).map((entry) => entry.id));
      await ledger.bulkPut(updated.filter((entry) => !originalEntries.has(entry)));
    });
  }
}

export const db = new BillingDatabase();

export async function getSourceEvents(entries: LedgerEntry[], additionalIds: string[] = []) {
  const ids = [...new Set([...entries.flatMap((entry) => entry.sourceEventIds), ...additionalIds])];
  const events = await db.transactionEvents.where('id').anyOf(ids).toArray();
  return new Map(events.map((event) => [event.id, event]));
}
