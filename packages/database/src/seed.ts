/* eslint-disable no-console */
/**
 * Database seed.
 *  - Always: upserts the Permission catalog from @hilatech/contracts (idempotent).
 *  - When SEED_DEMO=true: creates a demo organization, owner user and sample CRM data for local development.
 *    Demo credentials are printed to stdout and must never be used in production.
 */
import * as argon2 from 'argon2';
import {
  ALL_PERMISSIONS,
  PLAN_LIMITS,
  SYSTEM_ROLE_PERMISSIONS,
  SystemRole,
} from '@hilatech/contracts';

import { createPrismaClient } from './index';
import { createDefaultPipeline } from './domain/pipelines';

const prisma = createPrismaClient();

async function seedPermissions() {
  for (const key of ALL_PERMISSIONS) {
    const group = key.split(':')[0] ?? 'misc';
    await prisma.permission.upsert({
      where: { key },
      update: { group },
      create: { key, group },
    });
  }
  console.log(`✔ permission catalog: ${ALL_PERMISSIONS.length} keys`);
}

async function seedDemo() {
  const email = process.env.SEED_DEMO_EMAIL ?? 'owner@demo.local';
  const password = process.env.SEED_DEMO_PASSWORD ?? 'DemoPassw0rd!';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`• demo user ${email} already exists — skipping demo seed`);
    return;
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, passwordHash, firstName: 'Demo', lastName: 'Owner', emailVerifiedAt: now },
    });
    const org = await tx.organization.create({
      data: {
        name: 'Demo Company',
        slug: 'demo-company',
        industry: 'Services',
        timezone: 'Asia/Jerusalem',
      },
    });
    const roles = await Promise.all(
      (Object.values(SystemRole) as SystemRole[]).map((key) =>
        tx.role.create({
          data: {
            organizationId: org.id,
            key,
            name: key.charAt(0).toUpperCase() + key.slice(1),
            isSystem: true,
            permissions: [...SYSTEM_ROLE_PERMISSIONS[key]],
          },
        }),
      ),
    );
    const ownerRole = roles.find((r) => r.key === SystemRole.OWNER)!;
    await tx.organizationMember.create({
      data: { organizationId: org.id, userId: user.id, roleId: ownerRole.id },
    });
    await tx.subscription.create({
      data: {
        organizationId: org.id,
        plan: 'pro',
        status: 'active',
        limits: PLAN_LIMITS.pro,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
    });
    await createDefaultPipeline(tx, org.id);
    const contact = await tx.contact.create({
      data: {
        organizationId: org.id,
        firstName: 'Dana',
        lastName: 'Cohen',
        email: 'dana@example.com',
        company: 'Example Ltd',
        tags: ['vip'],
        ownerId: user.id,
      },
    });
    const lead = await tx.lead.create({
      data: {
        organizationId: org.id,
        title: 'Website redesign for Example Ltd',
        status: 'qualified',
        source: 'website',
        value: 12_000,
        currency: 'ILS',
        contactId: contact.id,
        assigneeId: user.id,
        tags: ['web'],
      },
    });
    await tx.leadActivity.create({
      data: { leadId: lead.id, actorId: user.id, type: 'created', payload: { source: 'seed' } },
    });
    const conversation = await tx.conversation.create({
      data: {
        organizationId: org.id,
        subject: 'Initial inquiry',
        channel: 'web',
        contactId: contact.id,
        leadId: lead.id,
        assigneeId: user.id,
        lastMessageAt: now,
        messageCount: 1,
      },
    });
    await tx.message.create({
      data: {
        conversationId: conversation.id,
        role: 'customer',
        content: 'Hi, we would like a quote for a new website.',
      },
    });
  });

  console.log('✔ demo data created');
  console.log(`  login: ${email} / ${password}  (development only)`);
}

async function main() {
  await seedPermissions();
  if (process.env.SEED_DEMO === 'true') await seedDemo();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
