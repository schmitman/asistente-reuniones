const FORBIDDEN_FIELD =
  /password|credential|contrase[nñ]a|secret|\btoken\b|api[_ -]?key|e-?mail|cellphone|phone|tel[eé]fono|\bcelular\b|whatsapp|\bdni\b|\bcuil\b|\bcuit\b|passport|salary|salario|\bsueldo\b|remuneraci|desired amount|linkedin|\bcv\b|curriculum/i;

export function isForbiddenField(name: string): boolean {
  return FORBIDDEN_FIELD.test(name.trim());
}

export function assertRequestableFields(fields: readonly string[]): void {
  for (const field of fields) {
    if (isForbiddenField(field)) {
      throw new Error(`Campo bloqueado, no se pide a Airtable: ${field}`);
    }
  }
}

export function scrubFieldMap(fields: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (isForbiddenField(key)) continue;
    clean[key] = value;
  }
  return clean;
}
