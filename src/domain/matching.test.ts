import { describe, expect, it } from 'vitest';
import { eventToEntry } from './classification';
import { getAutomaticMatchCorrections, mergeChannelEntries, rebuildLedger, reconcileChannelMatches, scoreMatch, sourceEventKey } from './matching';
import type { LedgerEntry, TransactionEvent } from './transaction';

const event = (overrides: Partial<TransactionEvent>): TransactionEvent => ({
  id: crypto.randomUUID(), batchId: 'batch', source: 'wechat', direction: 'expense', amountMinor: 3250, currency: 'CNY', occurredAt: '2026-08-24T02:00:00.000Z', merchant: '瑞幸咖啡', rawText: '', fingerprint: crypto.randomUUID(), createdAt: '2026-08-24T02:00:00.000Z', ...overrides,
});
const ccbCard = { issuer: 'ccb', last4: '6844' } as const;
const cmbCard = { issuer: 'cmb', last4: '7196' } as const;

describe('bank payment channel matching', () => {
  const wallet = event({
    merchant: '示例房东', occurredAt: '2026-11-15T12:30:53', amountMinor: 230_000,
    statementType: '转账', bankCard: cmbCard,
  });
  const bank = event({
    source: 'cmb', merchant: '微信转账', occurredAt: '2026-11-15T12:00:00',
    amountMinor: 230_000, bankCard: cmbCard,
  });

  it.each([
    ['wechat', '微信转账'],
    ['wechat', '财付通－微信转账'],
    ['wechat', '微信支付：转账'],
    ['alipay', '支付宝转账'],
    ['alipay', '支付宝（中国）网络技术有限公司-个人转账'],
  ] as const)('merges a unique same-card %s transfer described as %s', (source, merchant) => {
    const entries = rebuildLedger([{ ...wallet, source }, { ...bank, merchant }], []);

    expect(entries).toMatchObject([{
      status: 'confirmed', cardAutoConfirmed: true, sourceEventIds: [wallet.id, bank.id],
      amountMinor: 230_000, occurredAt: wallet.occurredAt, merchant: wallet.merchant,
    }]);
  });

  it('uses platform and transfer type as constraints even when the merchant is embedded', () => {
    const withMerchant = { ...bank, merchant: '微信转账-示例房东' };
    const otherWallet = { ...wallet, source: 'alipay' } as const;
    const purchase = { ...wallet, statementType: '商户消费' };
    const otherMerchant = { ...wallet, merchant: '另一收款方' };

    expect(rebuildLedger([withMerchant, wallet], [])).toHaveLength(1);
    for (const other of [otherWallet, purchase, otherMerchant]) {
      expect(rebuildLedger([withMerchant, other], [])).toHaveLength(2);
    }
    expect(rebuildLedger([bank, wallet, { ...purchase, id: 'purchase' }], [])).toHaveLength(2);
  });

  it('skips deleted source events before rebuilding and matching ledger entries', () => {
    const deletedWallet = { ...wallet, ledgerDeletedAt: '2026-11-26T01:00:00.000Z' };
    const previousEntries = rebuildLedger([wallet, bank], []);

    expect(rebuildLedger([deletedWallet, bank], [], undefined, previousEntries)).toMatchObject([
      { sourceEventIds: [bank.id], status: 'confirmed' },
    ]);
    expect(
      rebuildLedger([deletedWallet, { ...bank, ledgerDeletedAt: deletedWallet.ledgerDeletedAt }], []),
    ).toEqual([]);
  });

  it.each([
    { bankCard: { issuer: 'cmb', last4: '4321' } },
    { direction: 'income' },
    { amountMinor: 230_001 },
    { occurredAt: '2026-11-16T12:00:00' },
  ] as const)('keeps conflicting events independent (%j)', (overrides) => {
    const entries = rebuildLedger([wallet, { ...bank, ...overrides }], []);

    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.status === 'confirmed')).toBe(true);
  });

  it.each([
    { ...bank, bankCard: undefined },
    { ...bank, merchant: '快捷支付' },
    { ...bank, merchant: '未命名商户', statementType: '第三方代扣' },
  ])('offers a candidate without enough evidence to merge (%o)', (reviewBank) => {
    const entries = rebuildLedger([wallet, reviewBank], []);

    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.status === 'needs-review')).toMatchObject({
      sourceEventIds: [bank.id], matchCandidateEventIds: [wallet.id],
    });
  });

  it.each(['**转账', '＊＊转账', '转账**'])('confirms a unique same-card masked transfer (%s)', (merchant) => {
    const ccbTransfer = { ...bank, source: 'bank', merchant, bankCard: ccbCard } as const;
    const ccbWallet = { ...wallet, bankCard: ccbCard };
    const pending: LedgerEntry = {
      ...eventToEntry(ccbTransfer, []),
      status: 'needs-review',
      matchCandidateEventIds: [wallet.id],
    };
    const previous = [pending, eventToEntry(ccbWallet, [])];
    const entries = reconcileChannelMatches(previous, [ccbTransfer, ccbWallet]);

    expect(entries).toMatchObject([{
      merchant: wallet.merchant, occurredAt: wallet.occurredAt, status: 'confirmed',
      cardAutoConfirmed: true, sourceEventIds: [wallet.id, bank.id],
    }]);
    const rejected = { ...eventToEntry(ccbTransfer, []), excludedMatchKeys: [sourceEventKey([bank.id, wallet.id])] };
    const separated = [rejected, previous[1]];
    expect(reconcileChannelMatches(separated, [ccbTransfer, ccbWallet])).toEqual(separated);
    expect(scoreMatch(ccbTransfer, { ...ccbWallet, statementType: '商户消费' })).toBe(0);
    expect(scoreMatch(ccbTransfer, { ...ccbWallet, bankCard: { issuer: 'ccb', last4: '4321' } })).toBe(0);
    expect(scoreMatch({ ...ccbTransfer, merchant: '**转账服务公司' }, ccbWallet)).toBe(0);
  });

  it('keeps masked transfers under review when either side has multiple candidates', () => {
    const ccbTransfer = { ...bank, source: 'bank', merchant: '**转账', bankCard: ccbCard } as const;
    const ccbWallet = { ...wallet, bankCard: ccbCard };
    const otherWallet = { ...ccbWallet, id: 'other-wallet', bankCard: undefined };
    const otherBank = { ...ccbTransfer, id: 'other-bank' };
    const [merged] = rebuildLedger([ccbWallet, ccbTransfer], []);
    expect(merged.cardAutoConfirmed).toBe(true);

    const withOtherWallet = rebuildLedger([ccbTransfer, ccbWallet, otherWallet], [], undefined, [merged]);
    expect(withOtherWallet).toHaveLength(3);
    expect(withOtherWallet.find((entry) => entry.status === 'needs-review')?.matchCandidateEventIds).toHaveLength(2);
    expect(getAutomaticMatchCorrections([merged], [ccbTransfer, ccbWallet, otherWallet], []).get(merged.id))
      .toMatchObject([{ status: 'needs-review' }]);

    const withOtherBank = rebuildLedger([ccbTransfer, ccbWallet, otherBank], []);
    expect(withOtherBank).toHaveLength(3);
    expect(withOtherBank.filter((entry) => entry.status === 'needs-review')).toHaveLength(2);
  });

  it('uses the wallet time when rebuilding a manually confirmed masked transfer', () => {
    const ccbTransfer = { ...bank, source: 'bank', merchant: '**转账', bankCard: undefined } as const;
    const ccbWallet = { ...wallet, bankCard: ccbCard };
    const selected = mergeChannelEntries(eventToEntry(ccbTransfer, []), eventToEntry(ccbWallet, []), wallet.createdAt);

    expect(rebuildLedger([ccbTransfer, ccbWallet], [], undefined, [selected])).toMatchObject([{
      occurredAt: wallet.occurredAt, status: 'confirmed', sourceEventIds: [bank.id, wallet.id],
    }]);
  });

  it('lists each same-day candidate and keeps a previously automatic pair under review', () => {
    const closeToNoon = { ...wallet, id: 'close-to-noon', occurredAt: '2026-11-15T12:00:02' };
    const previous = rebuildLedger([wallet, bank], []);
    const entries = rebuildLedger([wallet, closeToNoon, bank], [], undefined, previous);

    expect(entries).toHaveLength(3);
    expect(entries.find((entry) => entry.status === 'needs-review')).toMatchObject({
      sourceEventIds: [bank.id], matchCandidateEventIds: [wallet.id, closeToNoon.id],
    });
    const competingBank = { ...bank, id: 'competing-bank' };
    expect(rebuildLedger([wallet, bank, competingBank], []).filter((entry) => entry.status === 'needs-review')).toHaveLength(2);
  });

  it('updates older standalone entries from the original wallet type and preserves the ledger notes', () => {
    const legacyWallet = {
      ...wallet, statementType: undefined, rawText: '2026-11-15 12:30:53 | 转账 | 示例房东 | 微信转账',
    };
    const entries = [
      { ...eventToEntry(legacyWallet, []), note: '微信备注' },
      { ...eventToEntry(bank, []), note: '银行备注' },
    ];
    const updated = reconcileChannelMatches(entries, [legacyWallet, bank]);

    expect(updated).toMatchObject([{
      sourceEventIds: [wallet.id, bank.id], note: '微信备注\n银行备注', status: 'confirmed',
    }]);
    expect(reconcileChannelMatches(updated, [legacyWallet, bank])).toEqual(updated);
    const rejected = [{ ...entries[0], excludedMatchKeys: [sourceEventKey([wallet.id, bank.id])] }, entries[1]];
    expect(reconcileChannelMatches(rejected, [legacyWallet, bank])).toEqual(rejected);
  });

  it('keeps a user-selected channel match when later imports introduce alternatives', () => {
    const other = { ...wallet, id: 'other-transfer', occurredAt: '2026-11-15T12:31:00' };
    const selected = mergeChannelEntries(eventToEntry(bank, []), eventToEntry(wallet, []), wallet.createdAt);

    expect(rebuildLedger([other, wallet, bank], [], undefined, [selected])).toMatchObject([
      { sourceEventIds: [other.id] },
      { sourceEventIds: [wallet.id, bank.id], status: 'confirmed' },
    ]);
  });
});

describe('matching engine', () => {
  it('scores same-amount cross-source events highly when close in time', () => {
    expect(scoreMatch(event({}), event({ source: 'bank', merchant: '瑞幸' }))).toBeGreaterThanOrEqual(90);
  });
  it('never matches two events from the same source', () => {
    expect(scoreMatch(event({}), event({ merchant: '瑞幸' }))).toBe(0);
  });
  it.each([
    ['2026-08-25T08:20:00', '桌游馆', '早餐店'],
    ['2026-08-24T09:01:00', '咖啡店', '早餐店'],
    ['2026-08-24T12:00:00', '早餐店', '早餐店'],
    ['2026-08-24T09:01:00', '未命名商户', '未命名商户'],
  ])('keeps unrelated same-amount wallet payments separate (%s, %s, %s)', (occurredAt, merchant, firstMerchant) => {
    const first = event({ amountMinor: 600, merchant: firstMerchant, occurredAt: '2026-08-24T09:00:00' });
    const second = event({ source: 'alipay', amountMinor: 600, merchant, occurredAt });

    const entries = rebuildLedger([first, second], []);

    expect(entries).toHaveLength(2);
    expect(entries.every((entry) => entry.status === 'confirmed' && entry.sourceEventIds.length === 1)).toBe(true);
  });
  it('requires review when same-amount wallet payments have close timestamps and a partial merchant match', () => {
    const first = event({ merchant: '瑞幸咖啡', occurredAt: '2026-08-24T09:00:00' });
    const second = event({ source: 'alipay', merchant: '瑞幸咖啡徐汇店', occurredAt: '2026-08-24T09:05:00' });

    expect(rebuildLedger([first, second], [])).toMatchObject([
      { status: 'needs-review', sourceEventIds: [first.id, second.id] },
    ]);
  });
  it('still confirms an exact merchant match when wallet timestamps are close', () => {
    const first = event({ merchant: '瑞幸咖啡', occurredAt: '2026-08-24T09:00:00' });
    const second = event({ source: 'alipay', merchant: '瑞幸 咖啡', occurredAt: '2026-08-24T09:02:00' });

    expect(rebuildLedger([first, second], [])).toMatchObject([
      { status: 'confirmed', sourceEventIds: [first.id, second.id] },
    ]);
  });
  it('keeps a bank payment separate when only the amount and date match', () => {
    const first = event({ merchant: '早餐店', occurredAt: '2026-08-24T09:00:00' });
    const second = event({ source: 'bank', merchant: '桌游馆', occurredAt: '2026-08-24T12:00:00' });

    expect(rebuildLedger([first, second], [])).toHaveLength(2);
  });
  it('confirms a unique CMB booking-date match and keeps the wallet payment time', () => {
    const merchant = '城市公共交通卡股份有限公司';
    const wallet = event({ source: 'alipay', merchant, amountMinor: 400, occurredAt: '2026-11-10T20:12:56' });
    const bank = event({ source: 'cmb', merchant, amountMinor: 400, occurredAt: '2026-11-10T12:00:00' });

    expect(rebuildLedger([wallet, bank], [])).toMatchObject([
      { status: 'confirmed', sourceEventIds: [wallet.id, bank.id], occurredAt: wallet.occurredAt },
    ]);
  });
  it.each([
    ['alipay', '蚂蚁财富-蚂蚁（杭州）基金销售有限公司', '蚂蚁（杭州）基金销售有限公司', 1000],
    ['wechat', '美团', '美团平台商户', 1990],
  ] as const)('confirms an unambiguous CMB match for the %s merchant alias %s', (source, walletName, bankName, amountMinor) => {
    const wallet = event({ source, merchant: walletName, amountMinor, occurredAt: '2026-11-07T12:48:40' });
    const bank = event({ source: 'cmb', merchant: bankName, amountMinor, occurredAt: '2026-11-07T12:00:00' });

    expect(rebuildLedger([wallet, bank], [])).toMatchObject([
      { status: 'confirmed', sourceEventIds: [wallet.id, bank.id], occurredAt: wallet.occurredAt },
    ]);
    const pending: LedgerEntry = {
      ...eventToEntry(wallet, []),
      sourceEventIds: [wallet.id, bank.id],
      status: 'needs-review',
    };
    expect(getAutomaticMatchCorrections([pending], [wallet, bank], []).get(pending.id)).toMatchObject([
      { status: 'confirmed', bookingDateAutoConfirmed: true },
    ]);
  });
  it('confirms an exact CMB merchant despite a weaker same-day candidate', () => {
    const merchant = '上海公共交通卡股份有限公司';
    const wallet = event({ source: 'alipay', merchant, amountMinor: 450, occurredAt: '2026-05-31T22:04:46' });
    const bank = event({ source: 'cmb', merchant, amountMinor: 450, occurredAt: '2026-05-31T12:00:00' });
    const weaker = event({ source: 'wechat', merchant: '上海公共交通卡', amountMinor: 450, occurredAt: '2026-05-31T22:02:00' });

    expect(rebuildLedger([weaker, wallet, bank], [])).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'confirmed', sourceEventIds: [wallet.id, bank.id] }),
    ]));

    const pending: LedgerEntry = { ...eventToEntry(wallet, []), sourceEventIds: [wallet.id, bank.id], status: 'needs-review' };
    expect(getAutomaticMatchCorrections([pending], [weaker, wallet, bank], []).get(pending.id)).toMatchObject([
      { status: 'confirmed', sourceEventIds: [wallet.id, bank.id] },
    ]);
  });
  it('preserves conflicting card evidence when ranking CMB candidate merchants', () => {
    const merchant = '上海公共交通卡股份有限公司';
    const card = { issuer: 'cmb', last4: '0042' } as const;
    const wallet = event({ source: 'alipay', merchant, occurredAt: '2026-05-31T22:04:46' });
    const bank = event({ source: 'cmb', merchant, bankCard: card, occurredAt: '2026-05-31T12:00:00' });
    const alternative = event({ source: 'wechat', merchant: '上海公共交通卡', bankCard: card, occurredAt: '2026-05-31T17:00:00' });

    const entries = rebuildLedger([wallet, bank, alternative], []);

    expect(entries.find((entry) => entry.sourceEventIds.includes(bank.id))).toMatchObject({
      status: 'needs-review', sourceEventIds: [bank.id, alternative.id],
    });
  });
  it('keeps repeated CMB booking-date matches pending even when one payment is near noon', () => {
    const merchant = '城市公共交通卡股份有限公司';
    const wallet = event({ source: 'alipay', merchant, amountMinor: 400, occurredAt: '2026-11-10T12:01:00' });
    const bank = event({ source: 'cmb', merchant, amountMinor: 400, occurredAt: '2026-11-10T12:00:00' });
    const otherWallet = event({ ...wallet, id: 'another-wallet-payment', occurredAt: '2026-11-10T20:12:56' });
    const previous = rebuildLedger([wallet, bank], []);
    const rebuilt = rebuildLedger([wallet, bank, otherWallet], [], undefined, previous);

    expect(rebuilt.find((entry) => entry.sourceEventIds.length === 2)?.status).toBe('needs-review');
  });
  it('confirms two identical CMB booking rows against two distinct wallet payments', () => {
    const merchant = '上海公共交通卡股份有限公司';
    const morning = event({ source: 'alipay', merchant, amountMinor: 400, occurredAt: '2026-11-09T09:58:00' });
    const evening = event({ source: 'alipay', merchant, amountMinor: 400, occurredAt: '2026-11-09T19:59:45' });
    const bank = event({ source: 'cmb', merchant, amountMinor: 400, occurredAt: '2026-11-09T12:00:00' });
    const otherBank = event({ ...bank, id: 'second-bank-row' });
    const events = [bank, otherBank, morning, evening];
    const pending: LedgerEntry[] = [
      { ...eventToEntry(morning, []), sourceEventIds: [otherBank.id, morning.id], status: 'needs-review' },
      { ...eventToEntry(evening, []), sourceEventIds: [bank.id, evening.id], status: 'needs-review' },
    ];

    const rebuilt = rebuildLedger(events, [], undefined, pending);

    expect(rebuilt).toMatchObject([
      { occurredAt: evening.occurredAt, amountMinor: 400, sourceEventIds: [bank.id, evening.id], status: 'confirmed', bookingDateAutoConfirmed: true },
      { occurredAt: morning.occurredAt, amountMinor: 400, sourceEventIds: [otherBank.id, morning.id], status: 'confirmed', bookingDateAutoConfirmed: true },
    ]);
    const corrections = getAutomaticMatchCorrections(pending, events, []);
    for (const entry of pending) {
      expect(corrections.get(entry.id)).toMatchObject([
        { status: 'confirmed', bookingDateAutoConfirmed: true, sourceEventIds: entry.sourceEventIds },
      ]);
    }
    expect(rebuildLedger(events.slice(0, 3), []).find((entry) => entry.sourceEventIds.length === 2)?.status).toBe('needs-review');
  });
  it('keeps equal-count CMB groups under review when cards or manual splits conflict', () => {
    const merchant = '上海公共交通卡股份有限公司';
    const morning = event({ source: 'alipay', merchant, amountMinor: 400, occurredAt: '2026-11-09T09:58:00' });
    const evening = event({ source: 'alipay', merchant, amountMinor: 400, occurredAt: '2026-11-09T19:59:45' });
    const bank = event({ source: 'cmb', merchant, amountMinor: 400, occurredAt: '2026-11-09T12:00:00' });
    const otherBank = event({ ...bank, id: 'second-bank-row' });
    const differentCards: TransactionEvent[] = [
      { ...bank, bankCard: { issuer: 'cmb', last4: '1234' } },
      { ...otherBank, bankCard: { issuer: 'cmb', last4: '5678' } },
      morning,
      evening,
    ];
    const excludedKey = sourceEventKey([bank.id, morning.id]);
    const manualSplit = [bank, morning].map((original) => ({
      ...eventToEntry(original, []), excludedMatchKeys: [excludedKey],
    }));

    expect(rebuildLedger(differentCards, []).filter((entry) => entry.status === 'needs-review')).toHaveLength(2);
    const rebuilt = rebuildLedger([bank, otherBank, morning, evening], [], undefined, manualSplit);
    expect(rebuilt.filter((entry) => entry.sourceEventIds.length === 2).every((entry) => entry.status === 'needs-review')).toBe(true);
    expect(rebuilt.some((entry) => sourceEventKey(entry.sourceEventIds) === excludedKey)).toBe(false);
  });
  it('checks the CMB issuer and card number when the wallet identifies a bank card', () => {
    const merchant = '城市公共交通卡股份有限公司';
    const wallet = event({ source: 'alipay', merchant, occurredAt: '2026-11-10T20:12:56' });
    const bank = event({ source: 'cmb', merchant, occurredAt: '2026-11-10T12:00:00', bankCard: { issuer: 'cmb', last4: '1234' } });

    expect(rebuildLedger([bank, { ...wallet, bankCard: ccbCard }], [])).toHaveLength(2);
    expect(rebuildLedger([bank, { ...wallet, bankCard: { issuer: 'cmb', last4: '4321' } }], [])).toHaveLength(2);
    expect(rebuildLedger([bank, { ...wallet, bankCard: { issuer: 'cmb', last4: '1234' } }], [])).toMatchObject([
      { status: 'confirmed', cardAutoConfirmed: true, occurredAt: wallet.occurredAt },
    ]);
  });
  it('updates earlier CMB pairs without reimporting the original events', () => {
    const merchant = '城市公共交通卡股份有限公司';
    const wallet = event({ source: 'alipay', merchant, occurredAt: '2026-11-10T20:12:56' });
    const bank = event({ source: 'cmb', merchant, occurredAt: '2026-11-10T12:00:00' });
    const pending: LedgerEntry = {
      ...eventToEntry(wallet, []),
      sourceEventIds: [wallet.id, bank.id],
      occurredAt: bank.occurredAt,
      status: 'needs-review',
      note: '旧账本备注',
    };

    const corrections = getAutomaticMatchCorrections([pending], [wallet, bank], []);
    expect(corrections.get(pending.id)).toMatchObject([
      { occurredAt: wallet.occurredAt, status: 'confirmed', bookingDateAutoConfirmed: true, note: pending.note },
    ]);

    const otherWallet = event({ ...wallet, id: 'another-wallet-payment' });
    const ambiguous = getAutomaticMatchCorrections([pending], [wallet, bank, otherWallet], []);
    expect(ambiguous.get(pending.id)).toMatchObject([
      { occurredAt: wallet.occurredAt, status: 'needs-review' },
    ]);
  });
  it.each([
    ['***大包', '城市公共交通卡股份有限公司'],
    ['***公司', '街边里脊肉（林）'],
    ['***大包', '大包食品店'],
    ['山城茶饮', '街边里脊肉'],
  ])('keeps conflicting counterparties separate even with the same card (%s, %s)', (bankMerchant, walletMerchant) => {
    const bank = event({ source: 'bank', merchant: bankMerchant, bankCard: ccbCard, occurredAt: '2026-08-24T12:00:00' });
    const wallet = event({ merchant: walletMerchant, bankCard: ccbCard, occurredAt: '2026-08-24T09:00:00' });

    expect(rebuildLedger([bank, wallet], [])).toHaveLength(2);
  });
  it('requires review for a generic masked name corroborated by the same card', () => {
    const bank = event({ source: 'bank', merchant: '***公司', bankCard: ccbCard, occurredAt: '2026-08-24T12:00:00' });
    const wallet = event({ merchant: '深圳市腾讯计算机系统有限公司', bankCard: ccbCard, occurredAt: '2026-08-24T09:00:00' });

    expect(rebuildLedger([bank, wallet], [])).toMatchObject([
      { status: 'needs-review', sourceEventIds: [bank.id, wallet.id] },
    ]);
    expect(rebuildLedger([bank, { ...wallet, bankCard: undefined }], [])).toHaveLength(2);
    expect(rebuildLedger([bank, { ...wallet, amountMinor: 4000 }], [])).toHaveLength(2);
    expect(rebuildLedger([bank, { ...wallet, occurredAt: '2026-08-25T09:00:00' }], [])).toHaveLength(2);
  });
  it.each([
    ['wechat', '**医院', '城东医院', 600, '09:32:51'],
    ['alipay', '***乐园', '城南零食乐园', 2597, '18:29:44'],
  ] as const)('confirms a uniquely matched %s masked name when the card agrees (%s)', (source, bankMerchant, walletMerchant, amountMinor, time) => {
    const bank = event({ source: 'bank', merchant: bankMerchant, amountMinor, bankCard: ccbCard, occurredAt: '2026-07-11T12:00:00' });
    const wallet = event({ source, merchant: walletMerchant, amountMinor, bankCard: ccbCard, occurredAt: `2026-07-11T${time}` });

    expect(rebuildLedger([bank, wallet], [])).toMatchObject([
      { status: 'confirmed', cardAutoConfirmed: true, sourceEventIds: [bank.id, wallet.id] },
    ]);
    expect(rebuildLedger([bank, { ...wallet, bankCard: undefined }], [])).toMatchObject([
      { status: 'needs-review', sourceEventIds: [bank.id, wallet.id] },
    ]);
    expect(rebuildLedger([bank, { ...wallet, bankCard: { issuer: 'ccb', last4: '9202' } }], [])).toHaveLength(2);
    expect(rebuildLedger([bank, { ...wallet, amountMinor: amountMinor + 1 }], [])).toHaveLength(2);
    expect(rebuildLedger([bank, { ...wallet, occurredAt: `2026-07-12T${time}` }], [])).toHaveLength(2);

    const pending: LedgerEntry = {
      ...eventToEntry(wallet, []),
      sourceEventIds: [bank.id, wallet.id],
      status: 'needs-review',
    };
    expect(getAutomaticMatchCorrections([pending], [bank, wallet], []).get(pending.id)).toMatchObject([
      { status: 'confirmed', cardAutoConfirmed: true, sourceEventIds: [bank.id, wallet.id] },
    ]);

    const alternative = event({ ...wallet, id: 'another-wallet-payment' });
    expect(getAutomaticMatchCorrections([pending], [bank, wallet, alternative], []).has(pending.id)).toBe(false);
    expect(rebuildLedger([bank, wallet, alternative], []).find((entry) => entry.sourceEventIds.length === 2)?.status).toBe('needs-review');
  });
  it('uses the visible prefix and suffix of a masked counterparty for manual review', () => {
    const bank = event({ source: 'bank', merchant: '南城＊＊＊大包', occurredAt: '2026-08-24T12:00:00' });
    const wallet = event({ merchant: '南城路口手工大包', occurredAt: '2026-08-24T09:00:00' });

    expect(rebuildLedger([bank, wallet], [])).toMatchObject([
      { status: 'needs-review', sourceEventIds: [bank.id, wallet.id] },
    ]);
  });
  it('confirms equal-count same-card masked matches across WeChat and Alipay', () => {
    const [earlier, later] = [
      event({ source: 'wechat', merchant: '仁济医院', amountMinor: 600, bankCard: ccbCard, occurredAt: '2026-07-11T09:32:51' }),
      event({ source: 'alipay', merchant: '城东大学医学院附属仁济医院', amountMinor: 600, bankCard: ccbCard, occurredAt: '2026-07-11T10:14:07' }),
    ];
    const firstBank = event({ source: 'bank', merchant: '**医院', amountMinor: 600, bankCard: ccbCard, occurredAt: '2026-07-11T12:00:00' });
    const secondBank = event({ ...firstBank, id: 'another-hospital-debit', merchant: '***医院' });
    const events = [firstBank, secondBank, later, earlier];
    const pending: LedgerEntry[] = [
      { ...eventToEntry(earlier, []), sourceEventIds: [firstBank.id, earlier.id], status: 'needs-review' },
      { ...eventToEntry(later, []), sourceEventIds: [secondBank.id, later.id], status: 'needs-review' },
    ];

    expect(rebuildLedger(events, [], undefined, pending)).toMatchObject([
      { status: 'confirmed', cardAutoConfirmed: true, sourceEventIds: [secondBank.id, later.id] },
      { status: 'confirmed', cardAutoConfirmed: true, sourceEventIds: [firstBank.id, earlier.id] },
    ]);
    const corrections = getAutomaticMatchCorrections(pending, events, []);
    for (const entry of pending) {
      expect(corrections.get(entry.id)).toMatchObject([
        { status: 'confirmed', cardAutoConfirmed: true, sourceEventIds: entry.sourceEventIds },
      ]);
    }

    expect(rebuildLedger([firstBank, secondBank, earlier, { ...later, merchant: '另一家医院' }], [])
      .filter((entry) => entry.status === 'needs-review')).toHaveLength(2);
  });
  it('leaves masked names with a visible company suffix for review', () => {
    const wallet = event({ source: 'alipay', merchant: '示例科技有限公司', bankCard: ccbCard, occurredAt: '2026-07-11T09:45:00' });
    const bank = event({ source: 'bank', merchant: '***有限公司', bankCard: ccbCard, occurredAt: '2026-07-11T12:00:00' });

    expect(rebuildLedger([bank, wallet], [])).toMatchObject([{ status: 'needs-review' }]);
  });
  it('matches each event at most once', () => {
    const entries = rebuildLedger([event({ id: 'wechat-1' }), event({ id: 'wechat-2', occurredAt: '2026-08-24T02:01:00.000Z' }), event({ id: 'bank-1', source: 'bank', merchant: '瑞幸' })], []);
    expect(entries.filter((entry) => entry.sourceEventIds.length === 2)).toHaveLength(1);
    expect(new Set(entries.flatMap((entry) => entry.sourceEventIds)).size).toBe(3);
  });
  it('automatically confirms a unique same-card match even with weak time and merchant scores', () => {
    const wallet = event({ merchant: 'Wallet Shop', occurredAt: '2026-08-24T09:00:00' });
    const bank = event({ source: 'bank', merchant: '', occurredAt: '2026-08-24T12:00:00', bankCard: ccbCard });
    const pending: LedgerEntry = {
      ...eventToEntry(wallet, []),
      sourceEventIds: [wallet.id, bank.id],
      status: 'needs-review',
    };

    const rebuilt = rebuildLedger([bank, { ...wallet, bankCard: ccbCard }], [], undefined, [pending]);

    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]).toMatchObject({ status: 'confirmed', sourceEventIds: [bank.id, wallet.id] });
  });
  it('uses the card match when the bank only lists the corresponding payment platform', () => {
    const wallet = event({ merchant: '早餐店', bankCard: ccbCard, occurredAt: '2026-08-24T09:00:00' });
    const bank = event({ source: 'bank', merchant: '财付通', bankCard: ccbCard, occurredAt: '2026-08-24T12:00:00' });

    expect(rebuildLedger([wallet, bank], [])).toMatchObject([
      { status: 'confirmed', sourceEventIds: [wallet.id, bank.id] },
    ]);
    expect(rebuildLedger([{ ...wallet, source: 'alipay' }, bank], [])).toHaveLength(2);
  });
  it.each([
    { issuer: 'ccb', last4: '9202' },
    { issuer: 'other', last4: '6844' },
  ] as const)('keeps entries separate when the bank card is different (%j)', (bankCard) => {
    const wallet = event({ source: 'alipay', bankCard });
    const bank = event({ source: 'bank', bankCard: ccbCard });

    expect(rebuildLedger([wallet, bank], [])).toHaveLength(2);
  });
  it('leaves the match for review when multiple same-card transactions qualify', () => {
    const wallet = event({ bankCard: ccbCard });
    const bank = event({ source: 'bank', bankCard: ccbCard });
    const otherBank = event({ source: 'bank', bankCard: ccbCard });

    const initial = rebuildLedger([wallet, bank], []);
    const entries = rebuildLedger([wallet, bank, otherBank], [], undefined, initial);

    expect(initial[0].status).toBe('confirmed');
    expect(entries).toHaveLength(2);
    expect(entries.find((entry) => entry.sourceEventIds.length === 2)?.status).toBe('needs-review');
  });
  it('preserves a resolved match when rebuilding with new rules', () => {
    const first = event({ id: 'wechat-1', merchant: 'Example Shop', occurredAt: '2026-08-24T09:00:00' });
    const second = event({ id: 'bank-1', source: 'bank', merchant: 'Example', occurredAt: '2026-08-24T12:00:00' });
    const initial = rebuildLedger([first, second], [], '2026-08-24T05:00:00.000Z');
    const resolved = initial.map((entry) => ({ ...entry, status: 'confirmed' as const }));
    const rebuilt = rebuildLedger([first, second], [{ id: 'rule-1', keyword: 'Example', category: '购物', createdAt: '2026-08-24T06:00:00.000Z' }], '2026-08-24T06:00:00.000Z', resolved);

    expect(initial[0].status).toBe('needs-review');
    expect(rebuilt[0].status).toBe('confirmed');
    expect(rebuilt[0].category).toBe('购物');
  });
  it('keeps a user-split match from being merged again', () => {
    const first = event({ id: 'wechat-1', merchant: 'Example Shop', bankCard: ccbCard });
    const second = event({ id: 'bank-1', source: 'bank', merchant: 'Bank Shop', occurredAt: '2026-08-24T04:00:00.000Z', bankCard: ccbCard });
    const matchKey = sourceEventKey([first.id, second.id]);
    const separateEntries = rebuildLedger([first], []).concat(rebuildLedger([second], [])).map((entry) => ({ ...entry, excludedMatchKeys: [matchKey] }));
    const rebuilt = rebuildLedger([first, second], [], '2026-08-24T06:00:00.000Z', separateEntries);

    expect(rebuilt).toHaveLength(2);
    expect(rebuilt.every((entry) => entry.sourceEventIds.length === 1)).toBe(true);
    expect(rebuilt.every((entry) => entry.excludedMatchKeys?.includes(matchKey))).toBe(true);
  });
  it('only splits invalid pending pairs with both original events available', () => {
    const first = event({ merchant: '早餐店', occurredAt: '2026-08-24T09:00:00' });
    const second = event({ source: 'alipay', merchant: '桌游馆', occurredAt: '2026-08-25T08:20:00' });
    const bank = event({ source: 'bank', merchant: '早餐店', occurredAt: '2026-08-24T12:00:00' });
    const pending: LedgerEntry = {
      ...eventToEntry(first, []),
      id: 'legacy-pair',
      sourceEventIds: [first.id, second.id],
      status: 'needs-review',
      note: '旧账本备注',
    };
    const entries: LedgerEntry[] = [
      pending,
      { ...pending, id: 'confirmed-pair', status: 'confirmed' },
      { ...pending, id: 'incomplete-pair', sourceEventIds: [first.id, 'missing'] },
      { ...pending, id: 'valid-pair', sourceEventIds: [first.id, bank.id] },
    ];

    const splits = getAutomaticMatchCorrections(entries, [first, second, bank], []);

    expect([...splits.keys()]).toEqual([pending.id]);
    expect(splits.get(pending.id)).toMatchObject([
      { sourceEventIds: [first.id], status: 'confirmed', note: pending.note },
      { sourceEventIds: [second.id], status: 'confirmed', note: pending.note },
    ]);
  });
  it('rechecks old card auto-confirmations for conflicting and partially matching names', () => {
    const bank = event({ source: 'bank', merchant: '***公司', bankCard: ccbCard, occurredAt: '2026-08-24T12:00:00' });
    const wallet = event({ merchant: '水果店', bankCard: ccbCard, occurredAt: '2026-08-24T09:00:00' });
    const automatic: LedgerEntry = {
      ...eventToEntry(wallet, []),
      id: 'old-card-match',
      sourceEventIds: [bank.id, wallet.id],
      cardAutoConfirmed: true,
    };

    const conflicting = getAutomaticMatchCorrections([automatic], [bank, wallet], []);
    expect(conflicting.get(automatic.id)).toMatchObject([
      { sourceEventIds: [bank.id], status: 'confirmed' },
      { sourceEventIds: [wallet.id], status: 'confirmed' },
    ]);

    const partiallyMatching = getAutomaticMatchCorrections(
      [automatic], [bank, { ...wallet, merchant: '水果供应有限公司' }], [],
    );
    expect(partiallyMatching.get(automatic.id)).toMatchObject([
      { id: automatic.id, status: 'needs-review', cardAutoConfirmed: undefined },
    ]);
  });
});
