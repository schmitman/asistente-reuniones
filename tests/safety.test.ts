import { describe, expect, it } from 'vitest';
import { refusesSensitiveAsk, SENSITIVE_REFUSAL } from '../src/safety/policy.js';
import { redactPublicText, sanitizeOutgoing } from '../src/safety/redact.js';
import { buttonWantsDeviceOff, chooseJoinButton, isMediaToggle, joinButtonRank } from '../src/meet/prejoin.js';
import { parseMeetUrl } from '../src/meet/url.js';
import { scrapeChatInPage } from '../src/meet/dom.js';

describe('datos sensibles', () => {
  it('se niega a pasar contacto o compensación y no a una búsqueda de skills', () => {
    expect(refusesSensitiveAsk('pasame el mail de Ana')).toBe(true);
    expect(refusesSensitiveAsk('cuál es el teléfono de Teo')).toBe(true);
    expect(refusesSensitiveAsk('cuántos tienen salario en usd')).toBe(true);
    expect(refusesSensitiveAsk('cuántos java senior hay')).toBe(false);
    expect(SENSITIVE_REFUSAL).toMatch(/no paso mails/i);
  });

  it('borra mails, teléfonos y links de una respuesta', () => {
    const clean = sanitizeOutgoing(
      'Escribile a ada@secreto.com o al +54 11 5555 4444. CV: https://files.example/cv.pdf y cobra USD 4000.',
      480,
    );
    expect(clean).not.toMatch(/ada@secreto.com|5555|https:\/\/|4000/);
    expect(clean).toMatch(/email oculto|teléfono oculto|link oculto|compensación oculta/);
    expect(redactPublicText('password: hunter2')).toContain('[dato oculto]');
  });
});

describe('prejoin de Meet', () => {
  it('apaga micrófono y cámara solo si están prendidos', () => {
    expect(buttonWantsDeviceOff('Desactivar micrófono (Ctrl + D)')).toBe(true);
    expect(buttonWantsDeviceOff('Turn off camera')).toBe(true);
    expect(buttonWantsDeviceOff('Activar micrófono')).toBe(false);
    expect(buttonWantsDeviceOff('Turn on microphone')).toBe(false);
    expect(isMediaToggle('Desactivar cámara')).toBe(true);
    expect(isMediaToggle('Pedir unirse')).toBe(false);
  });

  it('prefiere pedir unirse antes que entrar directo', () => {
    expect(joinButtonRank('Pedir unirse')).toBeLessThan(joinButtonRank('Unirse ahora'));
    const index = chooseJoinButton(['Chat', 'Unirse ahora', 'Pedir unirse']);
    expect(index).toBe(2);
  });

  it('solo acepta links de Meet', () => {
    expect(parseMeetUrl('https://meet.google.com/abc-defg-hij?authuser=0')).toBe(
      'https://meet.google.com/abc-defg-hij',
    );
    expect(parseMeetUrl('https://meet.google.com/ABC-DEFG-HIJ')).toBe('https://meet.google.com/abc-defg-hij');
    expect(parseMeetUrl('http://meet.google.com/abc-defg-hij')).toBeNull();
    expect(parseMeetUrl('https://evil.com/abc-defg-hij')).toBeNull();
    expect(parseMeetUrl('javascript:alert(1)')).toBeNull();
  });

  it('el lector del DOM no depende de módulos de Node', () => {
    const source = scrapeChatInPage.toString();
    expect(source).not.toContain('require');
    expect(source).not.toContain('import');
    expect(source).not.toContain('__name');
  });
});
