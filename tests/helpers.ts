import type { AppConfig } from '../src/config.js';
import type { AudioChunk, DomCaption, DomChatMessage, MeetController } from '../src/meet/controller.js';

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
    sttProvider: 'off',
    sttApiKey: '',
    sttBaseUrl: 'https://api.x.ai/v1',
    sttLanguage: '',
    sttDiarize: true,
    sttPython: '.venv-stt/bin/python',
    sttLocalModel: 'small',
    sttMinSegmentMs: 4000,
    sttMaxSegmentMs: 15_000,
    sttSpeechRms: 0.01,
    ...overrides,
  };
}

export class FakeMeet implements MeetController {
  posted: string[] = [];
  messages: DomChatMessage[] = [];
  caption: DomCaption | null = null;
  joinedUrl: string | null = null;
  closed = false;
  audioListener: ((chunk: AudioChunk) => void) | null = null;

  onAudio(listener: ((chunk: AudioChunk) => void) | null): void {
    this.audioListener = listener;
  }

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
