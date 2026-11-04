import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import type { SttResult, SttWord } from './speakers.js';

export interface SttOptions {
  language: string;
  diarize: boolean;
}

export interface SttProvider {
  readonly name: string;
  transcribe(wav: Buffer, options: SttOptions): Promise<SttResult>;
  close(): Promise<void>;
}

/** xAI Grok Voice: POST /v1/stt. Usa la misma XAI_API_KEY del chat. */
export class XaiStt implements SttProvider {
  readonly name = 'xai';
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.x.ai/v1',
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async transcribe(wav: Buffer, options: SttOptions): Promise<SttResult> {
    const form = new FormData();
    if (options.language) form.append('language', options.language);
    if (options.diarize) form.append('diarize', 'true');
    // El archivo tiene que ir último en el multipart.
    form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'tramo.wav');
    const response = await this.fetchImpl(`${this.baseUrl.replace(/\/+$/, '')}/stt`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: form,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`STT de xAI respondió ${response.status}: ${body.slice(0, 200)}`);
    }
    return parseSttJson(await response.json());
  }

  async close(): Promise<void> {}
}

export function parseSttJson(payload: unknown): SttResult {
  const data = (payload ?? {}) as { text?: unknown; language?: unknown; words?: unknown };
  const words: SttWord[] = Array.isArray(data.words)
    ? data.words
        .map((raw) => raw as { text?: unknown; start?: unknown; end?: unknown; speaker?: unknown })
        .filter((w) => typeof w.text === 'string')
        .map((w) => ({
          text: String(w.text),
          start: Number(w.start) || 0,
          end: Number(w.end) || 0,
          ...(typeof w.speaker === 'number' ? { speaker: w.speaker } : {}),
        }))
    : [];
  return {
    text: typeof data.text === 'string' ? data.text : words.map((w) => w.text).join(' '),
    ...(typeof data.language === 'string' ? { language: data.language } : {}),
    words,
  };
}

/**
 * faster-whisper local en CPU (gratis, sin red). Mantiene vivo un proceso Python
 * (scripts/whisper_worker.py) que carga el modelo una sola vez.
 */
export class LocalWhisperStt implements SttProvider {
  readonly name = 'local';
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending: Array<{ resolve: (r: SttResult) => void; reject: (e: Error) => void }> = [];
  private readonly dir = mkdtempSync(join(tmpdir(), 'asistente-stt-'));
  private counter = 0;

  constructor(
    private readonly python: string,
    private readonly model: string,
    private readonly script = resolve(process.cwd(), 'scripts/whisper_worker.py'),
  ) {}

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn(this.python, [this.script, '--model', this.model], { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) console.log(`[whisper] ${text.slice(0, 300)}`);
    });
    createInterface({ input: child.stdout }).on('line', (line) => {
      const next = this.pending.shift();
      if (!next) return;
      try {
        const parsed = JSON.parse(line) as { error?: string };
        if (parsed.error) next.reject(new Error(parsed.error));
        else next.resolve(parseSttJson(parsed));
      } catch (error) {
        next.reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.on('exit', (code) => {
      this.child = null;
      for (const item of this.pending.splice(0)) item.reject(new Error(`whisper terminó (código ${code})`));
    });
    this.child = child;
    return child;
  }

  transcribe(wav: Buffer, options: SttOptions): Promise<SttResult> {
    const child = this.ensure();
    const path = join(this.dir, `tramo-${(this.counter += 1)}.wav`);
    writeFileSync(path, wav);
    return new Promise<SttResult>((resolveResult, reject) => {
      this.pending.push({
        resolve: (result) => {
          rmSync(path, { force: true });
          resolveResult(result);
        },
        reject: (error) => {
          rmSync(path, { force: true });
          reject(error);
        },
      });
      child.stdin.write(`${JSON.stringify({ path, language: options.language || null })}\n`);
    });
  }

  async close(): Promise<void> {
    this.child?.stdin.end();
    this.child?.kill();
    this.child = null;
    rmSync(this.dir, { recursive: true, force: true });
  }
}

export type SttChoice = 'auto' | 'xai' | 'local' | 'off';

export function chooseSttProvider(input: {
  choice: SttChoice;
  xaiKey: string;
  python: string;
}): 'xai' | 'local' | 'off' {
  if (input.choice === 'off') return 'off';
  if (input.choice === 'xai') return input.xaiKey ? 'xai' : 'off';
  if (input.choice === 'local') return 'local';
  if (input.xaiKey) return 'xai';
  return existsSync(input.python) ? 'local' : 'off';
}
