/** "15m" → "15 minutes", 24h → "24 hours", 7d → "7 days" (for email copy). */
export function humanizeDuration(ms: number): string {
  const units: Array<[number, string]> = [
    [86_400_000, 'day'],
    [3_600_000, 'hour'],
    [60_000, 'minute'],
    [1_000, 'second'],
  ];
  for (const [size, label] of units) {
    if (ms >= size && ms % size === 0) {
      const n = ms / size;
      return `${n} ${label}${n === 1 ? '' : 's'}`;
    }
  }
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}
