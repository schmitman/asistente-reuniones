import type { DatabaseSync } from 'node:sqlite';
import type { MappedCandidate } from '../airtable/mapRecord.js';
import {
  canonicalizeEnglish,
  canonicalizeSeniority,
  extractSkillKeys,
  normalizeText,
} from '../query/normalize.js';

export interface StoredSkill {
  skill: string;
  source: string;
}

export function replaceBase(db: DatabaseSync, baseKey: string, records: MappedCandidate[]): number {
  const deleteSkills = db.prepare(
    `DELETE FROM candidate_skills WHERE candidate_id IN (SELECT id FROM candidates WHERE base_key = ?)`,
  );
  const deleteCandidates = db.prepare(`DELETE FROM candidates WHERE base_key = ?`);
  const insertCandidate = db.prepare(`
    INSERT INTO candidates (
      id, base_key, record_id, display_name, seniority_raw, seniority, seniority_rank,
      english_raw, english, english_rank, area, area_norm, status, status_norm,
      years_experience, position_name, position_norm, profile_text, profile_norm,
      country, country_norm, data_share_ok, skills_preview, search_text, skill_tags, skill_text, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertSkill = db.prepare(
    `INSERT OR IGNORE INTO candidate_skills (candidate_id, skill, source) VALUES (?, ?, ?)`,
  );
  const syncedAt = new Date().toISOString();

  db.exec('BEGIN');
  try {
    deleteSkills.run(baseKey);
    deleteCandidates.run(baseKey);
    for (const record of records) {
      if (record.baseKey !== baseKey) continue;
      const id = `${record.baseKey}:${record.recordId}`;
      const seniority = canonicalizeSeniority(record.seniorityRaw);
      const english = canonicalizeEnglish(record.englishRaw);
      const skills = skillsOf(record);
      const search = normalizeText(
        [
          record.displayName,
          record.positionName,
          record.profileText,
          record.area,
          record.status,
          record.country,
          record.skillsPreview,
          skills.map((item) => item.skill).join(' '),
        ]
          .filter(Boolean)
          .join(' '),
      ).slice(0, 2000);
      insertCandidate.run(
        id,
        record.baseKey,
        record.recordId,
        record.displayName,
        record.seniorityRaw,
        seniority.key,
        seniority.rank,
        record.englishRaw,
        english.key,
        english.rank,
        record.area,
        record.area ? normalizeText(record.area) : null,
        record.status,
        record.status ? normalizeText(record.status) : null,
        record.yearsExperience,
        record.positionName,
        record.positionName ? normalizeText(record.positionName) : null,
        record.profileText,
        record.profileText ? normalizeText(record.profileText) : null,
        record.country,
        record.country ? normalizeText(record.country) : null,
        record.dataShareOk ? 1 : 0,
        record.skillsPreview,
        search,
        record.skillTags ?? '',
        record.skillText ?? '',
        syncedAt,
      );
      for (const item of skills) insertSkill.run(id, item.skill, item.source);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return records.filter((record) => record.baseKey === baseKey).length;
}

function skillsOf(record: MappedCandidate): StoredSkill[] {
  const seen = new Set<string>();
  const skills: StoredSkill[] = [];
  for (const item of record.skillRaws) {
    for (const skill of extractSkillKeys(item.raw)) {
      const key = `${item.source}:${skill}`;
      if (seen.has(key)) continue;
      seen.add(key);
      skills.push({ source: item.source, skill });
    }
  }
  return skills;
}

export function countStoredCandidates(db: DatabaseSync, baseKey?: string): number {
  if (baseKey) {
    const row = db.prepare(`SELECT COUNT(*) AS n FROM candidates WHERE base_key = ?`).get(baseKey) as
      | { n: number }
      | undefined;
    return Number(row?.n ?? 0);
  }
  const row = db.prepare(`SELECT COUNT(*) AS n FROM candidates`).get() as { n: number } | undefined;
  return Number(row?.n ?? 0);
}
