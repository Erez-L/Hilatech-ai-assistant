/* eslint-disable no-console */
/**
 * Load-test seed. Writes ONLY to the separate `hilatech_load` database (hard guard below) using
 * set-based SQL (generate_series), so ~50k leads + ~50k contacts + 20k conversations (100k messages)
 * are created in well under a minute. Deterministic enough to compare runs (random() is not seeded, but
 * volumes and distributions are fixed).
 *
 *   createdb hilatech_load && DATABASE_URL=.../hilatech_load node scripts/prisma-wasm-migrate.mjs apply
 *   npx tsx tests/load/seed.ts            # from packages/database (tsx lives there), see tests/load/README.md
 *
 * Output: tests/load/.data/manifest.json (orgs, users, agent, knowledge bases, webhook endpoints) consumed by
 * run.mjs. The shared password for every seeded user is LOAD_PASSWORD (default below).
 */
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const requireFrom = (pkgDir: string) => createRequire(path.join(repo, pkgDir, 'package.json'));

const { Client } = requireFrom('packages/database')('pg') as typeof import('pg');
const argon2 = requireFrom('apps/api')('argon2') as typeof import('argon2');
const contracts = requireFrom('apps/api')(
  '@hilatech/contracts',
) as typeof import('@hilatech/contracts');
const engine = requireFrom('apps/api')(
  '@hilatech/ai-engine',
) as typeof import('@hilatech/ai-engine');
const shared = requireFrom('apps/api')('@hilatech/shared') as typeof import('@hilatech/shared');

const URL_ =
  process.env.LOAD_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/hilatech_load';
if (!/\/hilatech_load(\?|$)/.test(URL_)) {
  console.error(`Refusing to seed: ${URL_} is not the hilatech_load database`);
  process.exit(1);
}
export const LOAD_PASSWORD = process.env.LOAD_PASSWORD ?? 'LoadTest-Passw0rd!';

/** [slug, leads, contacts, conversations, users, knowledge chunks] */
const ORGS: Array<[string, number, number, number, number, number]> = [
  ['load-org-1', 20_000, 20_000, 8_000, 40, 3_000],
  ['load-org-2', 10_000, 10_000, 4_000, 30, 2_000],
  ['load-org-3', 8_000, 8_000, 3_000, 25, 2_000],
  ['load-org-4', 5_000, 5_000, 2_000, 20, 1_500],
  ['load-org-5', 4_000, 4_000, 1_800, 15, 1_500],
  ['load-org-6', 3_000, 3_000, 1_200, 10, 1_000],
];

const KB_TEXTS = [
  'refund policy customers may request a refund within thirty days of purchase with proof of payment',
  'shipping times standard delivery takes five business days express delivery takes two business days',
  'password reset users can reset their password from the login page using the forgot password link',
  'enterprise pricing includes volume discounts annual billing and a dedicated account manager',
  'integration guide connect the crm to email calendars and webhooks using the api keys page',
  'data retention conversations and documents are retained for ninety days after account closure',
  'support hours the support team is available sunday to thursday from nine to six israel time',
  'onboarding checklist invite teammates configure ai provider upload documents create first agent',
  'security overview encryption at rest tls in transit role based access control and audit logs',
  'invoice questions invoices are issued monthly and can be downloaded from the billing page',
];
const VOCAB =
  'account billing contract customer delivery discount escalation feature invoice license migration onboarding payment pricing quote renewal report setup support trial upgrade warranty workflow'.split(
    ' ',
  );

async function main(): Promise<void> {
  const db = new Client({ connectionString: URL_ });
  await db.connect();
  const q = (text: string, values?: unknown[]) => db.query(text, values);
  const t0 = Date.now();

  const existing = await q(
    `SELECT count(*)::int AS n FROM "Organization" WHERE slug LIKE 'load-org-%'`,
  );
  if (existing.rows[0].n > 0) {
    console.error(
      'hilatech_load already seeded (load-org-* exist). Drop/recreate the database to reseed.',
    );
    process.exit(1);
  }

  const passwordHash = await argon2.hash(LOAD_PASSWORD, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
  const secretPlain = 'load-test-webhook-secret-0001';
  const secretHash = shared.hashEndpointSecret(secretPlain);

  for (const key of contracts.ALL_PERMISSIONS) {
    await q(`INSERT INTO "Permission"(key, "group") VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`, [
      key,
      key.split(':')[0] ?? 'misc',
    ]);
  }

  const manifest: Record<string, unknown> = {
    password: LOAD_PASSWORD,
    webhookSecret: secretPlain,
    orgs: [],
  };
  const mockEmb = (text: string) =>
    `[${engine
      .mockEmbedding(text, 1536)
      .map((v) => v.toFixed(5))
      .join(',')}]`;

  for (const [slug, nLeads, nContacts, nConvs, nUsers, nChunks] of ORGS) {
    const org = (
      await q(
        `INSERT INTO "Organization"(id,name,slug,industry,timezone,"updatedAt") VALUES (gen_random_uuid(),$1,$1,'Services','Asia/Jerusalem',now()) RETURNING id`,
        [slug],
      )
    ).rows[0].id as string;

    // roles
    const roleIds: Record<string, string> = {};
    for (const key of Object.values(contracts.SystemRole) as string[]) {
      const perms =
        contracts.SYSTEM_ROLE_PERMISSIONS[key as keyof typeof contracts.SYSTEM_ROLE_PERMISSIONS];
      const r = await q(
        `INSERT INTO "Role"(id,"organizationId",key,name,"isSystem",permissions,"updatedAt") VALUES (gen_random_uuid(),$1,$2,$2,true,$3,now()) RETURNING id`,
        [org, key, [...perms]],
      );
      roleIds[key] = r.rows[0].id;
    }

    // users + memberships (1 owner, ~10% admins, rest members)
    const users = (
      await q(
        `INSERT INTO "User"(id,email,"passwordHash","firstName","lastName","emailVerifiedAt","updatedAt")
         SELECT gen_random_uuid(), 'u'||g||'@'||$1||'.load.test', $2, 'Load', 'User'||g, now(), now()
         FROM generate_series(1,$3::int) g RETURNING id, email`,
        [slug, passwordHash, nUsers],
      )
    ).rows as Array<{ id: string; email: string }>;
    users.sort((a, b) => Number(/u(\d+)@/.exec(a.email)![1]) - Number(/u(\d+)@/.exec(b.email)![1]));
    const roleOf = (i: number) =>
      i === 0 ? 'owner' : i <= Math.max(2, Math.floor(nUsers / 10)) ? 'admin' : 'member';
    for (let i = 0; i < users.length; i++) {
      await q(
        `INSERT INTO "OrganizationMember"(id,"organizationId","userId","roleId","updatedAt") VALUES (gen_random_uuid(),$1,$2,$3,now())`,
        [org, users[i]!.id, roleIds[roleOf(i)]],
      );
    }
    const now = new Date();
    const end = new Date(now);
    end.setMonth(end.getMonth() + 1);
    await q(
      `INSERT INTO "Subscription"(id,"organizationId",plan,status,limits,"currentPeriodStart","currentPeriodEnd","updatedAt")
       VALUES (gen_random_uuid(),$1,'enterprise','active',$2,$3,$4,now())`,
      [org, JSON.stringify(contracts.PLAN_LIMITS.enterprise), now, end],
    );

    // AI provider (mock) as the org default
    const provider = (
      await q(
        `INSERT INTO "AiProviderConfig"(id,"organizationId",provider,name,"defaultModel","embeddingModel","isDefault","isEnabled","updatedAt")
         VALUES (gen_random_uuid(),$1,'mock','Mock (load test)','mock-chat','mock-embedding',true,true,now()) RETURNING id`,
        [org],
      )
    ).rows[0].id as string;

    // contacts
    await q(
      `INSERT INTO "Contact"(id,"organizationId","firstName","lastName",email,phone,company,"jobTitle",tags,notes,"ownerId","deletedAt","createdAt","updatedAt")
       SELECT gen_random_uuid(), $1,
              (ARRAY['Dana','Noa','Avi','Yael','Omer','Tal','Lior','Maya','Eitan','Shira'])[1+floor(random()*10)::int],
              (ARRAY['Cohen','Levi','Mizrahi','Peretz','Biton','Dahan','Avraham','Friedman','Katz','Shapiro'])[1+floor(random()*10)::int] || g,
              'contact'||g||'@'||(ARRAY['example.com','mail.test','corp.test'])[1+floor(random()*3)::int],
              '05'||lpad((floor(random()*100000000))::text,8,'0'),
              (ARRAY['Acme','Globex','Initech','Umbrella','Hooli','Stark','Wayne','Wonka'])[1+floor(random()*8)::int] || ' Ltd ' || (g % 500),
              'Manager',
              CASE WHEN random() < 0.2 THEN ARRAY['vip'] ELSE ARRAY[]::text[] END,
              NULL,
              um.id,
              CASE WHEN random() < 0.03 THEN now() ELSE NULL END,
              now() - (random()*interval '365 days'), now()
       FROM generate_series(1,$2::int) g
       CROSS JOIN LATERAL (SELECT 1+floor(random()*$3::int)::int AS r WHERE g > 0) rr
       JOIN LATERAL (SELECT "userId" AS id FROM "OrganizationMember" WHERE "organizationId"=$1 ORDER BY "userId" OFFSET (rr.r-1) LIMIT 1) um ON true`,
      [org, nContacts, nUsers],
    );

    // leads (contactId random existing contact via offset)
    await q(
      `WITH c AS (SELECT id, row_number() OVER () AS rn FROM "Contact" WHERE "organizationId"=$1),
            u AS (SELECT "userId" AS id, row_number() OVER () AS rn FROM "OrganizationMember" WHERE "organizationId"=$1)
       INSERT INTO "Lead"(id,"organizationId",title,status,source,value,currency,"contactId","assigneeId",description,tags,"deletedAt","createdAt","updatedAt")
       SELECT gen_random_uuid(), $1,
              (ARRAY['Website redesign','CRM rollout','Annual support','Pilot project','Consulting','Integration','Migration','Training'])[1+floor(random()*8)::int] || ' #' || g,
              (ARRAY['new','contacted','qualified','proposal','won','lost'])[1+floor(random()*6)::int]::"LeadStatus",
              (ARRAY['website','referral','social','email','phone','whatsapp','event','ai_assistant','other'])[1+floor(random()*9)::int]::"LeadSource",
              round((random()*50000)::numeric,2), 'ILS',
              c.id, u.id,
              CASE WHEN random()<0.5 THEN 'Customer asked about '||(ARRAY['pricing','delivery','integration','support','renewal'])[1+floor(random()*5)::int] ELSE NULL END,
              CASE WHEN random() < 0.15 THEN ARRAY['hot'] ELSE ARRAY[]::text[] END,
              CASE WHEN random() < 0.02 THEN now() ELSE NULL END,
              now() - (random()*interval '365 days'), now()
       FROM generate_series(1,$2::int) g
       CROSS JOIN LATERAL (SELECT 1+floor(random()*$3::int)::int AS r1, 1+floor(random()*$4::int)::int AS r2 WHERE g > 0) rr
       JOIN c ON c.rn = rr.r1 JOIN u ON u.rn = rr.r2`,
      [org, nLeads, nContacts, nUsers],
    );

    // conversations + messages
    await q(
      `WITH c AS (SELECT id, row_number() OVER () AS rn FROM "Contact" WHERE "organizationId"=$1),
            u AS (SELECT "userId" AS id, row_number() OVER () AS rn FROM "OrganizationMember" WHERE "organizationId"=$1)
       INSERT INTO "Conversation"(id,"organizationId",subject,status,channel,"contactId","assigneeId","lastMessageAt","messageCount","createdAt","updatedAt")
       SELECT gen_random_uuid(), $1,
              (ARRAY['Question about invoice','Delivery delay','Quote request','Login problem','Feature request'])[1+floor(random()*5)::int] || ' ' || g,
              (ARRAY['open','pending','resolved','archived'])[1+floor(random()*4)::int]::"ConversationStatus",
              (ARRAY['web','email','whatsapp','phone','internal','api'])[1+floor(random()*6)::int]::"ConversationChannel",
              c.id,
              CASE WHEN random()<0.7 THEN u.id END,
              now() - (random()*interval '90 days'), 5,
              now() - (random()*interval '120 days'), now()
       FROM generate_series(1,$2::int) g
       CROSS JOIN LATERAL (SELECT 1+floor(random()*$3::int)::int AS r1, 1+floor(random()*$4::int)::int AS r2 WHERE g > 0) rr
       JOIN c ON c.rn = rr.r1 JOIN u ON u.rn = rr.r2`,
      [org, nConvs, nContacts, nUsers],
    );
    await q(
      `INSERT INTO "Message"(id,"conversationId",role,content,"createdAt")
       SELECT gen_random_uuid(), c.id,
              (ARRAY['customer','agent','customer','agent','system'])[m]::"MessageRole",
              'Message '||m||' of conversation. ' || md5(random()::text), c."createdAt" + (m * interval '3 minutes')
       FROM "Conversation" c CROSS JOIN generate_series(1,5) m WHERE c."organizationId"=$1`,
      [org],
    );

    // usage history (month to date) so entitlement/budget sums are realistic
    await q(
      `INSERT INTO "UsageRecord"(id,"organizationId","userId",metric,quantity,"periodStart","periodEnd",metadata)
       SELECT gen_random_uuid(), $1, NULL, 'ai_tokens', 200 + floor(random()*3000), date_trunc('month', now()), date_trunc('month', now()) + interval '1 month', '{}'
       FROM generate_series(1,$2::int)`,
      [org, Math.round(nLeads / 4)],
    );

    // knowledge base with ready documents + mock-embedded chunks
    const kb = (
      await q(
        `INSERT INTO "KnowledgeBase"(id,"organizationId",name,"embeddingProviderConfigId","embeddingModel","updatedAt")
         VALUES (gen_random_uuid(),$1,'Load KB',$2,'mock-embedding',now()) RETURNING id`,
        [org, provider],
      )
    ).rows[0].id as string;
    const nDocs = Math.max(10, Math.round(nChunks / 25));
    await q(
      `INSERT INTO "Document"(id,"organizationId","knowledgeBaseId",title,"fileName","mimeType","sizeBytes","storageKey",status,"chunkCount","processedAt","updatedAt")
       SELECT gen_random_uuid(), $1, $2, 'Doc '||g, 'doc'||g||'.txt', 'text/plain', 4096, $3||'/doc'||g, 'ready', $5, now(), now()
       FROM generate_series(1,$4::int) g`,
      [org, kb, slug, nDocs, Math.ceil(nChunks / nDocs)],
    );
    const docs = (await q(`SELECT id FROM "Document" WHERE "knowledgeBaseId"=$1 ORDER BY id`, [kb]))
      .rows as Array<{ id: string }>;
    // 200 distinct chunk texts per org -> embeddings computed once, reused by index (different content ids)
    const variants = Array.from({ length: 200 }, (_, i) => {
      const base = KB_TEXTS[i % KB_TEXTS.length]!;
      const extra = [
        VOCAB[i % VOCAB.length],
        VOCAB[(i * 7 + 3) % VOCAB.length],
        VOCAB[(i * 11 + 5) % VOCAB.length],
      ].join(' ');
      return `${base} ${extra}`;
    });
    const vec = variants.map(mockEmb);
    let written = 0;
    for (let d = 0; d < docs.length && written < nChunks; d++) {
      const per = Math.ceil(nChunks / docs.length);
      const rows: unknown[] = [];
      const ph: string[] = [];
      for (let i = 0; i < per && written < nChunks; i++, written++) {
        const v = (written * 13) % variants.length;
        const b = rows.length;
        ph.push(
          `(gen_random_uuid(),$${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6}::vector)`,
        );
        rows.push(org, kb, docs[d]!.id, i, variants[v], vec[v]);
      }
      await q(
        `INSERT INTO "DocumentChunk"(id,"organizationId","knowledgeBaseId","documentId",index,content,embedding) VALUES ${ph.join(',')}`,
        rows,
      );
    }
    await q(`UPDATE "KnowledgeBase" SET "documentCount"=$2,"chunkCount"=$3 WHERE id=$1`, [
      kb,
      docs.length,
      written,
    ]);

    // agent (no tools, mock model), workflow (webhook trigger) + inbound endpoint
    const agent = (
      await q(
        `INSERT INTO "Agent"(id,"organizationId",name,instructions,model,tools,"maxSteps","updatedAt")
         VALUES (gen_random_uuid(),$1,'Load agent','Answer briefly.','mock-chat',ARRAY[]::text[],3,now()) RETURNING id`,
        [org],
      )
    ).rows[0].id as string;
    const workflow = (
      await q(
        `INSERT INTO "Workflow"(id,"organizationId",name,"isEnabled",trigger,steps,"updatedAt")
         VALUES (gen_random_uuid(),$1,'Load webhook workflow',true,$2,$3,now()) RETURNING id`,
        [
          org,
          JSON.stringify({ type: 'webhook' }),
          JSON.stringify([
            { id: 'v', type: 'set_variable', name: 'x', value: '{{ trigger.payload.n }}' },
            {
              id: 'n',
              type: 'send_notification',
              to: { kind: 'user', userId: users[0]!.id },
              title: 'Inbound {{ vars.x }}',
            },
          ]),
        ],
      )
    ).rows[0].id as string;
    await q(
      `INSERT INTO "WebhookEndpoint"(id,"organizationId","workflowId",name,slug,"secretHash","updatedAt")
       VALUES (gen_random_uuid(),$1,$2,'Load endpoint','load-endpoint',$3,now())`,
      [org, workflow, secretHash],
    );

    (manifest.orgs as unknown[]).push({
      id: org,
      slug,
      leads: nLeads,
      contacts: nContacts,
      conversations: nConvs,
      chunks: written,
      knowledgeBaseId: kb,
      agentId: agent,
      workflowId: workflow,
      endpointSlug: 'load-endpoint',
      users: users.map((u, i) => ({ id: u.id, email: u.email, role: roleOf(i) })),
    });
    console.log(`seeded ${slug} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }

  console.log('ANALYZE ...');
  await q('ANALYZE');
  const counts = await q(
    `SELECT (SELECT count(*) FROM "Lead") leads, (SELECT count(*) FROM "Contact") contacts,
            (SELECT count(*) FROM "Conversation") conversations, (SELECT count(*) FROM "Message") messages,
            (SELECT count(*) FROM "DocumentChunk") chunks, (SELECT count(*) FROM "User") users`,
  );
  console.log('row counts', counts.rows[0]);

  mkdirSync(path.join(here, '.data'), { recursive: true });
  writeFileSync(path.join(here, '.data/manifest.json'), JSON.stringify(manifest, null, 1));
  await db.end();
  console.log(
    `done in ${((Date.now() - t0) / 1000).toFixed(0)}s -> tests/load/.data/manifest.json`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
