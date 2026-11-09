'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  Calendar,
  Contact as ContactIcon,
  MoreHorizontal,
  Repeat,
  Target,
  Trash2,
} from 'lucide-react';
import { Permission, type LeadStatus, type LeadWithRelations } from '@hilatech/contracts';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  PageHeader,
  Skeleton,
  formatCurrency,
  toast,
} from '@hilatech/ui';
import { getErrorMessage, isApiError } from '@/lib/api';
import { useAssignLead, useDeleteLead, useLead, useUpdateLead } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { applyServerErrors } from '@/lib/forms/server-errors';
import {
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  contactMeta,
  contactName,
  isClosedLead,
} from '@/lib/crm';
import { PermissionGate } from '@/components/common/permission-gate';
import { QueryState } from '@/components/common/query-state';
import { AssigneeMenu } from '@/components/crm/assignee-menu';
import { LeadStatusBadge } from '@/components/crm/badges';
import { RelatedConversations } from '@/components/crm/related-conversations';
import {
  LEAD_FORM_FIELDS,
  LeadFormFields,
  leadFormDefaults,
  leadFormSchema,
  toUpdateLeadRequest,
  type LeadFormInput,
  type LeadFormValues,
} from '../lead-form';
import { LeadStatusPipeline } from '../lead-status-pipeline';
import { ConvertLeadDialog } from './convert-lead-dialog';
import { LeadActivity } from './lead-activity';
import { LeadNotes } from './lead-notes';

export function LeadDetailView({ id }: { id: string }) {
  const lead = useLead(id);
  return (
    <PermissionGate anyOf={[Permission.LEADS_READ]}>
      <QueryState
        query={lead}
        loading={<LeadDetailSkeleton />}
        errorTitle="This lead couldn’t be loaded"
      >
        {(data) => <LeadDetail lead={data} />}
      </QueryState>
      {lead.isError && isApiError(lead.error) && lead.error.isNotFound ? (
        <div className="mt-4 flex justify-center">
          <Button asChild variant="secondary" leadingIcon={<ArrowLeft aria-hidden />}>
            <Link href="/leads">Back to leads</Link>
          </Button>
        </div>
      ) : null}
    </PermissionGate>
  );
}

function LeadDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Skeleton className="h-16 w-full rounded-lg" />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function LeadDetail({ lead }: { lead: LeadWithRelations }) {
  const router = useRouter();
  const canUpdate = useCan(Permission.LEADS_UPDATE);
  const canAssign = useCan(Permission.LEADS_ASSIGN);
  const canDelete = useCan(Permission.LEADS_DELETE);
  const canReadContacts = useCan(Permission.CONTACTS_READ);

  const update = useUpdateLead();
  const assign = useAssignLead();
  const remove = useDeleteLead();
  const [convertOpen, setConvertOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const changeStatus = (status: LeadStatus, lostReason?: string) => {
    update.mutate(
      { id: lead.id, body: status === 'lost' ? { status, lostReason } : { status } },
      {
        onSuccess: () =>
          toast.success(`Lead marked as ${LEAD_STATUS_LABELS[status].toLowerCase()}`),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };

  const onDelete = () => {
    remove.mutate(lead.id, {
      onSuccess: () => {
        toast.success(`Lead “${lead.title}” deleted`);
        router.replace('/leads');
      },
      onError: (e) => toast.error(getErrorMessage(e)),
    });
  };

  const closed = isClosedLead(lead.status);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/leads" className="inline-flex items-center gap-1 hover:text-fg">
            <ArrowLeft className="size-3.5" aria-hidden />
            Leads
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-3">
            {lead.title}
            <LeadStatusBadge status={lead.status} className="translate-y-0.5" />
          </span>
        }
        description={
          <>
            {LEAD_SOURCE_LABELS[lead.source]} · created{' '}
            <time dateTime={lead.createdAt} title={format(new Date(lead.createdAt), 'PPpp')}>
              {formatDistanceToNow(new Date(lead.createdAt), { addSuffix: true })}
            </time>
            {lead.convertedAt ? (
              <>
                {' '}
                · converted{' '}
                <time dateTime={lead.convertedAt}>
                  {format(new Date(lead.convertedAt), 'd MMM yyyy')}
                </time>
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <AssigneeMenu
              assignee={lead.assignee}
              canAssign={canAssign}
              canSelfAssign={canUpdate}
              pending={assign.isPending}
              onAssign={(userId) =>
                assign.mutate(
                  { id: lead.id, assigneeId: userId },
                  {
                    onSuccess: (l) =>
                      toast.success(
                        l.assignee
                          ? `Assigned to ${l.assignee.firstName} ${l.assignee.lastName}`.trim()
                          : 'Assignee removed',
                      ),
                  },
                )
              }
            />
            {canUpdate ? (
              <Button
                variant={lead.convertedAt ? 'secondary' : 'primary'}
                leadingIcon={<Repeat aria-hidden />}
                onClick={() => setConvertOpen(true)}
              >
                {lead.convertedAt ? 'Convert again' : 'Convert'}
              </Button>
            ) : null}
            {canDelete ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label="More actions" variant="secondary">
                    <MoreHorizontal aria-hidden />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem tone="danger" onSelect={() => setDeleteOpen(true)}>
                    <Trash2 aria-hidden />
                    Delete lead
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      <Card>
        <CardContent className="py-4">
          {canUpdate ? (
            <LeadStatusPipeline
              status={lead.status}
              onChange={changeStatus}
              pending={update.isPending}
            />
          ) : (
            <div className="flex items-center gap-3 text-sm text-fg-muted">
              <span>Stage</span>
              <LeadStatusBadge status={lead.status} />
            </div>
          )}
          {lead.status === 'lost' && lead.lostReason ? (
            <p className="mt-3 text-sm text-fg-muted">
              <span className="font-medium text-fg">Lost reason:</span> {lead.lostReason}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <LeadDetailsForm lead={lead} canUpdate={canUpdate} />
          <LeadNotes leadId={lead.id} canWrite={canUpdate} />
          <LeadActivity leadId={lead.id} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <dt className="text-fg-muted">Value</dt>
                <dd className="font-medium tabular">
                  {lead.value != null ? formatCurrency(lead.value, lead.currency) : '—'}
                </dd>
                <dt className="text-fg-muted">Expected close</dt>
                <dd className="flex items-center gap-1.5">
                  {lead.expectedCloseDate ? (
                    <>
                      <Calendar className="size-3.5 text-fg-subtle" aria-hidden />
                      {format(new Date(lead.expectedCloseDate), 'd MMM yyyy')}
                    </>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt className="text-fg-muted">Contact</dt>
                <dd className="min-w-0">
                  {lead.contact ? (
                    canReadContacts ? (
                      <Link
                        href={`/contacts/${lead.contact.id}`}
                        className="flex flex-col hover:underline"
                      >
                        <span className="truncate font-medium">{contactName(lead.contact)}</span>
                        {contactMeta(lead.contact) ? (
                          <span className="truncate text-xs text-fg-muted">
                            {contactMeta(lead.contact)}
                          </span>
                        ) : null}
                      </Link>
                    ) : (
                      contactName(lead.contact)
                    )
                  ) : (
                    <span className="text-fg-subtle">Not linked</span>
                  )}
                </dd>
                <dt className="text-fg-muted">Tags</dt>
                <dd className="flex flex-wrap gap-1">
                  {lead.tags.length > 0 ? (
                    lead.tags.map((t) => (
                      <Badge key={t} variant="outline">
                        {t}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </dd>
                <dt className="text-fg-muted">Updated</dt>
                <dd className="tabular">
                  {formatDistanceToNow(new Date(lead.updatedAt), { addSuffix: true })}
                </dd>
              </dl>
              {closed && !lead.contactId && canUpdate ? (
                <Alert tone="info" className="mt-4">
                  Convert this lead to keep the customer in your contacts.
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <RelatedConversations
            leadId={lead.id}
            lead={{ id: lead.id, title: lead.title }}
            contact={lead.contact}
            description="Threads linked to this lead."
          />
        </div>
      </div>

      <ConvertLeadDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        lead={lead}
        onConverted={({ contact }) =>
          toast.success(`Lead converted — ${contactName(contact)} is now a contact`, {
            action: canReadContacts
              ? { label: 'View contact', onClick: () => router.push(`/contacts/${contact.id}`) }
              : undefined,
          })
        }
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete this lead?"
        description="Notes and activity are deleted with it. Linked contacts and conversations are kept."
        confirmLabel="Delete lead"
        tone="danger"
        loading={remove.isPending}
        onConfirm={onDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function LeadDetailsForm({ lead, canUpdate }: { lead: LeadWithRelations; canUpdate: boolean }) {
  const update = useUpdateLead();
  const [formError, setFormError] = React.useState<string | null>(null);
  const defaults = React.useMemo(() => leadFormDefaults(lead), [lead]);
  const form = useForm<LeadFormInput, unknown, LeadFormValues>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: defaults,
  });
  React.useEffect(() => {
    if (!form.formState.isDirty) form.reset(defaults);
  }, [defaults, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const updated = await update.mutateAsync({ id: lead.id, body: toUpdateLeadRequest(values) });
      form.reset(leadFormDefaults(updated));
      toast.success('Lead saved');
    } catch (error) {
      if (!applyServerErrors(error, form.setError, LEAD_FORM_FIELDS))
        setFormError(getErrorMessage(error));
    }
  });

  if (!canUpdate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent>
          {lead.description ? (
            <p className="text-sm whitespace-pre-wrap">{lead.description}</p>
          ) : (
            <EmptyState
              compact
              icon={<Target />}
              title="No description"
              description="Your role can view this lead but not edit it."
            />
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>
            Keep the essentials current; the stage is managed above.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <LeadFormFields form={form} selectedContact={lead.contact} idPrefix={`lead-${lead.id}`} />
          {lead.contact ? (
            <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <ContactIcon className="size-3.5" aria-hidden />
              Clearing the contact here keeps the current link; use Convert to change it.
            </p>
          ) : null}
        </CardContent>
        <CardFooter className="justify-end">
          <Button
            type="button"
            variant="ghost"
            disabled={!form.formState.isDirty || form.formState.isSubmitting}
            onClick={() => form.reset(defaults)}
          >
            Discard
          </Button>
          <Button
            type="submit"
            loading={form.formState.isSubmitting}
            disabled={!form.formState.isDirty}
          >
            Save changes
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
