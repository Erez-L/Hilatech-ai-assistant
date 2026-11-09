'use client';

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { toast } from '@hilatech/ui';
import type {
  Agent,
  AgentExecution,
  AgentExecutionStatus,
  AiProviderConfig,
  AiProviderKind,
  AssistantThread,
  CreateAgentRequest,
  CreateAiProviderConfigRequest,
  CreatePromptTemplateRequest,
  ExecuteAgentRequest,
  RenderPromptTemplateRequest,
  UpdateAgentRequest,
  UpdateAiProviderConfigRequest,
  UpdateAssistantThreadRequest,
  UpdatePromptTemplateRequest,
  CreateAssistantThreadRequest,
  ConversationWithRelations,
  ConvertLeadRequest,
  CreateContactRequest,
  CreateConversationRequest,
  CreateInvitationRequest,
  CreateLeadRequest,
  CreateMessageRequest,
  CreateRoleRequest,
  DashboardPeriod,
  Invitation,
  LeadWithRelations,
  ListAuditLogsQuery,
  Member,
  Notification,
  NotificationPreferences,
  OrganizationSettings,
  PaginationQuery,
  Role,
  UnreadCount,
  UpdateContactRequest,
  UpdateConversationRequest,
  UpdateLeadRequest,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
  UpdateRoleRequest,
} from '@hilatech/contracts';
import {
  agentsApi,
  aiApi,
  assistantApi,
  type ListAgentExecutionsParams,
  type ListAgentsParams,
  analyticsApi,
  auditApi,
  authApi,
  billingApi,
  contactsApi,
  conversationsApi,
  getErrorMessage,
  invitationsApi,
  isApiError,
  keys,
  leadsApi,
  membersApi,
  notificationsApi,
  organizationsApi,
  rolesApi,
  usersApi,
  type ListContactsParams,
  type ListConversationsParams,
  type ListLeadsParams,
  type ListMembersParams,
  type ListNotificationsParams,
  type UpdateProfileRequest,
  type UserPreferences,
} from '@/lib/api';
import { useSession } from '@/stores/session';

export function useActiveOrganizationId(): string | null {
  return useSession((s) => s.activeOrganizationId);
}

// ---------------------------------------------------------------------------
// Session / auth
// ---------------------------------------------------------------------------

export function useAuthSessions() {
  return useQuery({ queryKey: keys.authSessions(), queryFn: authApi.sessions });
}

export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (familyId: string) => authApi.revokeSession(familyId),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.authSessions() }),
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: authApi.changePassword });
}

export function useUpdateProfile() {
  const updateUser = useSession((s) => s.updateUser);
  return useMutation({
    mutationFn: (body: UpdateProfileRequest) =>
      usersApi.update({ ...body, avatarUrl: body.avatarUrl ? body.avatarUrl : null }),
    onSuccess: (user) => updateUser(user),
  });
}

export function useUpdatePreferences() {
  return useMutation({ mutationFn: (body: UserPreferences) => usersApi.updatePreferences(body) });
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export function useOrganization() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.organization(orgId),
    queryFn: organizationsApi.current,
    enabled: !!orgId,
  });
}

export function useOrganizationSettings() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.organizationSettings(orgId),
    queryFn: organizationsApi.settings,
    enabled: !!orgId,
  });
}

export function useUpdateOrganization() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: UpdateOrganizationRequest) => organizationsApi.update(body),
    onSuccess: (org) => {
      qc.setQueryData(keys.organization(orgId), org);
      void qc.invalidateQueries({ queryKey: keys.session(orgId) });
    },
  });
}

export function useUpdateOrganizationSettings() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: OrganizationSettings) => organizationsApi.updateSettings(body),
    onSuccess: (settings) => {
      qc.setQueryData(keys.organizationSettings(orgId), settings);
      void qc.invalidateQueries({ queryKey: keys.organization(orgId) });
    },
  });
}

export function useDeleteOrganization() {
  return useMutation({ mutationFn: organizationsApi.remove });
}

// ---------------------------------------------------------------------------
// Members / roles / invitations
// ---------------------------------------------------------------------------

export function useMembers(params: ListMembersParams) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.members(orgId, params),
    queryFn: () => membersApi.list(params),
    enabled: !!orgId,
    placeholderData: (prev) => prev,
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateMemberRequest }) =>
      membersApi.update(id, body),
    onSuccess: (member) => {
      // Optimistically patch any cached member pages.
      qc.setQueriesData<{ data: Member[]; meta: unknown }>(
        { queryKey: ['org', orgId, 'members'] },
        (prev) =>
          prev ? { ...prev, data: prev.data.map((m) => (m.id === member.id ? member : m)) } : prev,
      );
      void qc.invalidateQueries({ queryKey: ['org', orgId, 'members'] });
      void qc.invalidateQueries({ queryKey: keys.dashboard(orgId) });
    },
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => membersApi.remove(id),
    onSuccess: (_void, id) => {
      qc.setQueriesData<{ data: Member[]; meta: { total: number } }>(
        { queryKey: ['org', orgId, 'members'] },
        (prev) =>
          prev
            ? {
                ...prev,
                data: prev.data.filter((m) => m.id !== id),
                meta: { ...prev.meta, total: prev.meta.total - 1 },
              }
            : prev,
      );
      void qc.invalidateQueries({ queryKey: ['org', orgId, 'members'] });
      void qc.invalidateQueries({ queryKey: keys.dashboard(orgId) });
    },
  });
}

export function useLeaveOrganization() {
  return useMutation({ mutationFn: membersApi.leave });
}

export function useRoles(options?: Pick<UseQueryOptions<Role[]>, 'enabled'>) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.roles(orgId),
    queryFn: rolesApi.list,
    enabled: !!orgId && (options?.enabled ?? true),
  });
}

export function usePermissionCatalog() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.permissions(orgId),
    queryFn: rolesApi.permissions,
    enabled: !!orgId,
    staleTime: 10 * 60 * 1000,
  });
}

export function useCreateRole() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: CreateRoleRequest) => rolesApi.create(body),
    onSuccess: (role) => {
      qc.setQueryData<Role[]>(keys.roles(orgId), (prev) => (prev ? [...prev, role] : [role]));
      void qc.invalidateQueries({ queryKey: keys.roles(orgId) });
    },
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateRoleRequest }) =>
      rolesApi.update(id, body),
    onSuccess: (role) => {
      qc.setQueryData<Role[]>(keys.roles(orgId), (prev) =>
        prev?.map((r) => (r.id === role.id ? role : r)),
      );
      void qc.invalidateQueries({ queryKey: keys.roles(orgId) });
      void qc.invalidateQueries({ queryKey: keys.session(orgId) });
    },
  });
}

export function useDeleteRole() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => rolesApi.remove(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<Role[]>(keys.roles(orgId), (prev) => prev?.filter((r) => r.id !== id));
      void qc.invalidateQueries({ queryKey: keys.roles(orgId) });
    },
  });
}

export function useInvitations() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.invitations(orgId),
    queryFn: invitationsApi.list,
    enabled: !!orgId,
  });
}

export function useCreateInvitation() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: CreateInvitationRequest) => invitationsApi.create(body),
    onSuccess: (invitation) => {
      qc.setQueryData<Invitation[]>(keys.invitations(orgId), (prev) =>
        prev ? [invitation, ...prev] : [invitation],
      );
      void qc.invalidateQueries({ queryKey: keys.invitations(orgId) });
      void qc.invalidateQueries({ queryKey: keys.dashboard(orgId) });
    },
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => invitationsApi.revoke(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.invitations(orgId) });
      const previous = qc.getQueryData<Invitation[]>(keys.invitations(orgId));
      qc.setQueryData<Invitation[]>(keys.invitations(orgId), (prev) =>
        prev?.filter((i) => i.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(keys.invitations(orgId), ctx.previous);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.invitations(orgId) });
      void qc.invalidateQueries({ queryKey: keys.dashboard(orgId) });
    },
  });
}

export function useInvitationPreview(token: string | null) {
  return useQuery({
    queryKey: keys.invitationPreview(token ?? ''),
    queryFn: () => invitationsApi.preview(token as string),
    enabled: !!token,
    retry: (count, error) =>
      !(isApiError(error) && (error.isNotFound || error.status === 410)) && count < 2,
  });
}

export function useAcceptInvitation() {
  return useMutation({ mutationFn: (token: string) => invitationsApi.accept(token) });
}

// ---------------------------------------------------------------------------
// Audit, billing, analytics, notifications
// ---------------------------------------------------------------------------

export function useAuditLogs(query: Partial<ListAuditLogsQuery>) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.auditLogs(orgId, query),
    queryFn: () => auditApi.list(query),
    enabled: !!orgId,
    placeholderData: (prev) => prev,
  });
}

export function useSubscription() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.subscription(orgId),
    queryFn: billingApi.subscription,
    enabled: !!orgId,
  });
}

export function useUsage() {
  const orgId = useActiveOrganizationId();
  return useQuery({ queryKey: keys.usage(orgId), queryFn: billingApi.usage, enabled: !!orgId });
}

export function usePlans() {
  return useQuery({ queryKey: keys.plans(), queryFn: billingApi.plans, staleTime: 60 * 60 * 1000 });
}

export function useDashboard(period: DashboardPeriod = '30d', options?: { enabled?: boolean }) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.dashboard(orgId, period),
    queryFn: () => analyticsApi.dashboard(period),
    enabled: !!orgId && (options?.enabled ?? true),
    placeholderData: (prev) => prev,
  });
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export function useNotifications(params: ListNotificationsParams = { unread: true }) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.notifications(orgId, params),
    queryFn: () => notificationsApi.list(params),
    enabled: !!orgId,
    refetchInterval: 60_000,
  });
}

export function useUnreadNotificationCount() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.notificationsUnreadCount(orgId),
    queryFn: notificationsApi.unreadCount,
    enabled: !!orgId,
    refetchInterval: 60_000,
    select: (d) => d.unread,
  });
}

type NotificationPage = { data: Notification[]; meta: { total: number } };

/** Marks one notification read. Optimistic: it leaves unread lists and the badge count drops at once. */
export function useMarkNotificationRead() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: keys.notificationsRoot(orgId) });
      const lists = qc.getQueriesData<NotificationPage>({
        queryKey: [...keys.notificationsRoot(orgId), 'list'],
      });
      const count = qc.getQueryData<UnreadCount>(keys.notificationsUnreadCount(orgId));
      let wasUnread = false;
      for (const [key, page] of lists) {
        if (!page) continue;
        const target = page.data.find((n) => n.id === id);
        if (!target || target.readAt) continue;
        wasUnread = true;
        const unreadOnly = (key[4] as { unread?: boolean } | undefined)?.unread === true;
        qc.setQueryData<NotificationPage>(key, {
          ...page,
          data: unreadOnly
            ? page.data.filter((n) => n.id !== id)
            : page.data.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)),
          meta: unreadOnly ? { ...page.meta, total: Math.max(0, page.meta.total - 1) } : page.meta,
        });
      }
      if (count && wasUnread) {
        qc.setQueryData<UnreadCount>(keys.notificationsUnreadCount(orgId), {
          unread: Math.max(0, count.unread - 1),
        });
      }
      return { lists, count };
    },
    onError: (error, _id, ctx) => {
      for (const [key, page] of ctx?.lists ?? []) qc.setQueryData(key, page);
      if (ctx?.count) qc.setQueryData(keys.notificationsUnreadCount(orgId), ctx.count);
      toast.error(getErrorMessage(error));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.notificationsRoot(orgId) }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: notificationsApi.markAllRead,
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: keys.notificationsRoot(orgId) });
      const lists = qc.getQueriesData<NotificationPage>({
        queryKey: [...keys.notificationsRoot(orgId), 'list'],
      });
      const count = qc.getQueryData<UnreadCount>(keys.notificationsUnreadCount(orgId));
      const now = new Date().toISOString();
      for (const [key, page] of lists) {
        if (!page) continue;
        const unreadOnly = (key[4] as { unread?: boolean } | undefined)?.unread === true;
        qc.setQueryData<NotificationPage>(key, {
          ...page,
          data: unreadOnly ? [] : page.data.map((n) => (n.readAt ? n : { ...n, readAt: now })),
          meta: unreadOnly ? { ...page.meta, total: 0 } : page.meta,
        });
      }
      qc.setQueryData<UnreadCount>(keys.notificationsUnreadCount(orgId), { unread: 0 });
      return { lists, count };
    },
    onError: (error, _v, ctx) => {
      for (const [key, page] of ctx?.lists ?? []) qc.setQueryData(key, page);
      if (ctx?.count) qc.setQueryData(keys.notificationsUnreadCount(orgId), ctx.count);
      toast.error(getErrorMessage(error));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: keys.notificationsRoot(orgId) }),
  });
}

export function useNotificationPreferences() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.notificationPreferences(orgId),
    queryFn: notificationsApi.preferences,
    enabled: !!orgId,
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: NotificationPreferences) => notificationsApi.updatePreferences(body),
    onSuccess: (prefs) => qc.setQueryData(keys.notificationPreferences(orgId), prefs),
    onError: (error) => toast.error(getErrorMessage(error)),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.notificationPreferences(orgId) }),
  });
}

// ---------------------------------------------------------------------------
// CRM — contacts
// ---------------------------------------------------------------------------

export function useContacts(params: ListContactsParams, options?: { enabled?: boolean }) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.contacts(orgId, params),
    queryFn: () => contactsApi.list(params),
    enabled: !!orgId && (options?.enabled ?? true),
    placeholderData: (prev) => prev,
  });
}

export function useContact(id: string | null) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.contact(orgId, id ?? ''),
    queryFn: () => contactsApi.get(id as string),
    enabled: !!orgId && !!id,
  });
}

export function useContactTags() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.contactTags(orgId),
    queryFn: contactsApi.tags,
    enabled: !!orgId,
    staleTime: 5 * 60 * 1000,
  });
}

export function useCreateContact() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: CreateContactRequest) => contactsApi.create(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.contactsRoot(orgId) });
      void qc.invalidateQueries({ queryKey: keys.dashboard(orgId) });
    },
  });
}

export function useUpdateContact() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateContactRequest }) =>
      contactsApi.update(id, body),
    onSuccess: (contact) => {
      qc.setQueryData(keys.contact(orgId, contact.id), contact);
      void qc.invalidateQueries({ queryKey: keys.contactsRoot(orgId) });
      // Leads and conversations embed contact summaries.
      void qc.invalidateQueries({ queryKey: keys.leadsRoot(orgId) });
      void qc.invalidateQueries({ queryKey: keys.conversationsRoot(orgId) });
    },
  });
}

export function useDeleteContact() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => contactsApi.remove(id),
    onSuccess: (_void, id) => {
      qc.removeQueries({ queryKey: keys.contact(orgId, id) });
      void qc.invalidateQueries({ queryKey: keys.contactsRoot(orgId) });
      void qc.invalidateQueries({ queryKey: keys.leadsRoot(orgId) });
      void qc.invalidateQueries({ queryKey: keys.conversationsRoot(orgId) });
      void qc.invalidateQueries({ queryKey: keys.dashboard(orgId) });
    },
  });
}

// ---------------------------------------------------------------------------
// CRM — leads
// ---------------------------------------------------------------------------

export function useLeads(params: ListLeadsParams, options?: { enabled?: boolean }) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.leads(orgId, params),
    queryFn: () => leadsApi.list(params),
    enabled: !!orgId && (options?.enabled ?? true),
    placeholderData: (prev) => prev,
  });
}

export function useLead(id: string | null) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.lead(orgId, id ?? ''),
    queryFn: () => leadsApi.get(id as string),
    enabled: !!orgId && !!id,
  });
}

function useLeadCacheSync() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return (lead: LeadWithRelations) => {
    qc.setQueryData(keys.lead(orgId, lead.id), lead);
    qc.setQueriesData<{ data: LeadWithRelations[]; meta: unknown }>(
      { queryKey: [...keys.leadsRoot(orgId), 'list'] },
      (prev) =>
        prev ? { ...prev, data: prev.data.map((l) => (l.id === lead.id ? lead : l)) } : prev,
    );
    void qc.invalidateQueries({ queryKey: keys.leadsRoot(orgId) });
    void qc.invalidateQueries({ queryKey: keys.dashboard(orgId) });
  };
}

export function useCreateLead() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: CreateLeadRequest) => leadsApi.create(body),
    onSuccess: (lead) => {
      qc.setQueryData(keys.lead(orgId, lead.id), lead);
      void qc.invalidateQueries({ queryKey: keys.leadsRoot(orgId) });
      void qc.invalidateQueries({ queryKey: keys.dashboard(orgId) });
      if (lead.contactId)
        void qc.invalidateQueries({ queryKey: keys.contact(orgId, lead.contactId) });
    },
  });
}

export function useUpdateLead() {
  const sync = useLeadCacheSync();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateLeadRequest }) =>
      leadsApi.update(id, body),
    onSuccess: sync,
  });
}

export function useAssignLead() {
  const sync = useLeadCacheSync();
  return useMutation({
    mutationFn: ({ id, assigneeId }: { id: string; assigneeId: string | null }) =>
      leadsApi.assign(id, { assigneeId }),
    onSuccess: sync,
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useConvertLead() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  const sync = useLeadCacheSync();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ConvertLeadRequest }) =>
      leadsApi.convert(id, body),
    onSuccess: ({ lead, contact }) => {
      sync(lead);
      void qc.invalidateQueries({ queryKey: keys.contactsRoot(orgId) });
      void qc.invalidateQueries({ queryKey: keys.contact(orgId, contact.id) });
      void qc.invalidateQueries({ queryKey: keys.leadActivities(orgId, lead.id) });
    },
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => leadsApi.remove(id),
    onSuccess: (_void, id) => {
      qc.removeQueries({ queryKey: keys.lead(orgId, id) });
      void qc.invalidateQueries({ queryKey: keys.leadsRoot(orgId) });
      void qc.invalidateQueries({ queryKey: keys.contactsRoot(orgId) });
      void qc.invalidateQueries({ queryKey: keys.dashboard(orgId) });
    },
  });
}

export function useLeadNotes(leadId: string | null, params: Partial<PaginationQuery> = {}) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.leadNotes(orgId, leadId ?? '', params),
    queryFn: () => leadsApi.notes(leadId as string, params),
    enabled: !!orgId && !!leadId,
  });
}

export function useAddLeadNote(leadId: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: string) => leadsApi.addNote(leadId, { body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.leadNotes(orgId, leadId) });
      void qc.invalidateQueries({ queryKey: keys.leadActivities(orgId, leadId) });
    },
  });
}

export function useDeleteLeadNote(leadId: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (noteId: string) => leadsApi.removeNote(leadId, noteId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.leadNotes(orgId, leadId) }),
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useLeadActivities(leadId: string | null, params: Partial<PaginationQuery> = {}) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.leadActivities(orgId, leadId ?? '', params),
    queryFn: () => leadsApi.activities(leadId as string, params),
    enabled: !!orgId && !!leadId,
  });
}

// ---------------------------------------------------------------------------
// CRM — conversations
// ---------------------------------------------------------------------------

export function useConversations(
  params: ListConversationsParams,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.conversations(orgId, params),
    queryFn: () => conversationsApi.list(params),
    enabled: !!orgId && (options?.enabled ?? true),
    placeholderData: (prev) => prev,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function useConversation(id: string | null) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.conversation(orgId, id ?? ''),
    queryFn: () => conversationsApi.get(id as string),
    enabled: !!orgId && !!id,
  });
}

function useConversationCacheSync() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return (conversation: ConversationWithRelations) => {
    qc.setQueryData(keys.conversation(orgId, conversation.id), conversation);
    qc.setQueriesData<{ data: ConversationWithRelations[]; meta: unknown }>(
      { queryKey: [...keys.conversationsRoot(orgId), 'list'] },
      (prev) =>
        prev
          ? {
              ...prev,
              data: prev.data.map((c) => (c.id === conversation.id ? conversation : c)),
            }
          : prev,
    );
    void qc.invalidateQueries({ queryKey: keys.conversationsRoot(orgId) });
    void qc.invalidateQueries({ queryKey: keys.dashboard(orgId) });
  };
}

export function useCreateConversation() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: CreateConversationRequest) => conversationsApi.create(body),
    onSuccess: (conversation) => {
      qc.setQueryData(keys.conversation(orgId, conversation.id), conversation);
      void qc.invalidateQueries({ queryKey: keys.conversationsRoot(orgId) });
      void qc.invalidateQueries({ queryKey: keys.dashboard(orgId) });
      if (conversation.contactId)
        void qc.invalidateQueries({ queryKey: keys.contact(orgId, conversation.contactId) });
    },
  });
}

export function useUpdateConversation() {
  const sync = useConversationCacheSync();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateConversationRequest }) =>
      conversationsApi.update(id, body),
    onSuccess: sync,
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useAssignConversation() {
  const sync = useConversationCacheSync();
  return useMutation({
    mutationFn: ({ id, assigneeId }: { id: string; assigneeId: string | null }) =>
      conversationsApi.assign(id, { assigneeId }),
    onSuccess: sync,
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export const MESSAGES_PAGE_SIZE = 50;

/**
 * Messages for a conversation, newest page first (sortOrder=desc) so the thread opens at the latest
 * message; "Load earlier" fetches the next page. Callers flatten and reverse for display.
 */
export function useMessages(conversationId: string | null, options?: { refetchInterval?: number }) {
  const orgId = useActiveOrganizationId();
  return useInfiniteQuery({
    queryKey: keys.messages(orgId, conversationId ?? ''),
    queryFn: ({ pageParam }) =>
      conversationsApi.messages(conversationId as string, {
        page: pageParam,
        pageSize: MESSAGES_PAGE_SIZE,
        sortOrder: 'desc',
      }),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
    enabled: !!orgId && !!conversationId,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

export function useSendMessage(conversationId: string) {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: CreateMessageRequest) => conversationsApi.sendMessage(conversationId, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.messages(orgId, conversationId) });
      // Posting updates lastMessage/messageCount and may reopen a resolved conversation.
      void qc.invalidateQueries({ queryKey: keys.conversationsRoot(orgId) });
    },
  });
}

// ---------------------------------------------------------------------------
// AI platform — providers, usage, prompts, tools
// ---------------------------------------------------------------------------

export function useAiProviders(options?: { enabled?: boolean }) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.aiProviders(orgId),
    queryFn: aiApi.providers,
    enabled: !!orgId && (options?.enabled ?? true),
  });
}

export function useAiModels(provider?: AiProviderKind | null, options?: { enabled?: boolean }) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.aiModels(orgId, provider ?? undefined),
    queryFn: () => aiApi.models(provider ?? undefined),
    enabled: !!orgId && (options?.enabled ?? true),
    staleTime: 10 * 60 * 1000,
  });
}

export function useCreateAiProvider() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: CreateAiProviderConfigRequest) => aiApi.createProvider(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.aiProviders(orgId) }),
  });
}

export function useUpdateAiProvider() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAiProviderConfigRequest }) =>
      aiApi.updateProvider(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.aiProviders(orgId) }),
  });
}

export function useDeleteAiProvider() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => aiApi.removeProvider(id),
    onSuccess: (_v, id) => {
      qc.setQueryData<AiProviderConfig[]>(keys.aiProviders(orgId), (prev) =>
        prev?.filter((p) => p.id !== id),
      );
      void qc.invalidateQueries({ queryKey: keys.aiProviders(orgId) });
    },
  });
}

export function useCheckAiProvider() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => aiApi.checkProvider(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: keys.aiProviders(orgId) }),
  });
}

export function useAiUsageSummary(range: { from?: string; to?: string }) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.aiUsage(orgId, range),
    queryFn: () => aiApi.usageSummary(range),
    enabled: !!orgId,
    placeholderData: (prev) => prev,
  });
}

export function useAiPrompts() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.aiPrompts(orgId),
    queryFn: () => aiApi.prompts({ page: 1, pageSize: 100 }),
    enabled: !!orgId,
  });
}

export function useSavePrompt() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (input: {
      id?: string;
      create?: CreatePromptTemplateRequest;
      update?: UpdatePromptTemplateRequest;
    }) =>
      input.id
        ? aiApi.updatePrompt(input.id, input.update ?? {})
        : aiApi.createPrompt(input.create as CreatePromptTemplateRequest),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.aiPrompts(orgId) }),
  });
}

export function useDeletePrompt() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => aiApi.removePrompt(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.aiPrompts(orgId) }),
  });
}

export function useRenderPrompt() {
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: RenderPromptTemplateRequest }) =>
      aiApi.renderPrompt(id, body),
  });
}

export function useAiTools(options?: { enabled?: boolean }) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.aiTools(orgId),
    queryFn: aiApi.tools,
    enabled: !!orgId && (options?.enabled ?? true),
    staleTime: 10 * 60 * 1000,
  });
}

// ---------------------------------------------------------------------------
// Assistant
// ---------------------------------------------------------------------------

export function useAssistantThreads(params: { page?: number; pageSize?: number } = {}) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.assistantThreads(orgId, params),
    queryFn: () => assistantApi.threads(params),
    enabled: !!orgId,
    placeholderData: (prev) => prev,
  });
}

export function useAssistantMessages(threadId: string | null) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.assistantMessages(orgId, threadId ?? ''),
    queryFn: () => assistantApi.messages(threadId as string, { page: 1, pageSize: 100 }),
    enabled: !!orgId && !!threadId,
  });
}

export function useCreateAssistantThread() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: CreateAssistantThreadRequest = {}) => assistantApi.createThread(body),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: [...keys.assistantRoot(orgId), 'threads'] }),
  });
}

export function useUpdateAssistantThread() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAssistantThreadRequest }) =>
      assistantApi.updateThread(id, body),
    onSuccess: (thread: AssistantThread) => {
      qc.setQueriesData<{ data: AssistantThread[]; meta: unknown }>(
        { queryKey: [...keys.assistantRoot(orgId), 'threads'] },
        (prev) =>
          prev ? { ...prev, data: prev.data.map((t) => (t.id === thread.id ? thread : t)) } : prev,
      );
      void qc.invalidateQueries({ queryKey: [...keys.assistantRoot(orgId), 'threads'] });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

export function useDeleteAssistantThread() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => assistantApi.removeThread(id),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: keys.assistantMessages(orgId, id) });
      void qc.invalidateQueries({ queryKey: [...keys.assistantRoot(orgId), 'threads'] });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });
}

// ---------------------------------------------------------------------------
// Agents & executions
// ---------------------------------------------------------------------------

export const EXECUTION_POLL_MS = 2000;
const TERMINAL_STATUSES: readonly AgentExecutionStatus[] = [
  'succeeded',
  'failed',
  'timed_out',
  'cancelled',
];
export function isTerminalExecution(status: AgentExecutionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function useAgents(params: ListAgentsParams = {}, options?: { enabled?: boolean }) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.agents(orgId, params),
    queryFn: () => agentsApi.list(params),
    enabled: !!orgId && (options?.enabled ?? true),
    placeholderData: (prev) => prev,
  });
}

export function useAgent(id: string | null) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.agent(orgId, id ?? ''),
    queryFn: () => agentsApi.get(id as string),
    enabled: !!orgId && !!id,
  });
}

export function useCreateAgent() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (body: CreateAgentRequest) => agentsApi.create(body),
    onSuccess: (agent) => {
      qc.setQueryData(keys.agent(orgId, agent.id), agent);
      void qc.invalidateQueries({ queryKey: keys.agentsRoot(orgId) });
    },
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAgentRequest }) =>
      agentsApi.update(id, body),
    onSuccess: (agent: Agent) => {
      qc.setQueryData(keys.agent(orgId, agent.id), agent);
      void qc.invalidateQueries({ queryKey: keys.agentsRoot(orgId) });
    },
  });
}

export function useDeleteAgent() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => agentsApi.remove(id),
    onSuccess: (_v, id) => {
      qc.removeQueries({ queryKey: keys.agent(orgId, id) });
      void qc.invalidateQueries({ queryKey: keys.agentsRoot(orgId) });
    },
  });
}

export function useExecuteAgent() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ExecuteAgentRequest }) =>
      agentsApi.execute(id, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.agentsRoot(orgId) }),
  });
}

export function useAgentExecutions(
  params: ListAgentExecutionsParams,
  options?: { refetchInterval?: number | false },
) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.executions(orgId, params),
    queryFn: () => agentsApi.executions(params),
    enabled: !!orgId,
    placeholderData: (prev) => prev,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

/** Execution detail; refetches every 2 s until the execution reaches a terminal status. */
export function useAgentExecution(id: string | null) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.execution(orgId, id ?? ''),
    queryFn: () => agentsApi.execution(id as string),
    enabled: !!orgId && !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status && isTerminalExecution(status) ? false : EXECUTION_POLL_MS;
    },
  });
}

export function useCancelExecution() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => agentsApi.cancelExecution(id),
    onSuccess: (_e: AgentExecution, id) => {
      void qc.invalidateQueries({ queryKey: keys.execution(orgId, id) });
      void qc.invalidateQueries({ queryKey: [...keys.agentsRoot(orgId), 'executions'] });
    },
  });
}
