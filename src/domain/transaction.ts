export const SOURCES = ['wechat', 'alipay', 'bank', 'cmb', 'apple-pay', 'unknown'] as const;
export type TransactionSource = (typeof SOURCES)[number];
export type TransactionDirection = 'expense' | 'income';

export const TRANSACTION_SOURCE_LABELS = {
  wechat: '微信支付',
  alipay: '支付宝',
  bank: '建设银行',
  cmb: '招商银行',
  'apple-pay': 'Apple Pay',
  unknown: '未知来源',
} satisfies Record<TransactionSource, string>;

export function isBankSource(source: TransactionSource): source is 'bank' | 'cmb' {
  return source === 'bank' || source === 'cmb';
}

export type BankCard = {
  issuer: 'ccb' | 'cmb' | 'other';
  last4: string;
};

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
  bankCard?: BankCard;
  statementType?: string;
  externalId?: string;
  rawText: string;
  fingerprint: string;
  createdAt: string;
  ledgerDeletedAt?: string;
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
  matchCandidateEventIds?: string[];
  excludedMatchKeys?: string[];
  status: EntryStatus;
  cardAutoConfirmed?: true;
  bookingDateAutoConfirmed?: true;
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
