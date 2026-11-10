import { msg } from '@/i18n/msg';

/** Values are stored as-is (English) by the API; show them with `enumLabel(t, 'industry', value)`. */
export const INDUSTRIES = [
  'Professional services',
  'Healthcare & clinics',
  'Retail & e-commerce',
  'Real estate',
  'Education',
  'Hospitality & food',
  'Beauty & wellness',
  'Construction & trades',
  'Finance & insurance',
  'Technology',
  'Manufacturing',
  'Non-profit',
  'Other',
] as const;

export const COMMON_TIMEZONES = [
  'UTC',
  'Asia/Jerusalem',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Athens',
  'Europe/Istanbul',
  'Europe/Moscow',
  'Africa/Cairo',
  'Africa/Johannesburg',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Tokyo',
  'Australia/Sydney',
  'America/Sao_Paulo',
  'America/Argentina/Buenos_Aires',
  'America/New_York',
  'America/Toronto',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Mexico_City',
];

export const DAYS = [
  { key: 'sun', label: msg('days.sun') },
  { key: 'mon', label: msg('days.mon') },
  { key: 'tue', label: msg('days.tue') },
  { key: 'wed', label: msg('days.wed') },
  { key: 'thu', label: msg('days.thu') },
  { key: 'fri', label: msg('days.fri') },
  { key: 'sat', label: msg('days.sat') },
] as const;
export type DayKey = (typeof DAYS)[number]['key'];

/** Currencies offered for the organization's reporting currency (any ISO-4217 code is still accepted by the API). */
export const COMMON_CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY'] as const;
