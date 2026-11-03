const ALIASES: Record<string, string> = {
  js: 'javascript',
  javascript: 'javascript',
  'java script': 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  reactjs: 'react',
  'react js': 'react',
  'react native': 'react native',
  reactnative: 'react native',
  node: 'node',
  nodejs: 'node',
  'node js': 'node',
  py: 'python',
  python: 'python',
  k8s: 'kubernetes',
  kubernetes: 'kubernetes',
  postgres: 'postgresql',
  postgresql: 'postgresql',
  mongo: 'mongodb',
  mongodb: 'mongodb',
  golang: 'go',
  go: 'go',
  csharp: 'c#',
  'c#': 'c#',
  'c sharp': 'c#',
  'c++': 'c++',
  cpp: 'c++',
  dotnet: '.net',
  '.net': '.net',
  'dot net': '.net',
  nextjs: 'next',
  'next js': 'next',
  vuejs: 'vue',
  'vue js': 'vue',
  angularjs: 'angular',
  'angular js': 'angular',
  qa: 'qa',
  ml: 'machine learning',
  'machine learning': 'machine learning',
  ai: 'ai',
  aws: 'aws',
  gcp: 'gcp',
  azure: 'azure',
  'ci/cd': 'ci/cd',
  cicd: 'ci/cd',
  'ux/ui': 'ux/ui',
  'ui/ux': 'ux/ui',
  sql: 'sql',
  nosql: 'nosql',
  'spring boot': 'spring boot',
  springboot: 'spring boot',
  'ruby on rails': 'ruby on rails',
  rails: 'ruby on rails',
  'power bi': 'power bi',
};

const SKILL_STOP = new Set([
  'de',
  'la',
  'el',
  'los',
  'las',
  'y',
  'o',
  'and',
  'or',
  'con',
  'para',
  'en',
  'un',
  'una',
  'the',
  'of',
  'a',
  'del',
  'al',
  'por',
  'su',
  'sus',
  'level',
  'nivel',
]);

const SHORT_OK = new Set(['go', 'c#', 'c++', 'r', 'qa', 'ai', 'ml', '.net', 'c']);

export const SENIORITY_LABELS: Record<string, string> = {
  junior: 'Junior',
  'semi-senior': 'Semi senior',
  'semi-senior-plus': 'Semi senior+',
  senior: 'Senior',
  lead: 'Lead',
  architect: 'Arquitecto',
  manager: 'Manager',
  director: 'Director',
};

export const ENGLISH_LABELS: Record<string, string> = {
  basic: 'básico',
  intermediate: 'intermedio',
  upper: 'intermedio alto',
  advanced: 'avanzado',
  bilingual: 'bilingüe',
  none: 'sin inglés',
};

export function normalizeText(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[“”«»]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function canonicalSkill(input: string): string | null {
  let text = normalizeText(input);
  if (!text) return null;
  text = text.replace(/\bui\/ux\b/g, 'ux/ui');
  if (text === '.net' || text === 'dotnet' || text === 'dot net') return '.net';
  text = text.replace(/\./g, '').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return ALIASES[text] ?? text;
}

export function extractSkillKeys(raw: string): string[] {
  const normalized = normalizeText(raw).replace(/\bui\/ux\b/g, 'ux/ui');
  if (!normalized) return [];
  const chunks = normalized
    .split(/[,;\n|]+/g)
    .flatMap((part) => part.split(/\s+\by\b\s+|\s+\band\b\s+/g));
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const chunk of chunks) {
    const key = canonicalSkill(chunk);
    if (!key || seen.has(key) || SKILL_STOP.has(key)) continue;
    if (key.length < 2 && !SHORT_OK.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= 40) break;
  }
  return keys;
}

export function canonicalizeSeniority(input: string | null | undefined): {
  key: string | null;
  rank: number | null;
} {
  if (!input) return { key: null, rank: null };
  const text = normalizeText(input);
  const compact = text.replace(/[\s-]+/g, '');
  if (['semisr+', 'semisenior+', 'semiseniorplus'].includes(compact) || text.endsWith('+') && /semi/.test(text)) {
    return { key: 'semi-senior-plus', rank: 3 };
  }
  if (compact === 'jr' || compact === 'junior') return { key: 'junior', rank: 1 };
  if (
    ['semisr', 'ssr', 'semisenior', 'midsenior'].includes(compact) ||
    text === 'semi senior' ||
    text === 'semi-senior'
  ) {
    return { key: 'semi-senior', rank: 2 };
  }
  if (compact === 'sr' || text === 'senior') return { key: 'senior', rank: 4 };
  if (text === 'lead' || text === 'tech lead' || compact === 'tl') return { key: 'lead', rank: 5 };
  if (text === 'manager' || text === 'gerente') return { key: 'manager', rank: 6 };
  if (text === 'arquitecto' || text === 'architect') return { key: 'architect', rank: 5 };
  if (text === 'director') return { key: 'director', rank: 7 };
  return { key: null, rank: null };
}

export function canonicalizeEnglish(input: string | null | undefined): {
  key: string | null;
  rank: number | null;
} {
  if (!input) return { key: null, rank: null };
  const text = normalizeText(input);
  if (!text || /linkedin\.com|https?:\/\//.test(text)) return { key: null, rank: null };
  if (['no', 'n/a', 'na', 'none', 'sin', 'sin ingles'].includes(text)) return { key: 'none', rank: 0 };
  if (/(bilingual|bilingue|nativo|native|\bc2\b)/.test(text)) return { key: 'bilingual', rank: 5 };
  if (/(avanzado|advanced|\bc1\b|full professional)/.test(text)) return { key: 'advanced', rank: 4 };
  if (/limited working/.test(text)) return { key: 'basic', rank: 1 };
  if (/(upper|intermedio alto|\bb2\b|professional working)/.test(text)) return { key: 'upper', rank: 3 };
  if (/(intermedio|intermediate|\bb1\b)/.test(text)) return { key: 'intermediate', rank: 2 };
  if (/(basico|basic|elemental|\ba1\b|\ba2\b)/.test(text)) return { key: 'basic', rank: 1 };
  return { key: null, rank: null };
}

export function seniorityLabel(key: string | null, raw: string | null): string | null {
  if (key && SENIORITY_LABELS[key]) return SENIORITY_LABELS[key];
  if (raw && raw.trim()) return raw.trim();
  return null;
}

export function englishLabel(key: string | null): string | null {
  if (!key) return null;
  return ENGLISH_LABELS[key] ?? null;
}

export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
