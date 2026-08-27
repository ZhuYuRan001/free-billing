export const SOURCES = ['wechat', 'alipay', 'bank', 'apple-pay', 'unknown'] as const;
export type TransactionSource = (typeof SOURCES)[number];
export type TransactionDirection = 'expense' | 'income';

export type TransactionEvent = {
  id: string;
  batchId: string;
  source: TransactionSource;
  direction: TransactionDirection;
  amountMinor: number;
  currency: 'CNY';
  occurredAt: string;
  merchant: string;
  accountLabel?: string;
  externalId?: string;
  rawText: string;
  fingerprint: string;
  createdAt: string;
};

export type EntryStatus = 'confirmed' | 'needs-review';

export type LedgerEntry = {
  id: string;
  amountMinor: number;
  currency: 'CNY';
  direction: TransactionDirection;
  occurredAt: string;
  merchant: string;
  category: string;
  sourceEventIds: string[];
  excludedMatchKeys?: string[];
  status: EntryStatus;
  note?: string;
  createdAt: string;
  updatedAt: string;
};

export type ImportBatch = {
  id: string;
  fileName: string;
  source: TransactionSource;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  status: 'completed' | 'failed';
  createdAt: string;
};

export type MerchantRule = {
  id: string;
  keyword: string;
  category: string;
  createdAt: string;
};
