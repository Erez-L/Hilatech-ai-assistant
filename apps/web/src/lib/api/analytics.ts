import { api } from './client';
import type { DashboardSummary } from './types';

type Num = number | undefined | null;
interface RawDashboard {
  generatedAt?: string;
  members?: Num | { active?: Num; suspended?: Num; total?: Num };
  invitations?: { pending?: Num };
  pendingInvitations?: Num;
  contacts?: Num | { total?: Num };
  leads?: Num | { total?: Num; byStatus?: Record<string, number> };
  conversations?: Num | { total?: Num; open?: Num };
  openConversations?: Num;
}

const n = (v: Num): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * The API returns nested counters ({ members: { active, suspended }, invitations: { pending }, … });
 * an earlier draft of the endpoint map described flat numbers. Both are accepted.
 */
export function normalizeDashboard(raw: RawDashboard): DashboardSummary {
  const members = raw.members;
  const contacts = raw.contacts;
  const leads = raw.leads;
  const conversations = raw.conversations;
  return {
    members:
      typeof members === 'object' && members ? n(members.active ?? members.total) : n(members),
    suspendedMembers: typeof members === 'object' && members ? n(members.suspended) : 0,
    pendingInvitations: n(raw.invitations?.pending ?? raw.pendingInvitations),
    contacts: typeof contacts === 'object' && contacts ? n(contacts.total) : n(contacts),
    leads: typeof leads === 'object' && leads ? n(leads.total) : n(leads),
    leadsByStatus: typeof leads === 'object' && leads?.byStatus ? leads.byStatus : {},
    conversations:
      typeof conversations === 'object' && conversations
        ? n(conversations.total)
        : n(conversations),
    openConversations:
      typeof conversations === 'object' && conversations
        ? n(conversations.open)
        : n(raw.openConversations),
    generatedAt: raw.generatedAt ?? null,
  };
}

export const analyticsApi = {
  dashboard: async (): Promise<DashboardSummary> =>
    normalizeDashboard(await api.get<RawDashboard>('/analytics/dashboard')),
};
