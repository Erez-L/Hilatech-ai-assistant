#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Counts the SQL statements Postgres executes for ONE call of each hot endpoint (N+1 / chattiness detector).
 * Requires:  ALTER DATABASE hilatech_load SET log_min_duration_statement = 0;  (then restart the load stack so the
 * pool reconnects) and read access to /var/log/postgresql/postgresql-16-main.log. Reset afterwards with
 *   ALTER DATABASE hilatech_load RESET log_min_duration_statement;
 */
import { readFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'undici';

const here = path.dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(here, '.data/manifest.json'), 'utf8'));
const BASE = process.env.BASE_URL ?? 'http://localhost:4150/api/v1';
const LOG = process.env.PG_LOG ?? '/var/log/postgresql/postgresql-16-main.log';
const org = manifest.orgs[0];
const user = org.users[0];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (m, p, { token, body, headers = {} } = {}) => {
  const h = {
    ...headers,
    ...(token ? { authorization: `Bearer ${token}`, 'x-organization-id': org.id } : {}),
  };
  if (body) h['content-type'] = 'application/json';
  const r = await request(BASE + p, {
    method: m,
    headers: h,
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.body.text();
  return { status: r.statusCode, text: t };
};
const sizeOf = () => statSync(LOG).size;
function readFrom(offset) {
  const fd = openSync(LOG, 'r');
  const len = sizeOf() - offset;
  const buf = Buffer.alloc(len);
  readSync(fd, buf, 0, len, offset);
  closeSync(fd);
  return buf.toString('utf8');
}
async function measure(name, fn, show = false) {
  await fn(); // warm-up (prisma statement cache, lazy connections)
  await sleep(400);
  const off = sizeOf();
  const r = await fn();
  await sleep(500);
  const text = readFrom(off);
  const stmts = [
    ...text.matchAll(/duration: ([\d.]+) ms\s+(?:statement|execute [^:]*): (.*)/g),
  ].filter((m) => !/pg_stat_activity|pg_backend_pid/.test(m[2]));
  const total = stmts.reduce((s, m) => s + Number(m[1]), 0);
  console.log(
    `${name.padEnd(34)} http=${r.status}  statements=${String(stmts.length).padStart(3)}  db-time=${total.toFixed(1)} ms`,
  );
  if (show)
    stmts.forEach((m) =>
      console.log(
        '    ',
        Number(m[1]).toFixed(2).padStart(7),
        m[2].replace(/\s+/g, ' ').slice(0, 150),
      ),
    );
}
const show = process.argv.includes('--show');
const login = JSON.parse(
  (await call('POST', '/auth/login', { body: { email: user.email, password: manifest.password } }))
    .text,
);
const token = (login.data ?? login).accessToken;
const only = process.argv.filter((a) => !a.startsWith('--')).slice(2);
const convs = JSON.parse((await call('GET', '/conversations?pageSize=1', { token })).text).data;
const thread = JSON.parse(
  (await call('POST', '/assistant/threads', { token, body: { title: 'qc' } })).text,
).data.id;
const cases = {
  'GET /auth/me (guard overhead)': () => call('GET', '/auth/me', { token }),
  'GET /analytics/dashboard': () => call('GET', '/analytics/dashboard?period=30d', { token }),
  'GET /leads?page=1': () => call('GET', '/leads?page=1&pageSize=20', { token }),
  'GET /leads?search=Website': () => call('GET', '/leads?search=Website&pageSize=20', { token }),
  'GET /contacts?search=Cohen': () => call('GET', '/contacts?search=Cohen&pageSize=20', { token }),
  'GET /conversations': () => call('GET', '/conversations?pageSize=20', { token }),
  'GET /conversations/:id/messages': () =>
    call('GET', `/conversations/${convs[0].id}/messages?pageSize=50`, { token }),
  'POST /knowledge/search': () =>
    call('POST', '/knowledge/search', { token, body: { query: 'refund policy', limit: 5 } }),
  'POST /assistant message (json)': () =>
    call('POST', `/assistant/threads/${thread}/messages`, { token, body: { content: 'hello' } }),
  'POST /agents/:id/execute (async)': () =>
    call('POST', `/agents/${org.agentId}/execute`, { token, body: { input: 'hi', mode: 'async' } }),
  'POST /hooks (inbound webhook)': () =>
    call('POST', `/hooks/${org.slug}/${org.endpointSlug}`, {
      headers: { 'x-webhook-secret': manifest.webhookSecret },
      body: { n: 1 },
    }),
  'POST /auth/login': () =>
    call('POST', '/auth/login', { body: { email: user.email, password: manifest.password } }),
};
for (const [name, fn] of Object.entries(cases))
  if (!only.length || only.some((o) => name.includes(o))) await measure(name, fn, show);
