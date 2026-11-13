import { describe, expect, it } from 'vitest';
import { ThinkingTagFilter, stripThinkingTags } from '../providers/thinking-filter';

describe('stripThinkingTags', () => {
  it('removes a thinking block and the whitespace around it', () => {
    expect(
      stripThinkingTags('<thinking>I need the tool.</thinking>\n\nYou have 0 open leads.'),
    ).toBe('You have 0 open leads.');
  });

  it('leaves ordinary text, including angle brackets, untouched', () => {
    expect(stripThinkingTags('Use a <b>bold</b> tag when x < 3.')).toBe(
      'Use a <b>bold</b> tag when x < 3.',
    );
  });

  it('drops an unterminated block rather than leaking it', () => {
    expect(stripThinkingTags('Answer.<thinking>half a thought')).toBe('Answer.');
  });

  it('keeps text between two blocks', () => {
    expect(stripThinkingTags('<thinking>a</thinking>One. <thinking>b</thinking>Two.')).toBe(
      'One. Two.',
    );
  });
});

describe('ThinkingTagFilter (streaming)', () => {
  it('handles tags split across chunks', () => {
    const filter = new ThinkingTagFilter();
    const chunks = ['<thi', 'nking>secret', ' plan</thin', 'king>\nHel', 'lo <', 'b>there'];
    const out = chunks.map((c) => filter.push(c)).join('') + filter.flush();
    expect(out).toBe('Hello <b>there');
  });

  it('never emits any part of the thinking text, chunk by chunk', () => {
    const filter = new ThinkingTagFilter();
    const text = 'Hi. <thinking>do not show</thinking> Bye.';
    let out = '';
    for (const ch of text) out += filter.push(ch);
    out += filter.flush();
    expect(out).toBe('Hi. Bye.');
    expect(out).not.toContain('show');
  });
});
