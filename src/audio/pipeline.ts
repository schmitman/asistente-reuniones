import { SpeechSegmenter, type SegmenterOptions, type SpeechSegment } from './segmenter.js';
import { hintNames, isLikelyHallucination, labelTurns, wordsToTurns, type SpeakerHint } from './speakers.js';
import type { SttOptions, SttProvider } from './stt.js';
import { pcm16ToWav, STT_SAMPLE_RATE } from './wav.js';

export interface AudioLine {
  /** ISO de cuándo empezó a hablar. */
  ts: string;
  speaker: string;
  text: string;
}

export interface AudioStatus {
  provider: string;
  tracks: number;
  receiving: boolean;
  segments: number;
  transcribed: number;
  queued: number;
  lastLatencyMs: number | null;
  lastError: string | null;
}

export interface AudioTranscriberOptions {
  stt: SttProvider;
  sttOptions: SttOptions;
  segmenter?: SegmenterOptions;
  onLines: (lines: AudioLine[]) => void;
  now?: () => number;
  log?: (message: string) => void;
  /** Si se acumulan más tramos que esto, se tiran los más viejos para no atrasarse. */
  maxQueue?: number;
}

/**
 * Recibe PCM16 de la reunión, lo corta en tramos de habla, los transcribe de a uno
 * y devuelve líneas con hablante. Usa los nombres de los subtítulos como pista.
 */
export class AudioTranscriber {
  private readonly segmenter: SpeechSegmenter;
  private readonly now: () => number;
  private readonly hints: SpeakerHint[] = [];
  private queue: SpeechSegment[] = [];
  private busy: Promise<void> | null = null;
  private tracks = 0;
  private lastChunkAt = 0;
  private lastOkAt = 0;
  private lastErrorAt = 0;
  private segments = 0;
  private transcribed = 0;
  private lastLatencyMs: number | null = null;
  private lastError: string | null = null;

  constructor(private readonly options: AudioTranscriberOptions) {
    this.segmenter = new SpeechSegmenter({ sampleRate: STT_SAMPLE_RATE, ...options.segmenter });
    this.now = options.now ?? Date.now;
  }

  pushAudio(pcm: Int16Array, tracks: number): void {
    const at = this.now();
    this.tracks = tracks;
    this.lastChunkAt = at;
    for (const segment of this.segmenter.push(pcm, at)) this.enqueue(segment);
  }

  addHint(name: string): void {
    const at = this.now();
    this.hints.push({ at, name });
    while (this.hints.length && at - (this.hints[0]?.at ?? at) > 120_000) this.hints.shift();
  }

  /** El audio llega y la última transcripción no falló: no hace falta guardar subtítulos. */
  healthy(): boolean {
    const receiving = this.lastChunkAt > 0 && this.now() - this.lastChunkAt < 5000;
    return receiving && this.lastErrorAt <= this.lastOkAt;
  }

  status(): AudioStatus {
    return {
      provider: this.options.stt.name,
      tracks: this.tracks,
      receiving: this.lastChunkAt > 0 && this.now() - this.lastChunkAt < 5000,
      segments: this.segments,
      transcribed: this.transcribed,
      queued: this.queue.length,
      lastLatencyMs: this.lastLatencyMs,
      lastError: this.lastError,
    };
  }

  /** Corta lo que haya en curso y espera a que termine la cola. */
  async drain(): Promise<void> {
    for (const segment of this.segmenter.flush()) this.enqueue(segment);
    while (this.busy) await this.busy;
  }

  async close(): Promise<void> {
    await this.drain();
    await this.options.stt.close();
  }

  private enqueue(segment: SpeechSegment): void {
    this.segments += 1;
    this.queue.push(segment);
    const max = this.options.maxQueue ?? 6;
    if (this.queue.length > max) {
      const dropped = this.queue.splice(0, this.queue.length - max);
      this.options.log?.(`descarté ${dropped.length} tramo(s) de audio: la transcripción viene atrasada`);
    }
    if (!this.busy) this.busy = this.work().finally(() => (this.busy = null));
  }

  private async work(): Promise<void> {
    while (this.queue.length) {
      const segment = this.queue.shift() as SpeechSegment;
      const started = this.now();
      try {
        const result = await this.options.stt.transcribe(pcm16ToWav(segment.pcm), this.options.sttOptions);
        this.lastOkAt = this.now();
        this.lastLatencyMs = this.lastOkAt - (segment.startMs + segment.durationMs);
        this.transcribed += 1;
        const turns = wordsToTurns(result).filter((turn) => !isLikelyHallucination(turn.text));
        if (!turns.length) continue;
        const names = hintNames(this.hints, segment.startMs - 2000, segment.startMs + segment.durationMs + 3000);
        const lines = labelTurns(turns, names).map((turn) => ({
          ts: new Date(segment.startMs + turn.start * 1000).toISOString(),
          speaker: turn.label,
          text: turn.text,
        }));
        this.options.onLines(lines);
        this.options.log?.(
          `tramo ${(segment.durationMs / 1000).toFixed(1)}s → ${this.now() - started} ms (${this.options.stt.name})`,
        );
      } catch (error) {
        this.lastErrorAt = this.now();
        this.lastError = error instanceof Error ? error.message : String(error);
        this.options.log?.(`error de transcripción: ${this.lastError}`);
      }
    }
  }
}
