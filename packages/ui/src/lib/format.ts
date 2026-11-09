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

/**
 * Currency formatting for pipeline values. Whole units when the amount is integral, two decimals
 * otherwise; `compact` switches to 12.9K / 4.2M for stat tiles. Unknown currency codes fall back to
 * a plain number followed by the code.
 */
export function formatCurrency(
  value: number,
  currency: string,
  options: { compact?: boolean; locale?: string } = {},
): string {
  if (!Number.isFinite(value)) return '—';
  const { compact = false, locale = 'en' } = options;
  const whole = Number.isInteger(value);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: compact && Math.abs(value) >= 10_000 ? 'compact' : 'standard',
      minimumFractionDigits: whole || compact ? 0 : 2,
      maximumFractionDigits: compact ? 1 : 2,
    }).format(value);
  } catch {
    return `${formatCompact(value, locale)} ${currency}`;
  }
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
