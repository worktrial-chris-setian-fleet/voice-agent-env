/**
 * Normalize a CRM answer value for comparison across formatting differences.
 * This intentionally preserves semantic content while tolerating whitespace and
 * minor punctuation variation in strings returned by LLMs.
 */
export function normalizeAnswer(value: string): string {
  return value.toLowerCase().replace(/[$,_]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Normalize field names so spacing and underscore variants compare cleanly. */
export function normalizeFieldName(field: string): string {
  return field
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_');
}

/** Compare normalized answer values, including numeric equivalence where possible. */
export function answersMatch(left: string, right: string): boolean {
  if (left === right) return true;
  const normalizedLeft = Number(left);
  const normalizedRight = Number(right);
  if (
    !Number.isNaN(normalizedLeft) &&
    !Number.isNaN(normalizedRight) &&
    left.trim() !== '' &&
    right.trim() !== ''
  ) {
    return Math.abs(normalizedLeft - normalizedRight) < 0.01;
  }
  return false;
}

/** Compare field names after normalization. */
export function fieldsMatch(left: string, right: string): boolean {
  return normalizeFieldName(left) === normalizeFieldName(right);
}

/** Determine whether a submitted field/value pair matches the target answer. */
export function submissionMatchesTarget(
  submittedField: string,
  submittedValue: string,
  targetField: string,
  targetValue: string
): boolean {
  return fieldsMatch(submittedField, targetField) &&
    answersMatch(normalizeAnswer(submittedValue), normalizeAnswer(targetValue));
}

/** Stable key for clue tracking across modules. */
export function makeClueKey(field: string, value: string): string {
  return `${normalizeFieldName(field)}::${normalizeAnswer(value)}`;
}
