import { describe, expect, it } from 'vitest';
import { AudioTranscriber, type AudioLine } from '../src/audio/pipeline.js';
import { SpeechSegmenter } from '../src/audio/segmenter.js';
import { hintNames, isLikelyHallucination, labelTurns, wordsToTurns } from '../src/audio/speakers.js';
import { chooseSttProvider, parseSttJson, XaiStt, type SttProvider } from '../src/audio/stt.js';
import { decodePcm16Base64, pcm16ToWav, rms } from '../src/audio/wav.js';
import { cleanCaptionText, cleanChatText, isCaptionNoise } from '../src/meet/clean.js';

const RATE = 16_000;
function tone(ms: number, amp = 0.2): Int16Array {
  const n = Math.round((RATE * ms) / 1000);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i += 1) out[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / RATE) * amp * 32767);
  return out;
}
const silence = (ms: number) => new Int16Array(Math.round((RATE * ms) / 1000));

describe('wav', () => {
  it('arma un WAV PCM16 mono 16 kHz válido', () => {
    const wav = pcm16ToWav(new Int16Array([0, 1000, -1000]));
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(40)).toBe(6);
    expect(wav.readInt16LE(46)).toBe(1000);
  });

  it('decodifica base64 PCM16 little-endian', () => {
    const buf = Buffer.alloc(4);
    buf.writeInt16LE(1234, 0);
    buf.writeInt16LE(-5, 2);
    expect(Array.from(decodePcm16Base64(buf.toString('base64')))).toEqual([1234, -5]);
  });

  it('calcula RMS', () => {
    expect(rms(silence(100))).toBe(0);
    expect(rms(tone(100, 0.5))).toBeGreaterThan(0.3);
  });
});

describe('segmentador', () => {
  it('ignora el silencio y corta una frase al final del habla', () => {
    const seg = new SpeechSegmenter({ minMs: 1000, silenceMs: 500 });
    expect(seg.push(silence(2000), 10_000)).toEqual([]);
    const out = [...seg.push(tone(1500), 11_500), ...seg.push(silence(800), 12_300)];
    expect(out).toHaveLength(1);
    const first = out[0]!;
    // arranca ~300 ms antes del habla (pre-roll) y saca casi todo el silencio final
    expect(first.durationMs).toBeGreaterThan(1500);
    expect(first.durationMs).toBeLessThan(2200);
    expect(first.startMs).toBeGreaterThanOrEqual(9_650);
    expect(first.startMs).toBeLessThanOrEqual(10_000);
  });

  it('corta en el tope aunque sigan hablando', () => {
    const seg = new SpeechSegmenter({ minMs: 1000, maxMs: 3000 });
    const out = seg.push(tone(7000), 7000);
    expect(out.length).toBe(2);
    expect(out[0]!.durationMs).toBeCloseTo(3000, -2);
  });

  it('descarta ruidos cortos y entrega lo pendiente en flush', () => {
    const seg = new SpeechSegmenter({ minMs: 4000, minSpeechMs: 400 });
    expect(seg.push(tone(100), 100)).toEqual([]);
    expect(seg.push(silence(2500), 2600)).toEqual([]);
    seg.push(tone(1000), 3600);
    expect(seg.flush()).toHaveLength(1);
  });
});

describe('hablantes', () => {
  const result = parseSttJson({
    text: 'Hola soy Mara. Perfecto.',
    language: 'es',
    words: [
      { text: 'Hola', start: 0, end: 0.3, speaker: 0 },
      { text: 'soy', start: 0.3, end: 0.5, speaker: 0 },
      { text: 'Mara.', start: 0.5, end: 0.9, speaker: 0 },
      { text: 'Perfecto.', start: 1.5, end: 2, speaker: 1 },
    ],
  });

  it('agrupa palabras en turnos por hablante', () => {
    expect(wordsToTurns(result)).toEqual([
      { speaker: 0, text: 'Hola soy Mara.', start: 0, end: 0.9 },
      { speaker: 1, text: 'Perfecto.', start: 1.5, end: 2 },
    ]);
  });

  it('usa los nombres de los subtítulos si coinciden con los hablantes', () => {
    const names = hintNames(
      [
        { at: 900, name: 'Germán' },
        { at: 1000, name: 'Mara' },
        { at: 1100, name: 'Mara' },
        { at: 1200, name: 'Germán' },
        { at: 5000, name: 'Afuera' },
      ],
      1000,
      2000,
    );
    expect(names).toEqual(['Mara', 'Germán']);
    expect(labelTurns(wordsToTurns(result), names).map((t) => t.label)).toEqual(['Mara', 'Germán']);
  });

  it('sin pistas pone Participante 1/2', () => {
    expect(labelTurns(wordsToTurns(result), []).map((t) => t.label)).toEqual(['Participante 1', 'Participante 2']);
    expect(labelTurns([{ speaker: null, text: 'hola', start: 0, end: 1 }], []).map((t) => t.label)).toEqual([
      'Participante',
    ]);
  });

  it('filtra alucinaciones típicas de Whisper', () => {
    expect(isLikelyHallucination('Subtítulos realizados por la comunidad de Amara.org')).toBe(true);
    expect(isLikelyHallucination('...')).toBe(true);
    expect(isLikelyHallucination('Buscamos un perfil de React')).toBe(false);
  });
});

describe('proveedor de STT', () => {
  it('elige xAI si hay clave, local si hay python, si no apaga', () => {
    expect(chooseSttProvider({ choice: 'auto', xaiKey: 'k', python: '/no/existe' })).toBe('xai');
    expect(chooseSttProvider({ choice: 'auto', xaiKey: '', python: '/no/existe' })).toBe('off');
    expect(chooseSttProvider({ choice: 'auto', xaiKey: '', python: process.execPath })).toBe('local');
    expect(chooseSttProvider({ choice: 'local', xaiKey: 'k', python: '/x' })).toBe('local');
    expect(chooseSttProvider({ choice: 'xai', xaiKey: '', python: '/x' })).toBe('off');
    expect(chooseSttProvider({ choice: 'off', xaiKey: 'k', python: '/x' })).toBe('off');
  });

  it('manda multipart a /v1/stt con idioma y diarización, archivo al final', async () => {
    let seen: { url: string; form: FormData; auth: string } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, form: init.body as FormData, auth: String((init.headers as Record<string, string>).Authorization) };
      return new Response(JSON.stringify({ text: 'hola', words: [{ text: 'hola', start: 0, end: 0.4, speaker: 0 }] }));
    }) as unknown as typeof fetch;
    const stt = new XaiStt('secreto', 'https://api.x.ai/v1/', fakeFetch);
    const out = await stt.transcribe(pcm16ToWav(tone(100)), { language: 'es', diarize: true });
    expect(out.words[0]).toEqual({ text: 'hola', start: 0, end: 0.4, speaker: 0 });
    expect(seen!.url).toBe('https://api.x.ai/v1/stt');
    expect(seen!.auth).toBe('Bearer secreto');
    const keys: string[] = [];
    seen!.form.forEach((_value, key) => keys.push(key));
    expect(keys).toEqual(['language', 'diarize', 'file']);
  });
});

describe('transcriptor', () => {
  it('corta, transcribe y devuelve líneas con hora y hablante', async () => {
    let clock = 1_000_000;
    const calls: number[] = [];
    const stt: SttProvider = {
      name: 'fake',
      async transcribe(wav) {
        calls.push(wav.length);
        return { text: 'hola', words: [{ text: 'Hola', start: 0.3, end: 0.6 }, { text: 'equipo', start: 0.6, end: 1 }] };
      },
      async close() {},
    };
    const lines: AudioLine[] = [];
    const t = new AudioTranscriber({
      stt,
      sttOptions: { language: '', diarize: true },
      segmenter: { minMs: 1000, silenceMs: 500 },
      onLines: (out) => lines.push(...out),
      now: () => clock,
    });
    for (const chunk of [tone(1500), silence(1000)]) {
      clock += (chunk.length / RATE) * 1000;
      t.addHint('Mara');
      t.pushAudio(chunk, 2);
    }
    await t.drain();
    expect(calls).toHaveLength(1);
    expect(lines).toEqual([{ ts: expect.any(String), speaker: 'Mara', text: 'Hola equipo' }]);
    expect(t.status()).toMatchObject({ provider: 'fake', tracks: 2, segments: 1, transcribed: 1, lastError: null });
    expect(t.healthy()).toBe(true);
  });

  it('marca error y deja de estar sano si falla el STT', async () => {
    const stt: SttProvider = {
      name: 'roto',
      async transcribe() {
        throw new Error('sin red');
      },
      async close() {},
    };
    const t = new AudioTranscriber({ stt, sttOptions: { language: '', diarize: false }, onLines: () => undefined });
    t.pushAudio(tone(1000), 1);
    await t.drain();
    expect(t.status().lastError).toBe('sin red');
    expect(t.healthy()).toBe(false);
  });
});

describe('limpieza de Meet', () => {
  it('saca la ayuda de fijar mensajes del chat', () => {
    expect(cleanChatText('@asistente cuantos react Coloca el cursor sobre un mensaje para fijarlo keep')).toBe(
      '@asistente cuantos react',
    );
    expect(cleanChatText('hola  keep Fijar mensaje')).toBe('hola');
    expect(cleanChatText('Hover over a message to pin it keep hola')).toBe('hola');
  });

  it('saca translate_cc de los subtítulos', () => {
    expect(cleanCaptionText('translate_cc buscamos java senior')).toBe('buscamos java senior');
    expect(isCaptionNoise('Mara', 'translate_cc')).toBe(true);
    expect(isCaptionNoise('translate_cc', 'algo')).toBe(true);
    expect(isCaptionNoise('Mara', 'buscamos java')).toBe(false);
  });
});
