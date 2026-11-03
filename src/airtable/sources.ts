import { assertRequestableFields } from '../safety/fields.js';

export type BaseKey = 'general' | 'historico';

export interface AirtableSource {
  key: BaseKey;
  baseId: string;
  baseName: string;
  tableId: string;
  tableName: string;
  fields: string[];
}

const GENERAL_FIELDS = [
  'Name & Lastname',
  'Name',
  'Lastname',
  'Seniority',
  'Profile',
  'Skills 2',
  'Skills (AI Internet)',
  // El nombre real del campo de texto libre termina con un espacio.
  'Skills ',
  'Tech Skills',
  'English Level',
  'Status',
  'Área',
  'Años de experiencia',
  'Position name',
  'Position Name (from Position on Job Board)',
  'Country',
  'Clausula Datos',
];

const HISTORICO_FIELDS = [
  'Name & Lastname',
  'Name',
  'Lastname',
  'Seniority',
  'Profile',
  'Skills ',
  'Skills 2',
  'Tech Skills',
  'English Level',
  'Status',
  'Position name',
  'Position Name (from Position on Job Board)',
  'Country',
  'Clausula Datos',
];

export const SOURCES: AirtableSource[] = [
  {
    key: 'general',
    baseId: 'appZ2uavuwQLI2foP',
    baseName: 'Base general (ultima)',
    tableId: 'tblUrmhgpg33qw9in',
    tableName: 'Base General',
    fields: GENERAL_FIELDS,
  },
  {
    key: 'historico',
    baseId: 'appwm3pmXVPgrflPx',
    baseName: 'BASE 2020 - 2021',
    tableId: 'tblpH3kSKPxvdFqGz',
    tableName: 'Imported table',
    fields: HISTORICO_FIELDS,
  },
];

for (const source of SOURCES) assertRequestableFields(source.fields);
