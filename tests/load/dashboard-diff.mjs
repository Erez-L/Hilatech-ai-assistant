#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Differential check for the read-path rewrites (dashboard, AI usage summary, conversation list): `capture <file>`
 * stores the responses for every seeded org; `compare <fileA> <fileB>` diffs two captures ignoring generatedAt /
 * period.to. The load data must be static between captures (no load running), so any difference is a behaviour change.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'undici';
const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, '.data/manifest.json'), 'utf8'));
const BASE = process.env.BASE_URL ?? 'http://localhost:4150/api/v1';
const [cmd, a, b] = process.argv.slice(2);
const strip = (d) => {
  const c = JSON.parse(JSON.stringify(d));
  delete c.generatedAt;
  delete c.period.to;
  return c;
};
if (cmd === 'capture') {
  const out = {};
  for (const o of manifest.orgs) {
    const l = await request(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: o.users[0].email, password: manifest.password }),
    });
    const token = JSON.parse(await l.body.text()).data.accessToken;
    for (const p of ['7d', '30d', '90d']) {
      const r = await request(`${BASE}/analytics/dashboard?period=${p}`, {
        headers: { authorization: `Bearer ${token}`, 'x-organization-id': o.id },
      });
      out[`${o.slug}:${p}`] = strip(JSON.parse(await r.body.text()).data);
    }
    const h = { authorization: `Bearer ${token}`, 'x-organization-id': o.id };
    out[`${o.slug}:usage`] = JSON.parse(
      await (await request(`${BASE}/ai/usage/summary`, { headers: h })).body.text(),
    ).data;
    for (const q of [
      'pageSize=50&page=1',
      'pageSize=50&page=3&status=open',
      'pageSize=20&search=invoice',
    ]) {
      out[`${o.slug}:conversations?${q}`] = JSON.parse(
        await (await request(`${BASE}/conversations?${q}`, { headers: h })).body.text(),
      );
    }
  }
  writeFileSync(a, JSON.stringify(out, null, 1));
  console.log(`captured ${Object.keys(out).length} dashboards -> ${a}`);
} else {
  const A = JSON.parse(readFileSync(a, 'utf8'));
  const B = JSON.parse(readFileSync(b, 'utf8'));
  let bad = 0;
  for (const k of Object.keys(A))
    if (JSON.stringify(A[k]) !== JSON.stringify(B[k])) {
      bad++;
      console.log('DIFF', k);
    }
  console.log(bad === 0 ? `identical (${Object.keys(A).length} dashboards)` : `${bad} differences`);
  process.exit(bad ? 1 : 0);
}
