/** Utilidades de audio puras: PCM 16-bit mono, WAV y RMS. */

export const STT_SAMPLE_RATE = 16_000;

export function decodePcm16Base64(b64: string): Int16Array {
  const bytes = Buffer.from(b64, 'base64');
  const out = new Int16Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < out.length; i += 1) out[i] = bytes.readInt16LE(i * 2);
  return out;
}

export function pcm16ToWav(samples: Int16Array, sampleRate = STT_SAMPLE_RATE): Buffer {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8, 'ascii');
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataBytes, 40);
  for (let i = 0; i < samples.length; i += 1) buffer.writeInt16LE(samples[i] ?? 0, 44 + i * 2);
  return buffer;
}

/** RMS normalizado 0..1 de un tramo PCM16. */
export function rms(samples: Int16Array, from = 0, to = samples.length): number {
  const n = to - from;
  if (n <= 0) return 0;
  let sum = 0;
  for (let i = from; i < to; i += 1) {
    const v = (samples[i] ?? 0) / 32768;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

export function concatPcm(parts: Int16Array[]): Int16Array {
  const total = parts.reduce((acc, part) => acc + part.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
