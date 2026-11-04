/**
 * Script que se inyecta en la página de Meet ANTES de que cargue (addInitScript).
 * Envuelve RTCPeerConnection: cada pista de audio remota (las voces de los demás)
 * se mezcla en un AudioContext, se baja a 16 kHz mono PCM16 y se manda a Node
 * cada ~0,5 s por la binding `__asistenteAudioChunk`. El micrófono del bot no entra.
 *
 * Está escrito como string JS plano para que el transpilador no le agregue helpers.
 */
export const AUDIO_BINDING = '__asistenteAudioChunk';

export const AUDIO_HOOK_SCRIPT = String.raw`
(() => {
  if (window.__asistenteAudioHooked) return;
  window.__asistenteAudioHooked = true;
  const Orig = window.RTCPeerConnection;
  if (!Orig) return;
  const TARGET = 16000;
  const FLUSH = 8000; // 0,5 s a 16 kHz
  const tracks = new Map();
  let ctx = null, mix = null, proc = null;
  let out = new Int16Array(FLUSH * 2), outLen = 0, carry = 0;
  const state = { tracks: 0, chunks: 0, error: null };
  window.__asistenteAudioState = state;

  function send() {
    if (!outLen) return;
    const bytes = new Uint8Array(out.buffer, 0, outLen * 2);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    outLen = 0;
    state.chunks += 1;
    const fn = window.__asistenteAudioChunk;
    if (typeof fn === 'function') fn({ pcm: btoa(bin), tracks: tracks.size }).catch(() => {});
  }

  function ensure() {
    if (ctx) return;
    ctx = new AudioContext();
    mix = ctx.createGain();
    proc = ctx.createScriptProcessor(4096, 1, 1);
    const silent = ctx.createGain();
    silent.gain.value = 0;
    mix.connect(proc);
    proc.connect(silent);
    silent.connect(ctx.destination);
    const ratio = ctx.sampleRate / TARGET;
    proc.onaudioprocess = (event) => {
      if (!tracks.size) return;
      const input = event.inputBuffer.getChannelData(0);
      // Promedio por ventana: filtro pasa-bajos barato + diezmado.
      let pos = carry;
      while (pos + ratio <= input.length) {
        const from = Math.floor(pos), to = Math.floor(pos + ratio);
        let sum = 0;
        for (let i = from; i < to; i++) sum += input[i];
        let v = sum / Math.max(1, to - from);
        v = v > 1 ? 1 : v < -1 ? -1 : v;
        if (outLen >= out.length) send();
        out[outLen++] = v * 32767;
        pos += ratio;
      }
      carry = pos - input.length;
      if (outLen >= FLUSH) send();
    };
    setInterval(() => { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }, 2000);
  }

  function addTrack(track) {
    if (!track || track.kind !== 'audio' || tracks.has(track.id)) return;
    try {
      ensure();
      const stream = new MediaStream([track]);
      // Chrome necesita que la pista remota esté enganchada a un elemento para que fluya a WebAudio.
      const el = new Audio();
      el.muted = true;
      el.srcObject = stream;
      el.play().catch(() => {});
      const src = ctx.createMediaStreamSource(stream);
      src.connect(mix);
      tracks.set(track.id, { src, el });
      state.tracks = tracks.size;
      track.addEventListener('ended', () => {
        try { src.disconnect(); } catch (_) {}
        el.srcObject = null;
        tracks.delete(track.id);
        state.tracks = tracks.size;
      });
    } catch (error) {
      state.error = String(error && error.message || error);
    }
  }

  function Wrapped(...args) {
    const pc = new Orig(...args);
    pc.addEventListener('track', (event) => addTrack(event.track));
    return pc;
  }
  Wrapped.prototype = Orig.prototype;
  Object.setPrototypeOf(Wrapped, Orig);
  window.RTCPeerConnection = Wrapped;
  if (window.webkitRTCPeerConnection) window.webkitRTCPeerConnection = Wrapped;
})();
`;
