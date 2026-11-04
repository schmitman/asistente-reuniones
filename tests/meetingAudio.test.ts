import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SttProvider } from '../src/audio/stt.js';
import { openDatabase } from '../src/db/database.js';
import { MeetingRuntime } from '../src/runtime/meeting.js';
import { FakeMeet, testConfig } from './helpers.js';

const MEET = 'https://meet.google.com/abc-defg-hij';
const RATE = 16_000;
const tone = (ms: number) => {
  const out = new Int16Array((RATE * ms) / 1000);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.round(Math.sin(i / 10) * 8000);
  return out;
};

describe('reunión con audio', () => {
  it('guarda el audio transcripto y usa subtítulos solo como pista de quién habla', async () => {
    const db = openDatabase(':memory:');
    const meet = new FakeMeet();
    let clock = Date.parse('2026-11-04T13:00:00.000Z');
    const stt: SttProvider = {
      name: 'fake',
      async transcribe() {
        return { text: 'Buscamos React senior', words: [{ text: 'Buscamos', start: 0, end: 0.5 }, { text: 'React', start: 0.5, end: 0.9 }, { text: 'senior', start: 0.9, end: 1.3 }] };
      },
      async close() {},
    };
    const config = testConfig({
      sttProvider: 'xai',
      sttMinSegmentMs: 1000,
      transcriptDir: mkdtempSync(join(tmpdir(), 'asistente-')),
    });
    const runtime = new MeetingRuntime(db, config, meet, async () => 'ok', () => clock, () => stt);
    await runtime.start(MEET, false);
    expect(meet.audioListener).toBeTypeOf('function');

    meet.caption = { speaker: 'Mara', text: 'buscamos react' };
    clock += 1500;
    meet.audioListener!({ pcm: tone(1500), tracks: 1 });
    await runtime.pollOnce();
    clock += 2500;
    meet.audioListener!({ pcm: new Int16Array(RATE * 2.5), tracks: 1 });
    await runtime.stop();

    const snapshot = runtime.getSnapshot();
    expect(snapshot.transcript).toEqual([
      expect.objectContaining({ speaker: 'Mara', text: 'Buscamos React senior', source: 'audio' }),
    ]);
    expect(snapshot.audio).toMatchObject({ provider: 'fake', transcribed: 1 });
    expect(meet.audioListener).toBeNull();
  });

  it('si el STT falla, vuelve a guardar los subtítulos', async () => {
    const db = openDatabase(':memory:');
    const meet = new FakeMeet();
    let clock = Date.parse('2026-11-04T13:00:00.000Z');
    const stt: SttProvider = {
      name: 'roto',
      async transcribe() {
        throw new Error('401');
      },
      async close() {},
    };
    const config = testConfig({ sttProvider: 'xai', transcriptDir: mkdtempSync(join(tmpdir(), 'asistente-')) });
    const runtime = new MeetingRuntime(db, config, meet, async () => 'ok', () => clock, () => stt);
    await runtime.start(MEET, false);
    clock += 1000;
    meet.audioListener!({ pcm: tone(1000), tracks: 1 });
    clock += 3000;
    meet.audioListener!({ pcm: new Int16Array(RATE * 3), tracks: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    meet.caption = { speaker: 'Mara', text: 'hola a todos' };
    await runtime.pollOnce();
    expect(runtime.getSnapshot().transcript).toEqual([
      expect.objectContaining({ speaker: 'Mara', text: 'hola a todos', source: 'caption' }),
    ]);
    await runtime.stop();
  });
});

describe('fin de la llamada', () => {
  it('cierra la sesión si deja de estar en la llamada varias veces seguidas', async () => {
    const db = openDatabase(':memory:');
    const meet = new FakeMeet();
    let present = true;
    (meet as FakeMeet & { inCall: () => Promise<boolean> }).inCall = async () => present;
    const config = testConfig({ transcriptDir: mkdtempSync(join(tmpdir(), 'asistente-')) });
    const runtime = new MeetingRuntime(db, config, meet, async () => 'ok');
    await runtime.start(MEET, false);
    await runtime.pollOnce();
    expect(runtime.getSnapshot().status).toBe('live');
    present = false;
    for (let i = 0; i < 4; i += 1) await runtime.pollOnce();
    expect(runtime.getSnapshot().status).toBe('live');
    await runtime.pollOnce();
    expect(runtime.getSnapshot().status).toBe('left');
    expect(meet.closed).toBe(true);
  });
});
