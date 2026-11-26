import { db } from '../infrastructure/database/db';
import { parseStatement, type ImportSource } from '../infrastructure/importers/registry';
import type { ParsedStatement } from '../infrastructure/importers/types';
import { rebuildLedger } from '../domain/matching';
import type { ImportBatch, TransactionEvent } from '../domain/transaction';

function findDuplicate(event: TransactionEvent, candidates: TransactionEvent[]) {
  if (event.source !== 'bank') return candidates[0];
  const sameTime = candidates.filter((stored) => stored.occurredAt === event.occurredAt);
  return (
    sameTime.find((stored) => stored.bankCard?.last4 === event.bankCard?.last4) ??
    sameTime.find((stored) => (!stored.bankCard || !event.bankCard) && stored.rawText === event.rawText)
  );
}

export async function importStatement(file: File, source?: ImportSource): Promise<{ batch: ImportBatch; warnings: string[] }> {
  return saveParsedStatement(file.name, await parseStatement(file, source));
}

export async function saveParsedStatement(fileName: string, parsed: ParsedStatement): Promise<{ batch: ImportBatch; warnings: string[] }> {
  const now = new Date().toISOString();
  const batchId = `batch_${crypto.randomUUID()}`;
  return db.transaction('rw', db.importBatches, db.transactionEvents, db.ledgerEntries, db.merchantRules, async () => {
    const byFingerprint = new Map<string, TransactionEvent[]>();
    for (const event of await db.transactionEvents.toArray()) {
      const candidates = byFingerprint.get(event.fingerprint);
      if (candidates) candidates.push(event);
      else byFingerprint.set(event.fingerprint, [event]);
    }

    const freshEvents: TransactionEvent[] = [];
    const enrichedEvents = new Map<string, TransactionEvent>();
    for (const event of parsed.events) {
      const candidates = byFingerprint.get(event.fingerprint) ?? [];
      const duplicate = findDuplicate(event, candidates);
      if (!duplicate) {
        freshEvents.push({ ...event, batchId });
      } else if ((!duplicate.bankCard && event.bankCard) || (!duplicate.statementType && event.statementType)) {
        const updated = {
          ...duplicate,
          bankCard: duplicate.bankCard ?? event.bankCard,
          statementType: duplicate.statementType ?? event.statementType,
        };
        candidates[candidates.indexOf(duplicate)] = updated;
        enrichedEvents.set(updated.id, updated);
      }
    }

    const batch: ImportBatch = {
      id: batchId,
      fileName,
      source: parsed.source,
      rowCount: parsed.rowCount,
      importedCount: freshEvents.length,
      skippedCount: parsed.events.length - freshEvents.length,
      status: 'completed',
      createdAt: now,
    };
    await db.importBatches.add(batch);
    await db.transactionEvents.bulkAdd(freshEvents);
    await db.transactionEvents.bulkPut([...enrichedEvents.values()]);
    const rules = await db.merchantRules.toArray();
    const previousEntries = await db.ledgerEntries.toArray();
    const entries = rebuildLedger(await db.transactionEvents.toArray(), rules, now, previousEntries);
    await db.ledgerEntries.clear();
    await db.ledgerEntries.bulkAdd(entries);
    return { batch, warnings: parsed.warnings };
  });
}

export async function rebuildStoredLedger() {
  await db.transaction('rw', db.transactionEvents, db.merchantRules, db.ledgerEntries, async () => {
    const [events, rules, previousEntries] = await Promise.all([
      db.transactionEvents.toArray(),
      db.merchantRules.toArray(),
      db.ledgerEntries.toArray(),
    ]);
    const entries = rebuildLedger(events, rules, new Date().toISOString(), previousEntries);
    await db.ledgerEntries.clear();
    await db.ledgerEntries.bulkAdd(entries);
  });
}
