import { openDatabase } from './db/database.js';
import { loadConfig } from './config.js';
import { syncAirtable } from './airtable/sync.js';
import { answerQuestion } from './llm/agent.js';
import { createPlaywrightMeet, runGoogleLogin } from './meet/session.js';
import type { MeetController } from './meet/controller.js';
import { startPanelServer } from './panel/server.js';
import { MeetingRuntime } from './runtime/meeting.js';

const HELP = `
Asistente IA de Mara

  npm run login                         Login de Google, una sola vez
  npm run sync                          Baja Airtable al cache local
  npm run ask -- "cuántos java senior"  Prueba la respuesta sin entrar a Meet
  npm run join -- <url> [--consent]     Entra a una reunión
  npm run serve                         Panel en localhost y espera un link

El bot no escribe en el chat salvo que el mensaje empiece por @asistente o "asistente,",
o que pidas el aviso de notas con --consent.
`.trim();

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const flags = new Set(rest.filter((arg) => arg.startsWith('--')));
  const args = rest.filter((arg) => !arg.startsWith('--'));
  if (!command || command === 'help' || flags.has('--help') || flags.has('-h')) {
    console.log(HELP);
    return;
  }

  const config = loadConfig();
  if (command === 'login') {
    await runGoogleLogin(config);
    console.log('Listo. El perfil quedó guardado y se reutiliza en las próximas reuniones.');
    return;
  }

  const db = openDatabase(config.sqlitePath);
  if (command === 'sync') {
    const result = await syncAirtable(db, config);
    for (const item of result) console.log(`${item.baseName}: ${item.count}`);
    return;
  }
  if (command === 'ask') {
    const question = args.join(' ').trim();
    if (!question) throw new Error('Pasame la pregunta: npm run ask -- "cuántos java senior hay"');
    console.log(await answerQuestion({ question, db, config }));
    return;
  }

  const meet = createLazyMeet(config);
  const runtime = new MeetingRuntime(db, config, meet);
  const panel = await startPanelServer({
    host: config.panelHost,
    port: config.panelPort,
    token: config.panelToken,
    api: runtime,
  });
  console.log(`Panel privado en ${panel.url}`);
  const stop = async () => {
    await runtime.stop();
    await panel.close();
  };
  process.once('SIGINT', () => {
    void stop().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void stop().finally(() => process.exit(0));
  });

  if (command === 'serve') {
    console.log('Esperando un link en el panel o en POST /api/join.');
    await new Promise(() => undefined);
    return;
  }
  if (command === 'join') {
    const url = args[0];
    if (!url) throw new Error('Falta el link. Ejemplo: npm run join -- https://meet.google.com/abc-defg-hij');
    const consent = flags.has('--consent') || (config.postConsentOnJoin && !flags.has('--no-consent'));
    try {
      await runtime.start(url, consent);
      console.log(`En la reunión. Nombre: ${config.displayName}. Salí con Ctrl+C.`);
      console.log(
        config.sttProvider === 'off'
          ? 'Transcripción por audio apagada: uso los subtítulos de Meet.'
          : `Transcribiendo el audio con ${config.sttProvider === 'xai' ? 'xAI (Grok Voice)' : `faster-whisper local (${config.sttLocalModel})`}.`,
      );
      await runtime.run();
    } finally {
      await stop();
    }
    return;
  }
  throw new Error(`No conozco el comando "${command}".\n\n${HELP}`);
}

function createLazyMeet(config: ReturnType<typeof loadConfig>): MeetController {
  let inner: MeetController | null = null;
  let audioListener: Parameters<NonNullable<MeetController['onAudio']>>[0] = null;
  const ready = async (): Promise<MeetController> => {
    if (!inner) {
      inner = await createPlaywrightMeet(config);
      inner.onAudio?.(audioListener);
    }
    return inner;
  };
  return {
    async join(url: string) {
      await (await ready()).join(url);
    },
    async postMessage(text: string) {
      await (await ready()).postMessage(text);
    },
    async scrapeChat() {
      return (await ready()).scrapeChat();
    },
    async scrapeCaption() {
      return (await ready()).scrapeCaption();
    },
    async close() {
      await inner?.close();
      inner = null;
    },
    async inCall() {
      return inner?.inCall ? inner.inCall() : true;
    },
    onAudio(listener) {
      audioListener = listener;
      inner?.onAudio?.(listener);
    },
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
