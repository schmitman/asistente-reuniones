/** Lógica pura para armar turnos con hablante a partir de la respuesta de STT. */

export interface SttWord {
  text: string;
  start: number;
  end: number;
  speaker?: number;
}

export interface SttResult {
  text: string;
  language?: string;
  words: SttWord[];
}

export interface Turn {
  /** Índice de hablante dentro del tramo (diarización), o null si no hay. */
  speaker: number | null;
  text: string;
  /** Segundos desde el inicio del tramo. */
  start: number;
  end: number;
}

export interface SpeakerHint {
  /** Epoch ms en que se vio el nombre (subtítulos de Meet). */
  at: number;
  name: string;
}

export function wordsToTurns(result: SttResult): Turn[] {
  const words = result.words.filter((word) => word.text.trim());
  if (!words.length) {
    const text = result.text.trim();
    return text ? [{ speaker: null, text, start: 0, end: 0 }] : [];
  }
  const turns: Turn[] = [];
  for (const word of words) {
    const speaker = typeof word.speaker === 'number' ? word.speaker : null;
    const last = turns[turns.length - 1];
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${word.text.trim()}`;
      last.end = word.end;
    } else {
      turns.push({ speaker, text: word.text.trim(), start: word.start, end: word.end });
    }
  }
  return turns;
}

/** Nombres de los subtítulos vistos en la ventana, en orden de aparición, sin repetir. */
export function hintNames(hints: SpeakerHint[], fromMs: number, toMs: number): string[] {
  const names: string[] = [];
  for (const hint of [...hints].sort((a, b) => a.at - b.at)) {
    if (hint.at < fromMs || hint.at > toMs) continue;
    const name = hint.name.trim();
    if (!name || /^desconocido$/i.test(name) || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

/**
 * Pone nombre a cada turno. Si los subtítulos muestran tantos nombres como hablantes
 * detectó la diarización, los asocia por orden de aparición. Si no, usa
 * "Participante" (o "Participante 1/2…" dentro del tramo).
 */
export function labelTurns(turns: Turn[], names: string[]): Array<Turn & { label: string }> {
  const order: Array<number | null> = [];
  for (const turn of turns) if (!order.includes(turn.speaker)) order.push(turn.speaker);
  const mapped = new Map<number | null, string>();
  if (names.length > 0 && names.length === order.length) {
    order.forEach((speaker, index) => mapped.set(speaker, names[index] as string));
  } else if (order.length === 1) {
    mapped.set(order[0] ?? null, 'Participante');
  } else {
    order.forEach((speaker, index) => mapped.set(speaker, `Participante ${index + 1}`));
  }
  return turns.map((turn) => ({ ...turn, label: mapped.get(turn.speaker) ?? 'Participante' }));
}

/** Filtra alucinaciones típicas de Whisper en silencio. */
export function isLikelyHallucination(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (/^[\s.,!?¡¿…-]+$/.test(t)) return true;
  return [
    /subt[ií]tulos (realizados|por) /,
    /^gracias por ver( el v[ií]deo)?[.!]*$/,
    /^thanks? (you )?for watching[.!]*$/,
    /amara\.org/,
    /^¡?suscr[ií]bete/,
  ].some((pattern) => pattern.test(t));
}
