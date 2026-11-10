#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Prints the SQL Prisma generates for the hot read paths and runs EXPLAIN (ANALYZE, BUFFERS) on each statement
 * against the seeded `hilatech_load` database (largest org). Read-only; refuses any other database.
 *
 *   node tests/load/explain.mjs [caseName ...]     # default: all cases
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const req = createRequire(path.join(repo, 'apps/api/package.json'));
const { createPrismaClient } = req('@hilatech/database');
const { Client } = createRequire(path.join(repo, 'packages/database/package.json'))('pg');
const URL_ =
  process.env.LOAD_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/hilatech_load';
if (!/\/hilatech_load(\?|$)/.test(URL_)) throw new Error('refusing: not hilatech_load');
const manifest = JSON.parse(readFileSync(path.join(here, '.data/manifest.json'), 'utf8'));
const org = manifest.orgs[0];
const organizationId = org.id;

const prisma = createPrismaClient({ connectionString: URL_, log: [] });
const captured = [];
// createPrismaClient only exposes basic log levels; re-create with event logging via a second client
const { PrismaClient } = req('@hilatech/database');
const { PrismaPg } = createRequire(path.join(repo, 'packages/database/package.json'))(
  '@prisma/adapter-pg',
);
const evClient = new PrismaClient({
  adapter: new PrismaPg({ connectionString: URL_, max: 2 }),
  log: [{ emit: 'event', level: 'query' }],
});
evClient.$on('query', (e) =>
  captured.push({ query: e.query, params: e.params, duration: e.duration }),
);
await prisma.$disconnect();

const db = new Client({ connectionString: URL_ });
await db.connect();
const contains = (s) => ({ contains: s, mode: 'insensitive' });
const period = { gte: new Date(Date.now() - 30 * 86400_000), lte: new Date() };
const live = { organizationId, deletedAt: null };
const conv = (await evClient.conversation.findFirst({ where: { organizationId } })).id;

const cases = {
  leads_list_page1: () =>
    evClient.lead.findMany({
      where: live,
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: {
        contact: { select: { id: true, firstName: true } },
        assignee: { select: { id: true } },
      },
    }),
  leads_list_deep_page: () =>
    evClient.lead.findMany({ where: live, orderBy: { createdAt: 'desc' }, take: 20, skip: 19_000 }),
  leads_list_status: () =>
    evClient.lead.findMany({
      where: { ...live, status: 'qualified' },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  leads_count_status: () => evClient.lead.count({ where: { ...live, status: 'qualified' } }),
  leads_search: () =>
    evClient.lead.findMany({
      where: {
        ...live,
        OR: [
          { title: contains('Website') },
          { description: contains('Website') },
          { contact: { firstName: contains('Website') } },
          { contact: { lastName: contains('Website') } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  leads_search_count: () =>
    evClient.lead.count({
      where: {
        ...live,
        OR: [
          { title: contains('Website') },
          { description: contains('Website') },
          { contact: { firstName: contains('Website') } },
          { contact: { lastName: contains('Website') } },
        ],
      },
    }),
  contacts_search: () =>
    evClient.contact.findMany({
      where: {
        ...live,
        OR: [
          { firstName: contains('Cohen') },
          { lastName: contains('Cohen') },
          { email: contains('Cohen') },
          { company: contains('Cohen') },
          { phone: contains('Cohen') },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  contacts_search_count: () =>
    evClient.contact.count({
      where: {
        ...live,
        OR: [
          { firstName: contains('Cohen') },
          { lastName: contains('Cohen') },
          { email: contains('Cohen') },
          { company: contains('Cohen') },
          { phone: contains('Cohen') },
        ],
      },
    }),
  conversations_list: () =>
    evClient.conversation.findMany({
      where: { organizationId, status: 'open' },
      orderBy: { lastMessageAt: { sort: 'desc', nulls: 'last' } },
      take: 20,
      include: {
        contact: { select: { id: true } },
        lead: { select: { id: true } },
        assignee: { select: { id: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { role: true, content: true },
        },
      },
    }),
  messages_list: () =>
    evClient.message.findMany({
      where: { conversationId: conv },
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
  dashboard_leads_groupby_status: () =>
    evClient.lead.groupBy({ by: ['status'], where: live, _count: { _all: true } }),
  dashboard_leads_groupby_source: () =>
    evClient.lead.groupBy({ by: ['source'], where: live, _count: { _all: true } }),
  dashboard_leads_new_in_period: () =>
    evClient.lead.count({ where: { ...live, createdAt: period } }),
  dashboard_pipeline_sum: () =>
    evClient.lead.aggregate({
      where: { ...live, status: { notIn: ['won', 'lost'] } },
      _sum: { value: true },
    }),
  dashboard_won_in_period: () =>
    evClient.lead.count({ where: { ...live, status: 'won', updatedAt: period } }),
  dashboard_conv_groupby_status: () =>
    evClient.conversation.groupBy({
      by: ['status'],
      where: { organizationId },
      _count: { _all: true },
    }),
  dashboard_conv_unassigned: () =>
    evClient.conversation.count({
      where: { organizationId, assigneeId: null, status: { in: ['open', 'pending'] } },
    }),
  dashboard_recent_leads: () =>
    evClient.lead.findMany({ where: live, orderBy: { createdAt: 'desc' }, take: 5 }),
  dashboard_contacts_total: () => evClient.contact.count({ where: live }),
  usage_sum_ai_tokens: () =>
    evClient.usageRecord.aggregate({
      where: {
        organizationId,
        metric: 'ai_tokens',
        periodStart: {
          gte: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)),
        },
      },
      _sum: { quantity: true },
    }),
};
const raw = {
  dashboard_daily_series: [
    `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date, COUNT(*)::int AS count FROM "Lead" WHERE "organizationId" = $1::uuid AND "createdAt" >= $2 AND "createdAt" <= $3 AND "deletedAt" IS NULL GROUP BY 1 ORDER BY 1`,
    [organizationId, period.gte.toISOString(), period.lte.toISOString()],
  ],
};

const want = process.argv.slice(2);
for (const [name, fn] of Object.entries(cases)) {
  if (want.length && !want.includes(name)) continue;
  captured.length = 0;
  const t0 = performance.now();
  await fn();
  const wall = performance.now() - t0;
  console.log(
    `\n===== ${name}  (prisma wall ${wall.toFixed(1)} ms, ${captured.length} statement(s))`,
  );
  for (const c of captured) {
    if (!/^\s*SELECT/i.test(c.query)) continue;
    console.log(`-- SQL: ${c.query.replace(/\s+/g, ' ').slice(0, 700)}`);
    let params;
    try {
      params = JSON.parse(c.params);
    } catch {
      params = [];
    }
    try {
      const r = await db.query(`EXPLAIN (ANALYZE, BUFFERS) ${c.query}`, params);
      console.log(r.rows.map((x) => x['QUERY PLAN']).join('\n'));
    } catch (e) {
      console.log('EXPLAIN failed:', e.message);
    }
  }
}
for (const [name, [sql, params]] of Object.entries(raw)) {
  if (want.length && !want.includes(name)) continue;
  console.log(`\n===== ${name} (raw)`);
  const r = await db.query(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, params);
  console.log(r.rows.map((x) => x['QUERY PLAN']).join('\n'));
}
await db.end();
await evClient.$disconnect();
