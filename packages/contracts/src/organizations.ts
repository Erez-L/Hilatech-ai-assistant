import { z } from 'zod';
import { idSchema, timestampsSchema, partialUpdate } from './common';

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(50)
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Slug may contain lowercase letters, numbers and hyphens',
  );

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(100),
  slug: slugSchema.optional(),
  industry: z.string().trim().max(100).optional(),
  timezone: z.string().trim().max(64).default('UTC'),
  locale: z.string().trim().max(16).default('en'),
});
export type CreateOrganizationRequest = z.infer<typeof createOrganizationSchema>;

export const updateOrganizationSchema = partialUpdate(createOrganizationSchema).extend({
  logoUrl: z.string().url().nullable().optional(),
  website: z.string().url().nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
});
export type UpdateOrganizationRequest = z.infer<typeof updateOrganizationSchema>;

/** Free-form JSON settings per organization (branding, business hours, AI defaults…).
 *  Validated keys are added as features land; unknown keys are rejected. */
export const organizationSettingsSchema = z
  .object({
    businessHours: z
      .object({
        timezone: z.string().max(64),
        days: z.partialRecord(
          z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
          z
            .object({
              open: z.string().regex(/^\d{2}:\d{2}$/),
              close: z.string().regex(/^\d{2}:\d{2}$/),
            })
            .nullable(),
        ),
      })
      .optional(),
    branding: z
      .object({
        primaryColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
      })
      .optional(),
    ai: z
      .object({
        defaultProvider: z.enum(['anthropic', 'openai']).optional(),
        defaultModel: z.string().max(100).optional(),
        assistantName: z.string().max(60).optional(),
        tone: z.enum(['professional', 'friendly', 'concise']).optional(),
        /** Extra standing instructions for the assistant (treated as organization instructions, max 4000 chars). */
        assistantInstructions: z.string().max(4000).optional(),
      })
      .optional(),
    /** ISO-4217 reporting currency for pipeline/won values on the dashboard. */
    currency: z
      .string()
      .length(3)
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict();
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

export const organizationSchema = z
  .object({
    id: idSchema,
    name: z.string(),
    slug: z.string(),
    industry: z.string().nullable(),
    timezone: z.string(),
    locale: z.string(),
    logoUrl: z.string().nullable(),
    website: z.string().nullable(),
    description: z.string().nullable(),
    settings: organizationSettingsSchema,
  })
  .merge(timestampsSchema);
export type Organization = z.infer<typeof organizationSchema>;

// ---------------------------------------------------------------------------
// Members, roles, invitations
// ---------------------------------------------------------------------------

export const MemberStatus = z.enum(['active', 'suspended']);
export type MemberStatus = z.infer<typeof MemberStatus>;

export const roleSchema = z
  .object({
    id: idSchema,
    organizationId: idSchema,
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    permissions: z.array(z.string()),
  })
  .merge(timestampsSchema);
export type Role = z.infer<typeof roleSchema>;

export const createRoleSchema = z.object({
  key: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(40)
    .regex(/^[a-z][a-z0-9_-]*$/),
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string()).min(0),
});
export type CreateRoleRequest = z.infer<typeof createRoleSchema>;
export const updateRoleSchema = partialUpdate(createRoleSchema.omit({ key: true }));
export type UpdateRoleRequest = z.infer<typeof updateRoleSchema>;

export const memberSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  userId: idSchema,
  status: MemberStatus,
  role: roleSchema.pick({ id: true, key: true, name: true, isSystem: true }),
  user: z.object({
    id: idSchema,
    email: z.string().email(),
    firstName: z.string(),
    lastName: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  joinedAt: z.string().datetime(),
});
export type Member = z.infer<typeof memberSchema>;

export const updateMemberSchema = z.object({
  roleId: idSchema.optional(),
  status: MemberStatus.optional(),
});
export type UpdateMemberRequest = z.infer<typeof updateMemberSchema>;

export const InvitationStatus = z.enum(['pending', 'accepted', 'revoked', 'expired']);
export type InvitationStatus = z.infer<typeof InvitationStatus>;

export const createInvitationSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  roleId: idSchema,
});
export type CreateInvitationRequest = z.infer<typeof createInvitationSchema>;

export const invitationSchema = z.object({
  id: idSchema,
  organizationId: idSchema,
  email: z.string().email(),
  role: roleSchema.pick({ id: true, key: true, name: true }),
  status: InvitationStatus,
  invitedBy: z.object({ id: idSchema, firstName: z.string(), lastName: z.string() }),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

/** Public (unauthenticated) view of an invitation, looked up by token on the accept page. */
export const invitationPreviewSchema = z.object({
  email: z.string().email(),
  organizationName: z.string(),
  roleName: z.string(),
  expiresAt: z.string().datetime(),
  status: InvitationStatus,
});
export type InvitationPreview = z.infer<typeof invitationPreviewSchema>;

export const acceptInvitationSchema = z.object({ token: z.string().min(16).max(256) });
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationSchema>;
