import type { TransactionEvent } from './transaction';

type PaymentKind = 'transfer' | 'purchase' | 'refund';
type PaymentChannel = 'wechat' | 'alipay';

const CHANNEL_LABELS = {
  wechat: ['微信支付', '微信', '财付通支付科技有限公司', '财付通'],
  alipay: ['支付宝(中国)网络技术有限公司', '支付宝支付', '支付宝'],
} satisfies Record<PaymentChannel, string[]>;

const PAYMENT_KINDS = new Map<string, PaymentKind>([
  ['转账', 'transfer'], ['转入', 'transfer'], ['转出', 'transfer'], ['个人转账', 'transfer'],
  ['商户消费', 'purchase'], ['消费', 'purchase'], ['购物', 'purchase'],
  ['退款', 'refund'], ['转账退款', 'refund'], ['商户消费退款', 'refund'], ['商户退款', 'refund'],
]);
const CHANNEL_DESCRIPTIONS = new Set([
  '支付', '快捷支付', '第三方支付', '第三方支付机构', '网络支付', '线上支付',
  '移动支付', '聚合支付', '扫码支付', '条码支付', '无卡支付', '快捷扣款', '第三方代扣',
]);
const NO_COUNTERPARTY = new Set(['', '-', '/', '*', '未命名商户', '未知商户']);

type BankPayment = { channel?: PaymentChannel; kind?: PaymentKind; merchant?: string };

function normalize(value: string) {
  return value.normalize('NFKC').replace(/\s+/g, '').replace(/[‐‑–—−]/g, '-');
}

function readChannelLabel(label: string): BankPayment | undefined {
  for (const channel of ['wechat', 'alipay'] as const) {
    for (const channelLabel of CHANNEL_LABELS[channel]) {
      if (!label.startsWith(channelLabel)) continue;
      const remainder = label.slice(channelLabel.length);
      const kind = PAYMENT_KINDS.get(remainder);
      if (!remainder || kind || CHANNEL_DESCRIPTIONS.has(remainder)) return { channel, kind };
    }
  }
}

function bankPaymentDescription(value: string): BankPayment | undefined {
  const description = normalize(value);
  const visible = description.replace(/^\*+|\*+$/g, '');
  const kind = PAYMENT_KINDS.get(visible);
  if (kind === 'transfer' || kind === 'refund' || (kind === 'purchase' && visible !== description) ||
      CHANNEL_DESCRIPTIONS.has(visible)) return { kind };

  let start = 0;
  let payment: BankPayment | undefined;
  for (const separator of description.matchAll(/[-:/]/g)) {
    const label = readChannelLabel(description.slice(start, separator.index));
    if (!label) break;
    if (payment && payment.channel !== label.channel) return;
    payment = { channel: label.channel, kind: payment?.kind ?? label.kind };
    start = separator.index + 1;
  }
  const detail = description.slice(start);
  const label = readChannelLabel(detail);
  if (!payment) return label;
  if (label && label.channel !== payment.channel) return;
  const detailKind = label?.kind ?? PAYMENT_KINDS.get(detail);
  if (label || detailKind || CHANNEL_DESCRIPTIONS.has(detail) || NO_COUNTERPARTY.has(detail)) {
    return { ...payment, kind: payment.kind ?? detailKind };
  }
  return { ...payment, merchant: detail };
}

function getStatementType(event: TransactionEvent): string {
  if (event.statementType !== undefined) return event.statementType;
  // Older imports kept the native statement values in order but did not store the type separately.
  const fields = event.rawText.split(' | ');
  const first = fields[0].trim();
  if (event.source === 'cmb' && /^\d{4}-\d{2}-\d{2}$/.test(first)) return fields[3] ?? '';
  if (event.source === 'bank' && first === event.externalId && /^\d{8}$/.test(fields[2] ?? '')) return fields[1] ?? '';
  if (/^\d{4}[-/.年]\d{1,2}[-/.月]\d{1,2}/.test(first)) return fields[1] ?? '';
  return '';
}

export function getWalletPaymentKind(event: TransactionEvent) {
  const description = normalize(getStatementType(event));
  return PAYMENT_KINDS.get(description);
}

export function getBankPayment(event: TransactionEvent): BankPayment | undefined {
  const party = normalize(event.merchant);
  const counterparty = bankPaymentDescription(party) ??
    (PAYMENT_KINDS.get(party) === 'purchase' ? { kind: 'purchase' as const } : undefined);
  const summary = bankPaymentDescription(getStatementType(event));
  if (counterparty?.channel && summary?.channel && counterparty.channel !== summary.channel) return counterparty;
  if (counterparty) return {
    ...counterparty,
    channel: counterparty.channel ?? summary?.channel,
    kind: counterparty.kind ?? summary?.kind,
    merchant: counterparty.merchant ?? summary?.merchant,
  };
  if (summary) return { ...summary, merchant: NO_COUNTERPARTY.has(party) ? summary.merchant : event.merchant };
}
