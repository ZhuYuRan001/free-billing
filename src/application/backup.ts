import type { ImportBatch, LedgerEntry, MerchantRule, TransactionEvent } from '../domain/transaction';
import { getAutomaticMatchCorrections, reconcileChannelMatches } from '../domain/matching';
import { db } from '../infrastructure/database/db';

type BackupPayload = {
  version: 1;
  exportedAt: string;
  importBatches: ImportBatch[];
  transactionEvents: TransactionEvent[];
  ledgerEntries: LedgerEntry[];
  merchantRules: MerchantRule[];
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes));
}

function bytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function deriveKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt as BufferSource, iterations: 100_000, hash: 'SHA-256' }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function exportBackup(password: string): Promise<Blob> {
  const payload: BackupPayload = await db.transaction(
    'r',
    [db.importBatches, db.transactionEvents, db.ledgerEntries, db.merchantRules],
    async () => ({
      version: 1,
      exportedAt: new Date().toISOString(),
      importBatches: await db.importBatches.toArray(),
      transactionEvents: await db.transactionEvents.toArray(),
      ledgerEntries: await db.ledgerEntries.toArray(),
      merchantRules: await db.merchantRules.toArray(),
    }),
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(payload)));
  return new Blob([JSON.stringify({ version: 1, encrypted: true, salt: base64(salt), iv: base64(iv), data: base64(new Uint8Array(encrypted)) })], { type: 'application/json' });
}

export async function restoreBackup(file: File, password: string) {
  const envelope = JSON.parse(await file.text()) as { salt: string; iv: string; data: string };
  const key = await deriveKey(password, bytes(envelope.salt));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv) }, key, bytes(envelope.data));
  const payload = JSON.parse(decoder.decode(decrypted)) as BackupPayload;
  if (payload.version !== 1) throw new Error('不支持的备份版本');
  const activeEvents = payload.transactionEvents.filter((event) => !event.ledgerDeletedAt);
  const corrections = getAutomaticMatchCorrections(
    payload.ledgerEntries,
    activeEvents,
    payload.merchantRules,
  );
  const entries = reconcileChannelMatches(
    payload.ledgerEntries.flatMap((entry) => corrections.get(entry.id) ?? [entry]),
    activeEvents,
  );
  await db.transaction('rw', db.importBatches, db.transactionEvents, db.ledgerEntries, db.merchantRules, async () => {
    await Promise.all([db.importBatches.clear(), db.transactionEvents.clear(), db.ledgerEntries.clear(), db.merchantRules.clear()]);
    await db.importBatches.bulkAdd(payload.importBatches);
    await db.transactionEvents.bulkAdd(payload.transactionEvents);
    await db.ledgerEntries.bulkAdd(entries);
    await db.merchantRules.bulkAdd(payload.merchantRules);
  });
}
