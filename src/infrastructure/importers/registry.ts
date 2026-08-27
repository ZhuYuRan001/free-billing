import Papa from 'papaparse';
import { z } from 'zod';
import { parseAmountMinor } from '../../domain/money';
import type { TransactionEvent, TransactionSource } from '../../domain/transaction';
import type { ParsedStatement, RawRow } from './types';

export type ImportSource = Exclude<TransactionSource, 'unknown' | 'apple-pay'>;

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  wechat: '微信支付',
  alipay: '支付宝',
  bank: '建设银行',
};

const rowSchema = z.record(z.string(), z.unknown());
const SUPPORTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

type SourceProfile = {
  headerSignature: string[];
  date: string[];
  amount: string[];
  merchant: string[];
  direction: string[];
  externalId: string[];
};

const SOURCE_PROFILES: Record<ImportSource, SourceProfile> = {
  wechat: {
    headerSignature: ['交易时间', '交易类型', '交易对方', '收/支', '金额(元)', '交易单号'],
    date: ['交易时间'],
    amount: ['金额(元)'],
    merchant: ['交易对方', '商品'],
    direction: ['收/支'],
    externalId: ['交易单号', '商户单号'],
  },
  alipay: {
    headerSignature: ['交易时间', '交易分类', '交易对方', '收/支', '金额', '交易订单号'],
    date: ['交易时间'],
    amount: ['金额'],
    merchant: ['交易对方', '商品说明'],
    direction: ['收/支'],
    externalId: ['交易订单号', '商家订单号'],
  },
  bank: {
    headerSignature: ['序号', '摘要', '交易日期', '交易金额', '账户余额', '对方账号与户名'],
    date: ['交易日期'],
    amount: ['交易金额'],
    merchant: ['对方账号与户名', '交易地点/附言', '摘要'],
    direction: [],
    externalId: ['序号'],
  },
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function findValue(row: RawRow, names: string[]): string {
  const normalizedNames = names.map(normalizeHeader);
  const exactEntry = normalizedNames
    .map((name) => Object.entries(row).find(([key]) => normalizeHeader(key) === name))
    .find((entry): entry is [string, unknown] => Boolean(entry));
  if (exactEntry) return String(exactEntry[1] ?? '').trim();

  const partialEntry = normalizedNames
    .map((name) => Object.entries(row).find(([key]) => normalizeHeader(key).includes(name)))
    .find((entry): entry is [string, unknown] => Boolean(entry));
  return String(partialEntry?.[1] ?? '').trim();
}

function scoreHeaders(headers: string[], source: ImportSource): number {
  const normalizedHeaders = new Set(headers.map(normalizeHeader));
  return SOURCE_PROFILES[source].headerSignature.filter((header) =>
    normalizedHeaders.has(normalizeHeader(header)),
  ).length;
}

export function detectSourceFromHeaders(headers: string[]): ImportSource | undefined {
  const ranked = (Object.keys(SOURCE_PROFILES) as ImportSource[])
    .map((source) => ({ source, score: scoreHeaders(headers, source) }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  return best && best.score >= 4 ? best.source : undefined;
}

function findHeaderRow(matrix: unknown[][], requestedSource?: ImportSource): {
  index: number;
  source: ImportSource;
} {
  const sources = requestedSource ? [requestedSource] : (Object.keys(SOURCE_PROFILES) as ImportSource[]);
  let best: { index: number; source: ImportSource; score: number } | undefined;

  matrix.forEach((row, index) => {
    const headers = row.map(String);
    sources.forEach((source) => {
      const score = scoreHeaders(headers, source);
      if (score >= 4 && (!best || score > best.score)) best = { index, source, score };
    });
  });

  if (!best) throw new Error('无法识别账单表头，请确认文件来源后重试。');
  return best;
}

function matrixToRows(matrix: unknown[][], requestedSource?: ImportSource): {
  rows: RawRow[];
  detectedSource: ImportSource;
} {
  const header = findHeaderRow(matrix, requestedSource);
  const headers = matrix[header.index].map((value) => String(value ?? '').trim());
  const rows = matrix.slice(header.index + 1).flatMap((values) => {
    const row: RawRow = {};
    headers.forEach((name, index) => {
      if (name) row[name] = values[index] ?? '';
    });
    return Object.values(row).some((value) => String(value).trim()) ? [row] : [];
  });
  return { rows, detectedSource: header.source };
}

function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(bytes);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('gb18030').decode(bytes);
  }
}

function parseCsvRows(text: string, requestedSource?: ImportSource): {
  rows: RawRow[];
  detectedSource?: ImportSource;
} {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => {
    if (!line.trim()) return false;
    const fields = Papa.parse<string[]>(line, { header: false, skipEmptyLines: true }).data[0] ?? [];
    return Boolean(detectSourceFromHeaders(fields) || (requestedSource && scoreHeaders(fields, requestedSource) >= 4));
  });
  if (headerIndex < 0) throw new Error('无法识别 CSV 账单表头，请确认文件来源后重试。');

  const result = Papa.parse<RawRow>(lines.slice(headerIndex).join('\n'), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });
  const mismatch = result.errors.find((error) => error.code === 'TooManyFields' || error.code === 'TooFewFields');
  if (mismatch) throw new Error(`CSV 账单格式异常：${mismatch.message}`);

  const detectedSource = detectSourceFromHeaders(Object.keys(result.data[0] ?? {}));
  return { rows: result.data, detectedSource };
}

async function readStatementRows(file: File, requestedSource?: ImportSource): Promise<{
  rows: RawRow[];
  detectedSource?: ImportSource;
}> {
  const lowerName = file.name.toLowerCase();
  if (!SUPPORTED_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    throw new Error('仅支持 CSV、XLSX 或 XLS 账单文件。');
  }

  if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
    const XLSX = await import('xlsx');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', raw: false, cellDates: false });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!firstSheet) throw new Error('Excel 文件没有可读取的工作表。');
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(firstSheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: true,
    });
    return matrixToRows(matrix, requestedSource);
  }

  return parseCsvRows(decodeText(await file.arrayBuffer()), requestedSource);
}

export async function detectStatementSource(file: File): Promise<ImportSource | undefined> {
  try {
    return (await readStatementRows(file)).detectedSource;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('无法识别')) return undefined;
    throw error;
  }
}

function parseDate(value: string): string | null {
  const trimmed = value.trim();
  const compact = trimmed.replace(/\D/g, '');
  if (/^\d{8}$/.test(compact)) {
    const date = new Date(Number(compact.slice(0, 4)), Number(compact.slice(4, 6)) - 1, Number(compact.slice(6, 8)), 12);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const match = trimmed.match(
    /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})(?:日)?(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (match) {
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      Number(match[4] ?? 12),
      Number(match[5] ?? 0),
      Number(match[6] ?? 0),
    );
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  const date = new Date(trimmed.includes(':') ? trimmed : `${trimmed} 12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getBankMerchant(row: RawRow): string {
  const counterparty = findValue(row, SOURCE_PROFILES.bank.merchant);
  const separatorIndex = counterparty.indexOf('/');
  return (separatorIndex >= 0 ? counterparty.slice(separatorIndex + 1) : counterparty).trim() || '未命名商户';
}

function getDirection(source: ImportSource, row: RawRow, signedAmountMinor: number): 'income' | 'expense' | null {
  if (source === 'bank') return signedAmountMinor > 0 ? 'income' : 'expense';
  const directionText = findValue(row, SOURCE_PROFILES[source].direction);
  if (/不计收支/.test(directionText)) return null;
  if (/收入|转入|退款|入账|贷/.test(directionText)) return 'income';
  if (/支出|转出|消费|借/.test(directionText)) return 'expense';
  return null;
}

export function normalizeRows(rows: RawRow[], source: ImportSource, fileName = 'statement.csv'): ParsedStatement {
  const profile = SOURCE_PROFILES[source];
  const warnings: string[] = [];
  const events = rows.flatMap((row, index): TransactionEvent[] => {
    const parsed = rowSchema.safeParse(row);
    if (!parsed.success) return [];

    const signedAmountMinor = parseAmountMinor(findValue(row, profile.amount));
    if (signedAmountMinor === null || signedAmountMinor === 0) {
      warnings.push(`第 ${index + 1} 笔金额无法识别，已跳过`);
      return [];
    }

    const occurredAt = parseDate(findValue(row, profile.date));
    if (!occurredAt) {
      warnings.push(`第 ${index + 1} 笔日期无法识别，已跳过`);
      return [];
    }

    const direction = getDirection(source, row, signedAmountMinor);
    if (!direction) {
      warnings.push(`第 ${index + 1} 笔为不计收支或收支类型无法识别，已跳过`);
      return [];
    }

    const merchant = source === 'bank' ? getBankMerchant(row) : findValue(row, profile.merchant) || '未命名商户';
    const externalId = findValue(row, profile.externalId) || undefined;
    const amountMinor = Math.abs(signedAmountMinor);
    const event: TransactionEvent = {
      id: `event_${crypto.randomUUID()}`,
      batchId: '',
      source,
      direction,
      amountMinor,
      currency: 'CNY',
      occurredAt,
      merchant,
      accountLabel: findValue(row, ['账户', '卡号', '尾号']) || undefined,
      externalId,
      rawText: Object.values(row).map(String).join(' | '),
      fingerprint: [source, externalId || occurredAt.slice(0, 16), amountMinor, merchant.toLowerCase()].join('|'),
      createdAt: new Date().toISOString(),
    };
    return [event];
  });

  return {
    source,
    events,
    rowCount: rows.length,
    warnings: warnings.concat(`来源：${IMPORT_SOURCE_LABELS[source]}，文件：${fileName}`),
  };
}

export async function parseStatement(file: File, requestedSource?: ImportSource): Promise<ParsedStatement> {
  let parsed: Awaited<ReturnType<typeof readStatementRows>>;
  try {
    parsed = await readStatementRows(file);
  } catch (error) {
    if (!requestedSource) throw error;
    parsed = await readStatementRows(file, requestedSource);
  }
  const source = requestedSource ?? parsed.detectedSource;
  if (!source) throw new Error('无法自动识别账单来源，请选择支付宝、微信支付或建设银行后重试。');
  if (parsed.detectedSource && parsed.detectedSource !== source) {
    throw new Error(`所选来源为${IMPORT_SOURCE_LABELS[source]}，但文件表头更像${IMPORT_SOURCE_LABELS[parsed.detectedSource]}。`);
  }
  return normalizeRows(parsed.rows, source, file.name);
}
