import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config.js';
import { countCandidates, searchCandidates, type CandidateFilter, type PublicCandidate } from '../query/candidates.js';
import { SENSITIVE_REFUSAL, refusesSensitiveAsk } from '../safety/policy.js';
import { sanitizeOutgoing } from '../safety/redact.js';
import { completeChat, type ToolDefinition } from './client.js';
import { answerFromCache } from './fallback.js';

const FILTER_PROPERTIES = {
  skills: {
    type: 'array',
    items: { type: 'string' },
    description: 'Skills que tiene que cumplir la persona. Por defecto es AND.',
  },
  skillMode: { type: 'string', enum: ['all', 'any'] },
  seniority: {
    type: 'array',
    items: { type: 'string' },
    description: 'Valores como JR, SemiSr, Sr, Lead, Manager, Arquitecto o Director.',
  },
  minSeniority: { type: 'string', description: 'Piso de seniority, por ejemplo senior.' },
  english: { type: 'array', items: { type: 'string' } },
  minEnglish: {
    type: 'string',
    description: 'Piso: basico, intermedio, upper, avanzado o bilingue.',
  },
  area: { type: 'string' },
  status: { type: 'array', items: { type: 'string' } },
  profile: { type: 'string' },
  position: { type: 'string' },
  country: { type: 'string' },
  minYears: { type: 'number' },
  maxYears: { type: 'number' },
  bases: {
    type: 'array',
    items: { type: 'string', enum: ['general', 'historico'] },
    description: 'Si no se indica, se usa solo la base general. historico es 2020-2021.',
  },
  text: { type: 'string', description: 'Texto libre sobre puesto o perfil.' },
} as const;

const countTool: ToolDefinition = {
  type: 'function',
  function: {
    name: 'count_candidates',
    description:
      'Cuenta perfiles del cache local. No devuelve emails, teléfonos, salarios ni links. Separá la base general de la histórica.',
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
  const messages: unknown[] = [
    { role: 'system', content: systemPrompt(input.config, input.db) },
    { role: 'user', content: question },
  ];

  try {
    for (let round = 0; round < 4; round += 1) {
      const turn = await completeChat({
        config: input.config,
        messages,
        tools,
        fetchImpl: input.fetchImpl,
      });
      if (turn.toolCalls.length === 0) {
        return finish(turn.content || fallback(input), input.config.replyMaxChars);
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
          content: runTool(call.name, call.arguments, input),
        });
      }
    }
  } catch (error) {
    input.log?.(`El modelo falló, respondo con el cache: ${error instanceof Error ? error.message : error}`);
  }
  return finish(fallback(input), input.config.replyMaxChars);
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
      : 'En este chat solo podés dar cantidades y cortes. No nombres personas.';
  return [
    'Sos el asistente de reuniones de Mara Schmitman, de Bondy / Schmitman HR, reclutamiento tech en Argentina.',
    'Hablás español rioplatense, con voseo, en frases cortas para un chat de Meet.',
    'Usá las herramientas para cualquier número. Si no hay datos, decilo. No inventes cantidades.',
    names,
    'Nunca reveles email, teléfono, salario, dirección, DNI, LinkedIn, CV ni contraseñas.',
    'Si piden datos de contacto o compensación, negalo en una oración.',
    'Si no te dicen la base, usá solo la general. La histórica es 2020-2021 y se menciona aparte.',
    `Cache local: ${general} perfiles en la base general y ${historico} en la histórica.`,
    'No uses markdown. Máximo tres oraciones.',
  ].join(' ');
}

function runTool(name: string, rawArgs: string, input: { db: DatabaseSync; config: AppConfig }): string {
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawArgs) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) args = parsed as Record<string, unknown>;
  } catch {
    return JSON.stringify({ error: 'No pude leer los argumentos.' });
  }
  const filter = filterFromArgs(args);
  if (name === 'count_candidates') {
    return JSON.stringify(countCandidates(input.db, filter));
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
    bases: bases.length > 0 ? bases : ['general'],
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
