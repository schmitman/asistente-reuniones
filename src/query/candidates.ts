import type { DatabaseSync } from 'node:sqlite';
import {
  canonicalizeEnglish,
  canonicalizeSeniority,
  englishLabel,
  likeEscape,
  normalizeText,
  seniorityLabel,
} from './normalize.js';
import { buildSkillQuery, displaySkill, tokenizeForMatch, type SkillQuery } from './skillMatch.js';

export type BaseKey = 'general' | 'historico';
export type SkillMode = 'all' | 'any';

export interface CandidateFilter {
  skills?: string[];
  skillMode?: SkillMode;
  seniority?: string[];
  minSeniority?: string;
  english?: string[];
  minEnglish?: string;
  area?: string;
  status?: string[];
  profile?: string;
  position?: string;
  country?: string;
  minYears?: number;
  maxYears?: number;
  bases?: BaseKey[];
  text?: string;
  requireDataShare?: boolean;
}

export interface CountResult {
  total: number;
  byBase: Record<string, number>;
  bySeniority: Record<string, number>;
  byEnglish: Record<string, number>;
  filters: CandidateFilter;
}

export interface PublicCandidate {
  name: string;
  base: BaseKey;
  seniority: string | null;
  englishLevel: string | null;
  area: string | null;
  status: string | null;
  yearsExperience: number | null;
  position: string | null;
  skills: string[];
  dataShareOk: boolean;
}

interface WhereClause {
  sql: string;
  params: Array<string | number>;
}

interface CandidateSqlRow {
  id: string;
  base_key: string;
  display_name: string;
  seniority: string | null;
  seniority_raw: string | null;
  english: string | null;
  area: string | null;
  status: string | null;
  years_experience: number | null;
  position_name: string | null;
  skills_preview: string;
  data_share_ok: number;
}

export function countCandidates(db: DatabaseSync, filter: CandidateFilter = {}): CountResult {
  const where = buildWhere(filter);
  const totalRow = db.prepare(`SELECT COUNT(*) AS n FROM candidates c WHERE ${where.sql}`).get(...where.params) as
    | { n: number }
    | undefined;
  return {
    total: Number(totalRow?.n ?? 0),
    byBase: grouped(db, 'base_key', where),
    bySeniority: grouped(db, "COALESCE(seniority, '')", where, (key) => seniorityLabel(key || null, null)),
    byEnglish: grouped(db, "COALESCE(english, '')", where, (key) => englishLabel(key || null) ?? ''),
    filters: publicFilter(filter),
  };
}

export function searchCandidates(
  db: DatabaseSync,
  filter: CandidateFilter = {},
  limit = 5,
): PublicCandidate[] {
  const where = buildWhere(filter);
  const capped = Math.min(15, Math.max(1, limit));
  const rows = db
    .prepare(
      `SELECT c.id, c.base_key, c.display_name, c.seniority, c.seniority_raw, c.english, c.area,
              c.status, c.years_experience, c.position_name, c.skills_preview, c.data_share_ok
       FROM candidates c
       WHERE ${where.sql}
       ORDER BY CASE c.base_key WHEN 'general' THEN 0 ELSE 1 END,
                COALESCE(c.seniority_rank, -1) DESC,
                c.display_name ASC
       LIMIT ?`,
    )
    .all(...where.params, capped) as unknown as CandidateSqlRow[];

  return rows.map((row) => ({
    name: row.display_name,
    base: row.base_key === 'historico' ? 'historico' : 'general',
    seniority: seniorityLabel(row.seniority, row.seniority_raw),
    englishLevel: englishLabel(row.english),
    area: row.area,
    status: row.status,
    yearsExperience: row.years_experience,
    position: row.position_name,
    skills: previewSkills(row.skills_preview),
    dataShareOk: row.data_share_ok === 1,
  }));
}

function grouped(
  db: DatabaseSync,
  expression: string,
  where: WhereClause,
  label: (key: string) => string | null = (key) => key,
): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT ${expression} AS key, COUNT(*) AS n
       FROM candidates c
       WHERE ${where.sql}
       GROUP BY ${expression}
       ORDER BY n DESC`,
    )
    .all(...where.params) as unknown as Array<{ key: string; n: number }>;
  const result: Record<string, number> = {};
  for (const row of rows) {
    const key = label(row.key || '') || 'sin dato';
    result[key] = (result[key] ?? 0) + Number(row.n);
  }
  return result;
}

function buildWhere(filter: CandidateFilter): WhereClause {
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  const bases = filter.bases && filter.bases.length > 0 ? filter.bases : (['general'] as BaseKey[]);
  clauses.push(`c.base_key IN (${bases.map(() => '?').join(', ')})`);
  params.push(...bases);

  const seniorities = unique(
    (filter.seniority ?? [])
      .map((value) => canonicalizeSeniority(value).key)
      .filter((value): value is string => Boolean(value)),
  );
  if (seniorities.length > 0) {
    clauses.push(`c.seniority IN (${seniorities.map(() => '?').join(', ')})`);
    params.push(...seniorities);
  }
  const minSeniority = canonicalizeSeniority(filter.minSeniority).rank;
  if (minSeniority != null) {
    clauses.push(`c.seniority_rank >= ?`);
    params.push(minSeniority);
  }

  const english = unique(
    (filter.english ?? [])
      .map((value) => canonicalizeEnglish(value).key)
      .filter((value): value is string => Boolean(value)),
  );
  if (english.length > 0) {
    clauses.push(`c.english IN (${english.map(() => '?').join(', ')})`);
    params.push(...english);
  }
  const minEnglish = canonicalizeEnglish(filter.minEnglish).rank;
  if (minEnglish != null) {
    clauses.push(`c.english_rank >= ?`);
    params.push(minEnglish);
  }

  pushContains(clauses, params, 'c.area_norm', filter.area);
  pushContains(clauses, params, 'c.profile_norm', filter.profile);
  pushContains(clauses, params, 'c.position_norm', filter.position);
  pushContains(clauses, params, 'c.country_norm', filter.country);
  pushContains(clauses, params, 'c.search_text', filter.text);

  const statuses = unique((filter.status ?? []).map((value) => normalizeText(value)).filter(Boolean));
  if (statuses.length > 0) {
    clauses.push(`c.status_norm IN (${statuses.map(() => '?').join(', ')})`);
    params.push(...statuses);
  }
  if (filter.minYears != null) {
    clauses.push(`c.years_experience IS NOT NULL AND c.years_experience >= ?`);
    params.push(filter.minYears);
  }
  if (filter.maxYears != null) {
    clauses.push(`c.years_experience IS NOT NULL AND c.years_experience <= ?`);
    params.push(filter.maxYears);
  }
  if (filter.requireDataShare) clauses.push(`c.data_share_ok = 1`);

  const skills = skillQueries(filter.skills ?? []);
  if (skills.length > 0) {
    const parts = skills.map((skill) => skillClause(skill, params));
    clauses.push(filter.skillMode === 'any' ? `(${parts.join(' OR ')})` : parts.join(' AND '));
  }

  return { sql: clauses.join(' AND '), params };
}

/** Skills limpios y sin repetir. "Senior Python engineer" queda como Python. */
export function skillQueries(values: string[]): SkillQuery[] {
  const seen = new Set<string>();
  const result: SkillQuery[] = [];
  for (const value of values) {
    const query = buildSkillQuery(value);
    if (!query || seen.has(query.canonical)) continue;
    seen.add(query.canonical);
    result.push(query);
  }
  return result;
}

/**
 * Un skill matchea si alguna variante aparece como palabra en Skills 2, Skills (AI Internet),
 * Skills, Profile o el puesto (skill_tags), o en Tech Skills (skill_text).
 * Las variantes cortas o ambiguas (go, ts, js, ui…) solo se buscan en los campos estructurados.
 */
function skillClause(skill: SkillQuery, params: Array<string | number>): string {
  const ors: string[] = [];
  for (const variant of skill.textVariants) {
    const pattern = `% ${likeEscape(variant)} %`;
    ors.push(`c.skill_tags LIKE ? ESCAPE '\\'`, `c.skill_text LIKE ? ESCAPE '\\'`);
    params.push(pattern, pattern);
  }
  for (const variant of skill.tagVariants) {
    ors.push(`c.skill_tags LIKE ? ESCAPE '\\'`);
    params.push(`% ${likeEscape(variant)} %`);
  }
  return ors.length > 0 ? `(${ors.join(' OR ')})` : '0';
}

function pushTokens(clauses: string[], params: Array<string | number>, value: string | undefined): void {
  const tokens = value ? tokenizeForMatch(value).trim() : '';
  if (!tokens) return;
  clauses.push(`(c.skill_tags LIKE ? ESCAPE '\\' OR c.search_text LIKE ? ESCAPE '\\')`);
  params.push(`% ${likeEscape(tokens)} %`, `%${likeEscape(normalizeText(value ?? ''))}%`);
}

function pushContains(
  clauses: string[],
  params: Array<string | number>,
  column: string,
  value: string | undefined,
): void {
  const normalized = value ? normalizeText(value) : '';
  if (!normalized) return;
  clauses.push(`${column} LIKE ? ESCAPE '\\'`);
  params.push(`%${likeEscape(normalized)}%`);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function previewSkills(preview: string): string[] {
  return preview
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function publicFilter(filter: CandidateFilter): CandidateFilter {
  return {
    bases: filter.bases && filter.bases.length > 0 ? filter.bases : ['general'],
    skills: filter.skills,
    skillMode: filter.skillMode ?? 'all',
    seniority: filter.seniority,
    minSeniority: filter.minSeniority,
    english: filter.english,
    minEnglish: filter.minEnglish,
    area: filter.area,
    status: filter.status,
    profile: filter.profile,
    position: filter.position,
    country: filter.country,
    minYears: filter.minYears,
    maxYears: filter.maxYears,
  };
}

/* ------------------------------------------------------------------------- */
/* Matching "estilo Airtable": skills obligatorios + filtros blandos.          */
/* ------------------------------------------------------------------------- */

export interface BaseMatch {
  base: BaseKey;
  baseName: string;
  /** Perfiles que tienen todos los skills obligatorios (más filtros duros como área o país). */
  total: number;
  bySeniority: Record<string, number>;
  byEnglish: Record<string, number>;
  /** Cuántos de esos además cumplen los filtros blandos (seniority, inglés, rol). */
  refined: number | null;
  /** Cuántos tienen cargados los años pedidos (el campo está vacío en la mayoría). */
  withYears: number | null;
}

export interface ProfileMatch {
  criterio: string;
  skills: string[];
  skillMode: SkillMode;
  softFilters: string[];
  yearsNote: string | null;
  bases: BaseMatch[];
  resumen: string;
}

// Ojo: "2020-2021" lo tapa el filtro de teléfonos, por eso se dice "histórica".
const BASE_NAMES: Record<BaseKey, string> = { general: 'base general', historico: 'base histórica' };

/**
 * Cuenta como Mara buscaría en Airtable: los skills son obligatorios y se buscan con variantes
 * en todos los campos de skills; seniority, inglés, años y rol son filtros blandos que se informan
 * aparte (no achican el total). Por defecto mira las dos bases.
 */
export function matchProfiles(db: DatabaseSync, filter: CandidateFilter = {}): ProfileMatch {
  const skills = skillQueries(filter.skills ?? []);
  const skillMode: SkillMode = filter.skillMode === 'any' ? 'any' : 'all';
  const bases: BaseKey[] = filter.bases && filter.bases.length > 0 ? filter.bases : ['general', 'historico'];
  const hard: CandidateFilter = {
    skills: skills.map((skill) => skill.canonical),
    skillMode,
    area: filter.area,
    country: filter.country,
    status: filter.status,
  };
  const soft: CandidateFilter = {
    seniority: filter.seniority,
    minSeniority: filter.minSeniority,
    english: filter.english,
    minEnglish: filter.minEnglish,
  };
  const years: CandidateFilter = { minYears: filter.minYears, maxYears: filter.maxYears };
  const hasYears = filter.minYears != null || filter.maxYears != null;
  const role = [filter.position, filter.profile, filter.text]
    .map((value) => (value ? cleanRole(value) : ''))
    .filter(Boolean)
    .join(' ');
  const softFilters = describeSoft(soft, role);
  const hasSoft = softFilters.length > 0;
  const yearsLabel = [
    filter.minYears != null ? `${filter.minYears}+ años` : '',
    filter.maxYears != null ? `hasta ${filter.maxYears} años` : '',
  ]
    .filter(Boolean)
    .join(' y ');

  const results: BaseMatch[] = bases.map((base) => {
    const where = buildWhere({ ...hard, bases: [base] });
    const total = Number(
      (db.prepare(`SELECT COUNT(*) AS n FROM candidates c WHERE ${where.sql}`).get(...where.params) as { n: number })
        .n,
    );
    let refined: number | null = null;
    if (hasSoft) {
      const refinedWhere = buildWhere({ ...hard, ...soft, bases: [base] });
      const clauses = [refinedWhere.sql];
      pushTokens(clauses, refinedWhere.params, role);
      refined = Number(
        (
          db
            .prepare(`SELECT COUNT(*) AS n FROM candidates c WHERE ${clauses.join(' AND ')}`)
            .get(...refinedWhere.params) as { n: number }
        ).n,
      );
    }
    let withYears: number | null = null;
    if (hasYears) {
      const yearsWhere = buildWhere({ ...hard, ...years, bases: [base] });
      withYears = Number(
        (db.prepare(`SELECT COUNT(*) AS n FROM candidates c WHERE ${yearsWhere.sql}`).get(...yearsWhere.params) as {
          n: number;
        }).n,
      );
    }
    return {
      base,
      baseName: BASE_NAMES[base],
      total,
      withYears,
      bySeniority: total > 0 ? grouped(db, "COALESCE(seniority, '')", where, (key) => seniorityLabel(key || null, null)) : {},
      byEnglish: total > 0 ? grouped(db, "COALESCE(english, '')", where, (key) => englishLabel(key || null) ?? '') : {},
      refined,
    };
  });

  const skillNames = skills.map((skill) => displaySkill(skill.canonical));
  const joiner = skillMode === 'any' ? ' o ' : ' + ';
  const criterio = [
    skillNames.length > 0 ? `skills ${skillNames.join(joiner)}` : 'sin skills (todos los perfiles)',
    filter.area ? `área ${filter.area}` : '',
    filter.country ? `país ${filter.country}` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return {
    criterio: `${criterio}; busco en Skills 2, Skills (AI Internet), Skills, Tech Skills, Profile y puesto, con variantes`,
    skills: skillNames,
    skillMode,
    softFilters,
    bases: results,
    yearsNote: yearsLabel ? `${yearsLabel}: se informa aparte, el campo de años está vacío en la mayoría de los perfiles` : null,
    resumen: summarize(criterio, softFilters, results, yearsLabel),
  };
}

function cleanRole(value: string): string {
  const generic = new Set(['senior', 'sr', 'junior', 'jr', 'semi', 'ssr', 'engineer', 'developer', 'dev', 'desarrollador',
    'programador', 'ingeniero', 'de', 'con', 'en', 'y', 'and', 'perfil', 'perfiles']);
  return tokenizeForMatch(value)
    .trim()
    .split(' ')
    .filter((token) => token && !generic.has(token))
    .join(' ');
}

function describeSoft(soft: CandidateFilter, role: string): string[] {
  const out: string[] = [];
  const seniority = (soft.seniority ?? []).map((value) => seniorityLabel(canonicalizeSeniority(value).key, value)).filter(Boolean);
  if (seniority.length > 0) out.push(`seniority ${seniority.join('/')}`);
  const minSeniority = canonicalizeSeniority(soft.minSeniority);
  if (minSeniority.key) out.push(`${seniorityLabel(minSeniority.key, null)} o más`);
  const english = (soft.english ?? []).map((value) => englishLabel(canonicalizeEnglish(value).key) ?? value);
  if (english.length > 0) out.push(`inglés ${english.join('/')}`);
  const minEnglish = canonicalizeEnglish(soft.minEnglish);
  if (minEnglish.key) out.push(`inglés ${englishLabel(minEnglish.key)} o más`);
  if (role) out.push(`rol "${role}"`);
  return out;
}

function topEntries(record: Record<string, number>, max: number, skip: string[] = []): string {
  return Object.entries(record)
    .filter(([key]) => !skip.includes(key))
    .slice(0, max)
    .map(([key, value]) => `${key} ${value}`)
    .join(', ');
}

function summarize(criterio: string, softFilters: string[], results: BaseMatch[], yearsLabel: string): string {
  const parts: string[] = [`Criterio: ${criterio}.`];
  for (const result of results) {
    let line = `${capitalize(result.baseName)}: ${result.total}`;
    const extras: string[] = [];
    if (result.refined != null) extras.push(`${result.refined} con ${softFilters.join(', ')}`);
    if (result.withYears != null) extras.push(`${result.withYears} con ${yearsLabel} cargados`);
    if (extras.length > 0) line += ` (${extras.join('; ')})`;
    if (result.total > 0) {
      const seniority = topEntries(result.bySeniority, 3, ['sin dato']);
      const english = topEntries(result.byEnglish, 2, ['sin dato']);
      const bits = [seniority ? `seniority: ${seniority}` : '', english ? `inglés: ${english}` : ''].filter(Boolean);
      if (bits.length > 0) line += `; ${bits.join('; ')}`;
    }
    parts.push(`${line}.`);
  }
  return parts.join(' ');
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
