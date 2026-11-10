'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  ArrowLeft,
  Calendar,
  Contact as ContactIcon,
  MoreHorizontal,
  Repeat,
  Sparkles,
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
import { useT, useFormat } from '@/i18n/provider';

export function LeadDetailView({ id }: { id: string }) {
  const t = useT();
  const lead = useLead(id);
  return (
    <PermissionGate anyOf={[Permission.LEADS_READ]}>
      <QueryState
        query={lead}
        loading={<LeadDetailSkeleton />}
        errorTitle={t('leads.thisLeadCouldnTBe')}
      >
        {(data) => <LeadDetail lead={data} />}
      </QueryState>
      {lead.isError && isApiError(lead.error) && lead.error.isNotFound ? (
        <div className="mt-4 flex justify-center">
          <Button asChild variant="secondary" leadingIcon={<ArrowLeft aria-hidden />}>
            <Link href="/leads">{t('leads.backToLeads')}</Link>
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
  const fmt = useFormat();
  const t = useT();
  const router = useRouter();
  const canUpdate = useCan(Permission.LEADS_UPDATE);
  const canAssign = useCan(Permission.LEADS_ASSIGN);
  const canDelete = useCan(Permission.LEADS_DELETE);
  const canReadContacts = useCan(Permission.CONTACTS_READ);
  const canAskAssistant = useCan(Permission.AI_ASSISTANT_USE);

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
          toast.success(
            t('leads.leadMarkedAs', { name: t(LEAD_STATUS_LABELS[status]).toLowerCase() }),
          ),
        onError: (e) => toast.error(getErrorMessage(e)),
      },
    );
  };

  const onDelete = () => {
    remove.mutate(lead.id, {
      onSuccess: () => {
        toast.success(t('leads.leadDeleted', { title: lead.title }));
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
            {t('common.leads')}
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
            {t('leads.created', { value: t(LEAD_SOURCE_LABELS[lead.source]) })}{' '}
            <time dateTime={lead.createdAt} title={fmt.dateTime(new Date(lead.createdAt), 'long')}>
              {fmt.relative(new Date(lead.createdAt))}
            </time>
            {lead.convertedAt ? (
              <>
                {' '}
                {t('leads.converted')}{' '}
                <time dateTime={lead.convertedAt}>{fmt.date(new Date(lead.convertedAt))}</time>
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
                          ? t('conversations.assignedTo', {
                              name: `${l.assignee.firstName} ${l.assignee.lastName}`.trim(),
                            })
                          : t('conversations.assigneeRemoved'),
                      ),
                  },
                )
              }
            />
            {canAskAssistant ? (
              <Button asChild variant="secondary" leadingIcon={<Sparkles aria-hidden />}>
                <Link href={`/assistant?leadId=${encodeURIComponent(lead.id)}`}>
                  {t('common.askTheAssistant')}
                </Link>
              </Button>
            ) : null}
            {canUpdate ? (
              <Button
                variant={lead.convertedAt ? 'secondary' : 'primary'}
                leadingIcon={<Repeat aria-hidden />}
                onClick={() => setConvertOpen(true)}
              >
                {lead.convertedAt ? t('leads.convertAgain') : t('leads.convert')}
              </Button>
            ) : null}
            {canDelete ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <IconButton label={t('common.moreActions')} variant="secondary">
                    <MoreHorizontal aria-hidden />
                  </IconButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem tone="danger" onSelect={() => setDeleteOpen(true)}>
                    <Trash2 aria-hidden />
                    {t('leads.deleteLead')}
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
              <span>{t('common.stage')}</span>
              <LeadStatusBadge status={lead.status} />
            </div>
          )}
          {lead.status === 'lost' && lead.lostReason ? (
            <p className="mt-3 text-sm text-fg-muted">
              <span className="font-medium text-fg">{t('leads.lostReason')}</span> {lead.lostReason}
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
              <CardTitle>{t('leads.summary')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <dt className="text-fg-muted">{t('common.value')}</dt>
                <dd className="font-medium tabular">
                  {lead.value != null ? fmt.currency(lead.value, lead.currency) : '—'}
                </dd>
                <dt className="text-fg-muted">{t('leads.expectedClose')}</dt>
                <dd className="flex items-center gap-1.5">
                  {lead.expectedCloseDate ? (
                    <>
                      <Calendar className="size-3.5 text-fg-subtle" aria-hidden />
                      {fmt.date(new Date(lead.expectedCloseDate))}
                    </>
                  ) : (
                    '—'
                  )}
                </dd>
                <dt className="text-fg-muted">{t('common.contact')}</dt>
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
                    <span className="text-fg-subtle">{t('leads.notLinked')}</span>
                  )}
                </dd>
                <dt className="text-fg-muted">{t('common.tags')}</dt>
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
                <dt className="text-fg-muted">{t('common.updated')}</dt>
                <dd className="tabular">{fmt.relative(new Date(lead.updatedAt))}</dd>
              </dl>
              {closed && !lead.contactId && canUpdate ? (
                <Alert tone="info" className="mt-4">
                  {t('leads.convertThisLeadToKeep')}
                </Alert>
              ) : null}
            </CardContent>
          </Card>

          <RelatedConversations
            leadId={lead.id}
            lead={{ id: lead.id, title: lead.title }}
            contact={lead.contact}
            description={t('leads.threadsLinkedToThisLead')}
          />
        </div>
      </div>

      <ConvertLeadDialog
        open={convertOpen}
        onOpenChange={setConvertOpen}
        lead={lead}
        onConverted={({ contact }) =>
          toast.success(t('leads.leadConvertedIsNowA', { contactName: contactName(contact) }), {
            action: canReadContacts
              ? {
                  label: t('leads.viewContact'),
                  onClick: () => router.push(`/contacts/${contact.id}`),
                }
              : undefined,
          })
        }
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('leads.deleteThisLead')}
        description={t('leads.notesAndActivityAreDeleted')}
        confirmLabel={t('leads.deleteLead')}
        tone="danger"
        loading={remove.isPending}
        onConfirm={onDelete}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function LeadDetailsForm({ lead, canUpdate }: { lead: LeadWithRelations; canUpdate: boolean }) {
  const t = useT();
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
      toast.success(t('leads.leadSaved'));
    } catch (error) {
      if (!applyServerErrors(error, form.setError, LEAD_FORM_FIELDS))
        setFormError(getErrorMessage(error));
    }
  });

  if (!canUpdate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('common.details')}</CardTitle>
        </CardHeader>
        <CardContent>
          {lead.description ? (
            <p className="text-sm whitespace-pre-wrap">{lead.description}</p>
          ) : (
            <EmptyState
              compact
              icon={<Target />}
              title={t('common.noDescription')}
              description={t('leads.yourRoleCanViewThis')}
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
          <CardTitle>{t('common.details')}</CardTitle>
          <CardDescription>{t('leads.keepTheEssentialsCurrentThe')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <LeadFormFields form={form} selectedContact={lead.contact} idPrefix={`lead-${lead.id}`} />
          {lead.contact ? (
            <p className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <ContactIcon className="size-3.5" aria-hidden />
              {t('leads.clearingTheContactHereKeeps')}
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
            {t('common.discard')}
          </Button>
          <Button
            type="submit"
            loading={form.formState.isSubmitting}
            disabled={!form.formState.isDirty}
          >
            {t('common.saveChanges')}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
