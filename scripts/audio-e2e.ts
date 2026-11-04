/**
 * Prueba de punta a punta de la captura de audio, sin Meet:
 *   npm run test:audio -- [--file audio.wav|mp3] [--provider xai|local]
 *
 * Abre Chromium con el mismo hook que usa el bot en Meet, arma una llamada WebRTC
 * local (dos RTCPeerConnection en la misma página), reproduce el audio como "voz
 * remota" y lo pasa por el mismo segmentador + STT que en una reunión real.
 * Si no pasás --file, genera dos frases en español con el TTS de xAI.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { cpus } from 'node:os';
import { AudioTranscriber, type AudioLine } from '../src/audio/pipeline.js';
import { LocalWhisperStt, XaiStt, type SttProvider } from '../src/audio/stt.js';
import { decodePcm16Base64 } from '../src/audio/wav.js';
import { loadConfig } from '../src/config.js';
import { AUDIO_BINDING, AUDIO_HOOK_SCRIPT } from '../src/meet/audioHook.js';

const args = process.argv.slice(2);
const argValue = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function tts(text: string, voice: string, apiKey: string): Promise<Buffer> {
  const response = await fetch('https://api.x.ai/v1/tts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice_id: voice, language: 'es' }),
  });
  if (!response.ok) throw new Error(`TTS respondió ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const PAGE = `<!doctype html><meta charset="utf-8"><title>prueba audio</title><body>
<script>
window.runCall = async (files) => {
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  const pc1 = new RTCPeerConnection(), pc2 = new RTCPeerConnection();
  pc1.onicecandidate = (e) => e.candidate && pc2.addIceCandidate(e.candidate);
  pc2.onicecandidate = (e) => e.candidate && pc1.addIceCandidate(e.candidate);
  const got = new Promise((r) => (pc2.ontrack = () => r()));
  dest.stream.getTracks().forEach((t) => pc1.addTrack(t, dest.stream));
  await pc1.setLocalDescription(await pc1.createOffer());
  await pc2.setRemoteDescription(pc1.localDescription);
  await pc2.setLocalDescription(await pc2.createAnswer());
  await pc1.setRemoteDescription(pc2.localDescription);
  await got;
  await new Promise((r) => setTimeout(r, 1500));
  let total = 0;
  for (const file of files) {
    const buf = await ctx.decodeAudioData(await (await fetch(file)).arrayBuffer());
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(dest);
    src.start();
    await new Promise((r) => (src.onended = r));
    await new Promise((r) => setTimeout(r, 1200));
    total += buf.duration;
  }
  return total;
};
</script>`;

async function main(): Promise<void> {
  const config = loadConfig();
  mkdirSync('logs/audio-e2e', { recursive: true });
  let files: string[];
  const given = argValue('--file');
  if (given) {
    files = [resolve(given)];
  } else {
    if (!config.sttApiKey) throw new Error('Sin XAI_API_KEY: pasá --file con un audio de prueba.');
    const a = 'logs/audio-e2e/mara.mp3';
    const b = 'logs/audio-e2e/candidato.mp3';
    if (!existsSync(a)) {
      writeFileSync(a, await tts('Hola, soy Mara. Estamos buscando un desarrollador senior de React con inglés avanzado para un cliente de Buenos Aires.', 'eve', config.sttApiKey));
    }
    if (!existsSync(b)) {
      writeFileSync(b, await tts('Perfecto. Yo tengo cinco años de experiencia con TypeScript y Node, y trabajé en una startup de pagos.', 'rex', config.sttApiKey));
    }
    files = [resolve(a), resolve(b)];
  }

  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(PAGE);
      return;
    }
    const index = Number((req.url || '').replace('/audio/', '').split('.')[0]);
    const file = files[index];
    if (!file) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('Content-Type', extname(file) === '.wav' ? 'audio/wav' : 'audio/mpeg');
    res.end(readFileSync(file));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;

  const providerName = argValue('--provider') ?? (config.sttProvider === 'off' ? 'local' : config.sttProvider);
  const stt: SttProvider =
    providerName === 'xai'
      ? new XaiStt(config.sttApiKey, config.sttBaseUrl)
      : new LocalWhisperStt(config.sttPython, config.sttLocalModel);
  const lines: AudioLine[] = [];
  const logs: string[] = [];
  const transcriber = new AudioTranscriber({
    stt,
    sttOptions: { language: config.sttLanguage, diarize: config.sttDiarize },
    segmenter: { minMs: config.sttMinSegmentMs, maxMs: config.sttMaxSegmentMs, speechRms: config.sttSpeechRms },
    onLines: (out) => {
      for (const line of out) console.log(`  [${new Date(line.ts).toLocaleTimeString('es-AR')}] ${line.speaker}: ${line.text}`);
      lines.push(...out);
    },
    log: (message) => {
      logs.push(message);
      console.log(`[audio] ${message}`);
    },
  });

  const { chromium } = await import('playwright');
  const context = await chromium.launchPersistentContext('', {
    headless: config.meetHeadless,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'],
  });
  let chunks = 0;
  await context.exposeBinding(AUDIO_BINDING, (_s, payload: { pcm: string; tracks: number }) => {
    chunks += 1;
    transcriber.pushAudio(decodePcm16Base64(payload.pcm), payload.tracks);
  });
  await context.addInitScript(AUDIO_HOOK_SCRIPT);
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`http://127.0.0.1:${port}/`);
  const cpuBefore = process.cpuUsage();
  const started = Date.now();
  console.log(`Reproduciendo ${files.length} audio(s) como voz remota. Proveedor: ${stt.name}`);
  const seconds = (await page.evaluate(
    `window.runCall(${JSON.stringify(files.map((f, i) => `/audio/${i}${extname(f)}`))})`,
  )) as number;
  await new Promise((r) => setTimeout(r, 1500));
  await transcriber.drain();
  const wall = (Date.now() - started) / 1000;
  const cpu = process.cpuUsage(cpuBefore);
  const state = await page.evaluate('window.__asistenteAudioState');
  await context.close();
  await transcriber.close();
  server.close();

  const status = transcriber.status();
  const report = {
    provider: stt.name,
    audioSeconds: Number(seconds.toFixed(1)),
    wallSeconds: Number(wall.toFixed(1)),
    chunksFromPage: chunks,
    pageState: state,
    status,
    nodeCpuPercentOfOneCore: Number((((cpu.user + cpu.system) / 1e6 / wall) * 100).toFixed(1)),
    cores: cpus().length,
    lines,
  };
  writeFileSync(`logs/audio-e2e/report-${stt.name}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, lines: lines.length }, null, 2));
  if (!lines.length) {
    process.exitCode = 1;
    console.error('No salió ninguna línea transcripta.');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
