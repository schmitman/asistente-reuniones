/** Limpieza de texto que Meet mete en el DOM (íconos, ayudas). Pura y testeable. */

const CHAT_NOISE = [
  /\s*(?:keep|push_pin)?\s*(?:Fijar mensaje|Pin message)\s*$/i,
  /\s*Coloca el cursor sobre un mensaje para fijarlo\.?\s*(?:keep|push_pin)?/gi,
  /\s*Hover over a message to pin it\.?\s*(?:keep|push_pin)?/gi,
];

export function cleanChatText(text: string): string {
  let out = text.replace(/\s+/g, ' ');
  for (const pattern of CHAT_NOISE) out = out.replace(pattern, ' ');
  return out.replace(/\s+/g, ' ').trim();
}

/** Nombres de íconos de Material que aparecen como texto alrededor de los subtítulos. */
const CAPTION_ICON_WORDS =
  /\b(?:translate_cc|closed_caption(?:_off)?|arrow_downward|more_vert|settings|language|format_size)\b/gi;

export function cleanCaptionText(text: string): string {
  return text.replace(CAPTION_ICON_WORDS, ' ').replace(/\s+/g, ' ').trim();
}

export function isCaptionNoise(speaker: string, text: string): boolean {
  const cleaned = cleanCaptionText(text);
  if (!cleaned) return true;
  if (/^(?:translate_cc|closed_caption)/i.test(speaker.trim())) return true;
  return false;
}
