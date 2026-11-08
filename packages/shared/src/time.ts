const UNIT_MS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };

/** Parse durations like "15m", "7d", "900s" into milliseconds. Throws on invalid input. */
export function parseDuration(value: string | number): number {
  if (typeof value === 'number') return value;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d|w)$/i.exec(value.trim());
  if (!match) throw new Error(`Invalid duration: "${value}"`);
  const amount = Number(match[1]);
  const unit = (match[2] as string).toLowerCase();
  return Math.round(amount * (UNIT_MS[unit] as number));
}

export function addMs(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

/** Start/end of the calendar month containing `date` (UTC). Used for usage periods. */
export function monthPeriod(date = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return { start, end };
}
