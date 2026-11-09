import { estimateTokens } from '../tokens';

export interface ChunkOptions {
  /** Target size per chunk in (estimated) tokens. */
  maxTokens?: number;
  /** Tokens of trailing context repeated at the start of the next chunk. */
  overlapTokens?: number;
  /** Hard floor: chunks smaller than this are merged with their neighbour. */
  minTokens?: number;
}

export interface TextChunk {
  index: number;
  content: string;
  tokenCount: number;
  /** Character offsets into the normalised source text. */
  start: number;
  end: number;
}

const DEFAULTS: Required<ChunkOptions> = { maxTokens: 400, overlapTokens: 60, minTokens: 40 };

/** Collapse whitespace noise from extracted documents while keeping paragraph breaks. */
export function normaliseText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Split into sentences/paragraph fragments that never exceed `maxTokens` on their own. */
function fragments(text: string, maxTokens: number): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  const paragraphRe = /[^\n]+(?:\n(?!\n)[^\n]+)*/g;
  for (const para of text.matchAll(paragraphRe)) {
    const paraStart = para.index ?? 0;
    const paraText = para[0];
    if (estimateTokens(paraText) <= maxTokens) {
      out.push({ text: paraText, start: paraStart });
      continue;
    }
    // Sentence split (., !, ?, Hebrew sof pasuq, CJK full stops) keeping delimiters.
    const sentenceRe = /[^.!?。׃]+[.!?。׃]*\s*/g;
    for (const sentence of paraText.matchAll(sentenceRe)) {
      const sStart = paraStart + (sentence.index ?? 0);
      const sText = sentence[0];
      if (estimateTokens(sText) <= maxTokens) {
        out.push({ text: sText, start: sStart });
      } else {
        // Very long sentence: hard-wrap by characters (~4 chars/token).
        const step = Math.max(32, maxTokens * 4);
        for (let i = 0; i < sText.length; i += step) {
          out.push({ text: sText.slice(i, i + step), start: sStart + i });
        }
      }
    }
  }
  return out;
}

/**
 * Greedy chunker with overlap: fills each chunk with whole fragments up to `maxTokens`, then starts
 * the next chunk with the last ~`overlapTokens` worth of fragments from the previous one.
 */
export function chunkText(input: string, options: ChunkOptions = {}): TextChunk[] {
  const opts = { ...DEFAULTS, ...options };
  const text = normaliseText(input);
  if (!text) return [];
  const parts = fragments(text, opts.maxTokens);
  const chunks: TextChunk[] = [];
  let current: Array<{ text: string; start: number }> = [];
  let currentTokens = 0;

  const flush = () => {
    if (current.length === 0) return;
    const first = current[0] as { text: string; start: number };
    const last = current[current.length - 1] as { text: string; start: number };
    const content = current
      .map((p) => p.text)
      .join('')
      .trim();
    if (!content) {
      current = [];
      currentTokens = 0;
      return;
    }
    chunks.push({
      index: chunks.length,
      content,
      tokenCount: estimateTokens(content),
      start: first.start,
      end: last.start + last.text.length,
    });
    // Seed the next chunk with overlap fragments.
    const overlap: typeof current = [];
    let overlapTokens = 0;
    for (let i = current.length - 1; i >= 0 && overlapTokens < opts.overlapTokens; i -= 1) {
      const frag = current[i] as { text: string; start: number };
      overlap.unshift(frag);
      overlapTokens += estimateTokens(frag.text);
    }
    current = overlap.length < current.length ? overlap : [];
    currentTokens = current.reduce((s, f) => s + estimateTokens(f.text), 0);
  };

  for (const part of parts) {
    const t = estimateTokens(part.text);
    if (currentTokens + t > opts.maxTokens && current.length > 0) flush();
    current.push(part);
    currentTokens += t;
  }
  // Final flush without seeding overlap.
  if (current.length > 0) {
    const first = current[0] as { text: string; start: number };
    const last = current[current.length - 1] as { text: string; start: number };
    const content = current
      .map((p) => p.text)
      .join('')
      .trim();
    const previous = chunks[chunks.length - 1];
    if (content && !(previous && previous.content.endsWith(content))) {
      if (
        previous &&
        estimateTokens(content) < opts.minTokens &&
        estimateTokens(previous.content) + estimateTokens(content) <= opts.maxTokens * 1.25
      ) {
        previous.content = `${previous.content}\n${content}`.trim();
        previous.tokenCount = estimateTokens(previous.content);
        previous.end = last.start + last.text.length;
      } else {
        chunks.push({
          index: chunks.length,
          content,
          tokenCount: estimateTokens(content),
          start: first.start,
          end: last.start + last.text.length,
        });
      }
    }
  }
  return chunks;
}
