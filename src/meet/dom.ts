import type { DomCaption, DomChatMessage } from './controller.js';

export function scrapeChatInPage(): DomChatMessage[] {
  const clean = (value: string | null | undefined): string => (value || '').replace(/\s+/g, ' ').trim();
  const textOf = (element: Element | null): string => clean(element?.textContent);
  const out: DomChatMessage[] = [];
  const seen = new Set<string>();
  const push = (id: string, sender: string, message: string) => {
    const text = clean(message).replace(/\s*(?:keep)?\s*(?:Fijar mensaje|Pin message)$/i, '').trim();
    if (!text) return;
    const key = id || `${sender}|${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: key, sender: clean(sender), text });
  };

  document.querySelectorAll('[data-message-id]').forEach((element) => {
    const id = element.getAttribute('data-message-id') || '';
    const sender =
      element.getAttribute('data-sender-name') ||
      textOf(element.querySelector('[data-sender-name], [data-self-name]'));
    const message =
      element.getAttribute('data-message-text') ||
      textOf(element.querySelector('[data-message-text]')) ||
      textOf(element);
    push(id, sender, message);
  });
  if (out.length > 0) return out;

  const region =
    document.querySelector('[data-panel-id="chat"]') ||
    document.querySelector('[aria-label="Chat"]') ||
    document.querySelector('[aria-label*="chat con" i]') ||
    document.querySelector('[aria-label*="Chat"]');
  if (!region) return out;
  region.querySelectorAll('[role="listitem"]').forEach((element, index) => {
    const sender = textOf(element.querySelector('[data-sender-name]'));
    const message = textOf(element.querySelector('[data-message-text]'));
    push(`fallback-${index}-${sender}`, sender, message || textOf(element));
  });
  return out;
}

export function scrapeCaptionInPage(): DomCaption | null {
  const clean = (value: string | null | undefined): string => (value || '').replace(/\s+/g, ' ').trim();
  const root =
    document.querySelector('.a4cQT') ||
    document.querySelector('[jsname="dsyhDe"]') ||
    document.querySelector('[aria-label*="subtítulo" i]') ||
    document.querySelector('[aria-label*="caption" i]');
  if (!root) return null;
  const speaker = clean(root.querySelector('.zs7s8d, [jsname="ysCPFe"]')?.textContent);
  let text = clean(root.querySelector('.iOzk7, [jsname="tgaKEf"]')?.textContent);
  if (!text) {
    text = clean(root.textContent);
    if (speaker && text.toLowerCase().startsWith(speaker.toLowerCase())) {
      text = clean(text.slice(speaker.length));
    }
  }
  if (!text) return null;
  return { speaker: speaker || 'Desconocido', text };
}
