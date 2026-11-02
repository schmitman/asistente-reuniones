import type { DatabaseSync } from 'node:sqlite';
import {
  canonicalizeEnglish,
  canonicalizeSeniority,
  canonicalSkill,
  englishLabel,
  likeEscape,
  normalizeText,
  seniorityLabel,
} from './normalize.js';

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

  const skills = unique(
    (filter.skills ?? [])
      .map((value) => canonicalSkill(value))
      .filter((value): value is string => Boolean(value)),
  );
  if (skills.length > 0) {
    const parts = skills.map((skill) => skillClause(skill, params));
    clauses.push(filter.skillMode === 'any' ? `(${parts.join(' OR ')})` : parts.join(' AND '));
  }

  return { sql: clauses.join(' AND '), params };
}

function skillClause(skill: string, params: Array<string | number>): string {
  const allowWord = skill.length >= 3 ? 1 : 0;
  const escaped = likeEscape(skill);
  params.push(
    skill,
    allowWord,
    `${escaped} %`,
    `% ${escaped}`,
    `% ${escaped} %`,
    skill === 'react' ? 1 : 0,
    skill === 'java' ? 1 : 0,
  );
  return `EXISTS (
    SELECT 1 FROM candidate_skills s
    WHERE s.candidate_id = c.id
      AND (
        s.skill = ?
        OR (
          ? = 1
          AND (
            s.skill LIKE ? ESCAPE '\\'
            OR s.skill LIKE ? ESCAPE '\\'
            OR s.skill LIKE ? ESCAPE '\\'
          )
          AND NOT (? = 1 AND s.skill LIKE '%native%')
          AND NOT (? = 1 AND (s.skill = 'javascript' OR s.skill LIKE 'javascript %' ESCAPE '\\'))
        )
      )
  )`;
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
