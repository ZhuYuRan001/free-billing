import type { LedgerEntry, MerchantRule, TransactionEvent } from './transaction';

export const DEFAULT_CATEGORIES = ['餐饮', '交通', '购物', '日用品', '娱乐', '住房', '医疗', '教育', '其他'];

const KEYWORDS: Record<string, string[]> = {
  餐饮: ['星巴克', '瑞幸', '咖啡', '麦当劳', '肯德基', '美团外卖', '饿了么', '餐厅', '火锅', '奶茶'],
  交通: ['滴滴', '高德', '打车', '地铁', '公交', '铁路', '携程', '加油'],
  购物: ['淘宝', '天猫', '京东', '拼多多', '抖音', '无印良品', 'shopee'],
  日用品: ['盒马', '永辉', '超市', '便利店', '沃尔玛'],
  娱乐: ['电影', '腾讯视频', '网易云', '游戏', 'steam'],
  住房: ['房租', '物业', '水费', '电费', '燃气'],
  医疗: ['医院', '药房', '诊所'],
  教育: ['课程', '学校', '教育'],
};

export function classifyMerchant(merchant: string, rules: MerchantRule[] = []): string {
  const text = merchant.toLowerCase();
  const explicit = rules.find((rule) => text.includes(rule.keyword.toLowerCase()));
  if (explicit) return explicit.category;
  const matched = Object.entries(KEYWORDS).find(([, words]) => words.some((word) => text.includes(word.toLowerCase())));
  return matched?.[0] ?? '其他';
}

export function eventToEntry(event: TransactionEvent, rules: MerchantRule[], now = new Date().toISOString()): LedgerEntry {
  return {
    id: `entry_${event.id}`,
    amountMinor: event.amountMinor,
    currency: event.currency,
    direction: event.direction,
    occurredAt: event.occurredAt,
    merchant: event.merchant || '未命名商户',
    category: classifyMerchant(event.merchant, rules),
    sourceEventIds: [event.id],
    status: 'confirmed',
    createdAt: now,
    updatedAt: now,
  };
}
