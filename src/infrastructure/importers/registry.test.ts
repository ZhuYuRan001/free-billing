import { describe, expect, it } from 'vitest';
import { rebuildLedger } from '../../domain/matching';
import { detectSourceFromHeaders, normalizeRows, parseStatement } from './registry';

describe('statement importer', () => {
  it('detects the three supported statement headers', () => {
    expect(detectSourceFromHeaders(['交易时间', '交易类型', '交易对方', '收/支', '金额(元)', '交易单号'])).toBe('wechat');
    expect(detectSourceFromHeaders(['交易时间', '交易分类', '交易对方', '收/支', '金额', '交易订单号'])).toBe('alipay');
    expect(detectSourceFromHeaders(['序号', '摘要', '交易日期', '交易金额', '账户余额', '对方账号与户名'])).toBe('bank');
  });

  it('normalizes a bank signed amount and compact date', () => {
    const result = normalizeRows(
      [
        {
          序号: '1',
          摘要: '消费',
          交易日期: '20260101',
          交易金额: '-6.00',
          账户余额: '1,068.42',
          '对方账号与户名': '4******9202/*百道',
        },
      ],
      'bank',
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      amountMinor: 600,
      direction: 'expense',
      merchant: '*百道',
      externalId: '1',
    });
    expect(result.events[0].occurredAt).toMatch(/^2026-01-01/);
    expect(result.events[0].bankCard).toBeUndefined();
  });

  it.each([
    ['wechat', '金额(元)', '支付方式', '建设银行储蓄卡(6844)'],
    ['alipay', '金额', '收/付款方式', '中国建设银行储蓄卡（6844）'],
    ['alipay', '金额', '收／付款方式', '中国建设银行储蓄卡（尾号：6844）'],
    ['alipay', '金额', '付款方式', '建行借记卡 后四位 6844'],
    ['wechat', '金额（元）', '支付方式', '建设银行储蓄卡（＊＊＊＊6844）'],
  ] as const)('reads the payment card from the %s payment method column', (source, amountColumn, methodColumn, method) => {
    const { events } = normalizeRows([{
      交易时间: '2026-08-24 09:00:00',
      '收/支': '支出',
      [amountColumn]: '32.50',
      [methodColumn]: method,
    }], source);

    expect(events[0].bankCard).toEqual({ issuer: 'ccb', last4: '6844' });
  });

  it.each(['csv', 'xlsx'])('reads the bank account from the %s statement preface', async (extension) => {
    const rows = [
      ['卡号/账号：', '6217******6844'],
      ['序号', '摘要', '交易日期', '交易金额', '账户余额', '对方账号与户名'],
      ['1', '消费', '20260824', '-32.50', '162.00', '4******9202/测试商户'],
    ];
    let content: string | ArrayBuffer = rows.map((row) => row.join(',')).join('\n');
    if (extension === 'xlsx') {
      const XLSX = await import('xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), '账单');
      content = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    }

    const { events } = await parseStatement(new File([content], `statement.${extension}`));

    expect(events[0].bankCard).toEqual({ issuer: 'ccb', last4: '6844' });
  });

  it('uses the bank row account column ahead of the statement-wide account', () => {
    const { events } = normalizeRows([{
      交易日期: '20260824',
      交易金额: '-32.50',
      本方卡号: '尾号：0042',
      对方卡号: '6844',
    }], 'bank', 'statement.csv', '6844');

    expect(events[0].bankCard).toEqual({ issuer: 'ccb', last4: '0042' });
  });

  it('preserves a slash inside the bank payment description', () => {
    const { events } = normalizeRows([{
      交易日期: '20260824',
      交易金额: '-32.50',
      摘要: '快捷支付',
      对方账号与户名: '微信支付/转账',
    }], 'bank');

    expect(events[0]).toMatchObject({ merchant: '微信支付/转账', statementType: '快捷支付' });
  });

  it.each([[true, true], [true, false], [false, true], [false, false]])(
    'matches the CCB transfer using the bank tail (%s) and wallet tail (%s)',
    async (hasBankTail, hasWalletTail) => {
      const bankRows = [
        ...(hasBankTail ? ['账号：6217******6844'] : []),
        '序号,摘要,交易日期,交易金额,账户余额,对方账号与户名',
        '1,其他,20260726,"-4,000.00","1,068.42",4******9202/**转账',
      ];
      const walletRows = [
        '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,交易单号',
        `2026-07-26 19:07:16,转账,示例房东,转账备注:微信转账,支出,"¥4,000.00",建设银行储蓄卡${hasWalletTail ? '(6844)' : ''},example-1`,
      ];
      const [bank, wallet] = await Promise.all([
        parseStatement(new File([bankRows.join('\n')], 'ccb.csv')),
        parseStatement(new File([walletRows.join('\n')], 'wechat.csv')),
      ]);

      expect(bank.events[0].bankCard?.last4).toBe(hasBankTail ? '6844' : undefined);
      expect(wallet.events[0].bankCard?.last4).toBe(hasWalletTail ? '6844' : undefined);
      const entries = rebuildLedger([...bank.events, ...wallet.events], []);
      if (hasBankTail && hasWalletTail) {
        expect(entries).toMatchObject([{
          merchant: '示例房东', status: 'confirmed', amountMinor: 400_000, occurredAt: wallet.events[0].occurredAt,
          sourceEventIds: [wallet.events[0].id, bank.events[0].id],
        }]);
      } else {
        expect(entries).toMatchObject([
          { merchant: '示例房东', status: 'confirmed', amountMinor: 400_000 },
          { merchant: '**转账', status: 'needs-review', matchCandidateEventIds: [wallet.events[0].id] },
        ]);
      }
    },
  );

  it('reads a labelled own-card suffix from the bank statement header', async () => {
    const csv = [
      '本方卡号（后四位）：0042',
      '序号,摘要,交易日期,交易金额,账户余额,对方账号与户名',
      '1,消费,20260824,-5.75,162.00,4******9202/***园店',
    ].join('\n');

    const { events } = await parseStatement(new File([csv], 'bank.csv'));

    expect(events[0].bankCard).toEqual({ issuer: 'ccb', last4: '0042' });
  });

  it('imports explicit zero amounts and skips missing amounts in a CSV statement', async () => {
    const csv = [
      '交易时间,交易类型,交易对方,收/支,金额(元),交易单号',
      '2026-08-24 10:00:00,商户消费,测试商户,支出,0.00,zero-1',
      '2026-08-24 11:00:00,商户消费,测试商户,支出,,missing-1',
    ].join('\n');

    const result = await parseStatement(new File([csv], 'statement.csv'));

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      externalId: 'zero-1',
      amountMinor: 0,
      direction: 'expense',
    });
    expect(result.warnings).toContain('第 2 笔金额无法识别，已跳过');
  });

  it('skips Alipay neutral transactions instead of treating them as expenses', () => {
    const result = normalizeRows(
      [
        {
          交易时间: '2026-08-24 10:00:00',
          交易分类: '信用借还',
          交易对方: '花呗',
          商品说明: '花呗自动还款',
          '收/支': '不计收支',
          金额: '100.00',
          交易订单号: 'neutral-1',
        },
        {
          交易时间: '2026-08-24 11:00:00',
          交易分类: '餐饮美食',
          交易对方: '测试商户',
          商品说明: '午餐',
          '收/支': '支出',
          金额: '10.00',
          交易订单号: 'expense-1',
        },
      ],
      'alipay',
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ merchant: '测试商户', amountMinor: 1000, direction: 'expense' });
    expect(result.warnings.some((warning) => warning.includes('不计收支'))).toBe(true);
  });
});
