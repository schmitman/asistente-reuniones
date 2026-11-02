import { describe, expect, it } from 'vitest';
import { AirtableClient } from '../src/airtable/client.js';
import type { AirtableSource } from '../src/airtable/sources.js';

const source: AirtableSource = {
  key: 'general',
  baseId: 'appZ2uavuwQLI2foP',
  baseName: 'Base general (ultima)',
  tableId: 'tblUrmhgpg33qw9in',
  tableName: 'Base General',
  fields: ['Name & Lastname', 'Skills 2', 'Campo Inventado'],
};

describe('AirtableClient', () => {
  it('pagina, manda el token y descarta un campo que Airtable no reconoce', async () => {
    const urls: string[] = [];
    let calls = 0;
    const client = new AirtableClient('token-de-prueba', 0, 2, async (input, init) => {
      calls += 1;
      urls.push(String(input));
      const headers = init?.headers as { Authorization?: string };
      expect(headers.Authorization).toBe('Bearer token-de-prueba');
      if (calls === 1) {
        return new Response(
          JSON.stringify({ error: { message: 'Unknown field name: "Campo Inventado"' } }),
          { status: 422 },
        );
      }
      const url = new URL(String(input));
      expect(url.searchParams.getAll('fields[]')).not.toContain('Campo Inventado');
      if (url.searchParams.get('offset')) {
        return Response.json({
          records: [{ id: 'rec2', fields: { 'Skills 2': ['Go'] } }],
        });
      }
      return Response.json({
        records: [{ id: 'rec1', fields: { 'Skills 2': ['Java'] } }],
        offset: 'next',
      });
    });

    const records = await client.listAll(source, null);
    expect(records.map((record) => record.id)).toEqual(['rec1', 'rec2']);
    expect(urls.some((url) => url.includes('Password'))).toBe(false);
  });

  it('no llega a pedir un campo de credenciales', async () => {
    const client = new AirtableClient('token-de-prueba', 0, 100, async () => {
      throw new Error('no debería llamar a la red');
    });
    await expect(
      client.listAll({ ...source, fields: ['Password', 'Skills 2'] }, 1),
    ).rejects.toThrow(/bloqueado/);
  });

  it('respeta el tope de registros', async () => {
    const client = new AirtableClient('token-de-prueba', 0, 100, async () =>
      Response.json({
        records: [
          { id: 'rec1', fields: {} },
          { id: 'rec2', fields: {} },
        ],
        offset: 'more',
      }),
    );
    const records = await client.listAll({ ...source, fields: ['Skills 2'] }, 1);
    expect(records).toHaveLength(1);
  });
});
