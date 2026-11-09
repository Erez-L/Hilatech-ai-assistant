/** Compact number formatting for stat tiles: 1,284 · 12.9K · 4.2M. */
export function formatCompact(value: number, locale = 'en'): string {
  if (!Number.isFinite(value)) return '—';
  if (Math.abs(value) < 10_000) return new Intl.NumberFormat(locale).format(value);
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

export function formatNumber(value: number, locale = 'en'): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(locale).format(value);
}

export function formatPercent(ratio: number, locale = 'en'): string {
  if (!Number.isFinite(ratio)) return '—';
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(
    ratio,
  );
}

export function formatBytesFromMb(mb: number): string {
  if (mb >= 1024 * 1024) return `${(mb / (1024 * 1024)).toFixed(1)} TB`;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function initials(first?: string | null, last?: string | null, fallback = '?'): string {
  const a = first?.trim().charAt(0) ?? '';
  const b = last?.trim().charAt(0) ?? '';
  const result = `${a}${b}`.toUpperCase();
  return result || fallback;
}
