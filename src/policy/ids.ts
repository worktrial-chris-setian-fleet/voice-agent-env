export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'experiment';
}

export function timestampId(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

export function nextPolicyId(existingPolicyIds: string[]): string {
  const numbers = existingPolicyIds
    .map((policyId) => /^policy-v(\d+)$/.exec(policyId)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => !Number.isNaN(value));
  const next = (numbers.length > 0 ? Math.max(...numbers) : 0) + 1;
  return `policy-v${String(next).padStart(3, '0')}`;
}

export function nextRunId(runType: string, date = new Date()): string {
  return `run-${timestampId(date)}-${runType}`;
}
