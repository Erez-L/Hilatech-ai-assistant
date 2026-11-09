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

// ---------------------------------------------------------------------------
// Leads
// ---------------------------------------------------------------------------

/** Pipeline order. `won` and `lost` are terminal and sit outside the linear progression. */
export const LEAD_PIPELINE_STAGES = ['new', 'contacted', 'qualified', 'proposal'] as const;
export const LEAD_TERMINAL_STAGES = ['won', 'lost'] as const;
export const LEAD_STATUSES = LeadStatus.options;

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  qualified: 'Qualified',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
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
export const LEAD_SOURCE_LABELS: Record<LeadSource, string> = {
  website: 'Website',
  referral: 'Referral',
  social: 'Social media',
  email: 'Email',
  phone: 'Phone',
  whatsapp: 'WhatsApp',
  event: 'Event',
  ai_assistant: 'AI assistant',
  import: 'Import',
  other: 'Other',
};

export function isClosedLead(status: LeadStatus): boolean {
  return status === 'won' || status === 'lost';
}

// ---------------------------------------------------------------------------
// Conversations
// ---------------------------------------------------------------------------

export const CONVERSATION_STATUSES = ConversationStatus.options;
export const CONVERSATION_STATUS_LABELS: Record<ConversationStatus, string> = {
  open: 'Open',
  pending: 'Pending',
  resolved: 'Resolved',
  archived: 'Archived',
};
export const CONVERSATION_STATUS_TONES: Record<ConversationStatus, StatusTone> = {
  open: 'accent',
  pending: 'warning',
  resolved: 'success',
  archived: 'neutral',
};

export const CONVERSATION_CHANNELS = ConversationChannel.options;
export const CONVERSATION_CHANNEL_LABELS: Record<ConversationChannel, string> = {
  web: 'Web chat',
  email: 'Email',
  whatsapp: 'WhatsApp',
  phone: 'Phone',
  internal: 'Internal',
  api: 'API',
};

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export function fullName(
  user: Pick<UserSummary, 'firstName' | 'lastName'> | null | undefined,
  fallback = 'Unknown',
): string {
  if (!user) return fallback;
  return `${user.firstName} ${user.lastName}`.trim() || fallback;
}

export function contactName(
  contact: Pick<ContactSummary, 'firstName' | 'lastName'> | null | undefined,
  fallback = 'Unknown contact',
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

function statusLabel(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  return (LEAD_STATUS_LABELS as Record<string, string>)[s] ?? s.replace(/_/g, ' ');
}

/** Plain-language rendering of a lead activity. Payload keys are tolerant: the API decides the exact shape. */
export function describeLeadActivity(
  activity: Pick<LeadActivityWithActor, 'type' | 'payload' | 'actor'>,
): ActivityDescription {
  const actor = activity.actor ? fullName(activity.actor) : 'System';
  const p = activity.payload ?? {};
  switch (activity.type) {
    case 'created':
      return { title: `${actor} created the lead`, tone: 'success' };
    case 'status_changed': {
      const from = statusLabel(p.from ?? p.previous ?? p.fromStatus);
      const to = statusLabel(p.to ?? p.status ?? p.toStatus);
      const reason = str(p.lostReason ?? p.reason);
      return {
        title: to ? `${actor} moved the lead to ${to}` : `${actor} changed the status`,
        description:
          [from ? `From ${from}` : null, reason ? `Reason: ${reason}` : null]
            .filter(Boolean)
            .join(' · ') || undefined,
        tone: to === 'Won' ? 'success' : to === 'Lost' ? 'danger' : 'info',
      };
    }
    case 'assigned': {
      const name = str(p.assigneeName) ?? str(p.assignee) ?? null;
      const unassigned = p.assigneeId === null || p.assigneeId === undefined;
      return {
        title: name
          ? `${actor} assigned the lead to ${name}`
          : unassigned && Object.keys(p).length > 0
            ? `${actor} removed the assignee`
            : `${actor} changed the assignee`,
        tone: 'accent',
      };
    }
    case 'note_added':
      return {
        title: `${actor} added a note`,
        description: str(p.preview ?? p.body ?? p.excerpt) ?? undefined,
        tone: 'neutral',
      };
    case 'contact_linked': {
      const name = str(p.contactName) ?? null;
      return {
        title: name ? `${actor} linked ${name}` : `${actor} linked a contact`,
        tone: 'accent',
      };
    }
    case 'value_changed': {
      const from = p.from ?? p.previous;
      const to = p.to ?? p.value;
      const currency = str(p.currency);
      const fmt = (v: unknown) =>
        typeof v === 'number' ? `${v.toLocaleString('en')}${currency ? ` ${currency}` : ''}` : null;
      const desc = [fmt(from), fmt(to)].filter(Boolean).join(' → ');
      return {
        title: `${actor} changed the value`,
        description: desc || undefined,
        tone: 'info',
      };
    }
    case 'converted': {
      const name = str(p.contactName) ?? null;
      return {
        title: name ? `${actor} converted the lead into ${name}` : `${actor} converted the lead`,
        description: p.markWon === true ? 'Marked as won' : undefined,
        tone: 'success',
      };
    }
    case 'updated': {
      const fields = Array.isArray(p.fields)
        ? (p.fields as unknown[]).filter((f): f is string => typeof f === 'string')
        : Object.keys(p).filter((k) => !['actorId'].includes(k));
      return {
        title: `${actor} updated the lead`,
        description: fields.length > 0 ? fields.map(humanizeField).join(', ') : undefined,
        tone: 'neutral',
      };
    }
    default:
      return { title: `${actor}: ${String(activity.type).replace(/_/g, ' ')}`, tone: 'neutral' };
  }
}

function humanizeField(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

/** Short day label for chart axes: "2026-03-07" → "7 Mar". */
export function shortDay(iso: string | number): string {
  const d = new Date(typeof iso === 'number' ? iso : `${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleDateString('en', { day: 'numeric', month: 'short' });
}
