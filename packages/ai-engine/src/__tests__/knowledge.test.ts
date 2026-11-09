import { describe, expect, it } from 'vitest';

import { chunkText, normaliseText } from '../knowledge/chunking';
import { normaliseDimensions, toVectorLiteral } from '../knowledge/embedding-service';
import { noopLogger } from '../tools/types';
import { estimateTokens } from '../tokens';

describe('chunkText', () => {
  it('returns nothing for empty input and one chunk for short text', () => {
    expect(chunkText('   \n\n ')).toEqual([]);
    const chunks = chunkText('Hello world. This is short.');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.index).toBe(0);
    expect(chunks[0]?.tokenCount).toBeGreaterThan(0);
  });

  it('splits long text into bounded chunks with overlap and sequential indexes', () => {
    const paragraph = Array.from(
      { length: 40 },
      (_, i) => `Sentence number ${i} talks about pricing and delivery terms.`,
    ).join(' ');
    const text = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;
    const chunks = chunkText(text, { maxTokens: 120, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(3);
    chunks.forEach((c, i) => {
      expect(c.index).toBe(i);
      expect(c.tokenCount).toBeLessThanOrEqual(150);
      expect(c.content.length).toBeGreaterThan(0);
    });
    // Overlap: the start of chunk 2 appears at the end of chunk 1.
    const head = chunks[1]?.content.slice(0, 30) ?? '';
    expect(chunks[0]?.content.includes(head.trim().slice(0, 15))).toBe(true);
  });

  it('hard-wraps a single giant token-less string', () => {
    const chunks = chunkText('x'.repeat(5000), { maxTokens: 100 });
    expect(chunks.length).toBeGreaterThan(5);
    expect(Math.max(...chunks.map((c) => estimateTokens(c.content)))).toBeLessThanOrEqual(130);
  });

  it('normalises whitespace but keeps paragraph breaks', () => {
    expect(normaliseText('a\r\n\r\n\r\n\r\nb\t\tc   d')).toBe('a\n\nb c d');
  });
});

describe('embedding helpers', () => {
  it('pads short vectors and truncates long ones to 1536', () => {
    expect(normaliseDimensions([1, 2, 3], noopLogger, 'm')).toHaveLength(1536);
    expect(normaliseDimensions(new Array(3072).fill(0.5), noopLogger, 'm')).toHaveLength(1536);
    const exact = new Array(1536).fill(0.1);
    expect(normaliseDimensions(exact, noopLogger, 'm')).toBe(exact);
  });

  it('renders a pgvector literal without scientific notation', () => {
    expect(toVectorLiteral([0.5, -1, 1e-9, Number.NaN])).toBe('[0.5,-1,0,0]');
  });
});
