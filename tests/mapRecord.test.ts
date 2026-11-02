import { describe, expect, it } from 'vitest';
import { mapRecord } from '../src/airtable/mapRecord.js';
import { SOURCES } from '../src/airtable/sources.js';
import { isForbiddenField } from '../src/safety/fields.js';

describe('mapRecord', () => {
  it('se queda con skills y puesto, y tira secretos y links de registro', () => {
    const mapped = mapRecord('general', {
      id: 'recABCDEFGHIJKLM',
      fields: {
        'Name & Lastname': 'Ada López',
        Email: 'ada@example.com',
        'Email laboral (Apollo)': 'ada@empresa.com',
        Password: 'hunter2',
        'Remote Tasks Credential': 'secreto',
        'Cellphone #': '+54 11 5555 4444',
        'Desired Salary U$D': 4000,
        linkedin: 'https://www.linkedin.com/in/ada',
        'Skills 2': ['Java', 'Spring Boot'],
        'Skills ': 'Kafka, SQL',
        Seniority: 'Sr',
        'English Level': 'Advanced',
        Área: 'Ingeniería / Software',
        'Años de experiencia': 8,
        'Position name': ['recXXXXXXXXXXXXXX'],
        'Position Name (from Position on Job Board)': ['Backend Java'],
        'Clausula Datos': true,
        Country: 'Argentina',
      },
    });

    const serialized = JSON.stringify(mapped);
    expect(serialized).not.toMatch(/hunter2|secreto|ada@example.com|5555|linkedin|4000/);
    expect(mapped.displayName).toBe('Ada López');
    expect(mapped.positionName).toBe('Backend Java');
    expect(mapped.yearsExperience).toBe(8);
    expect(mapped.dataShareOk).toBe(true);
    expect(mapped.skillRaws.map((item) => item.raw)).toEqual(expect.arrayContaining(['Java', 'Kafka, SQL']));
    expect(mapped.seniorityRaw).toBe('Sr');
  });

  it('la lista de campos que se piden no incluye contacto ni credenciales', () => {
    expect(isForbiddenField('Password')).toBe(true);
    expect(isForbiddenField('Remote Tasks Credential')).toBe(true);
    expect(isForbiddenField('Email')).toBe(true);
    expect(isForbiddenField('Cellphone #')).toBe(true);
    expect(isForbiddenField('Desired Salary U$D')).toBe(true);
    expect(isForbiddenField('Skills 2')).toBe(false);
    expect(isForbiddenField('Skills (AI Internet)')).toBe(false);
    for (const source of SOURCES) {
      expect(source.fields.some((field) => isForbiddenField(field))).toBe(false);
    }
    const general = SOURCES.find((source) => source.key === 'general');
    expect(general?.fields).toContain('Skills ');
    expect(general?.fields).toContain('Skills 2');
    expect(general?.tableName).toBe('Base General');
  });
});
