import type { CreateInvitationRequest, Invitation, InvitationPreview, Member } from '@hilatech/contracts';
import { api } from './client';

export const invitationsApi = {
  list: () => api.get<Invitation[]>('/invitations'),
  create: (body: CreateInvitationRequest) => api.post<Invitation>('/invitations', body),
  revoke: (id: string) => api.delete<void>(`/invitations/${encodeURIComponent(id)}`),
  /** Public: no auth, no organization header. */
  preview: (token: string) =>
    api.get<InvitationPreview>('/invitations/preview', {
      query: { token },
      auth: false,
      organization: false,
    }),
  /** Requires a signed-in user; the organization is derived from the token server-side. */
  accept: (token: string) => api.post<Member>('/invitations/accept', { token }, { organization: false }),
};
