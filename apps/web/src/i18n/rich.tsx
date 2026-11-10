import * as React from 'react';
import type { MessageKey } from './messages';
import type { TParams } from './translate';

type Translate = (key: MessageKey, params?: TParams) => string;
const MARK = '\u0001';

/**
 * Renders a message that contains inline elements. Put `{name}` placeholders in the message and pass the
 * elements by name; translators move them freely, e.g. `t.rich(t, 'x.key', { code: <code>…</code> })`.
 */
export function rich(
  t: Translate,
  key: MessageKey,
  nodes: Record<string, React.ReactNode>,
  params: TParams = {},
): React.ReactNode {
  const markers = Object.fromEntries(Object.keys(nodes).map((k) => [k, `${MARK}${k}${MARK}`]));
  const text = t(key, { ...params, ...markers });
  const parts = text.split(new RegExp(`${MARK}(\\w+)${MARK}`));
  return parts.map((part, i) =>
    i % 2 === 1 ? <React.Fragment key={i}>{nodes[part]}</React.Fragment> : part,
  );
}
