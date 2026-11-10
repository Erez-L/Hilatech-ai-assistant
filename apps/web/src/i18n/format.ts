import { LOCALE_META, type Locale } from './config';

export type DateStyle = 'short' | 'medium' | 'long';

export interface FormatterOptions {
  /** IANA time zone for dates; defaults to the runtime zone (e.g. Asia/Jerusalem in the browser). */
  timeZone?: string;
}

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86_400;

function toDate(value: Date | string | number): Date {
  return value instanceof Date ? value : new Date(value);
}

const DASH = '—';

/**
 * Locale-aware formatting helpers built on Intl. Currency always honours the ISO code passed in
 * (the lead/org's stored currency) - there is no default currency symbol.
 */
export function createFormatter(locale: Locale, options: FormatterOptions = {}) {
  const intl = LOCALE_META[locale].intl;
  const { timeZone } = options;

  const number = (value: number, opts?: Intl.NumberFormatOptions) =>
    Number.isFinite(value) ? new Intl.NumberFormat(intl, opts).format(value) : DASH;

  const compact = (value: number) => {
    if (!Number.isFinite(value)) return DASH;
    if (Math.abs(value) < 10_000) return number(value);
    return new Intl.NumberFormat(intl, { notation: 'compact', maximumFractionDigits: 1 }).format(
      value,
    );
  };

  const percent = (ratio: number, digits = 0) =>
    Number.isFinite(ratio)
      ? new Intl.NumberFormat(intl, { style: 'percent', maximumFractionDigits: digits }).format(
          ratio,
        )
      : DASH;

  /** Whole units when integral, two decimals otherwise; `compact` gives 12.9K style for stat tiles. */
  const currency = (value: number, code: string, opts: { compact?: boolean } = {}) => {
    if (!Number.isFinite(value)) return DASH;
    const whole = Number.isInteger(value);
    try {
      return new Intl.NumberFormat(intl, {
        style: 'currency',
        currency: code,
        notation: opts.compact && Math.abs(value) >= 10_000 ? 'compact' : 'standard',
        minimumFractionDigits: whole || opts.compact ? 0 : 2,
        maximumFractionDigits: opts.compact ? 1 : 2,
      }).format(value);
    } catch {
      return `${compact(value)} ${code}`;
    }
  };

  const date = (value: Date | string | number, style: DateStyle = 'medium') =>
    new Intl.DateTimeFormat(intl, { dateStyle: style, timeZone }).format(toDate(value));

  const dateTime = (value: Date | string | number, style: DateStyle = 'medium') =>
    new Intl.DateTimeFormat(intl, {
      dateStyle: style,
      timeStyle: style === 'long' ? 'medium' : 'short',
      timeZone,
    }).format(toDate(value));

  const time = (value: Date | string | number, seconds = false) =>
    new Intl.DateTimeFormat(intl, {
      hour: '2-digit',
      minute: '2-digit',
      second: seconds ? '2-digit' : undefined,
      hour12: false,
      timeZone,
    }).format(toDate(value));

  const dayMonth = (value: Date | string | number) =>
    new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', timeZone }).format(
      toDate(value),
    );

  const dateWithWeekday = (value: Date | string | number) =>
    new Intl.DateTimeFormat(intl, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone,
    }).format(toDate(value));

  const monthYear = (value: Date | string | number) =>
    new Intl.DateTimeFormat(intl, { month: 'long', year: 'numeric', timeZone }).format(
      toDate(value),
    );

  const relative = (value: Date | string | number, now: number = Date.now()) => {
    const rtf = new Intl.RelativeTimeFormat(intl, { numeric: 'auto' });
    // ICU's Hebrew data renders singular units as "לפני דקה (1)"; the "(1)" is noise in a UI label.
    const clean = (s: string) => s.replace(/\s*\(1\)/, '');
    const diff = Math.round((toDate(value).getTime() - now) / 1000);
    const abs = Math.abs(diff);
    if (abs < 45) return clean(rtf.format(0, 'second'));
    if (abs < HOUR) return clean(rtf.format(Math.round(diff / MINUTE), 'minute'));
    if (abs < DAY) return clean(rtf.format(Math.round(diff / HOUR), 'hour'));
    if (abs < DAY * 30) return clean(rtf.format(Math.round(diff / DAY), 'day'));
    if (abs < DAY * 365) return clean(rtf.format(Math.round(diff / (DAY * 30)), 'month'));
    return clean(rtf.format(Math.round(diff / (DAY * 365)), 'year'));
  };

  const bytesFromMb = (mb: number) => {
    if (mb >= 1024 * 1024) return `${number(mb / (1024 * 1024), { maximumFractionDigits: 1 })} TB`;
    if (mb >= 1024) return `${number(mb / 1024, { maximumFractionDigits: 1 })} GB`;
    return `${number(Math.round(mb))} MB`;
  };

  /** Milliseconds -> "850 ms" / "4.2 sec" / "2.1 min". */
  const duration = (ms: number) => {
    if (!Number.isFinite(ms)) return DASH;
    const unit = (value: number, u: 'millisecond' | 'second' | 'minute', digits: number) =>
      new Intl.NumberFormat(intl, {
        style: 'unit',
        unit: u,
        unitDisplay: 'short',
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      }).format(value);
    if (ms < 1000) return unit(Math.round(ms), 'millisecond', 0);
    if (ms < 60_000) return unit(ms / 1000, 'second', 1);
    return unit(ms / 60_000, 'minute', 1);
  };

  /** USD-style money with sub-cent precision for AI spend (4 decimals under 1). */
  const preciseCurrency = (value: number, code = 'USD') => {
    if (!Number.isFinite(value)) return DASH;
    return new Intl.NumberFormat(intl, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: Math.abs(value) < 1 ? 4 : 2,
    }).format(value);
  };

  const bytes = (n: number) => {
    if (n < 1024) return `${number(n)} B`;
    if (n < 1024 * 1024)
      return `${number(n / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
    return `${number(n / (1024 * 1024), { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
  };

  /** UTC calendar formatting for analytics buckets (bucket starts are UTC midnights). */
  const utcDayMonth = (value: Date | string | number) =>
    new Intl.DateTimeFormat(intl, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
      toDate(value),
    );
  const utcMonthYear = (value: Date | string | number) =>
    new Intl.DateTimeFormat(intl, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(
      toDate(value),
    );
  const utcDate = (value: Date | string | number) =>
    new Intl.DateTimeFormat(intl, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(toDate(value));

  const list = (items: string[]) =>
    new Intl.ListFormat(intl, { style: 'long', type: 'conjunction' }).format(items);

  return {
    locale,
    number,
    compact,
    percent,
    currency,
    date,
    dateTime,
    time,
    dayMonth,
    monthYear,
    dateWithWeekday,
    relative,
    bytesFromMb,
    duration,
    preciseCurrency,
    bytes,
    utcDayMonth,
    utcMonthYear,
    utcDate,
    list,
  };
}

export type Formatter = ReturnType<typeof createFormatter>;
