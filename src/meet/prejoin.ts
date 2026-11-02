const JOIN_PRIORITY = [
  'pedir unirse',
  'ask to join',
  'solicitar unirse',
  'request to join',
  'unirse ahora',
  'join now',
];

export function buttonWantsDeviceOff(ariaLabel: string | null | undefined): boolean {
  if (!ariaLabel) return false;
  const label = ariaLabel.toLowerCase();
  // "desactivar" contiene "activar" y "unmute" contiene "mute": hay que mirar la palabra entera.
  if (/\b(unmute|turn on)\b/.test(label) || /(^|[^a-z])activar/.test(label) || /\bencender\b/.test(label)) {
    return false;
  }
  return /desactivar|turn off|\bmute\b|silenciar/.test(label);
}

export function isMediaToggle(label: string): boolean {
  return /micr[oó]fono|microphone|c[aá]mara|camera/i.test(label);
}

export function joinButtonRank(label: string): number {
  const text = label.trim().toLowerCase().replace(/\s+/g, ' ');
  const index = JOIN_PRIORITY.findIndex((item) => text.includes(item));
  if (index >= 0) return index;
  if (text === 'unirse' || text === 'join') return JOIN_PRIORITY.length;
  return -1;
}

export function chooseJoinButton(labels: string[]): number {
  let bestRank = Number.POSITIVE_INFINITY;
  let bestIndex = -1;
  labels.forEach((label, index) => {
    const rank = joinButtonRank(label);
    if (rank >= 0 && rank < bestRank) {
      bestRank = rank;
      bestIndex = index;
    }
  });
  return bestIndex;
}

export function captionsAlreadyOn(label: string): boolean {
  return /(desactivar subt[ií]tulos|turn off captions|ocultar subt[ií]tulos|hide captions)/i.test(label);
}

export function captionsButtonRank(label: string): number {
  const text = label.toLowerCase();
  if (captionsAlreadyOn(text)) return -1;
  if (/(activar subt[ií]tulos|turn on captions)/i.test(text)) return 0;
  if (/(subt[ií]tulos|captions)/i.test(text)) return 1;
  return -1;
}
