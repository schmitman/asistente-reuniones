import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/database.js';
import { startPanelServer } from '../src/panel/server.js';
import { MeetingRuntime } from '../src/runtime/meeting.js';
import { FakeMeet, testConfig } from './helpers.js';

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()));
});

describe('panel privado', () => {
  it('muestra el canal de sugerencias y rechaza un link que no es de Meet', async () => {
    const db = openDatabase(':memory:');
    const meet = new FakeMeet();
    const runtime = new MeetingRuntime(
      db,
      testConfig({ transcriptDir: mkdtempSync(join(tmpdir(), 'asistente-panel-')) }),
      meet,
      async () => 'ok',
    );
    const panel = await startPanelServer({
      host: '127.0.0.1',
      port: 0,
      token: 'secreto',
      api: runtime,
    });
    closers.push(async () => {
      await runtime.stop();
      await panel.close();
    });

    const health = await fetch(`${panel.url}health`);
    expect(health.status).toBe(200);

    const html = await fetch(panel.url);
    expect(html.status).toBe(200);
    const page = await html.text();
    expect(page).toContain('Asistente IA de Mara');
    expect(page).toContain('etapa 3');

    const denied = await fetch(`${panel.url}api/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://meet.google.com/abc-defg-hij' }),
    });
    expect(denied.status).toBe(401);

    const invalid = await fetch(`${panel.url}api/join`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secreto', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/reunion' }),
    });
    expect(invalid.status).toBe(400);

    const joined = await fetch(`${panel.url}api/join`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secreto', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://meet.google.com/abc-defg-hij', consent: false }),
    });
    expect(joined.status).toBe(202);

    let status = 'joining';
    for (let attempt = 0; attempt < 20 && status !== 'live'; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const snapshot = (await (
        await fetch(`${panel.url}api/status`, { headers: { Authorization: 'Bearer secreto' } })
      ).json()) as { status: string };
      status = snapshot.status;
    }
    expect(status).toBe('live');
    expect(meet.joinedUrl).toBe('https://meet.google.com/abc-defg-hij');

    const busy = await fetch(`${panel.url}api/join`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secreto', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://meet.google.com/abc-defg-hij' }),
    });
    expect(busy.status).toBe(409);
  });
});
