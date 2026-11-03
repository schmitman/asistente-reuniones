import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config.js';
import { AirtableClient } from './client.js';
import { mapRecord } from './mapRecord.js';
import { SOURCES } from './sources.js';
import { replaceBase } from '../db/repo.js';

export interface SyncBaseResult {
  base: string;
  baseName: string;
  count: number;
}

export async function syncAirtable(
  db: DatabaseSync,
  config: AppConfig,
  log: (message: string) => void = console.log,
): Promise<SyncBaseResult[]> {
  if (!config.airtableToken) {
    throw new Error('Falta AIRTABLE_TOKEN. Tiene que ser un token de solo lectura.');
  }
  const client = new AirtableClient(
    config.airtableToken,
    config.airtableMinIntervalMs,
    config.airtablePageSize,
  );
  const results: SyncBaseResult[] = [];
  for (const source of SOURCES) {
    const started = new Date().toISOString();
    log(`Sincronizando ${source.baseName} (${source.tableName})…`);
    try {
      const records = await client.listAll(source, config.syncMaxRecords, (count) => {
        if (count % 1000 === 0) log(`  ${source.key}: ${count} registros`);
      });
      const mapped = records.map((record) => mapRecord(source.key, record));
      const count = replaceBase(db, source.key, mapped);
      db.prepare(
        `INSERT INTO sync_runs (base_key, started_at, finished_at, record_count, status, error)
         VALUES (?, ?, ?, ?, 'ok', NULL)`,
      ).run(source.key, started, new Date().toISOString(), count);
      log(`Listo ${source.baseName}: ${count} perfiles en cache.`);
      results.push({ base: source.key, baseName: source.baseName, count });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare(
        `INSERT INTO sync_runs (base_key, started_at, finished_at, record_count, status, error)
         VALUES (?, ?, ?, NULL, 'error', ?)`,
      ).run(source.key, started, new Date().toISOString(), message.slice(0, 500));
      throw error;
    }
  }
  return results;
}
