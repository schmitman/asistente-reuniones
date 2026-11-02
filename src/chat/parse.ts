import { normalizeText } from '../query/normalize.js';

const GREETING =
  /^(?:hola|hey|buenas(?:\s+d[ií]as)?|buen\s+d[ií]a|buenos\s+d[ií]as|ey|ok|dale)[\s,!:;\-]+/i;

const TRIGGER = /^(?:@\s*)?asistente\b(?:\s+ia\b(?:\s+de\s+mara\b)?)?/i;

export interface ParsedCommand {
  addressed: boolean;
  question: string;
}

export function parseAddressedCommand(raw: string): ParsedCommand {
  const text = raw.replace(/\u00a0/g, ' ').replace(GREETING, '').trim();
  const match = TRIGGER.exec(text);
  if (!match) return { addressed: false, question: '' };
  const question = text
    .slice(match[0].length)
    .trim()
    .replace(/^[,:;\-–—]+\s*/, '')
    .trim();
  return { addressed: true, question };
}

export function isOwnSender(sender: string, displayName: string): boolean {
  const name = normalizeText(sender);
  if (!name) return false;
  const bot = normalizeText(displayName);
  if (bot && name === bot) return true;
  return name.includes('asistente ia');
}
