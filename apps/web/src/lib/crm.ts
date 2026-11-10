import {
  ConversationChannel,
  ConversationStatus,
  LeadSource,
  LeadStatus,
  type ContactSummary,
  type LeadActivityWithActor,
  type UserSummary,
} from '@hilatech/contracts';
import type { StatusTone } from '@hilatech/ui';
import { msg, type Msg } from '@/i18n/msg';
import type { T } from '@/i18n/provider';
import type { Formatter } from '@/i18n/format';

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

/** Pipeline order. `won` and `lost` are terminal and sit outside the linear progression. */
export const LEAD_PIPELINE_STAGES = ['new', 'contacted', 'qualified', 'proposal'] as const;
export const LEAD_TERMINAL_STAGES = ['won', 'lost'] as const;
export const LEAD_STATUSES = LeadStatus.options;

export const LEAD_STATUS_LABELS: Record<LeadStatus, Msg> = {
  new: msg('crm.leadStatus.new'),
  contacted: msg('crm.leadStatus.contacted'),
  qualified: msg('crm.leadStatus.qualified'),
  proposal: msg('crm.leadStatus.proposal'),
  won: msg('crm.leadStatus.won'),
  lost: msg('crm.leadStatus.lost'),
};

export const LEAD_STATUS_TONES: Record<LeadStatus, StatusTone> = {
  new: 'info',
  contacted: 'neutral',
  qualified: 'accent',
  proposal: 'warning',
  won: 'success',
  lost: 'danger',
};

export const LEAD_SOURCES = LeadSource.options;
export const LEAD_SOURCE_LABELS: Record<LeadSource, Msg> = {
  website: msg('crm.leadSource.website'),
  referral: msg('crm.leadSource.referral'),
  social: msg('crm.leadSource.social'),
  email: msg('crm.leadSource.email'),
  phone: msg('crm.leadSource.phone'),
  whatsapp: msg('crm.leadSource.whatsapp'),
  event: msg('crm.leadSource.event'),
  ai_assistant: msg('crm.leadSource.ai_assistant'),
  import: msg('crm.leadSource.import'),
  other: msg('crm.leadSource.other'),
};

export function isClosedLead(status: LeadStatus): boolean {
  return status === 'won' || status === 'lost';
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export const CONVERSATION_STATUSES = ConversationStatus.options;
export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, Msg> = {
  open: msg('crm.conversationStatus.open'),
  pending: msg('crm.conversationStatus.pending'),
  resolved: msg('crm.conversationStatus.resolved'),
  archived: msg('crm.conversationStatus.archived'),
};
export const CONVERSATION_STATUS_TONES: Record<ConversationStatus, StatusTone> = {
  open: 'accent',
  pending: 'warning',
  resolved: 'success',
  archived: 'neutral',
};

export const CONVERSATION_CHANNELS = ConversationChannel.options;
export const CONVERSATION_CHANNEL_LABELS: Record<ConversationChannel, Msg> = {
  web: msg('crm.channel.web'),
  email: msg('crm.channel.email'),
  whatsapp: msg('crm.channel.whatsapp'),
  phone: msg('crm.channel.phone'),
  internal: msg('crm.channel.internal'),
  api: msg('crm.channel.api'),
};

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export function fullName(
  user: Pick<UserSummary, 'firstName' | 'lastName'> | null | undefined,
  fallback = '—',
): string {
  if (!user) return fallback;
  return `${user.firstName} ${user.lastName}`.trim() || fallback;
}

export function contactName(
  contact: Pick<ContactSummary, 'firstName' | 'lastName'> | null | undefined,
  fallback = '—',
): string {
  if (!contact) return fallback;
  return [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || fallback;
}

/** Secondary line for a contact: company, else email, else phone. */
export function contactMeta(
  contact: Pick<ContactSummary, 'company' | 'email' | 'phone'> | null | undefined,
): string | null {
  if (!contact) return null;
  return contact.company || contact.email || contact.phone || null;
}

// ---------------------------------------------------------------------------
// Lead activity timeline
// ---------------------------------------------------------------------------

export interface ActivityDescription {
  title: string;
  description?: string;
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function statusLabel(t: T, value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  const known = (LEAD_STATUS_LABELS as Record<string, Msg | undefined>)[s];
  return known ? t(known) : s.replace(/_/g, ' ');
}

/** Plain-language rendering of a lead activity. Payload keys are tolerant: the API decides the exact shape. */
export function describeLeadActivity(
  activity: Pick<LeadActivityWithActor, 'type' | 'payload' | 'actor'>,
  t: T,
  fmt: Pick<Formatter, 'number'>,
): ActivityDescription {
  const actor = activity.actor ? fullName(activity.actor) : t('crm.activity.system');
  const p = activity.payload ?? {};
  switch (activity.type) {
    case 'created':
      return { title: t('crm.activity.created', { actor }), tone: 'success' };
    case 'status_changed': {
      const from = statusLabel(t, p.from ?? p.previous ?? p.fromStatus);
      const to = statusLabel(t, p.to ?? p.status ?? p.toStatus);
      const reason = str(p.lostReason ?? p.reason);
      const toStatus = str(p.to ?? p.status ?? p.toStatus);
      return {
        title: to
          ? t('crm.activity.movedTo', { actor, status: to })
          : t('crm.activity.statusChanged', { actor }),
        description:
          [
            from ? t('crm.activity.from', { status: from }) : null,
            reason ? t('crm.activity.reason', { reason }) : null,
          ]
            .filter(Boolean)
            .join(' · ') || undefined,
        tone: toStatus === 'won' ? 'success' : toStatus === 'lost' ? 'danger' : 'info',
      };
    }
    case 'assigned': {
      const name = str(p.assigneeName) ?? str(p.assignee) ?? null;
      const unassigned = p.assigneeId === null || p.assigneeId === undefined;
      return {
        title: name
          ? t('crm.activity.assignedTo', { actor, name })
          : unassigned && Object.keys(p).length > 0
            ? t('crm.activity.assigneeRemoved', { actor })
            : t('crm.activity.assigneeChanged', { actor }),
        tone: 'accent',
      };
    }
    case 'note_added':
      return {
        title: t('crm.activity.noteAdded', { actor }),
        description: str(p.preview ?? p.body ?? p.excerpt) ?? undefined,
        tone: 'neutral',
      };
    case 'contact_linked': {
      const name = str(p.contactName) ?? null;
      return {
        title: name
          ? t('crm.activity.linkedName', { actor, name })
          : t('crm.activity.linkedContact', { actor }),
        tone: 'accent',
      };
    }
    case 'value_changed': {
      const from = p.from ?? p.previous;
      const to = p.to ?? p.value;
      const currency = str(p.currency);
      const money = (v: unknown) =>
        typeof v === 'number' ? `${fmt.number(v)}${currency ? ` ${currency}` : ''}` : null;
      const desc = [money(from), money(to)].filter(Boolean).join(' → ');
      return {
        title: t('crm.activity.valueChanged', { actor }),
        description: desc || undefined,
        tone: 'info',
      };
    }
    case 'converted': {
      const name = str(p.contactName) ?? null;
      return {
        title: name
          ? t('crm.activity.convertedInto', { actor, name })
          : t('crm.activity.converted', { actor }),
        description: p.markWon === true ? t('crm.activity.markedWon') : undefined,
        tone: 'success',
      };
    }
    case 'updated': {
      const fields = Array.isArray(p.fields)
        ? (p.fields as unknown[]).filter((f): f is string => typeof f === 'string')
        : Object.keys(p).filter((k) => !['actorId'].includes(k));
      return {
        title: t('crm.activity.updated', { actor }),
        description: fields.length > 0 ? fields.map(humanizeField).join(', ') : undefined,
        tone: 'neutral',
      };
    }
    default:
      return {
        title: t('crm.activity.other', { actor, type: String(activity.type).replace(/_/g, ' ') }),
        tone: 'neutral',
      };
  }
}

function humanizeField(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

/** Short day label for chart axes: "2026-03-07" → "7 Mar". */
export function shortDay(iso: string | number, fmt: Pick<Formatter, 'dayMonth'>): string {
  const d = new Date(typeof iso === 'number' ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return fmt.dayMonth(d);
}
