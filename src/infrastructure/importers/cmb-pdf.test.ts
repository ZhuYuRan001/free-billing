import { describe, expect, it, vi } from 'vitest';
import { getDocument } from 'pdfjs-dist';
import { rebuildLedger } from '../../domain/matching';
import { parseStatement } from './registry';

vi.mock('pdfjs-dist', () => ({ getDocument: vi.fn(), GlobalWorkerOptions: {} }));

function text(str: string, x: number, y: number) {
  return { str, transform: [10, 0, 0, 10, x, y], height: 10 };
}

describe('招商银行 PDF 流水', () => {
  it('按金额的正负识别收支，并将分开的负号归入交易金额', async () => {
    const items = [
      text('招商银行交易流水', 220, 780),
      text('账号', 260, 710),
      text('：', 284, 710),
      text('000000000000', 290, 710),
      text('1234', 362, 710),
      text('记账日期', 36, 590),
      text('货币', 98, 590),
      text('交易金额', 156, 590),
      text('联机余额', 234, 590),
      text('交易摘要', 307, 590),
      text('对手信息', 417, 590),
      text('2026-11-21', 36, 545),
      text('CNY', 98, 545),
      text('+2,000.00', 156, 545),
      text('2,000.00', 234, 545),
      text('示例收入', 307, 545),
      text('示例公司', 417, 550),
      text('0000000000005678', 417, 540),
      text('2026-11-22', 36, 520),
      text('CNY', 98, 520),
      text('−', 156, 520),
      text('1,234.56', 161, 520),
      text('765.44', 234, 520),
      text('第三方支付', 307, 520),
      text('微信转账', 417, 520),
    ];
    const destroy = vi.fn().mockResolvedValue(undefined);
    vi.mocked(getDocument).mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({ getTextContent: async () => ({ items }) }),
      }),
      destroy,
    } as unknown as ReturnType<typeof getDocument>);

    const result = await parseStatement(new File(['fixture'], 'cmb.pdf'));

    expect(result).toMatchObject({
      source: 'cmb',
      rowCount: 2,
      events: [
        { direction: 'income', amountMinor: 200_000, merchant: '示例公司' },
        {
          direction: 'expense', amountMinor: 123_456, merchant: '微信转账',
          bankCard: { issuer: 'cmb', last4: '1234' }, statementType: '第三方支付',
        },
      ],
    });
    const csv = [
      '交易时间,交易类型,交易对方,收/支,金额(元),支付方式,交易单号',
      '2026-11-22 12:30:53,转账,示例收款方,支出,1234.56,招商银行储蓄卡(1234),example-1',
    ].join('\n');
    const wallet = await parseStatement(new File([csv], 'wechat.csv'));
    const [expense] = rebuildLedger([...wallet.events, ...result.events], []);
    expect(expense).toMatchObject({
      merchant: '示例收款方', status: 'confirmed', occurredAt: wallet.events[0].occurredAt,
      sourceEventIds: [wallet.events[0].id, result.events[1].id],
    });
    expect(destroy).toHaveBeenCalledOnce();
  });
});
