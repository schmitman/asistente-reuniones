import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export interface TranscriptLine {
  ts: string;
  speaker: string;
  text: string;
  source: string;
}

export interface ChatLine {
  id: number;
  ts: string;
  sender: string;
  text: string;
  addressed: boolean;
  reply: string | null;
}

export interface SuggestionLine {
  ts: string;
  kind: string;
  text: string;
}

export function createMeeting(
  db: DatabaseSync,
  input: { id: string; url: string; code: string; startedAt: string },
): void {
  db.prepare(
    `INSERT INTO meetings (id, meet_code, meet_url, started_at, ended_at, consent_posted)
     VALUES (?, ?, ?, ?, NULL, 0)`,
  ).run(input.id, input.code, input.url, input.startedAt);
}

export function markConsent(db: DatabaseSync, meetingId: string): void {
  db.prepare(`UPDATE meetings SET consent_posted = 1 WHERE id = ?`).run(meetingId);
}

export function endMeeting(db: DatabaseSync, meetingId: string, endedAt: string): void {
  db.prepare(`UPDATE meetings SET ended_at = ? WHERE id = ?`).run(endedAt, meetingId);
}

export function insertChat(
  db: DatabaseSync,
  input: { meetingId: string; ts: string; sender: string; text: string; addressed: boolean },
): number {
  const result = db
    .prepare(
      `INSERT INTO chat_messages (meeting_id, ts, sender, text, addressed, reply)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    )
    .run(input.meetingId, input.ts, input.sender, input.text, input.addressed ? 1 : 0);
  return Number(result.lastInsertRowid);
}

export function setChatReply(db: DatabaseSync, chatId: number, reply: string): void {
  db.prepare(`UPDATE chat_messages SET reply = ? WHERE id = ?`).run(reply, chatId);
}

export function listChat(db: DatabaseSync, meetingId: string, limit = 40): ChatLine[] {
  const rows = db
    .prepare(
      `SELECT id, ts, sender, text, addressed, reply
       FROM chat_messages WHERE meeting_id = ?
       ORDER BY id DESC LIMIT ?`,
    )
    .all(meetingId, limit) as unknown as Array<{
    id: number;
    ts: string;
    sender: string;
    text: string;
    addressed: number;
    reply: string | null;
  }>;
  return rows.reverse().map((row) => ({
    id: row.id,
    ts: row.ts,
    sender: row.sender,
    text: row.text,
    addressed: row.addressed === 1,
    reply: row.reply,
  }));
}

export function listTranscript(db: DatabaseSync, meetingId: string, limit = 80): TranscriptLine[] {
  const rows = db
    .prepare(
      `SELECT ts, speaker, text, source FROM transcript_lines
       WHERE meeting_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(meetingId, limit) as unknown as TranscriptLine[];
  return rows.reverse();
}

export function listSuggestions(db: DatabaseSync, meetingId: string | null, limit = 20): SuggestionLine[] {
  const rows = meetingId
    ? (db
        .prepare(
          `SELECT ts, kind, text FROM suggestions
           WHERE meeting_id IS NULL OR meeting_id = ?
           ORDER BY id DESC LIMIT ?`,
        )
        .all(meetingId, limit) as unknown as SuggestionLine[])
    : (db
        .prepare(`SELECT ts, kind, text FROM suggestions ORDER BY id DESC LIMIT ?`)
        .all(limit) as unknown as SuggestionLine[]);
  return rows.reverse();
}

export function upsertCaption(
  db: DatabaseSync,
  input: { meetingId: string; ts: string; speaker: string; text: string },
): boolean {
  const speaker = input.speaker.trim() || 'Desconocido';
  const text = input.text.replace(/\s+/g, ' ').trim();
  if (!text) return false;
  const last = db
    .prepare(
      `SELECT id, ts, speaker, text FROM transcript_lines
       WHERE meeting_id = ? AND source = 'caption'
       ORDER BY id DESC LIMIT 1`,
    )
    .get(input.meetingId) as { id: number; ts: string; speaker: string; text: string } | undefined;
  if (last && last.speaker === speaker) {
    const delta = Date.parse(input.ts) - Date.parse(last.ts);
    const related = text === last.text || text.startsWith(last.text) || last.text.startsWith(text);
    if (delta >= 0 && delta < 15_000 && related) {
      if (text.length > last.text.length) {
        db.prepare(`UPDATE transcript_lines SET text = ?, ts = ? WHERE id = ?`).run(text, input.ts, last.id);
        return true;
      }
      return false;
    }
  }
  db.prepare(
    `INSERT INTO transcript_lines (meeting_id, ts, speaker, text, source) VALUES (?, ?, ?, ?, 'caption')`,
  ).run(input.meetingId, input.ts, speaker, text);
  return true;
}

export function insertTranscriptLine(
  db: DatabaseSync,
  input: { meetingId: string; ts: string; speaker: string; text: string; source: string },
): void {
  const text = input.text.replace(/\s+/g, ' ').trim();
  if (!text) return;
  db.prepare(
    `INSERT INTO transcript_lines (meeting_id, ts, speaker, text, source) VALUES (?, ?, ?, ?, ?)`,
  ).run(input.meetingId, input.ts, input.speaker.trim() || 'Participante', text, input.source);
}

export function writeMeetingJsonl(db: DatabaseSync, meetingId: string, filePath: string): void {
  const lines = [
    ...listTranscript(db, meetingId, 5000).map((line) => ({ ...line, source: line.source || 'caption' })),
    ...listChat(db, meetingId, 5000).map((line) => ({
      ts: line.ts,
      speaker: line.sender,
      text: line.text,
      source: 'chat',
      reply: line.reply,
    })),
  ].sort((a, b) => a.ts.localeCompare(b.ts));
  mkdirSync(dirname(filePath), { recursive: true });
  const body = lines.map((line) => JSON.stringify(line)).join('\n');
  writeFileSync(filePath, body ? `${body}\n` : '');
}
