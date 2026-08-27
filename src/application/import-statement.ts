import { db } from '../infrastructure/database/db';
import { parseStatement, type ImportSource } from '../infrastructure/importers/registry';
import { rebuildLedger } from '../domain/matching';
import type { ImportBatch } from '../domain/transaction';

export async function importStatement(file: File, source?: ImportSource): Promise<{ batch: ImportBatch; warnings: string[] }> {
  const parsed = await parseStatement(file, source);
  const now = new Date().toISOString();
  const batchId = `batch_${crypto.randomUUID()}`;
  const existing = new Set((await db.transactionEvents.toArray()).map((event) => event.fingerprint));
  const freshEvents = parsed.events.filter((event) => !existing.has(event.fingerprint)).map((event) => ({ ...event, batchId }));
  const batch: ImportBatch = {
    id: batchId,
    fileName: file.name,
    source: parsed.source,
    rowCount: parsed.rowCount,
    importedCount: freshEvents.length,
    skippedCount: parsed.events.length - freshEvents.length,
    status: 'completed',
    createdAt: now,
  };
  await db.transaction('rw', db.importBatches, db.transactionEvents, db.ledgerEntries, db.merchantRules, async () => {
    await db.importBatches.add(batch);
    await db.transactionEvents.bulkAdd(freshEvents);
    const rules = await db.merchantRules.toArray();
    const previousEntries = await db.ledgerEntries.toArray();
    const entries = rebuildLedger(await db.transactionEvents.toArray(), rules, now, previousEntries);
    await db.ledgerEntries.clear();
    await db.ledgerEntries.bulkAdd(entries);
  });
  return { batch, warnings: parsed.warnings };
}

export async function rebuildStoredLedger() {
  const [events, rules, previousEntries] = await Promise.all([
    db.transactionEvents.toArray(),
    db.merchantRules.toArray(),
    db.ledgerEntries.toArray(),
  ]);
  const entries = rebuildLedger(events, rules, new Date().toISOString(), previousEntries);
  await db.transaction('rw', db.ledgerEntries, async () => {
    await db.ledgerEntries.clear();
    await db.ledgerEntries.bulkAdd(entries);
  });
}
