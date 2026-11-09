import { type ConversationStatus, type MessageRole, Permission } from '@hilatech/contracts';
import { type TenantContext } from '@hilatech/types';

import { AppException } from '../../common/errors/app.exception';

/** Roles a human caller may post through the REST API. `assistant` is reserved for the AI module. */
export const API_MESSAGE_ROLES: readonly MessageRole[] = ['agent', 'customer', 'system'];

/** Pure business rules for conversations and messages; exported for unit tests. */
export const ConversationRules = {
  assertApiRole(role: MessageRole): void {
    if (!API_MESSAGE_ROLES.includes(role)) {
      throw AppException.validation('This message role cannot be posted through the API', [
        {
          path: 'role',
          message: `Expected one of ${API_MESSAGE_ROLES.join(', ')} (assistant replies are produced by the AI module)`,
          code: 'custom',
        },
      ]);
    }
  },

  /** Archived conversations are read-only. */
  assertPostable(conversation: { status: ConversationStatus }): void {
    if (conversation.status === 'archived') {
      throw AppException.conflict('Cannot post to an archived conversation', {
        status: conversation.status,
      });
    }
  },

  /** A new message reopens a resolved conversation; other statuses are untouched. */
  statusAfterMessage(status: ConversationStatus): ConversationStatus {
    return status === 'resolved' ? 'open' : status;
  },

  /** Only `agent` messages are attributed to the calling user; customer/system messages have no author. */
  authorFor(role: MessageRole, tenant: Pick<TenantContext, 'userId'>): string | null {
    return role === 'agent' ? tenant.userId : null;
  },

  /**
   * Changing the assignee to someone else requires `conversations:assign`; `conversations:update`
   * alone only allows taking (or keeping) the conversation yourself.
   */
  assertCanSetAssignee(
    tenant: Pick<TenantContext, 'userId' | 'permissions'>,
    nextAssigneeId: string | null,
    previousAssigneeId: string | null,
  ): void {
    if (nextAssigneeId === previousAssigneeId) return;
    if (nextAssigneeId === tenant.userId) return;
    if (!tenant.permissions.includes(Permission.CONVERSATIONS_ASSIGN)) {
      throw AppException.forbidden(
        'Assigning conversations to other members requires conversations:assign',
        { required: [Permission.CONVERSATIONS_ASSIGN] },
      );
    }
  },
};
