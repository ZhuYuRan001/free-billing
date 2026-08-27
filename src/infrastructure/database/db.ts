import Dexie, { type Table } from 'dexie';
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
  }
}

export const db = new BillingDatabase();
