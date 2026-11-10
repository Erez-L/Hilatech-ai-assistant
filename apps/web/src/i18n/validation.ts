import type { MessageKey } from './messages';
import { MESSAGES } from './messages';
import type { TParams } from './translate';

/**
 * Validation messages live inside zod schemas (module scope, no translator). They are encoded as
 * strings (`vm(key, params)`) and translated where they are displayed: `FormField` runs every error
 * through `translateMessage` (wired via UiStrings.formatMessage). Plain English messages from the API or
 * contracts are mapped through a reverse lookup of the English dictionary, so they translate too.
 */
const PREFIX = 'i18n:';

export function vm(key: MessageKey, params?: TParams): string {
  return params ? `${PREFIX}${key}|${JSON.stringify(params)}` : `${PREFIX}${key}`;
}

type Translate = (key: MessageKey, params?: TParams) => string;

let reverse: Map<string, MessageKey> | null = null;
let templates: { re: RegExp; key: MessageKey; names: string[] }[] | null = null;

function buildIndex(): void {
  reverse = new Map();
  templates = [];
  for (const [key, value] of Object.entries(MESSAGES.en)) {
    if (typeof value !== 'string') continue;
    if (!value.includes('{')) {
      if (!reverse.has(value)) reverse.set(value, key as MessageKey);
    } else if (key.startsWith('validation.')) {
      // "Keep the name under {max} characters" -> /^Keep the name under (.+?) characters$/
      const names: string[] = [];
      const source = value
        .split(/\{(\w+)\}/)
        .map((part, i) => {
          if (i % 2 === 1) {
            names.push(part);
            return '(.+?)';
          }
          return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        })
        .join('');
      templates.push({ re: new RegExp(`^${source}$`), key: key as MessageKey, names });
    }
  }
}

function reverseMap(): Map<string, MessageKey> {
  if (!reverse) buildIndex();
  return reverse as Map<string, MessageKey>;
}

/** zod default / contract messages with numbers, mapped by pattern. */
const PATTERNS: { re: RegExp; key: MessageKey; params: (m: RegExpMatchArray) => TParams }[] = [
  {
    re: /^String must contain at least (\d+) character\(s\)$/,
    key: 'validation.minChars',
    params: (m) => ({ count: Number(m[1]) }),
  },
  {
    re: /^String must contain at most (\d+) character\(s\)$/,
    key: 'validation.maxChars',
    params: (m) => ({ count: Number(m[1]) }),
  },
  {
    re: /^Array must contain at most (\d+) element\(s\)$/,
    key: 'validation.maxItems',
    params: (m) => ({ count: Number(m[1]) }),
  },
  {
    re: /^Array must contain at least (\d+) element\(s\)$/,
    key: 'validation.minItems',
    params: (m) => ({ count: Number(m[1]) }),
  },
];

export function translateMessage(t: Translate, message: string): string {
  if (message.startsWith(PREFIX)) {
    const rest = message.slice(PREFIX.length);
    const bar = rest.indexOf('|');
    const key = (bar === -1 ? rest : rest.slice(0, bar)) as MessageKey;
    let params: TParams | undefined;
    if (bar !== -1) {
      try {
        params = JSON.parse(rest.slice(bar + 1)) as TParams;
      } catch {
        params = undefined;
      }
    }
    if (params && typeof params.label === 'string') {
      params = { ...params, label: t(params.label as MessageKey) };
    }
    return t(key, params);
  }
  const exact = reverseMap().get(message);
  if (exact) return t(exact);
  for (const tpl of templates ?? []) {
    const m = message.match(tpl.re);
    if (m) return t(tpl.key, Object.fromEntries(tpl.names.map((n, i) => [n, m[i + 1] as string])));
  }
  for (const p of PATTERNS) {
    const m = message.match(p.re);
    if (m) return t(p.key, p.params(m));
  }
  return message;
}
