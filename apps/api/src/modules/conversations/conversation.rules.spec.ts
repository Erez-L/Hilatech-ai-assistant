import {
  ALL_PERMISSIONS,
  ErrorCode,
  Permission,
  SYSTEM_ROLE_PERMISSIONS,
} from '@hilatech/contracts';

import { type AppException } from '../../common/errors/app.exception';
import { ConversationRules } from './conversation.rules';

function capture(fn: () => void): AppException | undefined {
  try {
    fn();
  } catch (e) {
    return e as AppException;
  }
  return undefined;
}

describe('ConversationRules', () => {
  it('accepts agent / customer / system roles and rejects assistant with a field-level validation error', () => {
    for (const role of ['agent', 'customer', 'system'] as const) {
      expect(() => ConversationRules.assertApiRole(role)).not.toThrow();
    }
    const error = capture(() => ConversationRules.assertApiRole('assistant'));
    expect(error?.code).toBe(ErrorCode.VALIDATION_ERROR);
    expect(error?.getStatus()).toBe(400);
    expect(error?.details).toEqual([expect.objectContaining({ path: 'role' })]);
  });

  it('refuses to post into an archived conversation (409) and allows every other status', () => {
    const error = capture(() => ConversationRules.assertPostable({ status: 'archived' }));
    expect(error?.code).toBe(ErrorCode.CONFLICT);
    for (const status of ['open', 'pending', 'resolved'] as const) {
      expect(() => ConversationRules.assertPostable({ status })).not.toThrow();
    }
  });

  it('reopens a resolved conversation on a new message and leaves other statuses alone', () => {
    expect(ConversationRules.statusAfterMessage('resolved')).toBe('open');
    expect(ConversationRules.statusAfterMessage('open')).toBe('open');
    expect(ConversationRules.statusAfterMessage('pending')).toBe('pending');
    expect(ConversationRules.statusAfterMessage('archived')).toBe('archived');
  });

  it('attributes only agent messages to the caller', () => {
    const tenant = { userId: 'u1' };
    expect(ConversationRules.authorFor('agent', tenant)).toBe('u1');
    expect(ConversationRules.authorFor('customer', tenant)).toBeNull();
    expect(ConversationRules.authorFor('system', tenant)).toBeNull();
  });

  it('requires conversations:assign to hand a conversation to someone else', () => {
    const member = { userId: 'me', permissions: SYSTEM_ROLE_PERMISSIONS.member };
    const admin = { userId: 'me', permissions: ALL_PERMISSIONS };
    expect(() => ConversationRules.assertCanSetAssignee(member, 'me', null)).not.toThrow();
    expect(() => ConversationRules.assertCanSetAssignee(member, 'x', 'x')).not.toThrow();
    const error = capture(() => ConversationRules.assertCanSetAssignee(member, 'other', null));
    expect(error?.code).toBe(ErrorCode.FORBIDDEN);
    expect(error?.details).toEqual({ required: [Permission.CONVERSATIONS_ASSIGN] });
    expect(() => ConversationRules.assertCanSetAssignee(admin, 'other', null)).not.toThrow();
  });
});
