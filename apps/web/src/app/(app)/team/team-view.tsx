'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  MailPlus,
  MoreHorizontal,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserRoundCheck,
  UserRoundX,
  Users,
} from 'lucide-react';
import { Permission, type Invitation, type Member, type Role } from '@hilatech/contracts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  PageHeader,
  Pagination,
  SearchInput,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableEmptyRow,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeletonRows,
  toast,
} from '@hilatech/ui';
import { getErrorMessage } from '@/lib/api';
import {
  useInvitations,
  useMembers,
  useRemoveMember,
  useRevokeInvitation,
  useRoles,
  useUpdateMember,
} from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { useSession } from '@/stores/session';
import { QueryState } from '@/components/common/query-state';
import { PermissionGate } from '@/components/common/permission-gate';
import { InviteDialog } from './invite-dialog';
import { useT, useFormat } from '@/i18n/provider';
import { roleLabel } from '@/i18n/enums';

const PAGE_SIZE = 20;

export function TeamView() {
  const t = useT();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [search, setSearch] = React.useState('');
  const [page, setPage] = React.useState(1);
  const [inviteOpen, setInviteOpen] = React.useState(searchParams.get('invite') === '1');

  const canInvite = useCan(Permission.MEMBERS_INVITE);
  const canUpdate = useCan(Permission.MEMBERS_UPDATE);
  const canRemove = useCan(Permission.MEMBERS_REMOVE);
  const canReadRoles = useCan(Permission.ROLES_READ);

  const members = useMembers({ page, pageSize: PAGE_SIZE, search: search || undefined });
  const invitations = useInvitations();
  const roles = useRoles({ enabled: canReadRoles && (canInvite || canUpdate) });

  const openInvite = () => setInviteOpen(true);
  const closeInvite = (open: boolean) => {
    setInviteOpen(open);
    if (!open && searchParams.get('invite')) router.replace('/team');
  };

  return (
    <PermissionGate anyOf={[Permission.MEMBERS_READ]}>
      <div className="flex flex-col gap-8">
        <PageHeader
          title={t('common.team')}
          description={t('team.peopleWhoCanSignIn')}
          actions={
            canInvite ? (
              <Button
                leadingIcon={<MailPlus aria-hidden />}
                onClick={openInvite}
                disabled={!roles.data}
              >
                {t('common.inviteATeammate')}
              </Button>
            ) : undefined
          }
        />

        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>{t('team.members')}</CardTitle>
              <CardDescription>
                {members.data ? t('team.memberCount', { count: members.data.meta.total }) : ' '}
              </CardDescription>
            </div>
            <SearchInput
              value={search}
              onValueChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder={t('team.searchByNameOrEmail')}
              aria-label={t('team.searchMembers')}
              className="w-full sm:w-72"
            />
          </CardHeader>
          <CardContent className="p-0">
            <MembersTable
              query={members}
              roles={roles.data ?? []}
              canUpdate={canUpdate}
              canRemove={canRemove}
              searching={!!search}
            />
            {members.data && members.data.meta.total > PAGE_SIZE ? (
              <div className="border-t border-border px-5 py-3">
                <Pagination
                  page={members.data.meta.page}
                  pageSize={members.data.meta.pageSize}
                  total={members.data.meta.total}
                  onPageChange={setPage}
                  itemLabel="members"
                />
              </div>
            ) : null}
          </CardContent>
        </Card>

        {canInvite ? (
          <Card>
            <CardHeader>
              <CardTitle>{t('team.pendingInvitations')}</CardTitle>
              <CardDescription>{t('team.invitationsExpireSevenDaysAfter')}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <InvitationsTable query={invitations} onInvite={openInvite} />
            </CardContent>
          </Card>
        ) : null}

        {roles.data ? (
          <InviteDialog open={inviteOpen} onOpenChange={closeInvite} roles={roles.data} />
        ) : null}
      </div>
    </PermissionGate>
  );
}

// ---------------------------------------------------------------------------

function MembersTable({
  query,
  roles,
  canUpdate,
  canRemove,
  searching,
}: {
  query: ReturnType<typeof useMembers>;
  roles: Role[];
  canUpdate: boolean;
  canRemove: boolean;
  searching: boolean;
}) {
  const t = useT();
  const columns = 5;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('team.member')}</TableHead>
          <TableHead>{t('common.role')}</TableHead>
          <TableHead>{t('common.status')}</TableHead>
          <TableHead>{t('team.joined')}</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">{t('common.actions')}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {query.isPending ? (
          <TableSkeletonRows columns={columns} rows={5} />
        ) : query.isError ? (
          <TableEmptyRow colSpan={columns}>
            <div className="flex flex-col items-center gap-2">
              <span>{getErrorMessage(query.error)}</span>
              <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
                {t('common.tryAgain')}
              </Button>
            </div>
          </TableEmptyRow>
        ) : query.data.data.length === 0 ? (
          <TableEmptyRow colSpan={columns}>
            {searching ? t('team.noMembersMatchYourSearch') : t('team.noMembersYet')}
          </TableEmptyRow>
        ) : (
          query.data.data.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              roles={roles}
              canUpdate={canUpdate}
              canRemove={canRemove}
            />
          ))
        )}
      </TableBody>
    </Table>
  );
}

function MemberRow({
  member,
  roles,
  canUpdate,
  canRemove,
}: {
  member: Member;
  roles: Role[];
  canUpdate: boolean;
  canRemove: boolean;
}) {
  const fmt = useFormat();
  const t = useT();
  const currentUserId = useSession((s) => s.user?.id);
  const update = useUpdateMember();
  const remove = useRemoveMember();
  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const isSelf = member.userId === currentUserId;
  const isOwner = member.role.key === 'owner';
  const fullName = `${member.user.firstName} ${member.user.lastName}`.trim();

  const changeRole = (roleId: string) => {
    if (roleId === member.role.id) return;
    update.mutate(
      { id: member.id, body: { roleId } },
      {
        onSuccess: (m) => toast.success(t('team.isNow', { fullName, name: m.role.name })),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };

  const toggleStatus = () => {
    const status = member.status === 'active' ? 'suspended' : 'active';
    update.mutate(
      { id: member.id, body: { status } },
      {
        onSuccess: () =>
          toast.success(
            status === 'suspended'
              ? t('team.memberSuspended', { name: fullName })
              : t('team.memberReactivated', { name: fullName }),
          ),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };

  const onRemove = () => {
    remove.mutate(member.id, {
      onSuccess: () => {
        toast.success(t('team.removedFromTheOrganization', { fullName }));
        setConfirmRemove(false);
      },
      onError: (e) => toast.error(getErrorMessage(e)),
    });
  };

  const showMenu = (canUpdate || canRemove) && !isOwner && !isSelf;

  return (
    <TableRow>
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar
            src={member.user.avatarUrl}
            firstName={member.user.firstName}
            lastName={member.user.lastName}
          />
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 truncate font-medium">
              {fullName}
              {isSelf ? (
                <Badge variant="outline" className="px-1.5 py-0 text-[0.625rem] leading-4">
                  {t('team.you')}
                </Badge>
              ) : null}
            </span>
            <span className="truncate text-xs text-fg-muted">{member.user.email}</span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5">
          {member.role.isSystem ? (
            <ShieldCheck className="size-3.5 text-fg-subtle" aria-hidden />
          ) : null}
          {roleLabel(t, member.role.name)}
        </span>
      </TableCell>
      <TableCell>
        <StatusBadge status={member.status} />
      </TableCell>
      <TableCell className="text-fg-muted tabular">
        <time dateTime={member.joinedAt} title={fmt.dateTime(new Date(member.joinedAt), 'long')}>
          {fmt.date(new Date(member.joinedAt))}
        </time>
      </TableCell>
      <TableCell className="text-end">
        {showMenu ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={t('team.actionsFor', { fullName })} disabled={update.isPending}>
                  <MoreHorizontal aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {canUpdate && roles.length > 0 ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ShieldCheck aria-hidden className="size-4 text-fg-subtle" />
                      {t('team.changeRole')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuLabel>{t('common.role')}</DropdownMenuLabel>
                      <DropdownMenuRadioGroup value={member.role.id} onValueChange={changeRole}>
                        {roles
                          .filter((r) => r.key !== 'owner')
                          .map((r) => (
                            <DropdownMenuRadioItem key={r.id} value={r.id}>
                              {roleLabel(t, r.name)}
                            </DropdownMenuRadioItem>
                          ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}
                {canUpdate ? (
                  <DropdownMenuItem onSelect={toggleStatus}>
                    {member.status === 'active' ? (
                      <UserRoundX aria-hidden />
                    ) : (
                      <UserRoundCheck aria-hidden />
                    )}
                    {member.status === 'active' ? t('team.suspendAccess') : t('team.reactivate')}
                  </DropdownMenuItem>
                ) : null}
                {canRemove ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem tone="danger" onSelect={() => setConfirmRemove(true)}>
                      <UserMinus aria-hidden />
                      {t('team.removeFromOrganization')}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <ConfirmDialog
              open={confirmRemove}
              onOpenChange={setConfirmRemove}
              title={t('team.remove', { fullName })}
              description={t('team.theyWillLoseAccessTo')}
              confirmLabel={t('team.removeMember')}
              tone="danger"
              loading={remove.isPending}
              onConfirm={onRemove}
            />
          </>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------

function InvitationsTable({
  query,
  onInvite,
}: {
  query: ReturnType<typeof useInvitations>;
  onInvite: () => void;
}) {
  const fmt = useFormat();
  const t = useT();
  const revoke = useRevokeInvitation();
  const [target, setTarget] = React.useState<Invitation | null>(null);
  const columns = 5;

  const pending = React.useMemo(
    () => (query.data ?? []).filter((i) => i.status === 'pending'),
    [query.data],
  );

  return (
    <>
      <QueryState
        query={query}
        compact
        loading={
          <Table>
            <TableBody>
              <TableSkeletonRows columns={columns} rows={2} />
            </TableBody>
          </Table>
        }
        isEmpty={() => pending.length === 0}
        empty={
          <EmptyState
            compact
            icon={<Users />}
            title={t('team.noPendingInvitations')}
            description={t('team.inviteSomeoneAndTheirInvitation')}
            action={
              <Button variant="secondary" size="sm" onClick={onInvite}>
                {t('common.inviteATeammate')}
              </Button>
            }
          />
        }
      >
        {() => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common.email')}</TableHead>
                <TableHead>{t('common.role')}</TableHead>
                <TableHead>{t('team.invitedBy')}</TableHead>
                <TableHead>{t('common.expires')}</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">{t('common.actions')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.email}</TableCell>
                  <TableCell>{roleLabel(t, inv.role.name)}</TableCell>
                  <TableCell className="text-fg-muted">
                    {inv.invitedBy.firstName} {inv.invitedBy.lastName}
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    <time
                      dateTime={inv.expiresAt}
                      title={fmt.dateTime(new Date(inv.expiresAt), 'long')}
                    >
                      {fmt.relative(new Date(inv.expiresAt))}
                    </time>
                  </TableCell>
                  <TableCell className="text-end">
                    <IconButton
                      label={t('team.revokeInvitationFor', { email: inv.email })}
                      variant="danger"
                      onClick={() => setTarget(inv)}
                    >
                      <Trash2 aria-hidden />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </QueryState>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(open) => !open && setTarget(null)}
        title={t('team.revokeThisInvitation')}
        description={target ? t('team.willNoLongerBeAble', { email: target.email }) : undefined}
        confirmLabel={t('team.revokeInvitation')}
        tone="danger"
        loading={revoke.isPending}
        onConfirm={() => {
          if (!target) return;
          revoke.mutate(target.id, {
            onSuccess: () => {
              toast.success(t('team.invitationRevoked'));
              setTarget(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          });
        }}
      />
    </>
  );
}
