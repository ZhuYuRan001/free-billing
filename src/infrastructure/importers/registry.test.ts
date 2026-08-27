import { describe, expect, it } from 'vitest';
import { detectSourceFromHeaders, normalizeRows } from './registry';

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
