'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import type {
  CreateInvitationRequest,
  CreateRoleRequest,
  Invitation,
  Member,
  OrganizationSettings,
  Role,
  UpdateMemberRequest,
  UpdateOrganizationRequest,
  UpdateRoleRequest,
  ListAuditLogsQuery,
} from '@hilatech/contracts';
import {
  analyticsApi,
  auditApi,
  authApi,
  billingApi,
  invitationsApi,
  isApiError,
  keys,
  membersApi,
  notificationsApi,
  organizationsApi,
  rolesApi,
  usersApi,
  type ListMembersParams,
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

export function useDashboard() {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.dashboard(orgId),
    queryFn: analyticsApi.dashboard,
    enabled: !!orgId,
  });
}

export function useNotifications(unread = true) {
  const orgId = useActiveOrganizationId();
  return useQuery({
    queryKey: keys.notifications(orgId, unread),
    queryFn: () => notificationsApi.list(unread),
    enabled: !!orgId,
    // The endpoint may not exist until a later milestone: treat 404 as "no notifications".
    retry: (count, error) => !(isApiError(error) && error.isNotFound) && count < 1,
    refetchInterval: 60_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', orgId, 'notifications'] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  const orgId = useActiveOrganizationId();
  return useMutation({
    mutationFn: notificationsApi.markAllRead,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org', orgId, 'notifications'] }),
  });
}
