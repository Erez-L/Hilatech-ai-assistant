'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';
import { MailPlus, MoreHorizontal, ShieldCheck, Trash2, UserMinus, UserRoundCheck, UserRoundX, Users } from 'lucide-react';
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

const PAGE_SIZE = 20;

export function TeamView() {
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
          title="Team"
          description="People who can sign in to this organization, and the role each of them holds."
          actions={
            canInvite ? (
              <Button leadingIcon={<MailPlus aria-hidden />} onClick={openInvite} disabled={!roles.data}>
                Invite a teammate
              </Button>
            ) : undefined
          }
        />

        <Card>
          <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-1">
              <CardTitle>Members</CardTitle>
              <CardDescription>
                {members.data ? `${members.data.meta.total} member${members.data.meta.total === 1 ? '' : 's'}` : ' '}
              </CardDescription>
            </div>
            <SearchInput
              value={search}
              onValueChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Search by name or email"
              aria-label="Search members"
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
              <CardTitle>Pending invitations</CardTitle>
              <CardDescription>Invitations expire seven days after they are sent.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <InvitationsTable query={invitations} onInvite={openInvite} />
            </CardContent>
          </Card>
        ) : null}

        {roles.data ? <InviteDialog open={inviteOpen} onOpenChange={closeInvite} roles={roles.data} /> : null}
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
  const columns = 5;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Member</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Joined</TableHead>
          <TableHead className="w-12">
            <span className="sr-only">Actions</span>
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
                Try again
              </Button>
            </div>
          </TableEmptyRow>
        ) : query.data.data.length === 0 ? (
          <TableEmptyRow colSpan={columns}>
            {searching ? 'No members match your search.' : 'No members yet.'}
          </TableEmptyRow>
        ) : (
          query.data.data.map((member) => (
            <MemberRow key={member.id} member={member} roles={roles} canUpdate={canUpdate} canRemove={canRemove} />
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
        onSuccess: (m) => toast.success(`${fullName} is now ${m.role.name}`),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };

  const toggleStatus = () => {
    const status = member.status === 'active' ? 'suspended' : 'active';
    update.mutate(
      { id: member.id, body: { status } },
      {
        onSuccess: () => toast.success(status === 'suspended' ? `${fullName} suspended` : `${fullName} reactivated`),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };

  const onRemove = () => {
    remove.mutate(member.id, {
      onSuccess: () => {
        toast.success(`${fullName} removed from the organization`);
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
          <Avatar src={member.user.avatarUrl} firstName={member.user.firstName} lastName={member.user.lastName} />
          <div className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2 truncate font-medium">
              {fullName}
              {isSelf ? (
                <Badge variant="outline" className="px-1.5 py-0 text-[0.625rem] leading-4">
                  You
                </Badge>
              ) : null}
            </span>
            <span className="truncate text-xs text-fg-muted">{member.user.email}</span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5">
          {member.role.isSystem ? <ShieldCheck className="size-3.5 text-fg-subtle" aria-hidden /> : null}
          {member.role.name}
        </span>
      </TableCell>
      <TableCell>
        <StatusBadge status={member.status} />
      </TableCell>
      <TableCell className="text-fg-muted tabular">
        <time dateTime={member.joinedAt} title={format(new Date(member.joinedAt), 'PPpp')}>
          {format(new Date(member.joinedAt), 'd MMM yyyy')}
        </time>
      </TableCell>
      <TableCell className="text-right">
        {showMenu ? (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton label={`Actions for ${fullName}`} disabled={update.isPending}>
                  <MoreHorizontal aria-hidden />
                </IconButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {canUpdate && roles.length > 0 ? (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ShieldCheck aria-hidden className="size-4 text-fg-subtle" />
                      Change role
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuLabel>Role</DropdownMenuLabel>
                      <DropdownMenuRadioGroup value={member.role.id} onValueChange={changeRole}>
                        {roles
                          .filter((r) => r.key !== 'owner')
                          .map((r) => (
                            <DropdownMenuRadioItem key={r.id} value={r.id}>
                              {r.name}
                            </DropdownMenuRadioItem>
                          ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ) : null}
                {canUpdate ? (
                  <DropdownMenuItem onSelect={toggleStatus}>
                    {member.status === 'active' ? <UserRoundX aria-hidden /> : <UserRoundCheck aria-hidden />}
                    {member.status === 'active' ? 'Suspend access' : 'Reactivate'}
                  </DropdownMenuItem>
                ) : null}
                {canRemove ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem tone="danger" onSelect={() => setConfirmRemove(true)}>
                      <UserMinus aria-hidden />
                      Remove from organization
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <ConfirmDialog
              open={confirmRemove}
              onOpenChange={setConfirmRemove}
              title={`Remove ${fullName}?`}
              description="They will lose access to this organization immediately. Their account and other organizations are not affected."
              confirmLabel="Remove member"
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

function InvitationsTable({ query, onInvite }: { query: ReturnType<typeof useInvitations>; onInvite: () => void }) {
  const revoke = useRevokeInvitation();
  const [target, setTarget] = React.useState<Invitation | null>(null);
  const columns = 5;

  const pending = React.useMemo(() => (query.data ?? []).filter((i) => i.status === 'pending'), [query.data]);

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
            title="No pending invitations"
            description="Invite someone and their invitation will wait here until it’s accepted."
            action={
              <Button variant="secondary" size="sm" onClick={onInvite}>
                Invite a teammate
              </Button>
            }
          />
        }
      >
        {() => (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Invited by</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pending.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-medium">{inv.email}</TableCell>
                  <TableCell>{inv.role.name}</TableCell>
                  <TableCell className="text-fg-muted">
                    {inv.invitedBy.firstName} {inv.invitedBy.lastName}
                  </TableCell>
                  <TableCell className="text-fg-muted">
                    <time dateTime={inv.expiresAt} title={format(new Date(inv.expiresAt), 'PPpp')}>
                      {formatDistanceToNow(new Date(inv.expiresAt), { addSuffix: true })}
                    </time>
                  </TableCell>
                  <TableCell className="text-right">
                    <IconButton label={`Revoke invitation for ${inv.email}`} variant="danger" onClick={() => setTarget(inv)}>
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
        title="Revoke this invitation?"
        description={target ? `${target.email} will no longer be able to join with this link.` : undefined}
        confirmLabel="Revoke invitation"
        tone="danger"
        loading={revoke.isPending}
        onConfirm={() => {
          if (!target) return;
          revoke.mutate(target.id, {
            onSuccess: () => {
              toast.success('Invitation revoked');
              setTarget(null);
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          });
        }}
      />
    </>
  );
}
