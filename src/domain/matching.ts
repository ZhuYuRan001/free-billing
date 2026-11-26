import type { LedgerEntry, MerchantRule, TransactionEvent } from './transaction';
import { isBankSource } from './transaction';
import { classifyMerchant, eventToEntry } from './classification';
import { getBankPayment, getWalletPaymentKind } from './payment-channel';

const MAX_MATCH_WINDOW_MS = 24 * 60 * 60 * 1000;
const CLOSE_MATCH_WINDOW_MS = 5 * 60 * 1000;
const SAME_CARD_SCORE_BONUS = 40;
const EXACT_BOOKING_DATE_MATCH_SCORE = 100;
const UNKNOWN_MERCHANTS = new Set(['', '-', '/', '未命名商户', '未知商户', '消费', '商户消费']);
const GENERIC_MERCHANT_SUFFIXES = new Set([
  '公司', '有限公司', '股份有限公司', '有限责任公司', '集团', '集团公司', '集团有限公司',
]);
const CMB_MERCHANT_ALIASES = new Map([
  ['蚂蚁财富-蚂蚁(杭州)基金销售有限公司', '蚂蚁(杭州)基金销售有限公司'],
  ['美团平台商户', '美团'],
]);
const MERCHANT_SCORES = { exact: 10, partial: 8, weakPartial: 4, unknown: 0, conflict: 0 };
type MerchantMatch = keyof typeof MERCHANT_SCORES;

function normalizeMerchant(value: string, useCmbAliases = false): string {
  const name = (value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '').replace(/\*+/g, '*');
  return useCmbAliases ? CMB_MERCHANT_ALIASES.get(name.replace(/[‐‑–—−]/g, '-')) ?? name : name;
}

function matchesMaskedMerchant(masked: string, full: string): boolean {
  const fragments = masked.split('*');
  const prefix = fragments[0];
  const suffix = fragments.at(-1) ?? '';
  if (!full.startsWith(prefix) || !full.endsWith(suffix)) return false;

  let offset = prefix.length;
  const end = full.length - suffix.length;
  for (const fragment of fragments.slice(1, -1)) {
    const index = full.indexOf(fragment, offset);
    if (index === -1) return false;
    offset = index + fragment.length;
  }
  return offset <= end;
}

function partialMerchantMatch(visible: string): MerchantMatch {
  return visible.length < 2 || GENERIC_MERCHANT_SUFFIXES.has(visible) ? 'weakPartial' : 'partial';
}

function compareMerchants(a: string, b: string): MerchantMatch {
  if (UNKNOWN_MERCHANTS.has(a) || UNKNOWN_MERCHANTS.has(b) || a === '*' || b === '*') return 'unknown';

  const aMasked = a.includes('*');
  const bMasked = b.includes('*');
  if (aMasked && bMasked) return a === b ? partialMerchantMatch(a.replaceAll('*', '')) : 'conflict';
  if (aMasked || bMasked) {
    const [masked, full] = aMasked ? [a, b] : [b, a];
    return matchesMaskedMerchant(masked, full) ? partialMerchantMatch(masked.replaceAll('*', '')) : 'conflict';
  }

  if (a === b) return GENERIC_MERCHANT_SUFFIXES.has(a) ? 'weakPartial' : 'exact';
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 2 && longer.includes(shorter) ? partialMerchantMatch(shorter) : 'conflict';
}

function evaluateMatch(left: TransactionEvent, right: TransactionEvent) {
  if (left.source === right.source || left.direction !== right.direction || left.amountMinor !== right.amountMinor) return;
  const leftIsBank = isBankSource(left.source);
  const rightIsBank = isBankSource(right.source);
  if (leftIsBank && rightIsBank) return;
  const leftDate = new Date(left.occurredAt);
  const rightDate = new Date(right.occurredAt);
  const timeDelta = Math.abs(leftDate.getTime() - rightDate.getTime());
  if (!Number.isFinite(timeDelta) || timeDelta > MAX_MATCH_WINDOW_MS) return;

  const bank = leftIsBank ? left : rightIsBank ? right : undefined;
  const usesBookingDate = bank?.source === 'cmb';
  const wallet = bank === left ? right : left;
  const walletSource = wallet.source === 'wechat' || wallet.source === 'alipay' ? wallet.source : undefined;
  const walletCard = bank && walletSource ? wallet.bankCard : undefined;
  if (walletCard && walletCard.issuer !== (bank?.source === 'cmb' ? 'cmb' : 'ccb')) return;
  if (walletCard && bank?.bankCard && (
    walletCard.issuer !== bank.bankCard.issuer || walletCard.last4 !== bank.bankCard.last4
  )) return;

  const sameDay = leftDate.toDateString() === rightDate.toDateString();
  const sameCard = Boolean(walletCard && bank?.bankCard) && sameDay;
  const bankPayment = bank && walletSource ? getBankPayment(bank) : undefined;
  const walletKind = bankPayment?.kind ? getWalletPaymentKind(wallet) : undefined;
  if (bankPayment?.channel && bankPayment.channel !== walletSource) return;
  if (bankPayment?.kind && walletKind && bankPayment.kind !== walletKind) return;
  if (bankPayment && !bankPayment.merchant) {
    const sameKind = walletKind !== undefined && bankPayment.kind === walletKind;
    const genericTransfer = !bankPayment.channel && sameKind && bankPayment.kind === 'transfer';
    if (!sameDay || (!walletCard && !genericTransfer) || (!sameCard && !bankPayment.channel && !sameKind)) return;
    const channelMatches = Boolean(bankPayment.channel) && (!bankPayment.kind || sameKind);
    return {
      score: sameCard ? 100 : 68,
      sameCard,
      requiresReview: !sameCard || (!channelMatches && !genericTransfer),
      canConfirmMaskedMatch: false,
      exactBookingDateMatch: false,
      channelOnly: true,
    };
  }

  const useCmbAliases = usesBookingDate && Boolean(walletSource);
  const leftMerchant = normalizeMerchant((leftIsBank && bankPayment?.merchant) || left.merchant, useCmbAliases);
  const rightMerchant = normalizeMerchant((rightIsBank && bankPayment?.merchant) || right.merchant, useCmbAliases);
  const merchantMatch = compareMerchants(leftMerchant, rightMerchant);
  const timeMatches = bank ? sameDay : timeDelta <= CLOSE_MATCH_WINDOW_MS;
  if (!timeMatches || merchantMatch === 'conflict') return;
  if (!sameCard && (merchantMatch === 'unknown' || merchantMatch === 'weakPartial')) return;

  const timeScore = usesBookingDate || timeDelta > 60 * 60 * 1000 ? 8 : timeDelta <= CLOSE_MATCH_WINDOW_MS ? 30 : 20;
  const exactBookingDateMatch = usesBookingDate && merchantMatch === 'exact';
  const requiresReview = merchantMatch === 'partial' || merchantMatch === 'weakPartial';
  const canConfirmMaskedMatch = sameCard && requiresReview &&
    (leftMerchant.includes('*') || rightMerchant.includes('*')) &&
    !leftMerchant.includes('公司') && !rightMerchant.includes('公司');
  const score = exactBookingDateMatch ? EXACT_BOOKING_DATE_MATCH_SCORE : 60 + timeScore + MERCHANT_SCORES[merchantMatch];
  return {
    score: score + (sameCard ? SAME_CARD_SCORE_BONUS : 0),
    sameCard,
    requiresReview,
    canConfirmMaskedMatch,
    exactBookingDateMatch,
    channelOnly: false,
  };
}

type TransactionMatch = NonNullable<ReturnType<typeof evaluateMatch>>;

export function scoreMatch(left: TransactionEvent, right: TransactionEvent): number {
  return evaluateMatch(left, right)?.score ?? 0;
}

export function sourceEventKey(sourceEventIds: string[]): string {
  return JSON.stringify([...sourceEventIds].sort());
}

function bookingDateKey(event: TransactionEvent): string {
  return `${new Date(event.occurredAt).toDateString()}|${event.direction}|${event.amountMinor}`;
}

function indexEventsByBookingDate(events: TransactionEvent[]): Map<string, TransactionEvent[]> {
  const groups = new Map<string, TransactionEvent[]>();
  for (const event of events) {
    const key = bookingDateKey(event);
    const group = groups.get(key);
    if (group) group.push(event);
    else groups.set(key, [event]);
  }
  return groups;
}

function isUniqueSameDayMatch(
  left: TransactionEvent,
  right: TransactionEvent,
  match: TransactionMatch,
  sameDay: TransactionEvent[],
  excludedMatchKeys: Set<string>,
): boolean {
  const pair = [left, right];
  return !sameDay.some((other) => other.id !== left.id && other.id !== right.id && pair.some((event) => {
    const alternative = evaluateMatch(event, other);
    if (!alternative || (alternative.channelOnly && !match.channelOnly)) return false;
    const strongerCardEvidence = alternative.sameCard && !match.sameCard;
    const competingMatch = (match.channelOnly && alternative.channelOnly) ||
      strongerCardEvidence || (alternative.sameCard === match.sameCard &&
      (!match.exactBookingDateMatch || !alternative.requiresReview));
    return competingMatch &&
      !excludedMatchKeys.has(sourceEventKey([event.id, other.id]));
  }));
}

function getBalancedSameDayMatches(
  eventsByDate: Map<string, TransactionEvent[]>,
  entries: LedgerEntry[],
  excludedMatchKeys: Set<string>,
): Set<string> {
  const confirmedPartners = new Map<string, string>();
  for (const entry of entries) {
    if (entry.status !== 'confirmed' || entry.cardAutoConfirmed || entry.bookingDateAutoConfirmed || entry.sourceEventIds.length !== 2) continue;
    const [left, right] = entry.sourceEventIds;
    confirmedPartners.set(left, right);
    confirmedPartners.set(right, left);
  }

  const balancedMatches = new Set<string>();
  for (const sameDay of eventsByDate.values()) {
    if (sameDay.length < 4) continue;
    const bankGroups = new Map<string, TransactionEvent[]>();
    for (const event of sameDay) {
      if (!isBankSource(event.source)) continue;
      const name = normalizeMerchant(event.merchant, event.source === 'cmb');
      const masked = name.includes('*');
      if (masked ? !event.bankCard : event.source !== 'cmb') continue;
      const key = JSON.stringify([event.source, name, masked ? event.bankCard?.last4 : undefined]);
      const group = bankGroups.get(key);
      if (group) group.push(event);
      else bankGroups.set(key, [event]);
    }

    for (const bankEvents of bankGroups.values()) {
      if (bankEvents.length < 2) continue;
      const bank = bankEvents[0];
      const useCmbAliases = bank.source === 'cmb';
      const merchant = normalizeMerchant(bank.merchant, useCmbAliases);
      const masked = merchant.includes('*');
      const walletEvents = sameDay.filter((event) => {
        if (event.source !== 'wechat' && event.source !== 'alipay') return false;
        return masked ? evaluateMatch(bank, event)?.canConfirmMaskedMatch :
          normalizeMerchant(event.merchant, useCmbAliases) === merchant;
      });
      if (bankEvents.length !== walletEvents.length) continue;
      if (masked) {
        const names = walletEvents.map((event) => normalizeMerchant(event.merchant, useCmbAliases));
        const shortest = names.reduce((first, name) => first.length <= name.length ? first : name);
        if (shortest.includes('*') || !names.every((name) => name.includes(shortest))) continue;
      } else if (!walletEvents.every((event) => event.source === walletEvents[0].source)) continue;

      const members = [...bankEvents, ...walletEvents];
      const memberIds = new Set(members.map((event) => event.id));
      const cards = new Set(members.flatMap(({ bankCard }) => bankCard ? [`${bankCard.issuer}:${bankCard.last4}`] : []));
      if (cards.size > 1 || members.some(({ id }) => {
        const partner = confirmedPartners.get(id);
        return partner !== undefined && !memberIds.has(partner);
      })) continue;

      const outsideGroup = sameDay.filter((event) => !memberIds.has(event.id));
      const pairs = bankEvents.flatMap((bank) => walletEvents.map((wallet) => ({
        bank, wallet, key: sourceEventKey([bank.id, wallet.id]),
      })));
      const compatible = pairs.every(({ bank, wallet, key }) => {
        const match = evaluateMatch(bank, wallet);
        return match && (masked ? match.canConfirmMaskedMatch : match.exactBookingDateMatch) && !excludedMatchKeys.has(key) &&
          isUniqueSameDayMatch(bank, wallet, match, outsideGroup, excludedMatchKeys);
      });
      if (compatible) for (const { key } of pairs) balancedMatches.add(key);
    }
  }
  return balancedMatches;
}

function getCmbPaymentTime(left: TransactionEvent, right: TransactionEvent): string | undefined {
  if (left.source === 'cmb') return right.occurredAt;
  if (right.source === 'cmb') return left.occurredAt;
}

export function mergeChannelEntries(
  bank: LedgerEntry,
  wallet: LedgerEntry,
  now: string,
  automatic = false,
): LedgerEntry {
  const notes = [...new Set([wallet.note, bank.note].filter(Boolean))];
  const excludedMatchKeys = [...new Set([
    ...(wallet.excludedMatchKeys ?? []), ...(bank.excludedMatchKeys ?? []),
  ])];
  return {
    ...wallet,
    sourceEventIds: [...wallet.sourceEventIds, ...bank.sourceEventIds],
    matchCandidateEventIds: undefined,
    excludedMatchKeys: excludedMatchKeys.length ? excludedMatchKeys : undefined,
    status: 'confirmed',
    cardAutoConfirmed: automatic ? true : undefined,
    note: notes.length ? notes.join('\n') : undefined,
    createdAt: wallet.createdAt < bank.createdAt ? wallet.createdAt : bank.createdAt,
    updatedAt: now,
  };
}

export function reconcileChannelMatches(
  entries: LedgerEntry[],
  events: TransactionEvent[],
  now = new Date().toISOString(),
): LedgerEntry[] {
  const standalone = new Map(
    entries.filter((entry) => entry.sourceEventIds.length === 1).map((entry) => [entry.sourceEventIds[0], entry]),
  );
  const availableEvents = events.filter((event) => standalone.has(event.id));
  const bankEvents = availableEvents.filter((event) => isBankSource(event.source) && getBankPayment(event) !== undefined);
  const walletsByDate = indexEventsByBookingDate(availableEvents.filter(
    (event) => event.source === 'wechat' || event.source === 'alipay',
  ));
  const excluded = new Set(entries.flatMap((entry) => entry.excludedMatchKeys ?? []));
  const walletCounts = new Map<string, number>();
  const matchesByBank = new Map<string, { wallet: TransactionEvent; match: TransactionMatch }[]>();
  for (const bank of bankEvents) {
    const candidates = (walletsByDate.get(bookingDateKey(bank)) ?? []).flatMap((wallet) => {
      if (excluded.has(sourceEventKey([bank.id, wallet.id]))) return [];
      const match = evaluateMatch(bank, wallet);
      if (!match?.channelOnly) return [];
      walletCounts.set(wallet.id, (walletCounts.get(wallet.id) ?? 0) + 1);
      return [{ wallet, match }];
    });
    if (candidates.length) matchesByBank.set(bank.id, candidates);
  }

  const replacements = new Map<string, LedgerEntry | null>();
  for (const [bankId, candidates] of matchesByBank) {
    const bank = standalone.get(bankId)!;
    const [{ wallet, match }] = candidates;
    if (candidates.length === 1 && walletCounts.get(wallet.id) === 1 && !match.requiresReview) {
      const walletEntry = standalone.get(wallet.id)!;
      replacements.set(bank.id, null);
      replacements.set(walletEntry.id, mergeChannelEntries(bank, walletEntry, now, true));
      continue;
    }

    const ids = candidates
      .sort((a, b) => b.wallet.occurredAt.localeCompare(a.wallet.occurredAt) || a.wallet.id.localeCompare(b.wallet.id))
      .map(({ wallet }) => wallet.id);
    if (ids.length === bank.matchCandidateEventIds?.length && ids.every((id, index) => id === bank.matchCandidateEventIds?.[index])) continue;
    replacements.set(bank.id, { ...bank, matchCandidateEventIds: ids, status: 'needs-review', updatedAt: now });
  }
  for (const [eventId, entry] of standalone) {
    if (entry.matchCandidateEventIds && !matchesByBank.has(eventId)) {
      replacements.set(entry.id, { ...entry, matchCandidateEventIds: undefined, status: 'confirmed', updatedAt: now });
    }
  }
  return entries.flatMap((entry) => {
    const replacement = replacements.get(entry.id);
    return replacement === null ? [] : [replacement ?? entry];
  });
}

export function getAutomaticMatchCorrections(
  entries: LedgerEntry[],
  events: TransactionEvent[],
  rules: MerchantRule[],
  now = new Date().toISOString(),
): Map<string, LedgerEntry[]> {
  const eventsById = new Map(events.map((event) => [event.id, event]));
  const eventsByDate = indexEventsByBookingDate(events);
  const excludedMatchKeys = new Set(entries.flatMap((entry) => entry.excludedMatchKeys ?? []));
  const balancedMatches = getBalancedSameDayMatches(eventsByDate, entries, excludedMatchKeys);
  const corrections = new Map<string, LedgerEntry[]>();
  for (const entry of entries) {
    const automatic = entry.cardAutoConfirmed || entry.bookingDateAutoConfirmed;
    if ((entry.status !== 'needs-review' && !automatic) || entry.sourceEventIds.length !== 2) continue;
    const [leftId, rightId] = entry.sourceEventIds;
    const left = eventsById.get(leftId);
    const right = eventsById.get(rightId);
    if (!left || !right) continue;
    const key = sourceEventKey(entry.sourceEventIds);
    const match = excludedMatchKeys.has(key) ? undefined : evaluateMatch(left, right);
    if (match) {
      const occurredAt = match.channelOnly
        ? (isBankSource(left.source) ? right : left).occurredAt
        : getCmbPaymentTime(left, right) ?? entry.occurredAt;
      if (match.exactBookingDateMatch || match.canConfirmMaskedMatch || match.channelOnly) {
        const sameDay = eventsByDate.get(bookingDateKey(left)) ?? [];
        const confirmed = (!match.channelOnly || !match.requiresReview) &&
          (balancedMatches.has(key) || isUniqueSameDayMatch(left, right, match, sameDay, excludedMatchKeys));
        const status = confirmed ? 'confirmed' : 'needs-review';
        const cardAutoConfirmed = confirmed && match.sameCard ? true : undefined;
        const bookingDateAutoConfirmed = confirmed && !match.sameCard ? true : undefined;
        if (
          entry.status !== status || entry.occurredAt !== occurredAt ||
          entry.cardAutoConfirmed !== cardAutoConfirmed || entry.bookingDateAutoConfirmed !== bookingDateAutoConfirmed
        ) {
          corrections.set(entry.id, [{ ...entry, status, occurredAt, cardAutoConfirmed, bookingDateAutoConfirmed, updatedAt: now }]);
        }
      } else if ((automatic && match.requiresReview) || entry.bookingDateAutoConfirmed) {
        corrections.set(entry.id, [{
          ...entry, status: 'needs-review', occurredAt, cardAutoConfirmed: undefined,
          bookingDateAutoConfirmed: undefined, updatedAt: now,
        }]);
      } else if (occurredAt !== entry.occurredAt) {
        corrections.set(entry.id, [{ ...entry, occurredAt, updatedAt: now }]);
      }
      continue;
    }

    corrections.set(entry.id, [left, right].map((event) => ({
      ...eventToEntry(event, rules, now),
      createdAt: entry.createdAt,
      excludedMatchKeys: entry.excludedMatchKeys,
      note: entry.note,
    })));
  }
  return corrections;
}

export function rebuildLedger(
  sourceEvents: TransactionEvent[],
  rules: MerchantRule[],
  now = new Date().toISOString(),
  previousEntries: LedgerEntry[] = [],
): LedgerEntry[] {
  const events = sourceEvents.filter((event) => !event.ledgerDeletedAt);
  const previousBySourceEvents = new Map(
    previousEntries.map((entry) => [sourceEventKey(entry.sourceEventIds), entry]),
  );
  const excludedMatchKeys = new Set(previousEntries.flatMap((entry) => entry.excludedMatchKeys ?? []));
  const eventsByDate = indexEventsByBookingDate(events);
  const balancedMatches = getBalancedSameDayMatches(eventsByDate, previousEntries, excludedMatchKeys);
  const exclusionsByEvent = new Map<string, string[]>();
  const previousChannelEntries = new Map<string, LedgerEntry>();
  const eventsById = new Map(events.map((event) => [event.id, event]));
  for (const entry of previousEntries) {
    if (entry.excludedMatchKeys?.length) {
      for (const id of entry.sourceEventIds) exclusionsByEvent.set(id, entry.excludedMatchKeys);
    }
    if (entry.cardAutoConfirmed && entry.sourceEventIds.length === 2) {
      const [left, right] = entry.sourceEventIds.map((id) => eventsById.get(id));
      if (left && right && evaluateMatch(left, right)?.channelOnly) {
        previousChannelEntries.set(isBankSource(left.source) ? right.id : left.id, entry);
      }
    }
  }
  const candidates: Array<TransactionMatch & {
    left: number;
    right: number;
    key: string;
  }> = [];
  const cardCandidateCounts = events.map(() => 0);
  for (let left = 0; left < events.length; left += 1) {
    for (let right = left + 1; right < events.length; right += 1) {
      const match = evaluateMatch(events[left], events[right]);
      if (!match || match.score < 65) continue;
      const key = sourceEventKey([events[left].id, events[right].id]);
      if (excludedMatchKeys.has(key)) continue;
      const previous = previousBySourceEvents.get(key);
      if (match.channelOnly && !(previous?.status === 'confirmed' && !previous.cardAutoConfirmed)) continue;
      candidates.push({ left, right, key, ...match });
      if (match.sameCard) {
        cardCandidateCounts[left] += 1;
        cardCandidateCounts[right] += 1;
      }
    }
  }
  candidates.sort((a, b) => {
    if (a.channelOnly !== b.channelOnly) return Number(b.channelOnly) - Number(a.channelOnly);
    const aBalanced = balancedMatches.has(a.key);
    const bBalanced = balancedMatches.has(b.key);
    if (aBalanced && bBalanced) {
      const previousOrder = Number(previousBySourceEvents.has(b.key)) - Number(previousBySourceEvents.has(a.key));
      if (previousOrder) return previousOrder;
    }
    return Number(bBalanced) - Number(aBalanced) || b.score - a.score;
  });
  const used = new Set<number>();
  const entries: LedgerEntry[] = [];
  for (const candidate of candidates) {
    if (used.has(candidate.left) || used.has(candidate.right)) continue;
    const first = events[candidate.left];
    const second = events[candidate.right];
    used.add(candidate.left);
    used.add(candidate.right);
    const representative = isBankSource(first.source) ? second : first;
    const previous = previousBySourceEvents.get(candidate.key);
    const sameDay = eventsByDate.get(bookingDateKey(first)) ?? [];
    const confirmedBookingDateMatch = candidate.exactBookingDateMatch &&
      (balancedMatches.has(candidate.key) || isUniqueSameDayMatch(first, second, candidate, sameDay, excludedMatchKeys));
    const uniqueCardMatch = candidate.exactBookingDateMatch ? confirmedBookingDateMatch :
      balancedMatches.has(candidate.key) || (cardCandidateCounts[candidate.left] === 1 && cardCandidateCounts[candidate.right] === 1);
    const confirmedByCard = candidate.sameCard &&
      (!candidate.requiresReview || candidate.canConfirmMaskedMatch) && uniqueCardMatch;
    const confirmedByBookingDate = confirmedBookingDateMatch && !candidate.sameCard;
    const previouslyConfirmed = previous?.status === 'confirmed' && !previous.cardAutoConfirmed && !previous.bookingDateAutoConfirmed;
    const confirmed = previouslyConfirmed || confirmedByCard || confirmedByBookingDate ||
      (!candidate.exactBookingDateMatch && !candidate.requiresReview && !candidate.sameCard && !previous && candidate.score >= 90);
    const retainedExclusions = [...new Set([
      ...(exclusionsByEvent.get(first.id) ?? []),
      ...(exclusionsByEvent.get(second.id) ?? []),
    ])];
    entries.push({
      id: `entry_${first.id}_${second.id}`,
      amountMinor: representative.amountMinor,
      currency: 'CNY',
      direction: representative.direction,
      occurredAt: candidate.channelOnly ? representative.occurredAt :
        getCmbPaymentTime(first, second) ?? new Date(Math.min(new Date(first.occurredAt).getTime(), new Date(second.occurredAt).getTime())).toISOString(),
      merchant: representative.merchant || first.merchant || second.merchant || '未命名商户',
      category: classifyMerchant(representative.merchant || first.merchant || second.merchant, rules),
      sourceEventIds: [first.id, second.id],
      excludedMatchKeys: retainedExclusions.length ? retainedExclusions : undefined,
      status: confirmed ? 'confirmed' : 'needs-review',
      cardAutoConfirmed: confirmedByCard && !previouslyConfirmed ? true : undefined,
      bookingDateAutoConfirmed: confirmedByBookingDate && !previouslyConfirmed ? true : undefined,
      note: previous?.note,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    });
  }
  events.forEach((event, index) => {
    if (!used.has(index)) {
      const previous = previousBySourceEvents.get(sourceEventKey([event.id])) ?? previousChannelEntries.get(event.id);
      entries.push({
        ...eventToEntry(event, rules, now),
        excludedMatchKeys: exclusionsByEvent.get(event.id),
        note: previous?.note,
        createdAt: previous?.createdAt ?? now,
        status: previous?.matchCandidateEventIds ? 'confirmed' : previous?.status ?? 'confirmed',
      });
    }
  });
  return reconcileChannelMatches(entries, events, now).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
}
