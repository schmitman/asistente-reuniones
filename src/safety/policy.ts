import { normalizeText } from '../query/normalize.js';

const ALWAYS_SENSITIVE =
  /\b(salario|sueldo|remuneracion|compensacion|password|contrasena|dni|cuil|cuit|telefono|celular|whatsapp)\b/;

export function refusesSensitiveAsk(question: string): boolean {
  const text = normalizeText(question);
  if (ALWAYS_SENSITIVE.test(text)) return true;
  const asksToHandOver = /\b(pasame|pasa|dame|decime|comparti|mandame|enviame|cual es)\b/.test(text);
  const contactNoun = /\b(mail|correo|linkedin|cv|curriculum|direccion)\b/.test(text);
  if (asksToHandOver && contactNoun) return true;
  if (/\b(mail|correo|linkedin|cv|curriculum)\s+de\b/.test(text)) return true;
  return false;
}

export const SENSITIVE_REFUSAL =
  'Por el chat de la reunión no paso mails, teléfonos, salarios, documentos ni links. Puedo decirte cantidades o, si está habilitado, nombre y perfil.';
