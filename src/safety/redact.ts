const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL = /\b(?:https?:\/\/|www\.)\S+/gi;
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}\b/g;
const SECRET_ASSIGN =
  /\b(?:password|passwd|contrase[nñ]a|credential|secret|api[_ -]?key|token)\b\s*[:=]\s*\S+/gi;
const MONEY = /(?:(?:usd|u\$d|ars|ar\$)\s*)?\$\s?\d[\d.]*(?:,\d+)?|\b(?:usd|u\$d|ars)\s?\d[\d.]*/gi;

export function looksSensitive(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return true;
  if (/https?:\/\//i.test(text) || /\blinkedin\.com\b/i.test(text)) return true;
  if (/(password|contrase[nñ]a|credential|secret|api[_ -]?key)/i.test(text)) return true;
  const compact = text.replace(/\s/g, '');
  const digits = compact.replace(/\D/g, '');
  if (digits.length >= 8 && digits.length / Math.max(compact.length, 1) > 0.6) return true;
  return false;
}

export function redactPublicText(text: string): string {
  return text
    .replace(SECRET_ASSIGN, '[dato oculto]')
    .replace(EMAIL, '[email oculto]')
    .replace(URL, '[link oculto]')
    .replace(MONEY, '[compensación oculta]')
    .replace(PHONE, (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 8 ? '[teléfono oculto]' : match;
    });
}

export function sanitizeOutgoing(text: string, maxChars: number): string {
  const collapsed = redactPublicText(text).replace(/\s+/g, ' ').trim();
  const safe = collapsed || 'No pude armar una respuesta con lo que tengo en la base.';
  if (safe.length <= maxChars) return safe;
  const cut = safe.slice(0, Math.max(0, maxChars - 1));
  const sentence = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  const trimmed = (sentence > 80 ? cut.slice(0, sentence + 1) : cut).trim();
  return `${trimmed}…`;
}
