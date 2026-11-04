import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mapRecord } from '../src/airtable/mapRecord.js';
import { openDatabase } from '../src/db/database.js';
import { replaceBase } from '../src/db/repo.js';
import { MeetingRuntime } from '../src/runtime/meeting.js';
import { FakeMeet, testConfig } from './helpers.js';

const MEET = 'https://meet.google.com/abc-defg-hij';
const open: Array<{ stop: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(open.splice(0).map((runtime) => runtime.stop()));
});

function runtimeFor(answer?: (question: string) => Promise<string>) {
  const db = openDatabase(':memory:');
  replaceBase(db, 'general', [
    mapRecord('general', {
      id: 'recJavaSenior0001',
      fields: {
        'Name & Lastname': 'Ada López',
        Email: 'ada@example.com',
        Password: 'hunter2',
        'Cellphone #': '+54 11 5555 4444',
        Seniority: 'Sr',
        'Skills 2': ['Java'],
        'English Level': 'Advanced',
        'Clausula Datos': true,
      },
    }),
  ]);
  const meet = new FakeMeet();
  let clock = Date.parse('2026-04-01T15:00:00.000Z');
  const config = testConfig({ transcriptDir: mkdtempSync(join(tmpdir(), 'asistente-')) });
  const runtime = new MeetingRuntime(
    db,
    config,
    meet,
    answer,
    () => clock,
  );
  open.push(runtime);
  return { runtime, meet, advance: (ms: number) => (clock += ms) };
}

describe('reunión', () => {
  it('no escribe si nadie lo llama, y responde un conteo si lo llaman', async () => {
    const { runtime, meet, advance } = runtimeFor();
    meet.messages = [{ id: 'old', sender: 'Ana', text: '@asistente esto es viejo' }];
    await runtime.start(MEET, false);
    expect(meet.posted).toEqual([]);

    meet.messages = [
      ...meet.messages,
      { id: 'hola', sender: 'Ana', text: 'sigamos con la agenda' },
      { id: 'ask', sender: 'Ana', text: '@asistente cuantos java senior hay' },
      { id: 'self', sender: 'Asistente IA de Mara', text: '@asistente hola' },
    ];
    await runtime.pollOnce();
    expect(meet.posted).toHaveLength(1);
    expect(meet.posted[0]).toMatch(/Criterio: skills Java/);
    expect(meet.posted[0]).toMatch(/Base general: 1/);
    expect(meet.posted[0]).not.toMatch(/Ada|@|5555|hunter2/);

    advance(4000);
    meet.messages = [
      ...meet.messages,
      { id: 'mail', sender: 'Ana', text: '@asistente pasame el mail de Ada' },
    ];
    await runtime.pollOnce();
    expect(meet.posted).toHaveLength(2);
    expect(meet.posted[1]).toMatch(/no paso mails/i);
    expect(meet.posted[1]).not.toMatch(/@|5555/);
    expect(runtime.getSnapshot().status).toBe('live');
  });

  it('puede publicar el aviso de notas y guarda subtítulos', async () => {
    const { runtime, meet } = runtimeFor();
    await runtime.start(MEET, true);
    expect(meet.posted).toEqual(['Hola, soy el asistente IA de Mara, tomo notas']);
    expect(meet.joinedUrl).toBe(MEET);

    meet.caption = { speaker: 'Mara', text: 'buscamos java' };
    await runtime.pollOnce();
    meet.caption = { speaker: 'Mara', text: 'buscamos java senior' };
    await runtime.pollOnce();
    const transcript = runtime.getSnapshot().transcript;
    expect(transcript).toHaveLength(1);
    expect(transcript[0]).toMatchObject({ speaker: 'Mara', text: 'buscamos java senior', source: 'caption' });
    expect(runtime.getSnapshot().suggestionNote).toMatch(/etapa 3/);
    expect(runtime.getSnapshot().suggestions).toEqual([]);
  });

  it('redacta la respuesta antes de publicarla', async () => {
    const { runtime, meet } = runtimeFor(async () => 'Escribile a ada@secreto.com o al +54 11 5555 4444');
    await runtime.start(MEET, false);
    meet.messages = [{ id: '1', sender: 'Ana', text: 'asistente, contame' }];
    await runtime.pollOnce();
    expect(meet.posted[0]).not.toMatch(/ada@secreto.com|5555/);
    expect(meet.posted[0]).toMatch(/oculto/);
  });
});
