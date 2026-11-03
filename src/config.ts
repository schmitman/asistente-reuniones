import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

export type ChatDetailLevel = 'counts' | 'names';

export interface AppConfig {
  airtableToken: string;
  sqlitePath: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  meetProfileDir: string;
  meetHeadless: boolean;
  displayName: string;
  admissionTimeoutMs: number;
  postConsentOnJoin: boolean;
  consentMessage: string;
  chatDetailLevel: ChatDetailLevel;
  chatMaxNames: number;
  requireDataClause: boolean;
  pollIntervalMs: number;
  panelHost: string;
  panelPort: number;
  panelToken: string;
  airtablePageSize: number;
  airtableMinIntervalMs: number;
  syncMaxRecords: number | null;
  transcriptDir: string;
  meetDebug: boolean;
  replyMaxChars: number;
}

function loadDotEnv(file = '.env'): void {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function flag(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return /^(1|true|yes|si|sí)$/i.test(value.trim());
}

function intValue(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.floor(parsed);
}

function pathValue(value: string | undefined, fallback: string): string {
  const raw = value && value.trim() ? value.trim() : fallback;
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  loadDotEnv();
  const provider = (env.LLM_PROVIDER || '').trim().toLowerCase();
  let llmBaseUrl = (env.LLM_BASE_URL || '').trim();
  if (!llmBaseUrl) {
    llmBaseUrl = provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.x.ai/v1';
  }
  llmBaseUrl = llmBaseUrl.replace(/\/+$/, '');

  let llmModel = (env.LLM_MODEL || '').trim();
  if (!llmModel) llmModel = llmBaseUrl.includes('api.x.ai') ? 'grok-3' : 'gpt-4o-mini';

  const detailRaw = (env.CHAT_DETAIL_LEVEL || 'counts').trim().toLowerCase();
  if (detailRaw !== 'counts' && detailRaw !== 'names') {
    throw new Error('CHAT_DETAIL_LEVEL tiene que ser "counts" o "names".');
  }

  const panelHost = (env.PANEL_HOST || '127.0.0.1').trim() || '127.0.0.1';
  const panelToken = (env.PANEL_TOKEN || '').trim();
  if (!isLoopback(panelHost) && !panelToken) {
    throw new Error('PANEL_TOKEN es obligatorio si PANEL_HOST no es localhost.');
  }

  const maxRaw = (env.SYNC_MAX_RECORDS || '').trim();
  const syncMaxRecords = maxRaw ? Math.max(1, intValue(maxRaw, 1)) : null;

  return {
    airtableToken: (env.AIRTABLE_TOKEN || '').trim(),
    sqlitePath: pathValue(env.SQLITE_PATH, 'data/asistente.db'),
    llmBaseUrl,
    llmApiKey: (env.LLM_API_KEY || env.XAI_API_KEY || env.OPENAI_API_KEY || '').trim(),
    llmModel,
    meetProfileDir: pathValue(env.MEET_PROFILE_DIR, 'data/chrome-profile'),
    meetHeadless: flag(env.MEET_HEADLESS, false),
    displayName: (env.MEET_DISPLAY_NAME || 'Asistente IA de Mara').trim() || 'Asistente IA de Mara',
    admissionTimeoutMs: Math.max(15_000, intValue(env.MEET_ADMISSION_TIMEOUT_MS, 600_000)),
    postConsentOnJoin: flag(env.POST_CONSENT_ON_JOIN, false),
    consentMessage:
      (env.CONSENT_MESSAGE || 'Hola, soy el asistente IA de Mara, tomo notas').trim() ||
      'Hola, soy el asistente IA de Mara, tomo notas',
    chatDetailLevel: detailRaw,
    chatMaxNames: Math.min(10, Math.max(1, intValue(env.CHAT_MAX_NAMES, 5))),
    requireDataClause: flag(env.CHAT_REQUIRE_DATA_CLAUSE, true),
    pollIntervalMs: Math.max(400, intValue(env.MEET_POLL_MS, 1000)),
    panelHost,
    panelPort: Math.min(65535, Math.max(1, intValue(env.PANEL_PORT, 8787))),
    panelToken,
    airtablePageSize: Math.min(100, Math.max(1, intValue(env.AIRTABLE_PAGE_SIZE, 100))),
    airtableMinIntervalMs: Math.max(0, intValue(env.AIRTABLE_MIN_INTERVAL_MS, 220)),
    syncMaxRecords,
    transcriptDir: pathValue(env.TRANSCRIPT_DIR, 'data/transcripts'),
    meetDebug: flag(env.MEET_DEBUG, false),
    replyMaxChars: 480,
  };
}
