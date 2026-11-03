import type { BaseKey } from './sources.js';
import { looksSensitive } from '../safety/redact.js';
import { scrubFieldMap } from '../safety/fields.js';
import { tokenizeForMatch } from '../query/skillMatch.js';

export interface AirtableRecord {
  id: string;
  fields: Record<string, unknown>;
}

export interface SkillRaw {
  source: string;
  raw: string;
}

export interface MappedCandidate {
  baseKey: BaseKey;
  recordId: string;
  displayName: string;
  seniorityRaw: string | null;
  englishRaw: string | null;
  area: string | null;
  status: string | null;
  yearsExperience: number | null;
  positionName: string | null;
  profileText: string | null;
  country: string | null;
  dataShareOk: boolean;
  skillRaws: SkillRaw[];
  skillsPreview: string;
  /** Texto tokenizado de los campos estructurados de skills, perfil y puesto (para buscar). */
  skillTags: string;
  /** Texto tokenizado de los campos narrativos (Tech Skills). */
  skillText: string;
}

const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;

export function mapRecord(baseKey: BaseKey, record: AirtableRecord): MappedCandidate {
  const fields = scrubFieldMap(record.fields ?? {});
  const skillRaws = [
    ...skillValues('skills_2', pick(fields, 'Skills 2')),
    ...skillValues('skills_ai', pick(fields, 'Skills (AI Internet)')),
    ...skillValues('skills_text', pick(fields, 'Skills ', 'Skills')),
    ...skillValues('tech_skills', pick(fields, 'Tech Skills')),
    ...skillValues('profile', pick(fields, 'Profile')),
  ];
  const positionParts = [
    ...cleanList(pick(fields, 'Position Name (from Position on Job Board)')),
    ...cleanList(pick(fields, 'Position name')),
  ];
  const preview = skillRaws
    .filter((item) => item.source === 'skills_2' || item.source === 'skills_ai' || item.source === 'skills_text')
    .map((item) => item.raw)
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 12)
    .join(', ')
    .slice(0, 240);

  const tagSources = [
    pick(fields, 'Skills 2'),
    pick(fields, 'Skills (AI Internet)'),
    pick(fields, 'Skills '),
    pick(fields, 'Skills'),
    pick(fields, 'Profile'),
    pick(fields, 'Position name'),
    pick(fields, 'Position Name (from Position on Job Board)'),
  ];
  const skillTags = tokenizeForMatch(tagSources.flatMap((value) => searchableList(value)).join(' , '));
  const skillText = tokenizeForMatch(searchableList(pick(fields, 'Tech Skills')).join(' , '));

  return {
    baseKey,
    recordId: record.id,
    displayName: displayName(fields),
    seniorityRaw: plain(pick(fields, 'Seniority')),
    englishRaw: plain(pick(fields, 'English Level')),
    area: plain(pick(fields, 'Área', 'Area')),
    status: plain(pick(fields, 'Status')),
    yearsExperience: asNumber(pick(fields, 'Años de experiencia')),
    positionName: positionParts.length > 0 ? positionParts.join(', ').slice(0, 180) : null,
    profileText: plain(pick(fields, 'Profile')),
    country: plain(pick(fields, 'Country')),
    dataShareOk: asConsent(pick(fields, 'Clausula Datos')),
    skillRaws,
    skillsPreview: preview,
    skillTags,
    skillText,
  };
}

function displayName(fields: Record<string, unknown>): string {
  const full = plain(pick(fields, 'Name & Lastname'));
  const first = plain(pick(fields, 'Name'));
  const last = plain(pick(fields, 'Lastname'));
  const joined = full || [first, last].filter(Boolean).join(' ').trim();
  return (joined || 'Sin nombre').replace(/\s+/g, ' ').slice(0, 120);
}

function pick(fields: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {
    if (!(name in fields)) continue;
    const value = fields[name];
    if (value == null || value === '') continue;
    return value;
  }
  return null;
}

export function toStringList(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  if (Array.isArray(value)) return value.flatMap((item) => toStringList(item));
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (typeof record.name === 'string') return toStringList(record.name);
    if (typeof record.text === 'string') return toStringList(record.text);
  }
  return [];
}

function cleanList(value: unknown): string[] {
  return toStringList(value)
    .map((item) => item.replace(/\s+/g, ' ').trim())
    .filter((item) => item && !RECORD_ID.test(item) && !looksSensitive(item));
}

function plain(value: unknown): string | null {
  const list = cleanList(value);
  return list.length > 0 ? list.join(', ') : null;
}

function skillValues(source: string, value: unknown): SkillRaw[] {
  return cleanList(value)
    .filter((raw) => raw.length <= 280)
    .map((raw) => ({ source, raw }));
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function asConsent(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  const token = value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim();
  return ['true', 'si', 'yes', '1', 'checked', 'x'].includes(token);
}

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;
const LONG_DIGITS_RE = /\+?\d[\d\s().-]{7,}\d/g;

/** Valores completos (sin recorte de largo) para buscar, sin mails, links, teléfonos ni ids de registro. */
function searchableList(value: unknown): string[] {
  return toStringList(value)
    .filter((item) => !RECORD_ID.test(item.trim()))
    .map((item) => item.replace(EMAIL_RE, ' ').replace(URL_RE, ' ').replace(LONG_DIGITS_RE, ' '))
    .map((item) => item.slice(0, 8000))
    .filter((item) => item.trim());
}
