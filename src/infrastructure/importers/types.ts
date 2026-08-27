import type { TransactionEvent, TransactionSource } from '../../domain/transaction';

export type ParsedStatement = {
  source: TransactionSource;
  events: TransactionEvent[];
  rowCount: number;
  warnings: string[];
};

export type RawRow = Record<string, unknown>;
