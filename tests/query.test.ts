import { describe, expect, it } from 'vitest';
import { mapRecord } from '../src/airtable/mapRecord.js';
import { replaceBase } from '../src/db/repo.js';
import { openDatabase } from '../src/db/database.js';
import { answerFromCache, filtersFromQuestion } from '../src/llm/fallback.js';
import { countCandidates, searchCandidates } from '../src/query/candidates.js';
import { canonicalSkill, extractSkillKeys } from '../src/query/normalize.js';

function seed() {
  const db = openDatabase(':memory:');
  replaceBase(db, 'general', [
    mapRecord('general', {
      id: 'recJavaSenior0001',
      fields: {
        'Name & Lastname': 'Ada López',
        Email: 'ada@example.com',
        Password: 'hunter2',
        'Cellphone #': '+54 11 5555 4444',
        Seniority: 'Sr',
        'Skills 2': ['Java', 'Spring Boot'],
        'Skills (AI Internet)': ['Kafka'],
        'English Level': 'Advanced',
        Área: 'Ingeniería / Software',
        'Años de experiencia': 8,
        'Position Name (from Position on Job Board)': ['Backend Java'],
        'Clausula Datos': true,
        Profile: ['Java Developer'],
      },
    }),
    mapRecord('general', {
      id: 'recJsJunior00001',
      fields: {
        Name: 'Teo',
        Lastname: 'García',
        Seniority: 'JR',
        'Skills 2': ['JavaScript', 'React'],
        'English Level': 'Intermediate',
        'Clausula Datos': false,
      },
    }),
    mapRecord('general', {
      id: 'recReactNative01',
      fields: {
        'Name & Lastname': 'Luz Pérez',
        Seniority: 'SemiSr',
        'Skills 2': ['React Native'],
        'English Level': 'Bilingual',
        'Clausula Datos': true,
      },
    }),
    mapRecord('general', {
      id: 'recGoCloud000001',
      fields: {
        'Name & Lastname': 'Noa Ruiz',
        Seniority: 'Lead',
        'Skills ': 'Go, Google Cloud',
        'English Level': 'no',
      },
    }),
  ]);
  replaceBase(db, 'historico', [
    mapRecord('historico', {
      id: 'recHistJava00001',
      fields: {
        'Name & Lastname': 'Historico Java',
        Seniority: 'Senior',
        'Skills ': 'Java, SQL',
        'English Level': 'Upper Intermediate',
      },
    }),
  ]);
  return db;
}

describe('skills', () => {
  it('normaliza alias y no parte react native', () => {
    expect(canonicalSkill('React.js')).toBe('react');
    expect(canonicalSkill('Node.js')).toBe('node');
    expect(canonicalSkill('Golang')).toBe('go');
    expect(extractSkillKeys('Java, Spring Boot y Kafka')).toEqual(['java', 'spring boot', 'kafka']);
    expect(extractSkillKeys('React Native')).toEqual(['react native']);
  });
});

describe('consultas al cache', () => {
  it('java no incluye javascript y react no incluye react native', () => {
    const db = seed();
    expect(countCandidates(db, { skills: ['java'] }).total).toBe(1);
    expect(countCandidates(db, { skills: ['javascript'] }).total).toBe(1);
    expect(countCandidates(db, { skills: ['react'] }).total).toBe(1);
    expect(countCandidates(db, { skills: ['react native'] }).total).toBe(1);
    expect(countCandidates(db, { skills: ['go'] }).total).toBe(1);
    expect(countCandidates(db, { skills: ['google cloud'] }).total).toBe(1);
  });

  it('combina seniority, inglés y skills, y por defecto mira solo la base general', () => {
    const db = seed();
    const seniorJava = countCandidates(db, { skills: ['java'], seniority: ['Sr'], minEnglish: 'avanzado' });
    expect(seniorJava.total).toBe(1);
    expect(seniorJava.byBase).toEqual({ general: 1 });
    expect(seniorJava.bySeniority).toEqual({ Senior: 1 });
    expect(countCandidates(db, { skills: ['java'], bases: ['general', 'historico'] }).total).toBe(2);
    expect(countCandidates(db, { skills: ['java', 'spring'], skillMode: 'all' }).total).toBe(1);
    expect(countCandidates(db, { skills: ['java', 'react'], skillMode: 'all' }).total).toBe(0);
    expect(countCandidates(db, { skills: ['java', 'react'], skillMode: 'any' }).total).toBe(2);
  });

  it('en modo nombres oculta contacto y respeta la cláusula de datos', () => {
    const db = seed();
    const rows = searchCandidates(db, { skills: ['java'], requireDataShare: true }, 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe('Ada López');
    expect(rows[0]?.seniority).toBe('Senior');
    expect(rows[0]?.skills).toContain('Java');
    expect(JSON.stringify(rows)).not.toMatch(/ada@example.com|hunter2|5555/);
    expect(searchCandidates(db, { skills: ['javascript'], requireDataShare: true }, 5)).toHaveLength(0);
    expect(searchCandidates(db, { skills: ['javascript'], requireDataShare: false }, 5)[0]?.name).toBe('Teo García');
  });

  it('la respuesta local en rioplatense no nombra gente en modo conteos', () => {
    const db = seed();
    expect(filtersFromQuestion('cuántos java senior con inglés avanzado')).toMatchObject({
      skills: ['java'],
      seniority: ['senior'],
      minEnglish: 'advanced',
      bases: ['general'],
    });
    const answer = answerFromCache('cuántos java senior hay', db, 'counts', 5, true);
    expect(answer).toMatch(/Hay 1 perfil/);
    expect(answer).not.toMatch(/Ada|@|5555|hunter2/);
    const named = answerFromCache('cuántos java senior hay', db, 'names', 5, true);
    expect(named).toMatch(/Ada López/);
    expect(named).not.toMatch(/@|5555|hunter2/);
    const hidden = answerFromCache('cuántos react hay', db, 'names', 5, true);
    expect(hidden).toMatch(/cláusula de datos/);
    expect(hidden).not.toMatch(/Teo/);
  });
});
