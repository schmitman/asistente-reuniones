import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { AppConfig } from '../config.js';
import { isOwnSender, parseAddressedCommand } from '../chat/parse.js';
import { countStoredCandidates } from '../db/repo.js';
import { answerQuestion } from '../llm/agent.js';
import type { MeetController } from '../meet/controller.js';
import { meetCode, parseMeetUrl } from '../meet/url.js';
import { httpError } from '../panel/server.js';
import { SUGGESTION_NOTE, type PanelSnapshot } from '../panel/snapshot.js';
import { normalizeText } from '../query/normalize.js';
import { sanitizeOutgoing } from '../safety/redact.js';
import {
  createMeeting,
  endMeeting,
  insertChat,
  listChat,
  listSuggestions,
  listTranscript,
  markConsent,
  upsertCaption,
  writeMeetingJsonl,
} from '../transcript/store.js';

export class MeetingRuntime {
  private status: PanelSnapshot['status'] = 'idle';
  private meetingUrl: string | null = null;
  private meetingId: string | null = null;
  private lastError: string | null = null;
  private consentPosted = false;
  private running = false;
  private seen = new Set<string>();
  private lastReplyAt = 0;
  private recentQuestions: Array<{ key: string; at: number }> = [];
  private transcriptDirty = false;
  private lastFlush = 0;
  private readonly candidateCount: number;

  constructor(
    private readonly db: DatabaseSync,
    private readonly config: AppConfig,
    private readonly meet: MeetController,
    private readonly answer: (question: string) => Promise<string> = (question) =>
      answerQuestion({ question, db, config, log: (message) => console.log(`[llm] ${message}`) }),
    private readonly now: () => number = Date.now,
  ) {
    this.candidateCount = countStoredCandidates(db);
  }

  getSnapshot(): PanelSnapshot {
    const meetingId = this.meetingId;
    return {
      status: this.status,
      meetingUrl: this.meetingUrl,
      meetingId,
      displayName: this.config.displayName,
      detailLevel: this.config.chatDetailLevel,
      candidateCount: this.candidateCount,
      lastError: this.lastError,
      consentPosted: this.consentPosted,
      chat: meetingId
        ? listChat(this.db, meetingId).map((line) => ({
            ts: line.ts,
            sender: line.sender,
            text: line.text,
            addressed: line.addressed,
            reply: line.reply,
          }))
        : [],
      transcript: meetingId ? listTranscript(this.db, meetingId) : [],
      suggestions: listSuggestions(this.db, meetingId),
      suggestionNote: SUGGESTION_NOTE,
    };
  }

  requestJoin(url: string, consent: boolean): void {
    const meetUrl = parseMeetUrl(url);
    if (!meetUrl) {
      throw httpError('El link tiene que ser un Google Meet https://meet.google.com/xxx-xxxx-xxx.', 400);
    }
    if (this.status === 'joining' || this.status === 'live') {
      throw httpError('Ya hay una reunión en curso.', 409);
    }
    this.status = 'joining';
    this.meetingUrl = meetUrl;
    void this.start(meetUrl, consent)
      .then(() => this.run())
      .catch((error: unknown) => {
        this.running = false;
        this.status = 'error';
        this.lastError = error instanceof Error ? error.message : String(error);
        void this.meet.close();
      });
  }

  async requestLeave(): Promise<void> {
    await this.stop();
  }

  async start(url: string, consent: boolean): Promise<void> {
    const meetUrl = parseMeetUrl(url);
    if (!meetUrl) throw httpError('El link tiene que ser un Google Meet https://meet.google.com/xxx-xxxx-xxx.', 400);
    this.status = 'joining';
    this.lastError = null;
    this.meetingUrl = meetUrl;
    this.seen.clear();
    this.consentPosted = false;
    await this.meet.join(meetUrl);
    if (this.wasStopped()) return;
    const startedAt = new Date(this.now()).toISOString();
    this.meetingId = `${meetCode(meetUrl)}-${startedAt.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
    createMeeting(this.db, {
      id: this.meetingId,
      url: meetUrl,
      code: meetCode(meetUrl),
      startedAt,
    });
    if (consent || this.config.postConsentOnJoin) {
      const notice = sanitizeOutgoing(this.config.consentMessage, this.config.replyMaxChars);
      await this.meet.postMessage(notice);
      markConsent(this.db, this.meetingId);
      this.consentPosted = true;
    }
    const history = await this.meet.scrapeChat();
    for (const message of history) {
      this.seen.add(message.id);
      const parsed = parseAddressedCommand(message.text);
      this.recordChat(message.sender, message.text, parsed.addressed, null);
    }
    if (this.wasStopped()) return;
    this.status = 'live';
    this.running = true;
  }

  async run(): Promise<void> {
    while (this.running) {
      await this.pollOnce();
      await this.sleepWhileRunning(this.config.pollIntervalMs);
    }
  }

  async pollOnce(): Promise<void> {
    if (!this.meetingId) return;
    try {
      const messages = await this.meet.scrapeChat();
      for (const message of messages) {
        if (this.seen.has(message.id)) continue;
        const done = await this.handleMessage(message.sender, message.text, message.id);
        if (!done) break;
      }
      const caption = await this.meet.scrapeCaption();
      if (caption?.text) {
        const changed = upsertCaption(this.db, {
          meetingId: this.meetingId,
          ts: new Date(this.now()).toISOString(),
          speaker: caption.speaker,
          text: caption.text,
        });
        if (changed) this.transcriptDirty = true;
      }
      if (this.transcriptDirty && this.now() - this.lastFlush > 5000) this.flushTranscript();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.meetingId) {
      endMeeting(this.db, this.meetingId, new Date(this.now()).toISOString());
      this.flushTranscript();
    }
    await this.meet.close();
    if (this.status === 'live' || this.status === 'joining') this.status = 'left';
  }

  private wasStopped(): boolean {
    const status: PanelSnapshot['status'] = this.status;
    return status === 'left' || status === 'error';
  }

  private async handleMessage(sender: string, text: string, id: string): Promise<boolean> {
    if (isOwnSender(sender, this.config.displayName)) {
      this.seen.add(id);
      return true;
    }
    if (normalizeText(text) === normalizeText(this.config.consentMessage)) {
      this.seen.add(id);
      return true;
    }
    const parsed = parseAddressedCommand(text);
    if (!parsed.addressed) {
      this.seen.add(id);
      this.recordChat(sender, text, false, null);
      return true;
    }
    const key = normalizeText(parsed.question);
    const moment = this.now();
    if (this.recentQuestions.some((item) => item.key === key && moment - item.at < 60_000)) {
      this.seen.add(id);
      this.recordChat(sender, text, true, null);
      return true;
    }
    if (this.lastReplyAt !== 0 && moment - this.lastReplyAt < 3000) return false;

    this.seen.add(id);
    this.lastReplyAt = moment;
    this.recentQuestions.push({ key, at: moment });
    let reply: string | null = null;
    try {
      reply = sanitizeOutgoing(await this.answer(parsed.question), this.config.replyMaxChars);
      await this.meet.postMessage(reply);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      reply = null;
    }
    this.recordChat(sender, text, true, reply);
    return true;
  }

  private recordChat(sender: string, text: string, addressed: boolean, reply: string | null): void {
    if (!this.meetingId) return;
    const chatId = insertChat(this.db, {
      meetingId: this.meetingId,
      ts: new Date(this.now()).toISOString(),
      sender: sender || 'Desconocido',
      text,
      addressed,
    });
    if (reply) {
      this.db.prepare(`UPDATE chat_messages SET reply = ? WHERE id = ?`).run(reply, chatId);
    }
  }

  private flushTranscript(): void {
    if (!this.meetingId) return;
    writeMeetingJsonl(this.db, this.meetingId, join(this.config.transcriptDir, `${this.meetingId}.jsonl`));
    this.transcriptDirty = false;
    this.lastFlush = this.now();
  }

  private async sleepWhileRunning(ms: number): Promise<void> {
    const end = this.now() + ms;
    while (this.running && this.now() < end) {
      await delay(Math.min(200, end - this.now()));
    }
  }
}

function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
