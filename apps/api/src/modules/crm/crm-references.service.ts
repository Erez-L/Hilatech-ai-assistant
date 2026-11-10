import { type TenantContext } from '@hilatech/types';
import { Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Verifies that ids referenced from CRM payloads (owner / assignee users, contacts, leads) belong to the
 * caller's organization. A reference that does not resolve inside the tenant is reported as
 * `400 VALIDATION_ERROR` on the offending field — the same answer whether the id is unknown or belongs
 * to another organization, so nothing about other tenants leaks.
 */
@Injectable()
export class CrmReferencesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The referenced user must hold an ACTIVE membership in the organization. */
  async assertActiveMember(tenant: TenantContext, userId: string, field: string): Promise<void> {
    const membership = await this.prisma.client.organizationMember.findFirst({
      where: {
        organizationId: tenant.organizationId,
        userId,
        status: 'active',
        user: { isActive: true },
      },
      select: { id: true },
    });
    if (!membership) {
      throw AppException.validation(
        'Referenced user is not an active member of this organization',
        [
          {
            path: field,
            message: 'User is not an active member of this organization',
            code: 'custom',
          },
        ],
      );
    }
  }

  /** The referenced contact must exist (not soft-deleted) in the organization. */
  async assertContact(tenant: TenantContext, contactId: string, field: string): Promise<void> {
    const contact = await this.prisma.client.contact.findFirst({
      where: { id: contactId, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!contact) {
      throw AppException.validation('Referenced contact not found in this organization', [
        { path: field, message: 'Contact not found in this organization', code: 'custom' },
      ]);
    }
  }

  /** The referenced lead must exist (not soft-deleted) in the organization. */
  async assertLead(tenant: TenantContext, leadId: string, field: string): Promise<void> {
    const lead = await this.prisma.client.lead.findFirst({
      where: { id: leadId, organizationId: tenant.organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!lead) {
      throw AppException.validation('Referenced lead not found in this organization', [
        { path: field, message: 'Lead not found in this organization', code: 'custom' },
      ]);
    }
  }

  /** The referenced deal must exist in the organization. */
  async assertDeal(tenant: TenantContext, dealId: string, field: string): Promise<void> {
    const deal = await this.prisma.client.deal.findFirst({
      where: { id: dealId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!deal) {
      throw AppException.validation('Referenced deal not found in this organization', [
        { path: field, message: 'Deal not found in this organization', code: 'custom' },
      ]);
    }
  }

  /** The referenced conversation must exist in the organization. */
  async assertConversation(
    tenant: TenantContext,
    conversationId: string,
    field: string,
  ): Promise<void> {
    const conversation = await this.prisma.client.conversation.findFirst({
      where: { id: conversationId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!conversation) {
      throw AppException.validation('Referenced conversation not found in this organization', [
        { path: field, message: 'Conversation not found in this organization', code: 'custom' },
      ]);
    }
  }

  /** The referenced company must exist in the organization. */
  async assertCompany(tenant: TenantContext, companyId: string, field: string): Promise<void> {
    const company = await this.prisma.client.company.findFirst({
      where: { id: companyId, organizationId: tenant.organizationId },
      select: { id: true },
    });
    if (!company) {
      throw AppException.validation('Referenced company not found in this organization', [
        { path: field, message: 'Company not found in this organization', code: 'custom' },
      ]);
    }
  }
}
