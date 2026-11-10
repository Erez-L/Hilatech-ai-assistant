import { describe, expect, it } from 'vitest';
import { MESSAGES } from '../messages';
import type { Message } from '../translate';

const placeholders = (m: Message): string[] =>
  [
    ...new Set((typeof m === 'string' ? m : Object.values(m).join(' ')).match(/\{\w+\}/g) ?? []),
  ].sort();

describe('en/he dictionary parity', () => {
  const enKeys = Object.keys(MESSAGES.en).sort();
  const heKeys = Object.keys(MESSAGES.he).sort();

  it('has exactly the same keys', () => {
    expect(heKeys.filter((k) => !(k in MESSAGES.en))).toEqual([]);
    expect(enKeys.filter((k) => !(k in MESSAGES.he))).toEqual([]);
  });

  it('keeps the same message kind (string vs plural table)', () => {
    const bad = enKeys.filter((k) => typeof MESSAGES.en[k] !== typeof MESSAGES.he[k]);
    expect(bad).toEqual([]);
  });

  it('keeps the same {placeholders}, ignoring one/two forms that spell the number out', () => {
    const bad: string[] = [];
    for (const k of enKeys) {
      const e = MESSAGES.en[k]!;
      const h = MESSAGES.he[k]!;
      if (typeof e === 'string' && typeof h === 'string') {
        if (placeholders(e).join() !== placeholders(h).join()) bad.push(k);
      } else if (typeof e !== 'string' && typeof h !== 'string') {
        if (!h.other) bad.push(`${k} (no "other")`);
        const eo = placeholders(e.other ?? '');
        if (placeholders(h.other ?? '').join() !== eo.join()) bad.push(k);
        for (const form of ['one', 'two'] as const) {
          const m = h[form];
          if (m !== undefined && placeholders(m).some((p) => !eo.includes(p)))
            bad.push(`${k}.${form}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('has no empty messages', () => {
    for (const locale of ['en', 'he'] as const) {
      const empty = Object.entries(MESSAGES[locale]).filter(([, v]) =>
        typeof v === 'string' ? v.trim() === '' : !v.other,
      );
      expect(empty.map(([k]) => k)).toEqual([]);
    }
  });

  // Brand names, header names and shell snippets are intentionally identical in both languages.
  const SAME_OK = new Set([
    'app.productName',
    'audit.userAgent',
    'automation.curlXPostHContent',
    'integrations.bearerToken',
  ]);

  it('translates: Hebrew differs from English for user prose', () => {
    // Allowed to match: brand/technical tokens and symbols with no Hebrew/English letters to translate.
    const same = enKeys.filter((k) => {
      const e = MESSAGES.en[k]!;
      const h = MESSAGES.he[k]!;
      return (
        !SAME_OK.has(k) && typeof e === 'string' && e === h && /[A-Za-z]{4,}\s+[A-Za-z]{2,}/.test(e)
      );
    });
    expect(same).toEqual([]);
  });
});
