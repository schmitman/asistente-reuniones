# Etapa 2: audio y transcripción

El asistente ya no depende de los subtítulos de Meet. Escucha el audio que le llega de la reunión, lo corta en frases y lo transcribe. Los subtítulos quedan como pista de quién habla y como respaldo si el audio falla.

## Cómo funciona

```
Meet (Chromium del bot)
  └─ hook en la página (src/meet/audioHook.ts)
       RTCPeerConnection → cada pista de audio remota → AudioContext → mezcla
       → 16 kHz mono PCM16 → a Node cada 0,5 s (binding __asistenteAudioChunk)
Node
  ├─ SpeechSegmenter (src/audio/segmenter.ts): detecta voz por energía y corta tramos
  │    de 4 a 15 s, cortando en un silencio de 0,7 s
  ├─ STT (src/audio/stt.ts): xAI Grok Voice (/v1/stt, con diarización) o faster-whisper local
  ├─ hablantes (src/audio/speakers.ts): turnos por hablante + nombres de los subtítulos
  └─ transcript_lines con source = 'audio' (mismo store, panel y JSONL que antes)
```

- Solo entra el audio **de los demás**. El micrófono del bot sigue apagado y no se captura.
- No hace falta PulseAudio ni nada del sistema: el audio se toma dentro de la página, por eso anda igual en Xvfb, en la ventana visible o headless.
- Meet manda el audio en 3 pistas "virtuales" (las 3 voces más fuertes), no una por persona. Se mezclan las 3.
- Si el audio llega y la última transcripción salió bien, los subtítulos **no** se guardan (para no duplicar). Si el STT falla o no llega audio, se vuelve a guardar lo de los subtítulos, como en la etapa 1.
- Al salir se transcribe lo que quedaba pendiente.
- El bot ahora detecta si ya no está en la llamada (terminó o lo sacaron) y cierra la sesión sola, en vez de quedar "en la reunión" para siempre.
- Tampoco se da por admitido si está en la sala de espera ("Espera a que un anfitrión te agregue").

## Proveedores de transcripción

| `STT_PROVIDER` | Qué usa | Costo | Hablantes |
| --- | --- | --- | --- |
| `auto` (default) | xAI si hay `XAI_API_KEY`; si no, local si existe `.venv-stt`; si no, apagado | — | — |
| `xai` | `POST https://api.x.ai/v1/stt` (grok-voice-transcribe), misma clave que el chat | USD 0,10 por hora de audio (sólo se manda cuando hay voz) | sí, diarización por tramo |
| `local` | faster-whisper `small` int8 en CPU (`scripts/whisper_worker.py`) | gratis, sin red | no (sólo nombres de subtítulos) |
| `off` | nada, sólo subtítulos | — | — |

Medido en la máquina del bot (8 núcleos), con dos frases de ~7 s:

| | xAI | local (small) |
| --- | --- | --- |
| Tiempo de transcripción por tramo | 0,5 a 1,3 s | 1,5 a 2,7 s |
| Demora desde que terminás de hablar hasta que aparece | ~2 s | ~2,5 s |
| CPU | casi nada (Node < 2 % de un núcleo) | picos de ~3 núcleos durante 1-2 s por tramo; promedio ~0,5 núcleo hablando sin parar |
| RAM extra | ~0 | ~700 MB |

A eso sumale el largo del tramo: una frase entra recién cuando terminás (pausa de 0,7 s) o a los 15 s si seguís hablando. En la práctica, cada línea aparece entre 3 y 17 s después de que empezó.

## Quién habla

1. Con xAI, cada tramo viene con diarización (hablante 0, 1…). Los números **no** se mantienen entre tramos.
2. El bot prende los subtítulos en su propia vista (eso no lo ve nadie más) y anota qué nombre aparece en cada momento. Si en la ventana del tramo los subtítulos muestran tantos nombres como hablantes detectó la diarización, se asocian por orden. Ejemplo: "Mara" y "Germán".
3. Si no hay pista, queda "Participante" (o "Participante 1 / 2" dentro del mismo tramo).

## Configuración

Variables nuevas en `.env` (todas opcionales):

| Variable | Default | Para qué |
| --- | --- | --- |
| `STT_PROVIDER` | `auto` | `auto`, `xai`, `local`, `off` |
| `STT_API_KEY` | `XAI_API_KEY` | Clave para xAI si querés una distinta a la del chat |
| `STT_LANGUAGE` | vacío | `es` o `en` para sesgar; vacío autodetecta (mejor si mezclan idiomas) |
| `STT_DIARIZE` | `true` | Diarización en xAI |
| `STT_PYTHON` | `.venv-stt/bin/python` | Python con faster-whisper, para `local` |
| `STT_LOCAL_MODEL` | `small` | `base` (más rápido, peor), `small`, `medium` (lento en CPU) |
| `STT_MIN_SEGMENT_MS` / `STT_MAX_SEGMENT_MS` | 4000 / 15000 | Largo de los tramos |
| `STT_SPEECH_RMS` | `0.01` | Umbral de voz. Subilo si transcribe ruido de fondo |

### Instalar el modo local (opcional)

```bash
python3 -m venv .venv-stt
.venv-stt/bin/pip install faster-whisper
```

La primera vez baja el modelo (`small`, ~480 MB) de Hugging Face. No necesita GPU ni ffmpeg: el worker lee el WAV directo.

## Cómo probarlo

```bash
npm test                                   # lógica pura: WAV, segmentador, hablantes, STT simulado, runtime
npm run test:audio -- --provider xai       # punta a punta en Chromium, sin Meet
npm run test:audio -- --provider local
npm run test:audio -- --file mi-audio.mp3  # con un audio tuyo
```

`test:audio` abre Chromium con el mismo hook que en Meet, arma una llamada WebRTC local entre dos conexiones, reproduce dos frases en español (generadas con el TTS de xAI, voces distintas) como si fueran la voz remota, y las pasa por el mismo segmentador y STT. Deja el reporte en `logs/audio-e2e/report-<proveedor>.json`.

En una reunión real: entrá con el bot, hablá, y mirá el panel (`http://127.0.0.1:8787/`). Arriba de la transcripción dice el proveedor, cuántas pistas de audio tiene enganchadas (en Meet son 3), si está recibiendo, cuántos tramos transcribió y la demora. Las líneas de audio dicen `· audio`.

## Limitaciones

- Los nombres dependen de los subtítulos de Meet. Si Meet no los ofrece en esa reunión o el idioma de subtítulos no coincide, quedan "Participante".
- La diarización no sigue a la misma persona entre tramos: "Participante 1" de un tramo puede ser otra persona en el siguiente.
- Si dos personas hablan a la vez, sale mezclado.
- Con el modo local no hay diarización. Whisper a veces "alucina" frases en silencio; se filtran las típicas ("Subtítulos realizados por…", "Gracias por ver").
- Si la transcripción se atrasa (más de 6 tramos en cola), se descartan los más viejos para no quedar desfasado.
- El audio se manda a xAI cuando el proveedor es `xai`. Si una reunión no puede salir de la máquina, usá `STT_PROVIDER=local`.
- El hook envuelve `RTCPeerConnection`. Si Meet cambia cómo crea las conexiones, la captura podría dejar de ver pistas; el panel lo muestra como "0 pista(s)" y el bot vuelve solo a los subtítulos.
