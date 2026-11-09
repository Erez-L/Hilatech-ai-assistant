import {
  type Contact as ContactDto,
  type ContactSummary,
  type UserSummary,
} from '@hilatech/contracts';
import { type Contact, type Prisma, type User } from '@hilatech/database';

/** Prisma `select` for the `userSummarySchema` embedded in CRM resources. Never selects credentials. */
export const USER_SUMMARY_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  avatarUrl: true,
} as const satisfies Prisma.UserSelect;

export type UserSummaryRow = Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'avatarUrl'>;

export function toUserSummary(user: UserSummaryRow): UserSummary;
export function toUserSummary(user: UserSummaryRow | null | undefined): UserSummary | null;
export function toUserSummary(user: UserSummaryRow | null | undefined): UserSummary | null {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    avatarUrl: user.avatarUrl,
  };
}

/** Prisma `select` for the `contactSummarySchema` embedded in leads and conversations. */
export const CONTACT_SUMMARY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  company: true,
} as const satisfies Prisma.ContactSelect;

export type ContactSummaryRow = Pick<
  Contact,
  'id' | 'firstName' | 'lastName' | 'email' | 'phone' | 'company'
>;

export function toContactSummary(
  contact: ContactSummaryRow | null | undefined,
): ContactSummary | null {
  if (!contact) return null;
  return {
    id: contact.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    company: contact.company,
  };
}

export function toContact(row: Contact): ContactDto {
  return {
    id: row.id,
    organizationId: row.organizationId,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    company: row.company,
    jobTitle: row.jobTitle,
    tags: row.tags,
    notes: row.notes,
    customFields: jsonObject(row.customFields),
    ownerId: row.ownerId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Prisma `Decimal` (or anything decimal-like) → plain number for JSON responses. */
export function decimalToNumber(
  value: { toNumber(): number } | number | string | null,
): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  return value.toNumber();
}

/** JSON column → plain object (Prisma returns `JsonValue`, which may be a primitive or array). */
export function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function isoOrNull(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}
