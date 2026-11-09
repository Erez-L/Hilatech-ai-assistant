'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { format, formatDistanceToNow } from 'date-fns';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  Target,
  Trash2,
} from 'lucide-react';
import { Permission, type ContactDetail } from '@hilatech/contracts';
import {
  Alert,
  Avatar,
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
import { useContact, useDeleteContact, useLeads, useUpdateContact } from '@/hooks/queries';
import { useCan } from '@/hooks/use-can';
import { applyServerErrors } from '@/lib/forms/server-errors';
import { contactName } from '@/lib/crm';
import { PermissionGate } from '@/components/common/permission-gate';
import { QueryState } from '@/components/common/query-state';
import { LeadStatusBadge } from '@/components/crm/badges';
import { RelatedConversations } from '@/components/crm/related-conversations';
import { UserChip } from '@/components/crm/user-chip';
import { LeadDialog } from '../../leads/lead-dialog';
import {
  CONTACT_FORM_FIELDS,
  ContactFormFields,
  contactFormDefaults,
  contactFormSchema,
  toUpdateContactRequest,
  type ContactFormInput,
  type ContactFormValues,
} from '../contact-form';

export function ContactDetailView({ id }: { id: string }) {
  const contact = useContact(id);
  return (
    <PermissionGate anyOf={[Permission.CONTACTS_READ]}>
      <QueryState
        query={contact}
        loading={<ContactDetailSkeleton />}
        errorTitle="This contact couldn’t be loaded"
      >
        {(data) => <ContactDetailBody contact={data} />}
      </QueryState>
      {contact.isError && isApiError(contact.error) && contact.error.isNotFound ? (
        <div className="mt-4 flex justify-center">
          <Button asChild variant="secondary" leadingIcon={<ArrowLeft aria-hidden />}>
            <Link href="/contacts">Back to contacts</Link>
          </Button>
        </div>
      ) : null}
    </PermissionGate>
  );
}

function ContactDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy>
      <div className="flex items-center gap-4">
        <Skeleton className="size-14 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}

function ContactDetailBody({ contact }: { contact: ContactDetail }) {
  const router = useRouter();
  const canUpdate = useCan(Permission.CONTACTS_UPDATE);
  const canDelete = useCan(Permission.CONTACTS_DELETE);
  const canCreateLead = useCan(Permission.LEADS_CREATE);
  const remove = useDeleteContact();
  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [leadOpen, setLeadOpen] = React.useState(false);
  const name = contactName(contact);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={
          <Link href="/contacts" className="inline-flex items-center gap-1 hover:text-fg">
            <ArrowLeft className="size-3.5" aria-hidden />
            Contacts
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <Avatar size="lg" firstName={contact.firstName} lastName={contact.lastName} />
            {name}
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {contact.company || contact.jobTitle ? (
              <span className="inline-flex items-center gap-1.5">
                <Briefcase className="size-3.5" aria-hidden />
                {[contact.jobTitle, contact.company].filter(Boolean).join(' at ')}
              </span>
            ) : null}
            {contact.email ? (
              <a
                href={`mailto:${contact.email}`}
                className="inline-flex items-center gap-1.5 hover:text-fg"
              >
                <Mail className="size-3.5" aria-hidden />
                {contact.email}
              </a>
            ) : null}
            {contact.phone ? (
              <a
                href={`tel:${contact.phone}`}
                className="inline-flex items-center gap-1.5 hover:text-fg"
              >
                <Phone className="size-3.5" aria-hidden />
                {contact.phone}
              </a>
            ) : null}
          </span>
        }
        actions={
          <>
            {canCreateLead ? (
              <Button
                variant="secondary"
                leadingIcon={<Plus aria-hidden />}
                onClick={() => setLeadOpen(true)}
              >
                New lead
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
                    Delete contact
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <div className="flex min-w-0 flex-col gap-6">
          <ContactDetailsForm contact={contact} canUpdate={canUpdate} />
          <RelatedLeads
            contact={contact}
            onCreate={canCreateLead ? () => setLeadOpen(true) : undefined}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>At a glance</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
                <dt className="text-fg-muted">Owner</dt>
                <dd>
                  <UserChip user={contact.owner} emptyLabel="No owner" />
                </dd>
                <dt className="text-fg-muted">Leads</dt>
                <dd className="tabular">{contact.leadCount}</dd>
                <dt className="text-fg-muted">Conversations</dt>
                <dd className="tabular">{contact.conversationCount}</dd>
                <dt className="text-fg-muted">Tags</dt>
                <dd className="flex flex-wrap gap-1">
                  {contact.tags.length > 0 ? (
                    contact.tags.map((t) => (
                      <Badge key={t} variant="outline">
                        {t}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </dd>
                <dt className="text-fg-muted">Added</dt>
                <dd>
                  <time
                    dateTime={contact.createdAt}
                    title={format(new Date(contact.createdAt), 'PPpp')}
                  >
                    {format(new Date(contact.createdAt), 'd MMM yyyy')}
                  </time>
                </dd>
                <dt className="text-fg-muted">Updated</dt>
                <dd className="tabular">
                  {formatDistanceToNow(new Date(contact.updatedAt), { addSuffix: true })}
                </dd>
              </dl>
            </CardContent>
          </Card>
          <RelatedConversations
            contactId={contact.id}
            contact={contact}
            description="Threads with this contact."
          />
        </div>
      </div>

      <LeadDialog
        open={leadOpen}
        onOpenChange={setLeadOpen}
        contact={contact}
        onCreated={(lead) => router.push(`/leads/${lead.id}`)}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${name}?`}
        description="Leads and conversations linked to this contact are kept but lose the link. This cannot be undone."
        confirmLabel="Delete contact"
        tone="danger"
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(contact.id, {
            onSuccess: () => {
              toast.success(`${name} deleted`);
              router.replace('/contacts');
            },
            onError: (e) => toast.error(getErrorMessage(e)),
          })
        }
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ContactDetailsForm({
  contact,
  canUpdate,
}: {
  contact: ContactDetail;
  canUpdate: boolean;
}) {
  const update = useUpdateContact();
  const canReadMembers = useCan(Permission.MEMBERS_READ);
  const [formError, setFormError] = React.useState<string | null>(null);
  const defaults = React.useMemo(() => contactFormDefaults(contact), [contact]);
  const form = useForm<ContactFormInput, unknown, ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: defaults,
  });
  React.useEffect(() => {
    if (!form.formState.isDirty) form.reset(defaults);
  }, [defaults, form]);

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      const updated = await update.mutateAsync({
        id: contact.id,
        body: toUpdateContactRequest(values),
      });
      form.reset(contactFormDefaults(updated));
      toast.success('Contact saved');
    } catch (error) {
      if (!applyServerErrors(error, form.setError, CONTACT_FORM_FIELDS))
        setFormError(getErrorMessage(error));
    }
  });

  if (!canUpdate) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Your role can view this contact but not edit it.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="text-fg-muted">Email</dt>
            <dd>{contact.email ?? '—'}</dd>
            <dt className="text-fg-muted">Phone</dt>
            <dd>{contact.phone ?? '—'}</dd>
            <dt className="text-fg-muted">Company</dt>
            <dd>{contact.company ?? '—'}</dd>
            <dt className="text-fg-muted">Job title</dt>
            <dd>{contact.jobTitle ?? '—'}</dd>
            <dt className="text-fg-muted">Notes</dt>
            <dd className="whitespace-pre-wrap">{contact.notes ?? '—'}</dd>
          </dl>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <form onSubmit={onSubmit} noValidate>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>Contact information, tags and ownership.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <ContactFormFields
            form={form}
            withOwner={canReadMembers}
            idPrefix={`contact-${contact.id}`}
          />
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

// ---------------------------------------------------------------------------

function RelatedLeads({ contact, onCreate }: { contact: ContactDetail; onCreate?: () => void }) {
  const canRead = useCan(Permission.LEADS_READ);
  const leads = useLeads(
    { contactId: contact.id, page: 1, pageSize: 10, sortBy: 'updatedAt', sortOrder: 'desc' },
    { enabled: canRead },
  );
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <CardTitle>Leads</CardTitle>
          <CardDescription>
            Opportunities with {contactName(contact, 'this contact')}.
          </CardDescription>
        </div>
        {canRead ? (
          <Button asChild variant="ghost" size="sm" trailingIcon={<ArrowRight aria-hidden />}>
            <Link href={`/leads?contactId=${contact.id}`}>All leads</Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {!canRead ? (
          <EmptyState
            compact
            icon={<Target />}
            title="Leads are restricted"
            description="Your role can’t view leads."
          />
        ) : (
          <QueryState
            query={leads}
            compact
            loading={
              <ul className="divide-y divide-border">
                {Array.from({ length: 2 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 px-5 py-3">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="ml-auto h-4 w-16" />
                  </li>
                ))}
              </ul>
            }
            isEmpty={(r) => r.data.length === 0}
            empty={
              <EmptyState
                compact
                icon={<Target />}
                title="No leads for this contact"
                description="Create one to track an opportunity with them."
                action={
                  onCreate ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      leadingIcon={<Plus aria-hidden />}
                      onClick={onCreate}
                    >
                      New lead
                    </Button>
                  ) : undefined
                }
              />
            }
          >
            {(r) => (
              <ul className="divide-y divide-border">
                {r.data.map((lead) => (
                  <li key={lead.id}>
                    <Link
                      href={`/leads/${lead.id}`}
                      className="flex items-center gap-3 px-5 py-3 text-sm transition-colors hover:bg-surface-muted/60 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{lead.title}</span>
                      <LeadStatusBadge status={lead.status} />
                      <span className="w-24 shrink-0 text-right tabular text-fg-muted">
                        {lead.value != null ? formatCurrency(lead.value, lead.currency) : '—'}
                      </span>
                      <ArrowRight className="size-4 shrink-0 text-fg-subtle" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </QueryState>
        )}
      </CardContent>
    </Card>
  );
}
