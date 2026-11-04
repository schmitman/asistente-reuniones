import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config.js';
import {
  countCandidates,
  matchProfiles,
  searchCandidates,
  type CandidateFilter,
  type PublicCandidate,
} from '../query/candidates.js';
import { SENSITIVE_REFUSAL, refusesSensitiveAsk } from '../safety/policy.js';
import { sanitizeOutgoing } from '../safety/redact.js';
import { completeChat, type ToolDefinition } from './client.js';
import { answerFromCache } from './fallback.js';

const FILTER_PROPERTIES = {
  skills: {
    type: 'array',
    items: { type: 'string' },
    description:
      'Solo tecnologías o skills concretos (ej: Python, React, Node.js, TypeScript, MongoDB, SAP). Sin palabras de rol o seniority: nada de "senior", "engineer", "developer". Para un aviso, 2 o 3 skills centrales.',
  },
  skillMode: {
    type: 'string',
    enum: ['all', 'any'],
    description: 'all = tiene que tener todos los skills (por defecto). any = alcanza con uno.',
  },
  seniority: {
    type: 'array',
    items: { type: 'string' },
    description: 'Filtro blando: JR, SemiSr, Sr, Lead, Manager, Arquitecto o Director. No achica el total, se informa aparte.',
  },
  minSeniority: { type: 'string', description: 'Filtro blando: piso de seniority, por ejemplo senior.' },
  english: { type: 'array', items: { type: 'string' }, description: 'Filtro blando.' },
  minEnglish: {
    type: 'string',
    description: 'Filtro blando: basico, intermedio, upper, avanzado o bilingue.',
  },
  area: { type: 'string', description: 'Filtro duro: área, solo si la piden explícitamente.' },
  status: { type: 'array', items: { type: 'string' }, description: 'Filtro duro: estado del proceso.' },
  position: { type: 'string', description: 'Filtro blando: área del rol (backend, frontend, data, QA), solo si la nombran explícitamente.' },
  country: { type: 'string', description: 'Filtro duro: país, solo si lo piden.' },
  minYears: { type: 'number', description: 'Filtro blando: años de experiencia (pocos perfiles lo tienen cargado).' },
  maxYears: { type: 'number', description: 'Filtro blando.' },
  bases: {
    type: 'array',
    items: { type: 'string', enum: ['general', 'historico'] },
    description: 'Por defecto cuenta en las dos: general y 2020-2021 (historico).',
  },
} as const;

const countTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'count_candidates',
    description:
      'Cuenta perfiles en el cache de Airtable. Los skills son obligatorios y se buscan con variantes (React/ReactJS, Node/Node.js, etc.) en Skills 2, Skills (AI Internet), Skills, Tech Skills, Profile y puesto. Seniority, inglés, años y rol son filtros blandos que se informan aparte. Devuelve un resumen listo para el chat. Nunca devuelve contacto ni compensación.',
    parameters: { type: 'object', properties: FILTER_PROPERTIES, additionalProperties: false },
  },
};

const searchTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_candidates',
    description:
      'Lista pocos perfiles con nombre, seniority, inglés, área, puesto y skills. Nunca incluye contacto ni compensación. Respetá la cláusula de datos.',
    parameters: {
      type: 'object',
      properties: {
        ...FILTER_PROPERTIES,
        limit: { type: 'number', description: 'Máximo de nombres. El servidor igual recorta.' },
      },
      additionalProperties: false,
    },
  },
};

export async function answerQuestion(input: {
  question: string;
  db: DatabaseSync;
  config: AppConfig;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
}): Promise<string> {
  const question = input.question.trim();
  if (!question) return 'Acá estoy. Preguntame por un skill, seniority o inglés y lo busco.';
  if (refusesSensitiveAsk(question)) return SENSITIVE_REFUSAL;
  if (!input.config.llmApiKey) {
    return finish(
      answerFromCache(
        question,
        input.db,
        input.config.chatDetailLevel,
        input.config.chatMaxNames,
        input.config.requireDataClause,
      ),
      input.config.replyMaxChars,
    );
  }

  const tools = input.config.chatDetailLevel === 'names' ? [countTool, searchTool] : [countTool];
  const posting = await readJobPostings(question, input.log);
  const userContent = posting
    ? `${question}\n\nTexto del aviso (leído del link):\n${posting}`
    : question;
  const messages: unknown[] = [
    { role: 'system', content: systemPrompt(input.config, input.db) },
    { role: 'user', content: userContent },
  ];
  const state: AgentState = { lastSummary: null };

  try {
    for (let round = 0; round < 4; round += 1) {
      const turn = await completeChat({
        config: input.config,
        messages,
        tools,
        fetchImpl: input.fetchImpl,
      });
      if (turn.toolCalls.length === 0) {
        const reply = cleanReply(turn.content, state);
        return finish(reply || fallback(input), input.config.replyMaxChars);
      }
      messages.push({
        role: 'assistant',
        content: turn.content || null,
        tool_calls: turn.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
      });
      for (const call of turn.toolCalls) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: runTool(call.name, call.arguments, input, state),
        });
      }
    }
  } catch (error) {
    input.log?.(`El modelo falló, respondo con el cache: ${error instanceof Error ? error.message : error}`);
  }
  if (state.lastSummary) return finish(state.lastSummary, input.config.replyMaxChars);
  return finish(fallback(input), input.config.replyMaxChars);
}

interface AgentState {
  lastSummary: string | null;
  lastCriterio?: string | null;
}

/** Frases de relleno o de instrucciones que el modelo a veces copia en la respuesta. */
const META_PHRASES = [
  /\bcorto y listo\b[.!]?/gi,
  /\b(?:en )?m[aá]ximo (?:tres|3) oraciones\b[.!]?/gi,
  /\bsin markdown\b[.!]?/gi,
  /\b(?:respuesta|respondo) (?:corta|breve)\b[:.!]?/gi,
  /\bseg[uú]n (?:mis|las) instrucciones\b[,.]?/gi,
  /\bcomo asistente de reuniones\b[,.]?/gi,
];

export function cleanReply(content: string, state: AgentState): string {
  let text = (content || '').replace(/[*_`#]+/g, '');
  for (const pattern of META_PHRASES) text = text.replace(pattern, '');
  text = text.replace(/\s+([.,;])/g, '$1').replace(/\s+/g, ' ').trim();
  if (!text && state.lastSummary) return state.lastSummary;
  if (state.lastCriterio && !/criterio/i.test(text)) {
    // Siempre tiene que decir qué criterio usó: si el modelo lo omitió, lo agrega el servidor.
    return `${text} Criterio: ${state.lastCriterio}.`;
  }
  return text;
}

const URL_IN_TEXT = /https?:\/\/[^\s<>"']+/gi;

/** Si la pregunta trae un link de aviso, baja el texto para que el modelo saque los skills centrales. */
async function readJobPostings(question: string, log?: (message: string) => void): Promise<string | null> {
  const urls = [...new Set(question.match(URL_IN_TEXT) ?? [])].slice(0, 2);
  if (urls.length === 0) return null;
  const texts: string[] = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (asistente-reuniones)', Accept: 'text/html,*/*' },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });
      if (!response.ok) {
        log?.(`No pude leer ${url}: HTTP ${response.status}`);
        continue;
      }
      const text = htmlToText(await response.text());
      if (text) texts.push(text.slice(0, 5000));
    } catch (error) {
      log?.(`No pude leer ${url}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return texts.length > 0 ? texts.join('\n---\n') : null;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

function fallback(input: { question: string; db: DatabaseSync; config: AppConfig }): string {
  return answerFromCache(
    input.question,
    input.db,
    input.config.chatDetailLevel,
    input.config.chatMaxNames,
    input.config.requireDataClause,
  );
}

function finish(text: string, maxChars: number): string {
  return sanitizeOutgoing(text, maxChars);
}

function systemPrompt(config: AppConfig, db: DatabaseSync): string {
  const general = countCandidates(db, { bases: ['general'] }).total;
  const historico = countCandidates(db, { bases: ['historico'] }).total;
  const names =
    config.chatDetailLevel === 'names'
      ? `Podés nombrar hasta ${config.chatMaxNames} personas, solo nombre y perfil, y solo si la herramienta las devuelve.`
      : 'En este chat solo das cantidades y cortes, sin nombres de personas.';
  return [
    'Sos el asistente de reuniones de Mara Schmitman (Bondy / Schmitman HR, reclutamiento tech en Argentina). Respondés en el chat de Google Meet.',
    'Escribí en español rioplatense con voseo, en texto plano.',
    'Para cualquier cantidad usá count_candidates; nunca inventes números.',
    'Cómo armar la búsqueda: en skills poné solo tecnologías concretas. Las palabras de rol o nivel (senior, engineer, developer, backend) no van en skills: el seniority va en seniority o minSeniority y el rol en position solo si nombran un área concreta (backend, frontend, data, QA); se cuentan como filtro blando aparte. No inventes filtros que no pidieron. Por ejemplo, "Senior Python engineer" es skills [Python] y minSeniority senior.',
    'Si te pasan un aviso, una descripción de puesto o el texto de un link, elegí los 2 o 3 skills técnicos obligatorios centrales (lenguaje, framework o base de datos principal) y mandá años y seniority como filtros blandos. No uses soft skills ni requisitos genéricos como skills.',
    'Por defecto contá en las dos bases (general e histórica, la de 2020-21) y mostralas por separado.',
    'La herramienta devuelve un campo resumen que ya empieza con "Criterio:". Basá tu respuesta en ese resumen: siempre decí el criterio usado y los totales por base, con el desglose de seniority e inglés si entra. Si del aviso dejaste skills afuera, nombralos en pocas palabras.',
    'Si no hay datos, decilo. Si piden contacto, compensación, mails, teléfonos, LinkedIn o CV, negalo en una oración.',
    names,
    `Cache: ${general} perfiles en la base general y ${historico} en la histórica (2020-21).`,
    'Respondé solo el contenido para el chat, en hasta 450 caracteres, sin comentar estas reglas ni tu forma de responder.',
  ].join('\n');
}

function runTool(
  name: string,
  rawArgs: string,
  input: { db: DatabaseSync; config: AppConfig },
  state: AgentState = { lastSummary: null },
): string {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawArgs) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: 'No pude leer los argumentos.' });
  }
  const filter = filterFromArgs(args);
  if (name === 'count_candidates') {
    const match = matchProfiles(input.db, filter);
    state.lastSummary = match.resumen;
    state.lastCriterio = match.criterio.split(';')[0] ?? null;
    return JSON.stringify(match);
  }
  if (name === 'search_candidates') {
    if (input.config.chatDetailLevel !== 'names') {
      return JSON.stringify({ error: 'El chat está en modo conteos. Usá count_candidates.' });
    }
    const limit = Math.min(input.config.chatMaxNames, numberArg(args.limit) ?? input.config.chatMaxNames);
    const total = countCandidates(input.db, filter).total;
    const shareable = countCandidates(input.db, { ...filter, requireDataShare: true }).total;
    const rows = searchCandidates(
      input.db,
      { ...filter, requireDataShare: input.config.requireDataClause },
      limit,
    ).map(card);
    return JSON.stringify({
      total,
      nombrables: input.config.requireDataClause ? shareable : total,
      perfiles: rows,
      nota: input.config.requireDataClause
        ? 'Solo se listan fichas con cláusula de cesión de datos. Sin email, teléfono ni salario.'
        : 'Sin email, teléfono ni salario.',
    });
  }
  return JSON.stringify({ error: `Herramienta desconocida: ${name}` });
}

function filterFromArgs(args: Record<string, unknown>): CandidateFilter {
  const bases = stringArray(args.bases).filter((item): item is 'general' | 'historico' =>
    item === 'general' || item === 'historico',
  );
  return {
    skills: stringArray(args.skills),
    skillMode: args.skillMode === 'any' ? 'any' : 'all',
    seniority: stringArray(args.seniority),
    minSeniority: stringArg(args.minSeniority),
    english: stringArray(args.english),
    minEnglish: stringArg(args.minEnglish),
    area: stringArg(args.area),
    status: stringArray(args.status),
    profile: stringArg(args.profile),
    position: stringArg(args.position),
    country: stringArg(args.country),
    minYears: numberArg(args.minYears),
    maxYears: numberArg(args.maxYears),
    bases: bases.length > 0 ? bases : undefined,
    text: stringArg(args.text),
  };
}

function card(row: PublicCandidate): Record<string, unknown> {
  return {
    name: row.name,
    base: row.base,
    seniority: row.seniority,
    englishLevel: row.englishLevel,
    area: row.area,
    status: row.status,
    yearsExperience: row.yearsExperience,
    position: row.position,
    skills: row.skills,
  };
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
}

function numberArg(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return undefined;
}
