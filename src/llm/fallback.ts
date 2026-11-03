import type { DatabaseSync } from 'node:sqlite';
import type { ChatDetailLevel } from '../config.js';
import type { BaseKey, CandidateFilter } from '../query/candidates.js';
import { countCandidates, searchCandidates } from '../query/candidates.js';
import { canonicalSkill, englishLabel, normalizeText } from '../query/normalize.js';

const STOP = new Set([
  'cuantos',
  'cuantas',
  'cuanto',
  'cuanta',
  'hay',
  'candidato',
  'candidatos',
  'candidata',
  'candidatas',
  'perfil',
  'perfiles',
  'gente',
  'persona',
  'personas',
  'con',
  'de',
  'del',
  'en',
  'la',
  'el',
  'los',
  'las',
  'un',
  'una',
  'para',
  'que',
  'tengan',
  'tenga',
  'sepa',
  'sepan',
  'manejen',
  'maneja',
  'saber',
  'base',
  'general',
  'historica',
  'historico',
  'historicos',
  'ingles',
  'english',
  'nivel',
  'seniority',
  'buscame',
  'busca',
  'buscar',
  'decime',
  'tenes',
  'tienen',
  'tenemos',
  'sobre',
  'algun',
  'alguna',
  'algo',
  'me',
  'te',
  'por',
  'favor',
  'reunion',
  'chat',
  'asistente',
  'ia',
  'mara',
  'anos',
  'experiencia',
  'y',
  'o',
  'and',
  'or',
  'the',
  'a',
  'como',
  'estan',
  'esta',
]);

const PHRASES = ['react native', 'machine learning', 'spring boot', 'ruby on rails', 'power bi', 'ci/cd', 'ux/ui'];

export function filtersFromQuestion(question: string): CandidateFilter {
  const text = normalizeText(question);
  let bases: BaseKey[] = ['general'];
  if (/histor/.test(text) && /general/.test(text)) bases = ['general', 'historico'];
  else if (/histor/.test(text)) bases = ['historico'];

  const seniority: string[] = [];
  if (/semi\s*senior\s*\+|semisr\+/.test(text)) seniority.push('semi-senior-plus');
  else if (/semi\s*senior|semisr|\bssr\b/.test(text)) seniority.push('semi-senior');
  if (/\b(senior|sr)\b/.test(text) && !/semi/.test(text)) seniority.push('senior');
  if (/\b(junior|jr)\b/.test(text)) seniority.push('junior');
  if (/\blead\b/.test(text)) seniority.push('lead');
  if (/\bmanager\b/.test(text)) seniority.push('manager');
  if (/\barquitecto\b/.test(text)) seniority.push('architect');

  let minEnglish: string | undefined;
  if (/bilingue|nativo|\bc2\b/.test(text)) minEnglish = 'bilingual';
  else if (/avanzado|advanced|\bc1\b/.test(text)) minEnglish = 'advanced';
  else if (/intermedio alto|upper|\bb2\b/.test(text)) minEnglish = 'upper';
  else if (/intermedio|intermediate|\bb1\b/.test(text)) minEnglish = 'intermediate';
  else if (/(basico|basic)/.test(text) && /ingles|english/.test(text)) minEnglish = 'basic';

  const years = text.match(/(\d{1,2})\s*anos/);
  const skills: string[] = [];
  let rest = text;
  for (const phrase of PHRASES) {
    if (!rest.includes(phrase)) continue;
    skills.push(phrase);
    rest = rest.replaceAll(phrase, ' ');
  }
  for (const token of rest.split(' ')) {
    if (!token || STOP.has(token) || seniorityWord(token) || englishWord(token)) continue;
    const skill = canonicalSkill(token);
    if (!skill || STOP.has(skill)) continue;
    skills.push(skill);
  }

  return {
    bases,
    skills: [...new Set(skills)],
    seniority,
    minEnglish,
    minYears: years ? Number(years[1]) : undefined,
  };
}

function seniorityWord(token: string): boolean {
  return /^(senior|sr|junior|jr|semisr|ssr|lead|manager|arquitecto)$/.test(token);
}

function englishWord(token: string): boolean {
  return /^(ingles|english|basico|basic|intermedio|avanzado|bilingue|nativo|advanced|intermediate|upper)$/.test(token);
}

export function answerFromCache(
  question: string,
  db: DatabaseSync,
  detail: ChatDetailLevel,
  maxNames: number,
  requireDataClause: boolean,
): string {
  const filter = filtersFromQuestion(question);
  if ((filter.skills?.length ?? 0) === 0 && (filter.seniority?.length ?? 0) === 0 && !filter.minEnglish) {
    return 'Decime el skill, el seniority o el inglés y lo busco en la base. Por ejemplo: cuántos Java senior hay.';
  }
  const count = countCandidates(db, filter);
  const baseLabel = (filter.bases ?? ['general']).map(baseName).join(' y ');
  if (count.total === 0) {
    return `No encontré perfiles con ese criterio en ${baseLabel}. Si querés, puedo mirar la otra base.`;
  }
  const bits = [`Hay ${count.total} ${count.total === 1 ? 'perfil' : 'perfiles'} en ${baseLabel}.`];
  const seniority = Object.entries(count.bySeniority)
    .filter(([key]) => key !== 'sin dato')
    .slice(0, 3)
    .map(([key, value]) => `${key} ${value}`);
  if (seniority.length > 0) bits.push(`Seniority: ${seniority.join(', ')}.`);
  const english = Object.entries(count.byEnglish)
    .filter(([key]) => key !== 'sin dato' && key !== englishLabel('none'))
    .slice(0, 3)
    .map(([key, value]) => `${key} ${value}`);
  if (english.length > 0) bits.push(`Inglés: ${english.join(', ')}.`);
  if (detail === 'names') {
    const rows = searchCandidates(db, { ...filter, requireDataShare: requireDataClause }, maxNames);
    if (rows.length === 0) {
      bits.push('Hay coincidencias, pero ninguna tiene la cláusula de datos como para nombrarla en la reunión.');
    } else {
      const names = rows.map((row) => {
        const role = [row.seniority, row.position].filter(Boolean).join(', ');
        return role ? `${row.name} (${role})` : row.name;
      });
      bits.push(`Puedo nombrar: ${names.join('; ')}.`);
    }
  }
  return bits.join(' ');
}

function baseName(base: BaseKey): string {
  return base === 'historico' ? 'la base 2020-2021' : 'la base general';
}
