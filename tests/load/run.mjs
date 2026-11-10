#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * HilaTech load-test runner (closed-loop, undici). One process drives N concurrent virtual users per stage,
 * records per-request latency, and samples CPU / RSS / Postgres connections of the load-test stack once a second.
 *
 *   node tests/load/run.mjs --list
 *   node tests/load/run.mjs --scenario leads_list --stages 1,5,10,25,50 --duration 12
 *   node tests/load/run.mjs --all                       # the default plan used for docs/operations/load-test-results.md
 *   node tests/load/run.mjs --scenario agent_async --burst 600 --concurrency 20   # queue scenarios (see below)
 *
 * Environment: BASE_URL (default http://localhost:4150), WORKERS_URL (default http://localhost:4151),
 * LOAD_DATABASE_URL (default hilatech_load; the runner refuses any other database).
 * Results are appended to tests/load/results/<scenario>-<timestamp>.json.
 */
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, request } from 'undici';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const requireFrom = (dir) => createRequire(path.join(repo, dir, 'package.json'));
const { Client } = requireFrom('packages/database')('pg');

const BASE = process.env.BASE_URL ?? 'http://localhost:4150';
const WORKERS = process.env.WORKERS_URL ?? 'http://localhost:4151';
const DB_URL =
  process.env.LOAD_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/hilatech_load';
if (!/\/hilatech_load(\?|$)/.test(DB_URL))
  throw new Error('runner refuses to touch any database except hilatech_load');
const PREFIX = '/api/v1';
const manifest = JSON.parse(readFileSync(path.join(here, '.data/manifest.json'), 'utf8'));

// ------------------------------------------------------------------ utilities
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0
    ? args[i + 1]?.startsWith('--') || args[i + 1] === undefined
      ? true
      : args[i + 1]
    : def;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pct = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : 0;
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const dispatcher = new Agent({ connections: 512, pipelining: 1, keepAliveTimeout: 30_000 });

/** Weighted org pick (bigger org -> more users), then a random user of that org. */
const orgWeights = manifest.orgs.map((o) => o.leads);
const totalW = orgWeights.reduce((a, b) => a + b, 0);
function pickUser() {
  let r = Math.random() * totalW;
  for (let i = 0; i < manifest.orgs.length; i++) {
    r -= orgWeights[i];
    if (r <= 0) return { org: manifest.orgs[i], user: pick(manifest.orgs[i].users) };
  }
  const o = manifest.orgs[0];
  return { org: o, user: pick(o.users) };
}

async function http(method, p, { token, orgId, body, headers = {}, cookie } = {}) {
  const h = { ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (orgId) h['x-organization-id'] = orgId;
  if (cookie) h.cookie = cookie;
  let payload;
  if (body !== undefined) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    h['content-type'] ??= 'application/json';
  }
  const res = await request(BASE + PREFIX + p, { method, headers: h, body: payload, dispatcher });
  return res;
}

async function login(u) {
  const res = await http('POST', '/auth/login', {
    body: { email: u.email, password: manifest.password },
  });
  const text = await res.body.text();
  if (res.statusCode !== 200)
    throw new Error(`login ${u.email} -> ${res.statusCode} ${text.slice(0, 200)}`);
  const j = JSON.parse(text);
  const sc = res.headers['set-cookie'];
  const cookie = (Array.isArray(sc) ? sc : [sc])
    .filter(Boolean)
    .map((c) => c.split(';')[0])
    .join('; ');
  return { token: (j.data ?? j).accessToken, cookie };
}

// ------------------------------------------------------------------ system sampler
const CLK = 100; // USER_HZ
function readProc(pid) {
  try {
    const st = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const f = st.slice(st.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(f[11]) + Number(f[12]);
    const rss = Number(f[21]) * 4096;
    return { ticks, rss };
  } catch {
    return null;
  }
}
function pidsByName(name) {
  const out = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    try {
      if (readFileSync(`/proc/${d}/comm`, 'utf8').trim() === name) out.push(Number(d));
    } catch {
      /* gone */
    }
  }
  return out;
}
function machineTicks() {
  const l = readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
  const idle = l[3] + l[4];
  const total = l.reduce((a, b) => a + b, 0);
  return { idle, total };
}
const pidFile = (n) => {
  try {
    return Number(readFileSync(`/tmp/hilatech-load/${n}.pid`, 'utf8'));
  } catch {
    return null;
  }
};

class Sampler {
  constructor() {
    this.samples = [];
    this.run = false;
  }
  async start() {
    this.db = new Client({ connectionString: DB_URL });
    await this.db.connect();
    this.run = true;
    this.prev = this.snap();
    this.loop = (async () => {
      while (this.run) {
        await sleep(1000);
        const cur = this.snap();
        const dt = (cur.t - this.prev.t) / 1000;
        const cpu = (a, b) => (a && b ? ((a.ticks - b.ticks) / CLK / dt) * 100 : null);
        let pgTicks = 0;
        let pgPrev = 0;
        for (const [pid, v] of Object.entries(cur.pg)) {
          if (this.prev.pg[pid]) {
            pgTicks += v.ticks;
            pgPrev += this.prev.pg[pid].ticks;
          }
        }
        const mt = cur.m.total - this.prev.m.total;
        let conns = { total: 0, active: 0, idleTx: 0 };
        try {
          const r = await this.db.query(
            `SELECT count(*)::int total, count(*) FILTER (WHERE state='active')::int active,
                    count(*) FILTER (WHERE state LIKE 'idle in transaction%')::int idle_tx
             FROM pg_stat_activity WHERE datname='hilatech_load' AND pid <> pg_backend_pid()`,
          );
          conns = { total: r.rows[0].total, active: r.rows[0].active, idleTx: r.rows[0].idle_tx };
        } catch {
          /* ignore */
        }
        this.samples.push({
          t: cur.t,
          apiCpu: cpu(cur.api, this.prev.api),
          workersCpu: cpu(cur.workers, this.prev.workers),
          pgCpu: ((pgTicks - pgPrev) / CLK / dt) * 100,
          redisCpu: cpu(cur.redis, this.prev.redis),
          genCpu: ((cur.gen - this.prev.gen) / 1e6 / dt) * 100,
          machineCpuPct: mt ? (1 - (cur.m.idle - this.prev.m.idle) / mt) * 100 : null,
          apiRssMb: cur.api ? cur.api.rss / 1048576 : null,
          workersRssMb: cur.workers ? cur.workers.rss / 1048576 : null,
          pgConns: conns.total,
          pgActive: conns.active,
          pgIdleTx: conns.idleTx,
          load1: os.loadavg()[0],
        });
        this.prev = cur;
      }
    })();
  }
  snap() {
    const cu = process.cpuUsage();
    return {
      t: Date.now(),
      api: readProc(pidFile('api')),
      workers: readProc(pidFile('workers')),
      redis: pidsByName('redis-server').map(readProc).find(Boolean) ?? null,
      pg: Object.fromEntries(
        pidsByName('postgres')
          .map((p) => [p, readProc(p)])
          .filter(([, v]) => v),
      ),
      gen: cu.user + cu.system,
      m: machineTicks(),
    };
  }
  mark() {
    return this.samples.length;
  }
  summary(from) {
    const s = this.samples.slice(from);
    const col = (k) => s.map((x) => x[k]).filter((v) => v !== null && Number.isFinite(v));
    const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const max = (a) => (a.length ? Math.max(...a) : null);
    return {
      apiCpuAvg: round(avg(col('apiCpu'))),
      apiCpuMax: round(max(col('apiCpu'))),
      workersCpuAvg: round(avg(col('workersCpu'))),
      pgCpuAvg: round(avg(col('pgCpu'))),
      redisCpuAvg: round(avg(col('redisCpu'))),
      genCpuAvg: round(avg(col('genCpu'))),
      machineCpuAvg: round(avg(col('machineCpuPct'))),
      apiRssMaxMb: round(max(col('apiRssMb')), 0),
      workersRssMaxMb: round(max(col('workersRssMb')), 0),
      pgConnsMax: max(col('pgConns')),
      pgActiveMax: max(col('pgActive')),
      pgIdleTxMax: max(col('pgIdleTx')),
      load1Max: round(max(col('load1')), 2),
    };
  }
  async stop() {
    this.run = false;
    await this.loop;
    await this.db.end();
  }
}

// ------------------------------------------------------------------ scenarios
/**
 * A scenario exposes:
 *   prepare(ctx)            optional, once per run (e.g. collect ids)
 *   vu(ctx, idx)            returns per-VU state (login etc.); async
 *   step(state, ctx)        performs ONE iteration; returns { ok:boolean, status:number, ttfbMs?:number } or throws
 */
const LEAD_TERMS = [
  'Website',
  'CRM',
  'support',
  'Pilot',
  'Consulting',
  'Migration',
  'Cohen',
  'Levi',
  'Dana',
  'Acme',
];
const QUERIES = [
  'what is the refund policy',
  'how long does shipping take',
  'reset my password',
  'enterprise pricing discount',
  'integration with webhooks and email',
  'how long do you retain data',
  'support hours',
  'security encryption audit logs',
];
const mk = (m, p, extra = {}) => ({ m, p, ...extra });

async function doReq(state, r) {
  const t0 = performance.now();
  const res = await http(r.m, r.p, {
    token: state.token,
    orgId: state.org.id,
    body: r.body,
    headers: r.headers,
  });
  let ttfb;
  let bytes = 0;
  if (r.sse) {
    for await (const chunk of res.body) {
      if (ttfb === undefined) ttfb = performance.now() - t0;
      bytes += chunk.length;
    }
  } else {
    await res.body.text();
  }
  return {
    status: res.statusCode,
    ok: res.statusCode >= 200 && res.statusCode < 300,
    ttfbMs: ttfb,
    bytes,
  };
}

async function authedVu(ctx, idx, filter) {
  let pickd;
  do {
    pickd = pickUser();
  } while (filter && !filter(pickd.user));
  const s = await login(pickd.user);
  return { ...pickd, ...s, idx, n: 0 };
}

const scenarios = {
  auth_login: {
    desc: 'POST /auth/login (argon2id verify + refresh-token + audit writes), random seeded users',
    vu: async (ctx, idx) => ({ idx, ...pickUser() }),
    step: async (st) => {
      const t0 = performance.now();
      const res = await http('POST', '/auth/login', {
        body: { email: pickUser().user.email, password: manifest.password },
      });
      await res.body.text();
      return { status: res.statusCode, ok: res.statusCode === 200, t0 };
    },
  },
  auth_refresh: {
    desc: 'POST /auth/refresh (rotating single-use refresh cookie, one session chain per VU)',
    vu: async (ctx, idx) => ({ idx, ...pickUser(), ...(await login(pickUser().user)) }),
    step: async (st) => {
      const res = await http('POST', '/auth/refresh', { cookie: st.cookie });
      const text = await res.body.text();
      if (res.statusCode === 200) {
        const sc = res.headers['set-cookie'];
        st.cookie = (Array.isArray(sc) ? sc : [sc])
          .filter(Boolean)
          .map((c) => c.split(';')[0])
          .join('; ');
      }
      return { status: res.statusCode, ok: res.statusCode === 200 };
    },
  },
  dashboard: {
    desc: 'GET /analytics/dashboard?period=30d (21 queries per call), random org weighted by size',
    vu: (ctx, idx) => authedVu(ctx, idx),
    step: (st) => doReq(st, mk('GET', '/analytics/dashboard?period=30d')),
  },
  leads_list: {
    desc: 'GET /leads paginated (pageSize 20, pages 1-30) with status/source/assignee filters; no text search',
    vu: (ctx, idx) => authedVu(ctx, idx),
    step: (st) => {
      const qs = new URLSearchParams({ page: String(rint(1, 30)), pageSize: '20' });
      const r = Math.random();
      if (r < 0.4)
        qs.set('status', pick(['new', 'contacted', 'qualified', 'proposal', 'won', 'lost']));
      else if (r < 0.6) qs.set('source', pick(['website', 'referral', 'email', 'phone']));
      else if (r < 0.7) qs.set('sortBy', 'value');
      return doReq(st, mk('GET', `/leads?${qs}`));
    },
  },
  leads_search: {
    desc: 'GET /leads?search=<term> (ILIKE over title/description/contact names) with pagination',
    vu: (ctx, idx) => authedVu(ctx, idx),
    step: (st) =>
      doReq(
        st,
        mk(
          'GET',
          `/leads?${new URLSearchParams({ search: pick(LEAD_TERMS), page: String(rint(1, 5)), pageSize: '20' })}`,
        ),
      ),
  },
  contacts_search: {
    desc: 'GET /contacts?search=<term> (ILIKE over name/email/company/phone)',
    vu: (ctx, idx) => authedVu(ctx, idx),
    step: (st) =>
      doReq(
        st,
        mk(
          'GET',
          `/contacts?${new URLSearchParams({ search: pick(['Cohen', 'dana', 'Acme', 'mail.test', '0501', 'Initech']), page: String(rint(1, 5)), pageSize: '20' })}`,
        ),
      ),
  },
  contacts_list: {
    desc: 'GET /contacts paginated (pageSize 20, pages 1-30)',
    vu: (ctx, idx) => authedVu(ctx, idx),
    step: (st) => doReq(st, mk('GET', `/contacts?page=${rint(1, 30)}&pageSize=20`)),
  },
  conversations: {
    desc: 'GET /conversations (status filter, pagination) 60% + GET /conversations/:id/messages 40%',
    prepare: async (ctx) => {
      ctx.convIds = {};
      for (const o of manifest.orgs) {
        const u = o.users[0];
        const s = await login(u);
        const res = await http('GET', '/conversations?pageSize=100&page=1', {
          token: s.token,
          orgId: o.id,
        });
        const j = JSON.parse(await res.body.text());
        ctx.convIds[o.id] = (j.data ?? []).map((c) => c.id);
      }
    },
    vu: (ctx, idx) => authedVu(ctx, idx),
    step: (st, ctx) => {
      if (Math.random() < 0.6) {
        const qs = new URLSearchParams({ page: String(rint(1, 20)), pageSize: '20' });
        if (Math.random() < 0.5) qs.set('status', pick(['open', 'pending', 'resolved']));
        return doReq(st, mk('GET', `/conversations?${qs}`));
      }
      return doReq(
        st,
        mk('GET', `/conversations/${pick(ctx.convIds[st.org.id])}/messages?pageSize=50`),
      );
    },
  },
  knowledge_search: {
    desc: 'POST /knowledge/search (mock embeddings 1536-d, pgvector HNSW cosine, limit 5)',
    vu: (ctx, idx) => authedVu(ctx, idx),
    step: (st) =>
      doReq(st, mk('POST', '/knowledge/search', { body: { query: pick(QUERIES), limit: 5 } })),
  },
  assistant_json: {
    desc: 'POST /assistant/threads/:id/messages (mock provider, JSON response); new thread every 5 messages',
    vu: (ctx, idx) => authedVu(ctx, idx),
    step: async (st) => {
      if (!st.threadId || st.n % 5 === 0) {
        const res = await http('POST', '/assistant/threads', {
          token: st.token,
          orgId: st.org.id,
          body: { title: 'load' },
        });
        st.threadId = (JSON.parse(await res.body.text()).data ?? {}).id;
      }
      st.n++;
      return doReq(
        st,
        mk('POST', `/assistant/threads/${st.threadId}/messages`, {
          body: { content: `Summarise lead number ${st.n} please` },
        }),
      );
    },
  },
  assistant_sse: {
    desc: 'POST /assistant/threads/:id/messages with Accept: text/event-stream (mock provider, SSE)',
    vu: (ctx, idx) => authedVu(ctx, idx),
    step: async (st) => {
      if (!st.threadId || st.n % 5 === 0) {
        const res = await http('POST', '/assistant/threads', {
          token: st.token,
          orgId: st.org.id,
          body: { title: 'load' },
        });
        st.threadId = (JSON.parse(await res.body.text()).data ?? {}).id;
      }
      st.n++;
      return doReq(
        st,
        mk('POST', `/assistant/threads/${st.threadId}/messages`, {
          sse: true,
          headers: { accept: 'text/event-stream' },
          body: { content: `Summarise lead number ${st.n} please` },
        }),
      );
    },
  },
  webhook_ingest_sync: {
    desc: 'POST /hooks/:org/load-endpoint (HTTP 202 path only; queue drain measured by webhook_ingest burst)',
    vu: (ctx, idx) => ({ idx, ...pickUser() }),
    step: async (st) => {
      const o = pick(manifest.orgs);
      const res = await http('POST', `/hooks/${o.slug}/${o.endpointSlug}`, {
        headers: { 'x-webhook-secret': manifest.webhookSecret },
        body: { n: Math.floor(Math.random() * 1e6), source: 'load' },
      });
      await res.body.text();
      return { status: res.statusCode, ok: res.statusCode === 202 };
    },
  },
};

// ------------------------------------------------------------------ closed-loop stage runner
async function runStage(name, sc, vus, durationS, warmupS, sampler, ctx) {
  const states = [];
  const tSetup = performance.now();
  await Promise.all(
    Array.from({ length: vus }, async (_, i) => {
      states[i] = await sc.vu(ctx, i);
    }),
  );
  const setupMs = performance.now() - tSetup;

  const lat = [];
  const ttfb = [];
  const statuses = {};
  let ok = 0;
  let bad = 0;
  let errs = 0;
  let measuring = false;
  let stop = false;
  const runVu = async (i) => {
    while (!stop) {
      const t0 = performance.now();
      let r;
      try {
        r = await sc.step(states[i], ctx);
      } catch (e) {
        r = { ok: false, status: 'ERR:' + (e.code ?? e.message).toString().slice(0, 30) };
      }
      const dt = performance.now() - t0;
      if (!measuring) continue;
      statuses[r.status] = (statuses[r.status] ?? 0) + 1;
      if (r.ok) {
        ok++;
        lat.push(dt);
        if (r.ttfbMs !== undefined) ttfb.push(r.ttfbMs);
      } else if (typeof r.status === 'string') errs++;
      else bad++;
    }
  };
  const workers = Array.from({ length: vus }, (_, i) => runVu(i));
  await sleep(warmupS * 1000);
  const mark = sampler.mark();
  measuring = true;
  const t1 = performance.now();
  await sleep(durationS * 1000);
  const elapsed = (performance.now() - t1) / 1000;
  measuring = false;
  stop = true;
  const sysSummary = sampler.summary(mark);
  await Promise.all(workers);
  lat.sort((a, b) => a - b);
  ttfb.sort((a, b) => a - b);
  const total = ok + bad + errs;
  const out = {
    scenario: name,
    vus,
    durationS: round(elapsed, 1),
    requests: total,
    success: ok,
    rps: round(ok / elapsed),
    errorRate: total ? round(((bad + errs) / total) * 100, 2) : 0,
    statuses,
    p50: round(pct(lat, 50)),
    p95: round(pct(lat, 95)),
    p99: round(pct(lat, 99)),
    max: round(lat[lat.length - 1] ?? 0),
    mean: round(lat.reduce((a, b) => a + b, 0) / (lat.length || 1)),
    ...(ttfb.length ? { ttfbP50: round(pct(ttfb, 50)), ttfbP95: round(pct(ttfb, 95)) } : {}),
    setupSeconds: round(setupMs / 1000, 1),
    cpuMsPerReq: {
      api:
        sysSummary.apiCpuAvg != null && ok
          ? round(((sysSummary.apiCpuAvg / 100) * elapsed * 1000) / ok, 2)
          : null,
      postgres:
        sysSummary.pgCpuAvg != null && ok
          ? round(((sysSummary.pgCpuAvg / 100) * elapsed * 1000) / ok, 2)
          : null,
    },
    sys: sysSummary,
  };
  return out;
}

function printRow(r) {
  console.log(
    `${r.scenario.padEnd(20)} vus=${String(r.vus).padStart(3)} rps=${String(r.rps).padStart(7)} ` +
      `p50=${String(r.p50).padStart(7)} p95=${String(r.p95).padStart(7)} p99=${String(r.p99).padStart(7)} ms ` +
      `err=${r.errorRate}% api-cpu=${r.sys.apiCpuAvg}% pg-cpu=${r.sys.pgCpuAvg}% gen-cpu=${r.sys.genCpuAvg}% ` +
      `machine=${r.sys.machineCpuAvg}% pgconn(max)=${r.sys.pgConnsMax}/act=${r.sys.pgActiveMax} rss=${r.sys.apiRssMaxMb}MB ` +
      `${Object.keys(r.statuses).length > 1 || !r.statuses['200'] ? JSON.stringify(r.statuses) : ''}`,
  );
}

// ------------------------------------------------------------------ queue (burst + drain) scenarios
async function queueDepth(queue) {
  try {
    const res = await request(`${WORKERS}/health`, { dispatcher });
    const j = JSON.parse(await res.body.text());
    const q = j.queues?.[queue];
    // `delayed` is excluded on purpose: the automation queue always holds a delayed repeatable schedule-tick job.
    return q ? q.waiting + q.active : null;
  } catch {
    return null;
  }
}

const queueScenarios = {
  agent_async: {
    queue: 'ai-tasks',
    desc: 'POST /agents/:id/execute (async, 202) burst, then drain through workers (mock provider, no tools)',
    table: 'AgentExecution',
    enqueue: async (st) => {
      const res = await http('POST', `/agents/${st.org.agentId}/execute`, {
        token: st.token,
        orgId: st.org.id,
        body: { input: 'Say hello briefly', mode: 'async' },
      });
      await res.body.text();
      return { status: res.statusCode, ok: res.statusCode === 202 };
    },
    vuLogin: true,
  },
  webhook_ingest: {
    queue: 'automation',
    desc: 'POST /hooks/:org/load-endpoint burst (202), then drain through the automation worker (set_variable + send_notification)',
    table: 'WorkflowExecution',
    enqueue: async (st) => {
      const o = st.org;
      const res = await http('POST', `/hooks/${o.slug}/${o.endpointSlug}`, {
        headers: { 'x-webhook-secret': manifest.webhookSecret },
        body: { n: Math.floor(Math.random() * 1e6) },
      });
      await res.body.text();
      return { status: res.statusCode, ok: res.statusCode === 202 };
    },
    vuLogin: false,
  },
};

async function runQueue(name, total, concurrency, sampler) {
  const sc = queueScenarios[name];
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const startedAt = new Date();
  const states = await Promise.all(
    Array.from({ length: concurrency }, async () => {
      const p = pickUser();
      return { ...p, ...(sc.vuLogin ? await login(p.user) : {}) };
    }),
  );
  // ensure queue empty
  const d0 = await queueDepth(sc.queue);
  const lat = [];
  let sent = 0,
    ok = 0,
    bad = 0;
  const mark = sampler.mark();
  const t0 = performance.now();
  let peak = 0;
  let stopPoll = false;
  const depthSeries = [];
  const poller = (async () => {
    while (!stopPoll) {
      const d = await queueDepth(sc.queue);
      if (d !== null) {
        peak = Math.max(peak, d);
        depthSeries.push([round((performance.now() - t0) / 1000, 1), d]);
      }
      await sleep(500);
    }
  })();
  await Promise.all(
    states.map(async (st) => {
      while (sent < total) {
        sent++;
        const s0 = performance.now();
        let r;
        try {
          r = await sc.enqueue(st);
        } catch {
          r = { ok: false };
        }
        if (r.ok) {
          ok++;
          lat.push(performance.now() - s0);
        } else bad++;
      }
    }),
  );
  const enqueueSeconds = (performance.now() - t0) / 1000;
  const depthAtEndOfEnqueue = await queueDepth(sc.queue);
  // wait for drain
  let drained = false;
  const deadline = performance.now() + 15 * 60 * 1000;
  while (performance.now() < deadline) {
    const d = await queueDepth(sc.queue);
    if (d === 0) {
      const pending = (
        await db.query(
          `SELECT count(*)::int n FROM "${sc.table}" WHERE "createdAt" >= ($1::timestamptz AT TIME ZONE 'UTC') AND status IN ('queued','running')`,
          [startedAt.toISOString()],
        )
      ).rows[0].n;
      if (pending === 0) {
        drained = true;
        break;
      }
    }
    await sleep(250);
  }
  const totalSeconds = (performance.now() - t0) / 1000;
  stopPoll = true;
  await poller;
  const sys = sampler.summary(mark);
  const rows = (
    await db.query(
      `SELECT status, count(*)::int n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch from ("finishedAt" - "createdAt"))*1000) p50,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch from ("finishedAt" - "createdAt"))*1000) p95,
            percentile_cont(0.99) WITHIN GROUP (ORDER BY extract(epoch from ("finishedAt" - "createdAt"))*1000) p99,
            max(extract(epoch from ("finishedAt" - "createdAt"))*1000) max,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch from ("finishedAt" - "startedAt"))*1000) run_p50
     FROM "${sc.table}" WHERE "createdAt" >= ($1::timestamptz AT TIME ZONE 'UTC') GROUP BY status`,
      [startedAt.toISOString()],
    )
  ).rows;
  await db.end();
  lat.sort((a, b) => a - b);
  const done = rows.filter((r) => r.status === 'succeeded').reduce((a, r) => a + r.n, 0);
  const out = {
    scenario: name,
    mode: 'burst+drain',
    jobs: total,
    concurrency,
    enqueue: {
      ok,
      bad,
      seconds: round(enqueueSeconds, 1),
      rps: round(ok / enqueueSeconds),
      p50: round(pct(lat, 50)),
      p95: round(pct(lat, 95)),
      p99: round(pct(lat, 99)),
    },
    queueDepthPeak: peak,
    queueDepthAtEndOfEnqueue: depthAtEndOfEnqueue,
    initialDepth: d0,
    drained,
    secondsToDrainAfterEnqueue: round(totalSeconds - enqueueSeconds, 1),
    totalSeconds: round(totalSeconds, 1),
    processedThroughputPerSec: round(done / totalSeconds, 1),
    byStatus: rows.map((r) => ({
      status: r.status,
      n: r.n,
      queuedToFinishedMs: {
        p50: round(+r.p50, 0),
        p95: round(+r.p95, 0),
        p99: round(+r.p99, 0),
        max: round(+r.max, 0),
      },
      runMsP50: round(+r.run_p50, 0),
    })),
    depthSeries: depthSeries.filter((_, i) => i % 4 === 0),
    sys,
  };
  return out;
}

// ------------------------------------------------------------------ main
const DEFAULT_PLAN = [
  ['auth_login', '1,4,8,16'],
  ['auth_refresh', '1,8,32,64'],
  ['dashboard', '1,5,10,25,50'],
  ['leads_list', '1,10,25,50,100'],
  ['leads_search', '1,5,10,25'],
  ['contacts_list', '1,10,25,50'],
  ['contacts_search', '1,5,10,25'],
  ['conversations', '1,10,25,50,100'],
  ['knowledge_search', '1,10,25,50'],
  ['assistant_json', '1,10,25,50'],
  ['assistant_sse', '1,10,25,50'],
  ['webhook_ingest_sync', '1,10,25,50'],
];

async function main() {
  if (opt('list')) {
    for (const [k, v] of Object.entries(scenarios)) console.log(k.padEnd(22), v.desc);
    for (const [k, v] of Object.entries(queueScenarios)) console.log(k.padEnd(22), v.desc);
    return;
  }
  const health = await request(`${BASE}${PREFIX}/health`, { dispatcher });
  await health.body.text();
  if (health.statusCode !== 200) throw new Error(`API not healthy at ${BASE}`);

  const duration = Number(opt('duration', 12));
  const warmup = Number(opt('warmup', 3));
  const sampler = new Sampler();
  await sampler.start();
  const results = [];
  const tag = opt('tag', '');
  {
    const m = sampler.mark();
    await sleep(6000);
    const idle = sampler.summary(m);
    console.log(
      `idle baseline (6s, no load): machine CPU ${idle.machineCpuAvg}%, api ${idle.apiCpuAvg}%, workers ${idle.workersCpuAvg}%, pg ${idle.pgCpuAvg}%, load1 ${idle.load1Max}`,
    );
    results.push({ scenario: '_idle_baseline', sys: idle });
  }
  mkdirSync(path.join(here, 'results'), { recursive: true });
  const file = path.join(
    here,
    'results',
    `${opt('all') ? 'all' : opt('scenario')}${tag ? '-' + tag : ''}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  const save = () =>
    writeFileSync(
      file,
      JSON.stringify(
        {
          env: {
            cpus: os.cpus().length,
            memGb: round(os.totalmem() / 2 ** 30, 1),
            node: process.version,
            base: BASE,
            tag,
          },
          results,
        },
        null,
        1,
      ),
    );
  const plan = opt('all') ? DEFAULT_PLAN : [[opt('scenario'), opt('stages', '1,10,25')]];
  try {
    for (const [name, stages] of plan) {
      if (queueScenarios[name]) {
        const r = await runQueue(
          name,
          Number(opt('burst', 300)),
          Number(opt('concurrency', 20)),
          sampler,
        );
        results.push(r);
        save();
        console.log(JSON.stringify({ ...r, depthSeries: undefined }, null, 1));
        continue;
      }
      const sc = scenarios[name];
      if (!sc) throw new Error(`unknown scenario ${name}`);
      console.log(`\n== ${name}: ${sc.desc}`);
      const ctx = {};
      await sc.prepare?.(ctx);
      for (const vus of String(stages).split(',').map(Number)) {
        const r = await runStage(name, sc, vus, duration, warmup, sampler, ctx);
        results.push(r);
        save();
        printRow(r);
        await sleep(1500);
      }
    }
    if (opt('all')) {
      for (const [n, burst, c] of [
        ['agent_async', 600, 20],
        ['webhook_ingest', 2000, 20],
      ]) {
        const r = await runQueue(n, burst, c, sampler);
        results.push(r);
        save();
        console.log(JSON.stringify({ ...r, depthSeries: undefined }, null, 1));
      }
    }
  } finally {
    await sampler.stop();
    save();
  }
  console.log(`\nresults -> ${path.relative(repo, file)}`);
  await dispatcher.close();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
