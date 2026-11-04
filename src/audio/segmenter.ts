import { STT_SAMPLE_RATE, concatPcm, rms } from './wav.js';

/**
 * Corta el audio continuo de la reunión en tramos de habla para mandar a transcribir.
 * Detección de voz por energía (RMS por cuadro de 20 ms): simple, sin dependencias.
 */
export interface SegmenterOptions {
  sampleRate?: number;
  /** Duración mínima de un tramo antes de cortar en un silencio. */
  minMs?: number;
  /** Tope: corta aunque la persona siga hablando. */
  maxMs?: number;
  /** Silencio que cuenta como fin de frase. */
  silenceMs?: number;
  /** RMS (0..1) desde el que un cuadro cuenta como voz. */
  speechRms?: number;
  /** Tramos con menos voz que esto se descartan (toses, clicks). */
  minSpeechMs?: number;
  /** Audio previo que se agrega al principio para no comerse la primera sílaba. */
  preRollMs?: number;
}

export interface SpeechSegment {
  pcm: Int16Array;
  /** Epoch ms del primer sample. */
  startMs: number;
  durationMs: number;
  speechMs: number;
}

const FRAME_MS = 20;

export class SpeechSegmenter {
  private readonly rate: number;
  private readonly frameSamples: number;
  private readonly opts: Required<Omit<SegmenterOptions, 'sampleRate'>>;
  private carry: Int16Array = new Int16Array(0);
  private preRoll: Int16Array[] = [];
  private frames: Int16Array[] = [];
  private segmentStartSample = 0;
  private speechFrames = 0;
  private silenceRun = 0;
  private processedSamples = 0;
  private baseMs: number | null = null;

  constructor(options: SegmenterOptions = {}) {
    this.rate = options.sampleRate ?? STT_SAMPLE_RATE;
    this.frameSamples = Math.round((this.rate * FRAME_MS) / 1000);
    this.opts = {
      minMs: options.minMs ?? 4000,
      maxMs: options.maxMs ?? 15_000,
      silenceMs: options.silenceMs ?? 700,
      speechRms: options.speechRms ?? 0.01,
      minSpeechMs: options.minSpeechMs ?? 400,
      preRollMs: options.preRollMs ?? 300,
    };
  }

  /** Agrega audio. `receivedAtMs` es la hora (epoch ms) en que terminó este pedazo. */
  push(samples: Int16Array, receivedAtMs: number): SpeechSegment[] {
    if (this.baseMs === null) this.baseMs = receivedAtMs - (samples.length / this.rate) * 1000;
    const data = this.carry.length ? concatPcm([this.carry, samples]) : samples;
    const out: SpeechSegment[] = [];
    let offset = 0;
    while (offset + this.frameSamples <= data.length) {
      const frame = data.slice(offset, offset + this.frameSamples);
      offset += this.frameSamples;
      const segment = this.processFrame(frame);
      if (segment) out.push(segment);
    }
    this.carry = data.slice(offset);
    return out;
  }

  /** Cierra el tramo en curso (al salir de la reunión). */
  flush(): SpeechSegment[] {
    const segment = this.frames.length ? this.emit() : null;
    return segment ? [segment] : [];
  }

  private processFrame(frame: Int16Array): SpeechSegment | null {
    const isSpeech = rms(frame) >= this.opts.speechRms;
    const frameIndexSample = this.processedSamples;
    this.processedSamples += frame.length;

    if (!this.frames.length) {
      if (!isSpeech) {
        this.preRoll.push(frame);
        const keep = Math.ceil(this.opts.preRollMs / FRAME_MS);
        if (this.preRoll.length > keep) this.preRoll.shift();
        return null;
      }
      this.frames = [...this.preRoll, frame];
      this.segmentStartSample = frameIndexSample - this.preRoll.length * this.frameSamples;
      this.preRoll = [];
      this.speechFrames = 1;
      this.silenceRun = 0;
      return null;
    }

    this.frames.push(frame);
    if (isSpeech) {
      this.speechFrames += 1;
      this.silenceRun = 0;
    } else {
      this.silenceRun += 1;
    }
    const durationMs = this.frames.length * FRAME_MS;
    const silenceMs = this.silenceRun * FRAME_MS;
    const endOfPhrase = durationMs >= this.opts.minMs && silenceMs >= this.opts.silenceMs;
    const longPause = silenceMs >= Math.max(2000, this.opts.silenceMs * 2);
    if (endOfPhrase || longPause || durationMs >= this.opts.maxMs) return this.emit();
    return null;
  }

  private emit(): SpeechSegment | null {
    // Saco el silencio del final, dejando un margen corto.
    const tailKeep = Math.ceil(200 / FRAME_MS);
    const trim = Math.max(0, this.silenceRun - tailKeep);
    const frames = trim > 0 ? this.frames.slice(0, this.frames.length - trim) : this.frames;
    const speechMs = this.speechFrames * FRAME_MS;
    const startMs = (this.baseMs ?? 0) + (this.segmentStartSample / this.rate) * 1000;
    this.frames = [];
    this.speechFrames = 0;
    this.silenceRun = 0;
    if (speechMs < this.opts.minSpeechMs) return null;
    const pcm = concatPcm(frames);
    return { pcm, startMs, durationMs: (pcm.length / this.rate) * 1000, speechMs };
  }
}
