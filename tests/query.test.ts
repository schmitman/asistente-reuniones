import { describe, expect, it } from 'vitest';
import { mapRecord } from '../src/airtable/mapRecord.js';
import { replaceBase } from '../src/db/repo.js';
import { openDatabase } from '../src/db/database.js';
import { answerFromCache, filtersFromQuestion } from '../src/llm/fallback.js';
import { countCandidates, matchProfiles, searchCandidates } from '../src/query/candidates.js';
import { buildSkillQuery, cleanSkillTerm, tokenizeForMatch } from '../src/query/skillMatch.js';
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
  it('java no incluye javascript; react incluye react native como en Airtable', () => {
    const db = seed();
    expect(countCandidates(db, { skills: ['java'] }).total).toBe(1);
    expect(countCandidates(db, { skills: ['javascript'] }).total).toBe(1);
    expect(countCandidates(db, { skills: ['react'] }).total).toBe(2);
    expect(countCandidates(db, { skills: ['ReactJS'] }).total).toBe(2);
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
    expect(countCandidates(db, { skills: ['java', 'react'], skillMode: 'any' }).total).toBe(3);
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
      bases: ['general', 'historico'],
    });
    const answer = answerFromCache('cuántos java senior hay', db, 'counts', 5, true);
    expect(answer).toMatch(/Criterio: skills Java/);
    expect(answer).toMatch(/Base general: 1 \(1 con seniority Senior\)/);
    expect(answer).toMatch(/Base histórica: 1/);
    expect(answer).not.toMatch(/Ada|@|5555|hunter2/);
    const named = answerFromCache('cuántos java senior hay', db, 'names', 5, true);
    expect(named).toMatch(/Ada López/);
    expect(named).not.toMatch(/@|5555|hunter2/);
    const hidden = answerFromCache('cuántos javascript hay en la base general', db, 'names', 5, true);
    expect(hidden).toMatch(/cláusula de datos/);
    expect(hidden).not.toMatch(/Teo/);
  });
});

describe('matching estilo Airtable', () => {
  it('saca palabras de rol y reconoce variantes', () => {
    expect(cleanSkillTerm('Senior Python engineer')).toBe('python');
    expect(cleanSkillTerm('React.js developer')).toBe('react js');
    expect(buildSkillQuery('React.js developer')?.canonical).toBe('react');
    expect(buildSkillQuery('NodeJS')?.canonical).toBe('node');
    expect(buildSkillQuery('TS')?.canonical).toBe('typescript');
    expect(buildSkillQuery('Mongo')?.canonical).toBe('mongodb');
    expect(buildSkillQuery('senior engineer')).toBeNull();
    expect(tokenizeForMatch('Node.JS, Mongó;  C# y C++')).toBe(' node js mongo c# y c++ ');
  });

  it('busca en todos los campos de skills y trata seniority como filtro blando', () => {
    const db = openDatabase(':memory:');
    replaceBase(db, 'general', [
      mapRecord('general', { id: 'recPy0000000001a', fields: { 'Skills 2': ['Python'], Seniority: 'Sr' } }),
      mapRecord('general', { id: 'recPy0000000002a', fields: { 'Skills (AI Internet)': ['Python 3'], Seniority: 'JR' } }),
      mapRecord('general', { id: 'recPy0000000003a', fields: { 'Tech Skills': 'Armé un ETL con python y pandas.' } }),
      mapRecord('general', { id: 'recPy0000000004a', fields: { Profile: ['Python Developer'], 'English Level': 'Advanced' } }),
      mapRecord('general', { id: 'recPy0000000005a', fields: { 'Position Name (from Position on Job Board)': ['Backend Python Sr'] } }),
      mapRecord('general', { id: 'recNode00000001a', fields: { 'Skills ': 'Node.js, TypeScript, MongoDB', Seniority: 'Sr' } }),
      mapRecord('general', { id: 'recNode00000002a', fields: { 'Skills 2': ['NodeJS', 'TS'], 'Skills (AI Internet)': ['Mongo'] } }),
      mapRecord('general', { id: 'recGoVerb000001a', fields: { 'Tech Skills': 'I had to go and fix it' } }),
    ]);
    replaceBase(db, 'historico', [
      mapRecord('historico', { id: 'recHistPy000001a', fields: { 'Skills 2': 'Django, Python', Seniority: 'Senior' } }),
    ]);
    const python = matchProfiles(db, { skills: ['Senior Python engineer'], minSeniority: 'senior' });
    expect(python.skills).toEqual(['Python']);
    expect(python.bases.find((base) => base.base === 'general')?.total).toBe(5);
    expect(python.bases.find((base) => base.base === 'general')?.refined).toBe(1);
    expect(python.bases.find((base) => base.base === 'historico')?.total).toBe(1);
    expect(python.resumen).toMatch(/^Criterio: skills Python\./);

    const node = matchProfiles(db, { skills: ['Node.js', 'TypeScript', 'MongoDB'], minYears: 7 });
    expect(node.bases.find((base) => base.base === 'general')?.total).toBe(2);
    expect(node.criterio).toMatch(/Node\.js \+ TypeScript \+ MongoDB/);
    expect(matchProfiles(db, { skills: ['go'] }).bases[0]?.total).toBe(0);
  });
});
