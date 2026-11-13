const OPEN = '<thinking>';
const CLOSE = '</thinking>';

/** Length of the longest suffix of `text` that is a proper prefix of `tag` (a tag split across chunks). */
function partialTagSuffix(text: string, tag: string): number {
  const max = Math.min(text.length, tag.length - 1);
  for (let n = max; n > 0; n--) if (text.endsWith(tag.slice(0, n))) return n;
  return 0;
}

/**
 * Removes inline `<thinking>…</thinking>` blocks from model text.
 *
 * Some Bedrock models (Amazon Nova) write their reasoning into the answer itself rather than a
 * separate reasoning block. That text is not meant for the end user and must not reach chat
 * replies, CRM notes or evaluation checks. Works on a stream: tags may be split across chunks.
 */
export class ThinkingTagFilter {
  private buffer = '';
  private inside = false;
  /** Drop whitespace at the very start and right after a removed block. */
  private trimNext = true;

  push(chunk: string): string {
    this.buffer += chunk;
    let out = '';
    for (;;) {
      if (this.inside) {
        const end = this.buffer.indexOf(CLOSE);
        if (end === -1) {
          this.buffer = this.buffer.slice(
            this.buffer.length - partialTagSuffix(this.buffer, CLOSE),
          );
          break;
        }
        this.buffer = this.buffer.slice(end + CLOSE.length);
        this.inside = false;
        this.trimNext = true;
      } else {
        const start = this.buffer.indexOf(OPEN);
        if (start === -1) {
          const keep = partialTagSuffix(this.buffer, OPEN);
          out += this.visible(this.buffer.slice(0, this.buffer.length - keep));
          this.buffer = this.buffer.slice(this.buffer.length - keep);
          break;
        }
        out += this.visible(this.buffer.slice(0, start));
        this.buffer = this.buffer.slice(start + OPEN.length);
        this.inside = true;
      }
    }
    return out;
  }

  /** Call once at the end of the stream; returns text held back as a possible partial tag. */
  flush(): string {
    const rest = this.inside ? '' : this.visible(this.buffer);
    this.buffer = '';
    return rest;
  }

  private visible(text: string): string {
    if (!this.trimNext) return text;
    const trimmed = text.replace(/^\s+/, '');
    if (trimmed.length > 0) this.trimNext = false;
    return trimmed;
  }
}

/** Non-streaming form of {@link ThinkingTagFilter}. */
export function stripThinkingTags(text: string): string {
  const filter = new ThinkingTagFilter();
  return filter.push(text) + filter.flush();
}
