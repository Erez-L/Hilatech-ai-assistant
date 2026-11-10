import { describe, expect, it } from 'vitest';
import { testI18n } from '@/test/i18n';
import { translateMessage, vm } from '../validation';
import { enumLabel, humanizeValue } from '../enums';
import { createTranslator } from '../translate';

describe('translate', () => {
  it('interpolates params and selects plural forms', () => {
    const en = testI18n('en').t;
    expect(en('team.memberCount', { count: 1 })).toBe('1 member');
    expect(en('team.memberCount', { count: 3 })).toBe('3 members');
    const he = testI18n('he').t;
    expect(he('team.memberCount', { count: 1 })).toBe('חבר צוות אחד');
    expect(he('team.memberCount', { count: 2 })).toBe('שני חברי צוות');
    expect(he('team.memberCount', { count: 5 })).toBe('5 חברי צוות');
  });
  it('falls back to the fallback dictionary, then to the key', () => {
    const t = createTranslator('he', { a: 'א' } as never, { a: 'a', b: 'b' } as never);
    expect(t('a' as never)).toBe('א');
    expect(t('b' as never)).toBe('b');
    expect(t('zzz' as never)).toBe('zzz');
  });
});

describe('validation messages', () => {
  it('encodes and translates vm() strings in both locales', () => {
    const msgText = vm('validation.keepTheNameUnderMaxCharacters', { max: 80 });
    expect(translateMessage(testI18n('en').t, msgText)).toBe('Keep the name under 80 characters');
    expect(translateMessage(testI18n('he').t, msgText)).toContain('80');
    expect(translateMessage(testI18n('he').t, msgText)).not.toMatch(/[A-Za-z]{4}/);
  });
  it('translates known English strings and zod defaults, passes unknown ones through', () => {
    const he = testI18n('he').t;
    expect(translateMessage(he, 'Invalid email')).toBe(he('validation.invalidEmail'));
    expect(translateMessage(he, 'Required')).toBe(he('validation.required'));
    expect(translateMessage(he, 'Something custom from the server')).toBe(
      'Something custom from the server',
    );
  });
});

describe('enum labels', () => {
  it('uses the dictionary when present and humanizes otherwise', () => {
    const he = testI18n('he').t;
    expect(enumLabel(he, 'status', 'past_due')).toBe(he('status.past_due'));
    expect(humanizeValue('some_new_value')).toBe('Some new value');
    expect(enumLabel(testI18n('en').t, 'status', 'brand_new')).toBe('Brand new');
  });
});
