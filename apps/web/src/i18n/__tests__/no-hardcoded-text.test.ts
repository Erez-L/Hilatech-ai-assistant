import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findHardcodedText } from '@/test/hardcoded-text';

const SKIP_DIRS = new Set(['__tests__', 'i18n', 'test', 'node_modules']);

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(p, out);
    } else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) && !e.name.endsWith('.d.ts')) {
      out.push(p);
    }
  }
  return out;
}

describe('no hardcoded user-visible text', () => {
  it('finds nothing in web source (use t()/msg(); opt out with `// i18n-ignore: reason`)', () => {
    const root = path.resolve(__dirname, '../..');
    const findings: string[] = [];
    for (const f of walk(root)) {
      for (const x of findHardcodedText(f, fs.readFileSync(f, 'utf8'))) {
        findings.push(`${path.relative(root, f)}:${x.line} [${x.kind}] ${x.text}`);
      }
    }
    expect(findings).toEqual([]);
  });

  it('the guard itself catches the patterns it is meant to', () => {
    const bad = `export const A = () => (<div><button aria-label="Close">Save</button>{toast.success('Done')}</div>);`;
    const kinds = findHardcodedText('x.tsx', bad).map((f) => f.kind);
    expect(kinds).toContain('jsx-text');
    expect(kinds).toContain('jsx-attr');
    expect(kinds).toContain('toast');
    const ok = `// i18n-ignore: brand\nexport const A = () => <div>HilaTech</div>;`;
    expect(findHardcodedText('y.tsx', ok)).toEqual([]);
  });
});
