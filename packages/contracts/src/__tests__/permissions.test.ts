import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, Permission, SYSTEM_ROLE_PERMISSIONS, isPermission } from '../permissions';
import { registerSchema, passwordSchema } from '../auth';
import { createOrganizationSchema, slugSchema } from '../organizations';

describe('permissions', () => {
  it('owner has every permission', () => {
    expect(SYSTEM_ROLE_PERMISSIONS.owner).toHaveLength(ALL_PERMISSIONS.length);
  });
  it('admin cannot delete the organization', () => {
    expect(SYSTEM_ROLE_PERMISSIONS.admin).not.toContain(Permission.ORG_DELETE);
    expect(SYSTEM_ROLE_PERMISSIONS.admin).toContain(Permission.MEMBERS_INVITE);
  });
  it('member is a strict subset of admin', () => {
    for (const p of SYSTEM_ROLE_PERMISSIONS.member)
      expect(SYSTEM_ROLE_PERMISSIONS.admin).toContain(p);
    expect(SYSTEM_ROLE_PERMISSIONS.member).not.toContain(Permission.ROLES_MANAGE);
  });
  it('isPermission guards unknown keys', () => {
    expect(isPermission('leads:read')).toBe(true);
    expect(isPermission('leads:fly')).toBe(false);
  });
});

describe('auth schemas', () => {
  it('rejects weak passwords', () => {
    expect(passwordSchema.safeParse('short').success).toBe(false);
    expect(passwordSchema.safeParse('alllowercase1').success).toBe(false);
    expect(passwordSchema.safeParse('GoodPassw0rd!').success).toBe(true);
  });
  it('normalizes email', () => {
    const r = registerSchema.parse({
      email: '  Erez@Example.COM ',
      password: 'GoodPassw0rd!',
      firstName: 'Erez',
      lastName: 'Levi',
    });
    expect(r.email).toBe('erez@example.com');
  });
});

describe('organization schemas', () => {
  it('validates slugs', () => {
    expect(slugSchema.safeParse('my-org-1').success).toBe(true);
    expect(slugSchema.safeParse('-bad').success).toBe(false);
    expect(slugSchema.safeParse('Bad Space').success).toBe(false);
  });
  it('applies defaults', () => {
    const o = createOrganizationSchema.parse({ name: 'HilaTech' });
    expect(o.timezone).toBe('UTC');
    expect(o.locale).toBe('en');
  });
});
