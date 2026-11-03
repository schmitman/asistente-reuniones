import { normalizeText } from './normalize.js';

/**
 * Matching de skills pensado para acercarse a la búsqueda de Airtable:
 * se busca la palabra (y sus variantes) dentro del texto de todos los campos de skills,
 * sin importar mayúsculas, acentos ni puntuación.
 *
 * El texto se guarda "tokenizado": minúsculas, sin acentos, todo lo que no sea
 * letra, número, + o # se vuelve espacio, y lleva un espacio al principio y al final.
 * Así "React.js, Node.JS" queda " react js node js " y se puede buscar con LIKE '% react %'.
 */
export function tokenizeForMatch(input: string): string {
  const text = normalizeText(input)
    .replace(/[^a-z0-9+#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? ` ${text} ` : '';
}

/** Variantes conocidas, ya tokenizadas. La clave es el nombre canónico. */
const VARIANTS: Record<string, string[]> = {
  react: ['react', 'reactjs', 'react js'],
  'react native': ['react native', 'reactnative'],
  node: ['node', 'nodejs', 'node js'],
  typescript: ['typescript', 'ts'],
  javascript: ['javascript', 'java script', 'js', 'ecmascript', 'es6'],
  java: ['java', 'java8', 'java 8', 'java11', 'java 11', 'java17', 'java 17', 'j2ee', 'jee'],
  python: ['python', 'python3', 'python 3', 'python2'],
  mongodb: ['mongodb', 'mongo', 'mongo db'],
  postgresql: ['postgresql', 'postgres', 'postgre', 'postgre sql'],
  mysql: ['mysql', 'my sql'],
  kubernetes: ['kubernetes', 'k8s'],
  go: ['go', 'golang'],
  'c#': ['c#', 'csharp', 'c sharp'],
  'c++': ['c++', 'cpp'],
  '.net': ['net', 'dotnet', 'dot net', 'net core', 'asp net'],
  next: ['next', 'nextjs', 'next js'],
  vue: ['vue', 'vuejs', 'vue js'],
  angular: ['angular', 'angularjs', 'angular js'],
  'machine learning': ['machine learning', 'ml'],
  aws: ['aws', 'amazon web services'],
  gcp: ['gcp', 'google cloud', 'google cloud platform'],
  azure: ['azure'],
  'ci/cd': ['ci cd', 'cicd'],
  'ux/ui': ['ux ui', 'ui ux', 'ux', 'ui'],
  'spring boot': ['spring boot', 'springboot'],
  'ruby on rails': ['ruby on rails', 'rails', 'ror'],
  'power bi': ['power bi', 'powerbi'],
  express: ['express', 'expressjs', 'express js'],
  nestjs: ['nestjs', 'nest js', 'nest'],
  django: ['django'],
  flask: ['flask'],
  fastapi: ['fastapi', 'fast api'],
  php: ['php'],
  laravel: ['laravel'],
  ruby: ['ruby'],
  kotlin: ['kotlin'],
  swift: ['swift'],
  flutter: ['flutter'],
  docker: ['docker'],
  terraform: ['terraform'],
  sql: ['sql'],
  nosql: ['nosql', 'no sql'],
  graphql: ['graphql', 'graph ql'],
  salesforce: ['salesforce', 'sfdc'],
  sap: ['sap'],
  qa: ['qa', 'quality assurance', 'tester', 'testing'],
  devops: ['devops', 'dev ops'],
  'data engineering': ['data engineer', 'data engineering'],
  'data science': ['data science', 'data scientist'],
  'product manager': ['product manager', 'product owner', 'pm'],
};

const ALIAS_TO_CANONICAL: Record<string, string> = (() => {
  const map: Record<string, string> = {};
  for (const [canonical, variants] of Object.entries(VARIANTS)) {
    map[tokenizeForMatch(canonical).trim()] = canonical;
    for (const variant of variants) map[variant] = map[variant] ?? canonical;
  }
  // Atajos frecuentes que no conviene buscar como palabra suelta.
  map['py'] = 'python';
  map['ts'] = 'typescript';
  map['js'] = 'javascript';
  map['k8s'] = 'kubernetes';
  map['ml'] = 'machine learning';
  return map;
})();

/**
 * Variantes cortas o ambiguas en texto libre (por ejemplo "go" como verbo o "ui").
 * Solo se buscan en los campos estructurados de skills, no en el texto narrativo.
 */
const TAG_ONLY = new Set(['go', 'ts', 'js', 'ml', 'ui', 'ux', 'pm', 'net', 'ror', 'sap', 'qa', 'nest', 'next', 'express', 'r', 'c']);

/** Palabras de rol o seniority: se sacan del skill y se tratan como filtro blando. */
const ROLE_WORDS = new Set([
  'senior', 'sr', 'semi', 'semisenior', 'ssr', 'junior', 'jr', 'trainee', 'lead', 'leader', 'principal', 'staff',
  'engineer', 'engineers', 'engineering', 'developer', 'developers', 'dev', 'devs', 'desarrollador', 'desarrolladora',
  'desarrolladores', 'programador', 'programadora', 'programadores', 'ingeniero', 'ingeniera', 'ingenieros',
  'specialist', 'especialista', 'expert', 'experto', 'experta', 'profile', 'perfil', 'perfiles', 'role', 'rol',
  'con', 'with', 'de', 'en', 'experience', 'experiencia', 'skills', 'skill', 'conocimiento', 'conocimientos',
  'strong', 'solid', 'solido', 'hands', 'on', 'knowledge', 'years', 'anos', 'plus', 'y', 'and', 'or', 'o', 'a',
  'the', 'remote', 'remoto',
]);

export interface SkillQuery {
  /** Lo que pidió el usuario, limpio. */
  label: string;
  canonical: string;
  /** Variantes tokenizadas que se buscan en todos los campos. */
  textVariants: string[];
  /** Variantes cortas o ambiguas que solo se buscan en campos estructurados. */
  tagVariants: string[];
}

/** "Senior Python engineer" -> "python"; "React.js developer" -> "react". */
export function cleanSkillTerm(input: string): string {
  const tokens = tokenizeForMatch(input).trim().split(' ').filter(Boolean);
  const kept = tokens.filter((token) => !ROLE_WORDS.has(token) && !/^\d+\+?$/.test(token));
  return kept.join(' ');
}

export function buildSkillQuery(input: string): SkillQuery | null {
  const cleaned = cleanSkillTerm(input);
  if (!cleaned) return null;
  const canonical = ALIAS_TO_CANONICAL[cleaned] ?? cleaned;
  const known = VARIANTS[canonical];
  const base = known ? [...known] : [cleaned, cleaned.replace(/ /g, '')];
  if (!known && cleaned.endsWith(' js')) base.push(cleaned.replace(/ js$/, ''), cleaned.replace(/ js$/, 'js'));
  const variants = [...new Set(base.filter(Boolean))];
  const textVariants = variants.filter((variant) => !TAG_ONLY.has(variant) && variant.length >= 2);
  const tagVariants = variants.filter((variant) => TAG_ONLY.has(variant) || variant.length < 2);
  return { label: cleaned, canonical, textVariants, tagVariants };
}

export function skillQueryMatches(query: SkillQuery, tags: string, text: string): boolean {
  if (query.textVariants.some((variant) => tags.includes(` ${variant} `) || text.includes(` ${variant} `))) return true;
  return query.tagVariants.some((variant) => tags.includes(` ${variant} `));
}

/** Etiqueta linda para mostrar en el chat. */
export function displaySkill(canonical: string): string {
  const pretty: Record<string, string> = {
    react: 'React',
    'react native': 'React Native',
    node: 'Node.js',
    typescript: 'TypeScript',
    javascript: 'JavaScript',
    java: 'Java',
    python: 'Python',
    mongodb: 'MongoDB',
    postgresql: 'PostgreSQL',
    mysql: 'MySQL',
    kubernetes: 'Kubernetes',
    go: 'Go',
    '.net': '.NET',
    next: 'Next.js',
    vue: 'Vue',
    angular: 'Angular',
    aws: 'AWS',
    gcp: 'GCP',
    azure: 'Azure',
    php: 'PHP',
    sql: 'SQL',
    graphql: 'GraphQL',
    docker: 'Docker',
  };
  if (pretty[canonical]) return pretty[canonical];
  return canonical.replace(/\b\p{L}/gu, (char) => char.toUpperCase());
}
