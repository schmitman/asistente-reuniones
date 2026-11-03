import type { AirtableSource } from './sources.js';
import type { AirtableRecord } from './mapRecord.js';
import { assertRequestableFields } from '../safety/fields.js';

type FetchLike = typeof fetch;

export class AirtableClient {
  constructor(
    private readonly token: string,
    private readonly minIntervalMs = 220,
    private readonly pageSize = 100,
    private readonly fetchImpl: FetchLike = fetch,
    private readonly sleep: (ms: number) => Promise<void> = delay,
  ) {
    if (!token) throw new Error('Falta AIRTABLE_TOKEN.');
  }

  async listAll(
    source: AirtableSource,
    maxRecords: number | null,
    onProgress?: (count: number) => void,
  ): Promise<AirtableRecord[]> {
    assertRequestableFields(source.fields);
    const records: AirtableRecord[] = [];
    let offset: string | undefined;
    let fields = [...source.fields];
    do {
      const page = await this.page(source, fields, offset);
      fields = page.fields;
      for (const record of page.records) {
        records.push(record);
        if (maxRecords != null && records.length >= maxRecords) {
          onProgress?.(records.length);
          return records.slice(0, maxRecords);
        }
      }
      onProgress?.(records.length);
      offset = page.offset;
    } while (offset);
    return records;
  }

  private async page(
    source: AirtableSource,
    fields: string[],
    offset?: string,
  ): Promise<{ records: AirtableRecord[]; offset?: string; fields: string[] }> {
    let current = [...fields];
    for (let attempt = 0; attempt < current.length + 2; attempt += 1) {
      const url = new URL(`https://api.airtable.com/v0/${source.baseId}/${source.tableId}`);
      url.searchParams.set('pageSize', String(Math.min(100, this.pageSize)));
      for (const field of current) url.searchParams.append('fields[]', field);
      if (offset) url.searchParams.set('offset', offset);
      await this.sleep(this.minIntervalMs);
      const response = await this.fetchRetry(url);
      if (response.status === 422) {
        const body = await response.text();
        const unknown = unknownFieldName(body);
        if (unknown && current.includes(unknown)) {
          current = current.filter((field) => field !== unknown);
          continue;
        }
        throw new Error(`Airtable rechazó los campos de ${source.baseName}: ${body.slice(0, 240)}`);
      }
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`Airtable ${response.status} en ${source.baseName}: ${body.slice(0, 240)}`);
      }
      const payload = (await response.json()) as {
        records?: AirtableRecord[];
        offset?: string;
      };
      return {
        records: payload.records ?? [],
        offset: payload.offset,
        fields: current,
      };
    }
    throw new Error(`No quedaron campos válidos para ${source.baseName}.`);
  }

  private async fetchRetry(url: URL): Promise<Response> {
    let lastError = 'error de red';
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          headers: {
            Authorization: `Bearer ${this.token}`,
            'User-Agent': 'asistente-reuniones/0.1',
          },
        });
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await this.sleep(500 * (attempt + 1));
        continue;
      }
      if (response.status === 429 || response.status >= 500) {
        const retryAfter = Number(response.headers.get('retry-after') || '0');
        await this.sleep(retryAfter > 0 ? retryAfter * 1000 : 800 * (attempt + 1));
        lastError = `HTTP ${response.status}`;
        continue;
      }
      return response;
    }
    throw new Error(`Airtable no respondió (${lastError}).`);
  }
}

function unknownFieldName(body: string): string | undefined {
  const direct = body.match(/Unknown field name: "([^"]+)"/);
  if (direct?.[1]) return direct[1];
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message?.match(/Unknown field name: "([^"]+)"/)?.[1];
  } catch {
    return undefined;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
