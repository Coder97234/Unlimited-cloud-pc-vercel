// PostgreSQL JSON/text cannot represent NUL or isolated UTF-16 surrogates.
// Keep valid surrogate pairs intact, including when a character cap cuts one.
export function wellFormedText(value: string) {
  return value.replace(/[\ud800-\udbff][\udc00-\udfff]|[\0\ud800-\udfff]/g, (match) => match.length === 2 ? match : '\ufffd');
}
