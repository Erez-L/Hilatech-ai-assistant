import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  dirOf,
  normalizeLocale,
  parseAcceptLanguage,
  resolveLocale,
} from '../config';

describe('locale resolution', () => {
  it('prefers the saved preference over cookie and Accept-Language', () => {
    expect(resolveLocale({ preference: 'he', cookie: 'en', acceptLanguage: 'en-US' })).toBe('he');
    expect(resolveLocale({ preference: 'en', cookie: 'he', acceptLanguage: 'he' })).toBe('en');
  });
  it('falls back preference -> cookie -> Accept-Language -> en', () => {
    expect(resolveLocale({ cookie: 'he', acceptLanguage: 'en' })).toBe('he');
    expect(resolveLocale({ acceptLanguage: 'he-IL,he;q=0.9,en;q=0.8' })).toBe('he');
    expect(resolveLocale({})).toBe(DEFAULT_LOCALE);
    expect(resolveLocale()).toBe('en');
  });
  it('ignores unsupported values at each step', () => {
    expect(resolveLocale({ preference: 'fr', cookie: 'xx', acceptLanguage: 'de, he;q=0.5' })).toBe(
      'he',
    );
    expect(resolveLocale({ preference: null, cookie: '', acceptLanguage: 'fr-FR' })).toBe('en');
  });
  it('normalizes tags, including the legacy iw code', () => {
    expect(normalizeLocale('he-IL')).toBe('he');
    expect(normalizeLocale('iw')).toBe('he');
    expect(normalizeLocale('EN_gb')).toBe('en');
    expect(normalizeLocale('zz')).toBeNull();
  });
  it('respects q-values in Accept-Language', () => {
    expect(parseAcceptLanguage('en;q=0.4, he;q=0.9')).toBe('he');
    expect(parseAcceptLanguage('he;q=0, en')).toBe('en');
    expect(parseAcceptLanguage(null)).toBeNull();
  });
  it('maps locales to direction', () => {
    expect(dirOf('he')).toBe('rtl');
    expect(dirOf('en')).toBe('ltr');
  });
});
