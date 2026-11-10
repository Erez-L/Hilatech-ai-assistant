#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Optional second seed step: gives the 400 most recent conversations of every seeded org an extra 150 messages
 * (~360k rows) so inbox/list endpoints are measured against realistic long threads. hilatech_load only.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const { Client } = createRequire(path.resolve(here, '../../packages/database/package.json'))('pg');
const url =
  process.env.LOAD_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/hilatech_load';
if (!/\/hilatech_load(\?|$)/.test(url)) throw new Error('refusing: not hilatech_load');
const db = new Client({ connectionString: url });
await db.connect();
const t0 = Date.now();
const r = await db.query(`
  INSERT INTO "Message"(id,"conversationId",role,content,"createdAt")
  SELECT gen_random_uuid(), c.id, (ARRAY['customer','agent'])[1 + (g % 2)]::"MessageRole",
         'Long thread message ' || g || ' ' || repeat('lorem ipsum dolor sit amet ', 12), c."createdAt" + (g * interval '1 minute')
  FROM (SELECT id, "createdAt", row_number() OVER (PARTITION BY "organizationId" ORDER BY "lastMessageAt" DESC NULLS LAST) rn FROM "Conversation") c
  CROSS JOIN generate_series(6, 155) g WHERE c.rn <= 400`);
await db.query(
  `UPDATE "Conversation" SET "messageCount" = 155 WHERE id IN (SELECT "conversationId" FROM "Message" GROUP BY 1 HAVING count(*) >= 155)`,
);
await db.query('ANALYZE "Message"');
console.log(`inserted ${r.rowCount} messages in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await db.end();
