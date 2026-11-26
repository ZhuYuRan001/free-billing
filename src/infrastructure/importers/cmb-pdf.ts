import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { RawRow } from './types';

const HEADERS = ['记账日期', '货币', '交易金额', '联机余额', '交易摘要', '对手信息'];
const LINE_TOLERANCE = 1.5;
const MONEY = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

type Span = { text: string; x: number; y: number; height: number };

function textLines(spans: Span[]) {
  const lines: { y: number; spans: Span[] }[] = [];
  for (const span of [...spans].sort((a, b) => b.y - a.y)) {
    const line = lines.at(-1);
    if (line && line.y - span.y <= LINE_TOLERANCE) line.spans.push(span);
    else lines.push({ y: span.y, spans: [span] });
  }
  return lines.map(({ y, spans: line }) => ({
    y,
    text: line.sort((a, b) => a.x - b.x).map((span) => span.text).join('').trim(),
  }));
}

function readMoney(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, '').replace(/−/g, '-');
}

function readPage(spans: Span[], pageNumber: number) {
  const dateHeader = spans.find((span) => span.text.trim() === HEADERS[0]);
  if (!dateHeader) throw new Error(`第 ${pageNumber} 页缺少招商银行流水表头。`);

  const headers = HEADERS.map((label) => spans.find((span) =>
    span.text.trim() === label && Math.abs(span.y - dateHeader.y) <= LINE_TOLERANCE,
  ));
  const lefts = headers.map((span) => span?.x ?? NaN);
  if (lefts.some((x, index) => !Number.isFinite(x) || (index > 0 && x <= lefts[index - 1]))) {
    throw new Error(`第 ${pageNumber} 页的招商银行流水列无法识别。`);
  }

  const body = spans.filter((span) => span.y < dateHeader.y - LINE_TOLERANCE);
  const columns = lefts.map((left, index) => body.filter((span) =>
    span.x >= left - 2 && span.x < (lefts[index + 1] ?? Infinity) - 2,
  ));
  const dates = textLines(columns[0]).filter((line) => DATE.test(line.text));
  const amountLines = textLines(columns[2]).filter((line) => MONEY.test(readMoney(line.text)));
  if (!dates.length || dates.length !== amountLines.length) {
    throw new Error(`第 ${pageNumber} 页的记账日期与交易金额无法逐笔对应。`);
  }

  return dates.map(({ y, text: date }, index): RawRow => {
    const day = new Date(`${date}T00:00:00Z`);
    const [currency, amount, balance] = columns.slice(1, 4).map((column) =>
      textLines(column.filter((span) => Math.abs(span.y - y) <= LINE_TOLERANCE))[0]?.text ?? '',
    );
    const signedAmount = readMoney(amount);
    const runningBalance = readMoney(balance);
    if (
      !Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date ||
      !/^(?:CNY|RMB|人民币)$/.test(currency) || !MONEY.test(signedAmount) || !MONEY.test(runningBalance)
    ) {
      throw new Error(`第 ${pageNumber} 页第 ${index + 1} 笔的日期、币种或金额无法识别。`);
    }

    const rowPadding = dateHeader.height * 1.2;
    const above = dates[index - 1]?.y ?? y + rowPadding * 2;
    const below = dates[index + 1]?.y ?? y - rowPadding * 2;
    const top = Math.min(y + rowPadding, (above + y) / 2);
    const bottom = Math.max(y - rowPadding, (below + y) / 2);
    const [summary, counterparty] = columns.slice(4).map((column) =>
      textLines(column.filter((span) => span.y <= top && span.y > bottom))
        .map((line) => line.text),
    );
    const merchant = counterparty.filter((line) => !/^[\d*Xx●•\s-]+$/.test(line)).join(' ');
    return {
      记账日期: date,
      交易金额: signedAmount,
      联机余额: runningBalance,
      交易摘要: summary.join(' '),
      对手户名: merchant || summary.join(' '),
    };
  });
}

export async function readCmbPdf(file: File) {
  GlobalWorkerOptions.workerSrc = workerUrl;
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), stopAtErrors: true });
  try {
    const document = await task.promise;
    const rows: RawRow[] = [];
    let bankCardLast4: string | undefined;
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const { items } = await page.getTextContent();
      const spans: Span[] = items.flatMap((item) => 'str' in item && item.str.trim()
        ? [{ text: item.str, x: item.transform[4], y: item.transform[5], height: item.height }]
        : []);
      if (pageNumber === 1) {
        const tableTop = spans.find((span) => span.text.trim() === HEADERS[0])?.y ?? -Infinity;
        const heading = textLines(spans.filter((span) => span.y > tableTop + LINE_TOLERANCE));
        if (!heading.some(({ text }) => text.replace(/\s+/g, '').includes('招商银行交易流水'))) {
          throw new Error('无法识别为招商银行文字版 PDF 流水。');
        }
        const accountTails = new Set(heading.flatMap(({ text }) =>
          [...text.normalize('NFKC').matchAll(/账号\s*:\s*[\d*Xx●•\s]*(\d{4})(?![\d*Xx●•])/g)]
            .map((match) => match[1]),
        ));
        if (accountTails.size === 1) bankCardLast4 = accountTails.values().next().value;
      }
      rows.push(...readPage(spans, pageNumber));
    }
    return { rows, bankCardLast4 };
  } catch (error) {
    if (error instanceof Error && error.name === 'PasswordException') {
      throw new Error('PDF 需要密码，请先解锁后再选择文件。', { cause: error });
    }
    throw error;
  } finally {
    await task.destroy();
  }
}
