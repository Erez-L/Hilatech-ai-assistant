import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/** Physical Tailwind utilities that break in RTL. Use the logical (start/end) equivalents. */
const PHYSICAL =
  /(?<![\w./[-])(?:-?(?:ml|mr|pl|pr|left|right)-(?:\d|\[|px|auto|full|1\/|0)|text-(?:left|right)\b|border-[lr](?:\s|-|"|'|`)|rounded-(?:l|r|tl|tr|bl|br)(?:\s|-|"|'|`)|float-(?:left|right)\b|space-x-|divide-x\b)/g;

// Dialog/Sheet centering is intentionally physical (left-1/2 + translate) and symmetric.
const ALLOWED = [/left-1\/2/, /right-1\/2/, /-?translate-x/];

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!['node_modules', '__tests__', 'test', 'dist'].includes(e.name)) walk(p, out);
    } else if (/\.(tsx|css)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
}

describe('RTL: no physical direction utilities', () => {
  const roots = [
    path.resolve(__dirname, '../..'),
    path.resolve(__dirname, '../../../../../packages/ui/src'),
  ];
  it('uses logical start/end classes only', () => {
    const hits: string[] = [];
    for (const root of roots) {
      for (const f of walk(root)) {
        fs.readFileSync(f, 'utf8')
          .split('\n')
          .forEach((line, i) => {
            if (/rtl-ok/.test(line)) return;
            for (const m of line.matchAll(PHYSICAL)) {
              if (
                ALLOWED.some(
                  (a) =>
                    a.test(line) &&
                    a.test(m[0] + line.slice(m.index! + m[0].length, m.index! + m[0].length + 3)),
                )
              )
                continue;
              hits.push(`${path.relative(process.cwd(), f)}:${i + 1} ${m[0]}`);
            }
          });
      }
    }
    expect(hits).toEqual([]);
  });
});
