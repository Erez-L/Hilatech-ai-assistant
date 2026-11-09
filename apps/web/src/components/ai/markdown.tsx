import * as React from 'react';
import { CodeBlock, cn } from '@hilatech/ui';

/**
 * Tiny, safe markdown renderer for assistant output: paragraphs, headings, bullet/numbered lists,
 * fenced code, inline `code`, **bold**, *italic* and http(s)/mailto links. Everything is emitted as
 * React elements (text is escaped by React) — there is no HTML injection path.
 */

type Block =
  | { type: 'p'; text: string }
  | { type: 'h'; level: number; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'code'; lang: string | null; code: string };

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', text: para.join('\n') });
    para = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const fence = /^```\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i] as string)) {
        code.push(lines[i] as string);
        i += 1;
      }
      blocks.push({ type: 'code', lang: fence[1] || null, code: code.join('\n') });
      continue;
    }
    if (line.trim() === '') {
      flushPara();
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      blocks.push({ type: 'h', level: (heading[1] as string).length, text: heading[2] as string });
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (ul || ol) {
      flushPara();
      const ordered = !!ol;
      const items: string[] = [];
      const re = ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/;
      while (i < lines.length) {
        const m = re.exec(lines[i] as string);
        if (!m) break;
        items.push(m[1] as string);
        i += 1;
      }
      i -= 1;
      blocks.push({ type: ordered ? 'ol' : 'ul', items });
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}

const INLINE = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*)|(\[[^\]\n]+\]\([^)\s]+\))/g;

function safeHref(href: string): string | null {
  return /^(https?:\/\/|mailto:)/i.test(href) ? href : null;
}

export function renderInline(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(INLINE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const token = m[0];
    if (m[1]) {
      out.push(
        <code
          key={key++}
          className="rounded-xs bg-surface-muted px-1 py-0.5 font-mono text-[0.85em]"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (m[2]) {
      out.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (m[3]) {
      out.push(<em key={key++}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const href = link ? safeHref(link[2] as string) : null;
      out.push(
        href ? (
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-2"
          >
            {link?.[1]}
          </a>
        ) : (
          token
        ),
      );
    }
    last = start + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ source, className }: { source: string; className?: string }) {
  const blocks = React.useMemo(() => parseBlocks(source), [source]);
  return (
    <div className={cn('flex flex-col gap-2 break-words', className)}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case 'code':
            return <CodeBlock key={i} code={b.code} language={b.lang} />;
          case 'h':
            return (
              <p key={i} className="font-semibold">
                {renderInline(b.text)}
              </p>
            );
          case 'ul':
            return (
              <ul key={i} className="list-disc pl-5">
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={i} className="list-decimal pl-5">
                {b.items.map((item, j) => (
                  <li key={j}>{renderInline(item)}</li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={i} className="whitespace-pre-wrap">
                {renderInline(b.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
