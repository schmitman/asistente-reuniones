# Asistente IA de Mara

Bot propio para las reuniones de Mara Schmitman (Bondy / Schmitman HR). Entra a un Google Meet con Chromium, espera a que el anfitrión lo admita, lee el chat y contesta solo cuando le hablan. Las respuestas salen de un cache local de Airtable: cantidades, y si se configura, nombre y perfil. No usa APIs de bots de terceros.

El micrófono y la cámara quedan apagados. No publica nada en el chat salvo que el mensaje empiece por `@asistente` o `asistente,`, o que pidas el aviso de notas al entrar.

## Qué hace esta etapa

1. Se une a un link de Meet por CLI o por el panel local. El perfil de Chrome queda en disco, así el login de Google se hace una sola vez.
2. Lee el chat en el DOM y responde en el chat de la reunión.
3. Contesta con un modelo OpenAI-compatible (OpenAI o xAI Grok) que consulta el cache de candidatos. Sin API key igual responde conteos simples.
4. Escucha el audio de la reunión y lo transcribe (xAI Grok Voice o faster-whisper local), con nombres sacados de los subtítulos cuando se puede. Si el audio falla, guarda los subtítulos como antes. Detalle en [docs/etapa2-audio.md](docs/etapa2-audio.md).
5. Tiene un panel en localhost para ver estado, chat, transcripción y el lugar donde más adelante van a caer sugerencias proactivas.

## Requisitos

- Linux, Node.js 22 o más nuevo.
- Chromium, lo instala Playwright.
- Para una VM sin monitor: el paquete `xvfb`.
- Un token de Airtable de **solo lectura**.
- Una cuenta de Google dedicada al asistente. No uses una cuenta personal con sesión de trabajo mezclada.

## Instalación

```bash
git clone <este-repo>
cd asistente-reuniones
npm install
npx playwright install chromium
npx playwright install-deps chromium
cp .env.example .env
```

En Debian/Ubuntu, si `install-deps` no puede usar sudo, instalá las librerías que te liste el comando. Para el framebuffer virtual:

```bash
sudo apt-get update
sudo apt-get install -y xvfb
```

Completá `.env`. Las variables están explicadas abajo.

## Variables de entorno

| Variable | Para qué |
| --- | --- |
| `AIRTABLE_TOKEN` | Token personal de solo lectura. Sin esto no corre el sync. |
| `LLM_PROVIDER` | `xai` o `openai`. Solo elige la URL por defecto. |
| `LLM_BASE_URL` | Base OpenAI-compatible. Grok: `https://api.x.ai/v1`. OpenAI: `https://api.openai.com/v1`. |
| `LLM_API_KEY` | Clave del modelo. También acepta `XAI_API_KEY` u `OPENAI_API_KEY`. |
| `LLM_MODEL` | Por ejemplo `grok-3` o `gpt-4o-mini`. |
| `MEET_PROFILE_DIR` | Carpeta del perfil de Chrome. Default `data/chrome-profile`. |
| `MEET_HEADLESS` | `false` recomendado. Meet suele bloquear el headless. |
| `MEET_DISPLAY_NAME` | `Asistente IA de Mara`. Se usa si la sala pide nombre de invitado. |
| `MEET_ADMISSION_TIMEOUT_MS` | Cuánto espera a que lo admitan. Default 10 minutos. |
| `POST_CONSENT_ON_JOIN` | `true` publica el aviso al entrar. Default `false`. |
| `CONSENT_MESSAGE` | Default: `Hola, soy el asistente IA de Mara, tomo notas`. |
| `CHAT_DETAIL_LEVEL` | `counts` (default) o `names`. |
| `CHAT_MAX_NAMES` | Tope de nombres si el detalle es `names`. Default 5. |
| `CHAT_REQUIRE_DATA_CLAUSE` | En modo `names`, solo nombra fichas con **Clausula Datos**. Default `true`. |
| `SQLITE_PATH` | Cache y transcripciones. Default `data/asistente.db`. |
| `TRANSCRIPT_DIR` | JSONL por reunión. Default `data/transcripts`. |
| `PANEL_HOST` / `PANEL_PORT` | Default `127.0.0.1:8787`. Si el host no es localhost, `PANEL_TOKEN` es obligatorio. |
| `PANEL_TOKEN` | Secreto para `POST /api/join` y `POST /api/leave`. |
| `SYNC_MAX_RECORDS` | Tope opcional para probar el sync sin bajar las bases enteras. |
| `AIRTABLE_MIN_INTERVAL_MS` | Pausa entre pedidos. Default 220, por debajo del límite de Airtable. |

## Primer login de Google

Meet, con la cuenta ya iniciada, muestra el nombre de la cuenta. Por eso el nombre de esa cuenta de Google tiene que ser **Asistente IA de Mara**. Si entra como invitada, el bot completa el campo de nombre.

El login es manual, una vez. El perfil queda en `MEET_PROFILE_DIR` y se reutiliza.

En una máquina con monitor:

```bash
npm run login
```

Se abre Chrome en `accounts.google.com`. Iniciá sesión, aceptá lo que haga falta y, cuando veas la cuenta adentro, volvé a la terminal y presioná Enter.

En una VM sin monitor hay tres caminos:

1. Hacer el login en una laptop y copiar la carpeta `data/chrome-profile` a la VM, con los mismos permisos de tu usuario.
2. Reenviar X11 (`ssh -X`) y correr `npm run login`.
3. Levantar un escritorio virtual y mirarlo por VNC:

```bash
Xvfb :99 -screen 0 1280x720x24 &
DISPLAY=:99 npm run login
# en otra terminal, contra el mismo display:
x11vnc -display :99 -localhost -nopw
```

No automatizamos el usuario, la contraseña ni el desafío de Google. Si Google pide verificación, la resolvés vos en esa ventana.

## Sync de Airtable

```bash
npm run sync
```

Baja estas dos bases, solo campos de perfil, y reemplaza el cache de cada una cuando la descarga termina. Si se corta la red, el cache anterior de esa base queda como estaba.

- **Base general (ultima)**, `appZ2uavuwQLI2foP`, tabla `Base General` (alrededor de 35 mil filas). Skills confiables: `Skills 2` y `Skills (AI Internet)`, ambos multi-select. También el texto `Skills ` (el nombre real termina con un espacio), `Tech Skills`, `Profile`, `Seniority`, `Área`, `Años de experiencia`, `English Level`, `Status` y el puesto legible `Position Name (from Position on Job Board)`. `Position name` en esta base es un link a oportunidades: si Airtable devuelve un id `rec…`, se descarta.
- **BASE 2020 - 2021**, `appwm3pmXVPgrflPx`, tabla `Imported table` (alrededor de 16,5 mil filas). Skills en texto libre.

No se piden ni se guardan campos de email, teléfono, salario, LinkedIn, CV, contraseña ni credenciales. Hay una lista blanca y, encima, un filtro por nombre de campo. `Clausula Datos` se guarda solo como sí/no, para saber si se puede decir el nombre en una reunión.

La base general es la que se consulta si nadie aclara. La histórica entra solo si se pide.

Probar una pregunta sin abrir Meet:

```bash
npm run ask -- "cuántos java senior con inglés avanzado hay"
```

## Unirse a una reunión

Con monitor, o dentro de Xvfb:

```bash
xvfb-run -a npm run join -- https://meet.google.com/abc-defg-hij --consent
```

Sin el aviso de notas:

```bash
xvfb-run -a npm run join -- https://meet.google.com/abc-defg-hij
```

Qué hace al entrar:

1. Abre el link con el perfil guardado.
2. Si aparece el nombre de invitado, escribe `Asistente IA de Mara`.
3. Apaga micrófono y cámara.
4. Toca **Pedir unirse** (o **Unirse ahora**, si la sala no tiene sala de espera).
5. Espera a que el anfitrión lo admita.
6. Abre el chat. Si puede, prende subtítulos.
7. Con `--consent` o `POST_CONSENT_ON_JOIN=true`, escribe una sola vez: `Hola, soy el asistente IA de Mara, tomo notas`.

En el chat de la reunión alguien tiene que llamarlo, por ejemplo:

- `@asistente cuántos java senior hay`
- `asistente, perfiles react native semi senior`
- `Hola asistente, hay gente con inglés avanzado?`

No contesta saludos generales, ni mensajes viejos que ya estaban cuando abrió el chat, ni sus propios mensajes. Entre respuestas deja unos segundos.

Para dejar el proceso esperando links:

```bash
xvfb-run -a npm run serve
```

El panel queda en [http://127.0.0.1:8787/](http://127.0.0.1:8787/). Desde ahí se pega el link, se tilda el aviso y se pide unirse. También:

```bash
curl -s -X POST http://127.0.0.1:8787/api/join \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $PANEL_TOKEN" \
  -d '{"url":"https://meet.google.com/abc-defg-hij","consent":true}'
```

`GET /health` y `GET /api/status` dicen si está idle, joining, live o error. `POST /api/leave` cuelga.

## Cómo probar de punta a punta

1. `npm test` y `npm run typecheck`.
2. `npm run sync` (podés poner `SYNC_MAX_RECORDS=50` la primera vez).
3. `npm run ask -- "cuántos java senior hay"` y mirá que el número tenga sentido, sin mails ni teléfonos.
4. Abrí un Meet con otra cuenta, como anfitriona.
5. `xvfb-run -a npm run join -- <link> --consent`.
6. Admití al asistente. Tiene que verse sin cámara y sin micrófono, con el aviso en el chat.
7. Escribí `hola a todos`. No tiene que contestar.
8. Escribí `@asistente cuántos java senior hay`. Tiene que contestar corto, en voseo, con un conteo.
9. Pedile un mail o un salario. Tiene que negarse.
10. Si prendés subtítulos, en el panel tiene que ir apareciendo la transcripción. En `data/transcripts/` queda un `.jsonl`.
11. La sección **Sugerencias** del panel queda vacía a propósito.

Los selectores del chat y de los subtítulos cambian con Meet. Si el bot entra pero no lee, corré con `MEET_DEBUG=true` y ajustá `src/meet/dom.ts` y `src/meet/prejoin.ts`. No hace falta tocar el resto.

## Seguridad

- El token de Airtable es de lectura. El proceso no escribe en Airtable.
- El chat público, en `counts`, solo dice cantidades y cortes (seniority, inglés, base). En `names` suma nombre, seniority, puesto, área, años y skills, y solo de quien tiene la cláusula de datos.
- Aunque el modelo se equivoque, antes de publicar se borran mails, teléfonos, links, montos y asignaciones del estilo `password: …`.
- El panel escucha en localhost. No lo publiques a internet. Si cambiás el host, definí `PANEL_TOKEN`.
- Entrá solo a reuniones donde te hayan pasado el link y donde las personas sepan que hay un asistente tomando notas.

## Limitaciones

- Los selectores de Meet son frágiles. Una actualización de la interfaz puede dejar ciego el chat o los subtítulos sin romper el ingreso.
- Automatizar el cliente de Meet está en una zona gris de los términos de Google. Esto no esquiva controles, no resuelve captchas y no entra si el anfitrión no admite. Revisá los términos con el equipo antes de usarlo seguido.
- El headless suele chocar con el login de Google y a veces con la sala. En la VM, Xvfb más ventana real es el camino que anda.
- La transcripción por audio no sabe nombres por sí sola: los toma de los subtítulos de Meet. Ver [docs/etapa2-audio.md](docs/etapa2-audio.md).
- El sync es completo, no incremental. Las dos bases juntas son unos 50 mil registros: con la pausa de 220 ms son varios minutos.
- `java` no cuenta como `javascript`, y `react` no cuenta como `react native`. Un término sí abarca una frase que lo contiene como palabra (`spring` encuentra `spring boot`).
- Los conteos chicos pueden alcanzar para identificar a alguien. El modo `counts` no lo evita del todo.
- El panel de sugerencias no genera nada todavía.

## Roadmap

**Etapa 2. Audio y transcripción de verdad. Hecha.** El audio remoto se toma dentro de la página (sin PulseAudio), se corta en frases y se transcribe con xAI o con faster-whisper local. Los subtítulos quedan como pista de hablante y respaldo. Ver [docs/etapa2-audio.md](docs/etapa2-audio.md).

**Etapa 3. Sugerencias proactivas.** Con la transcripción, proponer en el panel privado búsquedas o datos útiles para Mara. Ese canal no escribe en el chat de Meet. El chat sigue siendo solo bajo demanda.

**Etapa 4. Voz.** Hablar en la reunión con un pipeline de voz (Pipecat o LiveKit), recién cuando el aviso y la admisión del anfitrión ya estén aceitados. Recién ahí se evaluaría prender el micrófono, y solo para la voz del asistente.

## Desarrollo

```bash
npm test
npm run typecheck
```

Los tests cubren el parser de menciones, el mapeo y la consulta del cache con datos ficticios, el cliente de Airtable con fetch simulado, la redacción de la respuesta y el ciclo de la reunión con un Meet falso. No abren una reunión real.

Comandos:

```bash
npm run login
npm run sync
npm run ask -- "cuántos go hay"
npm run serve
npm run join -- https://meet.google.com/abc-defg-hij
npm run test:audio -- --provider xai   # prueba de audio punta a punta, sin Meet
```

Layout: `src/meet` entra a la sala, `src/chat` decide si le hablaron, `src/llm` llama al modelo, `src/airtable` y `src/query` son el cache, `src/audio` corta y transcribe el audio, `src/panel` es el canal privado y `src/runtime/meeting.ts` une todo.
