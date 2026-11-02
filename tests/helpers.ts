import type { AppConfig } from '../src/config.js';
import type { DomCaption, DomChatMessage, MeetController } from '../src/meet/controller.js';

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    airtableToken: '',
    sqlitePath: ':memory:',
    llmBaseUrl: 'https://api.x.ai/v1',
    llmApiKey: '',
    llmModel: 'grok-3',
    meetProfileDir: 'data/chrome-profile',
    meetHeadless: true,
    displayName: 'Asistente IA de Mara',
    admissionTimeoutMs: 30_000,
    postConsentOnJoin: false,
    consentMessage: 'Hola, soy el asistente IA de Mara, tomo notas',
    chatDetailLevel: 'counts',
    chatMaxNames: 5,
    requireDataClause: true,
    pollIntervalMs: 1000,
    panelHost: '127.0.0.1',
    panelPort: 0,
    panelToken: '',
    airtablePageSize: 100,
    airtableMinIntervalMs: 0,
    syncMaxRecords: null,
    transcriptDir: 'data/transcripts',
    meetDebug: false,
    replyMaxChars: 480,
    ...overrides,
  };
}

export class FakeMeet implements MeetController {
  posted: string[] = [];
  messages: DomChatMessage[] = [];
  caption: DomCaption | null = null;
  joinedUrl: string | null = null;
  closed = false;

  async join(url: string): Promise<void> {
    this.joinedUrl = url;
  }

  async postMessage(text: string): Promise<void> {
    this.posted.push(text);
  }

  async scrapeChat(): Promise<DomChatMessage[]> {
    return this.messages;
  }

  async scrapeCaption(): Promise<DomCaption | null> {
    return this.caption;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}
