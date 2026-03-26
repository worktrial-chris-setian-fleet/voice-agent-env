export function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

export function getIntArgValue(flag: string, fallback: number): number {
  const value = getArgValue(flag);
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

export function getStringArgValue(flag: string, fallback?: string): string | undefined {
  return getArgValue(flag) ?? fallback;
}
