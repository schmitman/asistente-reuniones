import type { PanelSnapshot } from './snapshot.js';

export function renderPanel(snapshot: PanelSnapshot, token: string): string {
  const data = JSON.stringify(snapshot).replaceAll('<', '\\u003c');
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Asistente IA de Mara</title>
  <style>
    :root { color-scheme: light; --ink: #1c1915; --muted: #5c564e; --line: #e4ddd2; --paper: #f6f3ee; --card: #fff; --accent: #0f6e56; }
    * { box-sizing: border-box; }
    body { margin: 0; font: 16px/1.45 "Segoe UI", system-ui, sans-serif; color: var(--ink); background: var(--paper); }
    main { max-width: 880px; margin: 0 auto; padding: 28px 20px 64px; }
    h1 { font-size: 1.6rem; margin: 0 0 4px; }
    h2 { font-size: 1rem; margin: 0 0 10px; }
    p { margin: 0; }
    .lede { color: var(--muted); margin-bottom: 18px; }
    .grid { display: grid; gap: 14px; }
    section, form { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; }
    label { display: block; font-size: 0.92rem; margin-bottom: 6px; }
    input[type="url"] { width: 100%; padding: 10px 12px; border: 1px solid var(--line); border-radius: 10px; font: inherit; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
    button { font: inherit; border: 0; border-radius: 999px; padding: 9px 14px; background: var(--accent); color: white; cursor: pointer; }
    button.secondary { background: transparent; color: var(--ink); border: 1px solid var(--line); }
    .status { font-weight: 650; }
    ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; }
    li { padding-bottom: 8px; border-bottom: 1px solid var(--line); }
    .meta { color: var(--muted); font-size: 0.82rem; }
    .empty { color: var(--muted); }
    .error { color: #8d2b2b; }
  </style>
</head>
<body>
  <main>
    <h1>Asistente IA de Mara</h1>
    <p class="lede">Canal privado. El bot no escribe en el Meet salvo que lo llamen, o si activás el aviso de notas.</p>
    <div class="grid">
      <section>
        <h2>Reunión</h2>
        <p>Estado: <span id="status" class="status"></span></p>
        <p id="meeting" class="meta"></p>
        <p id="error" class="error"></p>
        <p id="cache" class="meta"></p>
      </section>
      <form id="join-form">
        <label for="url">Link de Google Meet</label>
        <input id="url" name="url" type="url" required placeholder="https://meet.google.com/abc-defg-hij" />
        <div class="row">
          <label><input id="consent" type="checkbox" /> Publicar al entrar: “Hola, soy el asistente IA de Mara, tomo notas”</label>
        </div>
        <div class="row">
          <button type="submit">Pedir unirse</button>
          <button id="leave" class="secondary" type="button">Salir</button>
        </div>
        <p id="form-error" class="error"></p>
      </form>
      <section>
        <h2>Chat de la reunión</h2>
        <ul id="chat"></ul>
      </section>
      <section>
        <h2>Transcripción</h2>
        <p class="meta">Audio de la reunión transcripto (fuente "audio"). Si el audio falla, usa los subtítulos de Meet (fuente "caption").</p>
        <p id="audio" class="meta"></p>
        <ul id="transcript"></ul>
      </section>
      <section>
        <h2>Sugerencias</h2>
        <p id="suggestion-note" class="empty"></p>
        <ul id="suggestions"></ul>
      </section>
    </div>
  </main>
  <script>
    const token = ${JSON.stringify(token)};
    const initial = ${data};
    const $ = (id) => document.getElementById(id);
    function item(parent, title, body) {
      const li = document.createElement('li');
      const meta = document.createElement('div');
      meta.className = 'meta';
      meta.textContent = title;
      const text = document.createElement('div');
      text.textContent = body;
      li.append(meta, text);
      parent.append(li);
    }
    const STATUS = {
      idle: 'en espera',
      joining: 'pidiendo entrar',
      live: 'en la reunión',
      error: 'error',
      left: 'salió',
    };
    function paint(snapshot) {
      $('status').textContent = STATUS[snapshot.status] || snapshot.status;
      $('meeting').textContent = (snapshot.meetingUrl || 'Sin reunión.') + (snapshot.consentPosted ? ' · aviso publicado' : '');
      $('error').textContent = snapshot.lastError || '';
      const detail = snapshot.detailLevel === 'names' ? 'nombres' : 'conteos';
      $('cache').textContent = snapshot.candidateCount + ' perfiles en el cache · detalle ' + detail;
      $('suggestion-note').textContent = snapshot.suggestions.length ? '' : snapshot.suggestionNote;
      const chat = $('chat');
      chat.replaceChildren();
      if (!snapshot.chat.length) item(chat, '', 'Todavía no leí mensajes.');
      for (const line of snapshot.chat) {
        item(chat, line.sender + (line.addressed ? ' · te llamó' : ''), line.reply ? line.text + ' → ' + line.reply : line.text);
      }
      const audio = snapshot.audio;
      $('audio').textContent = audio
        ? 'Audio: ' + audio.provider + ' · ' + audio.tracks + ' pista(s) · ' + (audio.receiving ? 'recibiendo' : 'sin señal') +
          ' · ' + audio.transcribed + '/' + audio.segments + ' tramos' +
          (audio.lastLatencyMs != null ? ' · demora ' + (audio.lastLatencyMs / 1000).toFixed(1) + ' s' : '') +
          (audio.lastError ? ' · error: ' + audio.lastError : '')
        : 'Audio apagado: solo subtítulos.';
      const transcript = $('transcript');
      transcript.replaceChildren();
      if (!snapshot.transcript.length) item(transcript, '', 'Sin transcripción todavía.');
      for (const line of snapshot.transcript) item(transcript, line.speaker + ' · ' + line.source, line.text);
      const suggestions = $('suggestions');
      suggestions.replaceChildren();
      for (const line of snapshot.suggestions) item(suggestions, line.kind, line.text);
    }
    async function api(path, options) {
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = 'Bearer ' + token;
      const response = await fetch(path, { ...options, headers });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'No se pudo completar.');
      return payload;
    }
    $('join-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      $('form-error').textContent = '';
      try {
        await api('/api/join', {
          method: 'POST',
          body: JSON.stringify({ url: $('url').value, consent: $('consent').checked }),
        });
      } catch (error) {
        $('form-error').textContent = error.message;
      }
    });
    $('leave').addEventListener('click', async () => {
      $('form-error').textContent = '';
      try { await api('/api/leave', { method: 'POST', body: '{}' }); }
      catch (error) { $('form-error').textContent = error.message; }
    });
    paint(initial);
    setInterval(async () => {
      try { paint(await api('/api/status')); } catch (_) {}
    }, 2000);
  </script>
</body>
</html>`;
}
