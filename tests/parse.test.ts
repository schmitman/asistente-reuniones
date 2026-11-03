import { describe, expect, it } from 'vitest';
import { isOwnSender, parseAddressedCommand } from '../src/chat/parse.js';

describe('parseAddressedCommand', () => {
  it('reconoce @asistente al principio y se queda con la pregunta', () => {
    expect(parseAddressedCommand('@asistente cuántos java senior hay')).toEqual({
      addressed: true,
      question: 'cuántos java senior hay',
    });
    expect(parseAddressedCommand('@Asistente, buscame react')).toEqual({
      addressed: true,
      question: 'buscame react',
    });
    expect(parseAddressedCommand('  @asistente ia de mara cuantos node')).toEqual({
      addressed: true,
      question: 'cuantos node',
    });
  });

  it('reconoce asistente con coma, dos puntos o saludo', () => {
    expect(parseAddressedCommand('asistente, cuantos python')).toEqual({
      addressed: true,
      question: 'cuantos python',
    });
    expect(parseAddressedCommand('asistente: hay gente con ingles avanzado?')).toEqual({
      addressed: true,
      question: 'hay gente con ingles avanzado?',
    });
    expect(parseAddressedCommand('Hola asistente, hay seniors?')).toEqual({
      addressed: true,
      question: 'hay seniors?',
    });
    expect(parseAddressedCommand('@asistente')).toEqual({ addressed: true, question: '' });
  });

  it('ignora mensajes que no le hablan', () => {
    expect(parseAddressedCommand('el asistente de mara es útil').addressed).toBe(false);
    expect(parseAddressedCommand('asistencia técnica').addressed).toBe(false);
    expect(parseAddressedCommand('asistentes, vengan').addressed).toBe(false);
    expect(parseAddressedCommand('hola a todos').addressed).toBe(false);
    expect(parseAddressedCommand('después el asistente mira la base').addressed).toBe(false);
  });
});

describe('isOwnSender', () => {
  it('no se responde a sí mismo', () => {
    expect(isOwnSender('Asistente IA de Mara', 'Asistente IA de Mara')).toBe(true);
    expect(isOwnSender('asistente ia', 'Asistente IA de Mara')).toBe(true);
    expect(isOwnSender('Ana Pérez', 'Asistente IA de Mara')).toBe(false);
    expect(isOwnSender('', 'Asistente IA de Mara')).toBe(false);
  });
});
