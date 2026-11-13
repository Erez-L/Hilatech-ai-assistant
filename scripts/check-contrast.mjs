#!/usr/bin/env node
/**
 * Measures WCAG 2.x contrast for the design-token pairs the UI actually uses, in the light and the dark theme,
 * straight from packages/ui/src/styles.css. Exit code 1 when a pair is below its minimum.
 *
 *   node scripts/check-contrast.mjs
 *
 * Minimums: 4.5 for text, 3.0 for large/bold labels on filled controls and for non-text UI (borders of inputs).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../packages/ui/src/styles.css'),
  'utf8',
);

function block(selectorRegex) {
  const match = css.match(selectorRegex);
  if (!match) throw new Error(`block not found: ${selectorRegex}`);
  const vars = {};
  for (const [, name, value] of match[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) vars[name] = value.trim();
  return vars;
}

const light = block(/:root\s*\{\s*color-scheme: light;([\s\S]*?)\n\}/);
const dark = { ...light, ...block(/\.dark\s*\{\s*color-scheme: dark;([\s\S]*?)\n\}/) };
const sidebar = block(/\.sidebar-scope\s*\{([\s\S]*?)\n\}/);
const tones = {};
for (const [, name, body] of css.matchAll(/\[data-tone='(\w+)'\][^{]*\{([\s\S]*?)\n\}/g)) {
  tones[name] = {};
  for (const [, key, value] of body.matchAll(/--([\w-]+):\s*([^;]+);/g)) tones[name][key] = value.trim();
}

const hex = (value) => {
  const m = /^#([0-9a-f]{6})$/i.exec(value);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbFn = (value) => {
  const m = /^rgb\((\d+) (\d+) (\d+)(?: \/ ([\d.]+))?\)$/.exec(value);
  return m ? { rgb: [+m[1], +m[2], +m[3]], alpha: m[4] ? +m[4] : 1 } : null;
};
/** Resolves a token value to opaque RGB, compositing translucent values over `under`. */
function resolve(value, under) {
  const solid = hex(value);
  if (solid) return solid;
  const fn = rgbFn(value);
  if (!fn) throw new Error(`cannot resolve colour: ${value}`);
  return fn.rgb.map((c, i) => Math.round(c * fn.alpha + under[i] * (1 - fn.alpha)));
}
const mix = (a, b, share) => a.map((c, i) => Math.round(c * share + b[i] * (1 - share)));
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const rows = [];
const check = (theme, label, fg, bg, min) => {
  const value = ratio(fg, bg);
  rows.push({ theme, label, value, min, ok: value >= min });
};

for (const [theme, t] of [
  ['light', light],
  ['dark', dark],
]) {
  const c = (name, under) => resolve(t[name], under ?? hex(t.surface));
  const surfaces = { bg: c('bg'), surface: c('surface'), 'surface-muted': c('surface-muted') };
  for (const [surfaceName, surface] of Object.entries(surfaces)) {
    check(theme, `fg on ${surfaceName}`, c('fg'), surface, 4.5);
    check(theme, `fg-muted on ${surfaceName}`, c('fg-muted'), surface, 4.5);
    check(theme, `fg-subtle on ${surfaceName}`, c('fg-subtle'), surface, 4.5);
    check(theme, `accent (links) on ${surfaceName}`, c('accent'), surface, 4.5);
  }
  check(theme, 'accent-fg on accent (primary button)', c('accent-fg'), c('accent'), 4.5);
  check(theme, 'danger-fg on danger (danger button)', c('danger-fg'), c('danger'), 4.5);
  check(theme, 'danger text on surface', c('danger'), c('surface'), 4.5);
  for (const kind of ['accent', 'success', 'warning', 'danger', 'info']) {
    check(theme, `${kind}-soft-fg on ${kind}-soft (badge)`, c(`${kind}-soft-fg`), c(`${kind}-soft`), 4.5);
  }
  check(theme, 'border-control on surface (input outline)', c('border-control'), c('surface'), 3);
  check(theme, 'border-control on bg (input outline)', c('border-control'), c('bg'), 3);

  for (const [name, tone] of Object.entries(tones)) {
    const bright = hex(tone['tone-bright']);
    if (theme === 'light') {
      check(theme, `tone ${name}: tone-fg on tone-soft`, hex(tone['tone-fg']), hex(tone['tone-soft']), 4.5);
      check(theme, `tone ${name}: white on tone (icon tile)`, [255, 255, 255], hex(tone.tone), 3);
      check(theme, `tone ${name}: tone-fg on surface`, hex(tone['tone-fg']), c('surface'), 4.5);
    } else {
      // Dark: tone-fg = tone-bright, tone-soft = 18% of it over the surface, tone-on = #0f1729 on the bright tile.
      const soft = mix(bright, c('surface'), 0.18);
      check(theme, `tone ${name}: tone-fg on tone-soft`, bright, soft, 4.5);
      check(theme, `tone ${name}: tone-on on tone (icon tile)`, [15, 23, 41], bright, 3);
      check(theme, `tone ${name}: tone-fg on surface`, bright, c('surface'), 4.5);
    }
  }
}

// The navigation rail is dark in both themes.
for (const [theme, t] of [
  ['light', light],
  ['dark', dark],
]) {
  const rail = hex(t.sidebar);
  for (const name of ['fg', 'fg-muted', 'fg-subtle']) {
    check(`${theme} rail`, `${name} on sidebar`, resolve(sidebar[name], rail), rail, 4.5);
  }
  for (const [name, tone] of Object.entries(tones)) {
    check(`${theme} rail`, `tone ${name}: bright icon on sidebar`, hex(tone['tone-bright']), rail, 3);
  }
}

let failed = 0;
for (const row of rows) {
  if (!row.ok) failed += 1;
  if (!row.ok || process.argv.includes('--all')) {
    console.log(
      `${row.ok ? 'ok  ' : 'FAIL'} ${row.value.toFixed(2).padStart(5)} (min ${row.min})  [${row.theme}] ${row.label}`,
    );
  }
}
console.log(`\n${rows.length - failed}/${rows.length} pairs meet their minimum.`);
process.exit(failed ? 1 : 0);
