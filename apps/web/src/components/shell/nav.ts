import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BookOpen,
  Bot,
  Building2,
  Contact,
  CreditCard,
  LayoutDashboard,
  MessageSquare,
  Plug,
  ScrollText,
  Shield,
  Sparkles,
  Target,
  Users,
  Workflow,
} from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import { msg, type Msg } from '@/i18n/msg';
import type { T } from '@/i18n/provider';

export interface NavItem {
  href: string;
  label: Msg;
  icon: LucideIcon;
  /** Permission required to see the item (hidden otherwise). */
  permission?: string;
  /** Marks features planned for a later milestone (placeholder pages). */
  upcoming?: boolean;
}

export interface NavSection {
  label?: Msg;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ href: '/dashboard', label: msg('shell.dashboard'), icon: LayoutDashboard }],
  },
  {
    label: msg('shell.customers'),
    items: [
      {
        href: '/leads',
        label: msg('shell.leads'),
        icon: Target,
        permission: Permission.LEADS_READ,
      },
      {
        href: '/contacts',
        label: msg('shell.contacts'),
        icon: Contact,
        permission: Permission.CONTACTS_READ,
      },
      {
        href: '/conversations',
        label: msg('shell.conversations'),
        icon: MessageSquare,
        permission: Permission.CONVERSATIONS_READ,
      },
    ],
  },
  {
    label: msg('common.ai'),
    items: [
      {
        href: '/assistant',
        label: msg('shell.assistant'),
        icon: Sparkles,
        permission: Permission.AI_ASSISTANT_USE,
      },
      {
        href: '/agents',
        label: msg('shell.agents'),
        icon: Bot,
        permission: Permission.AGENTS_READ,
      },
      {
        href: '/knowledge',
        label: msg('shell.knowledge'),
        icon: BookOpen,
        permission: Permission.KNOWLEDGE_READ,
      },
    ],
  },
  {
    label: msg('shell.operations'),
    items: [
      {
        href: '/automations',
        label: msg('shell.automations'),
        icon: Workflow,
        permission: Permission.AUTOMATIONS_READ,
      },
      {
        href: '/integrations',
        label: msg('shell.integrations'),
        icon: Plug,
        permission: Permission.INTEGRATIONS_READ,
      },
      {
        href: '/analytics',
        label: msg('shell.analytics'),
        icon: BarChart3,
        permission: Permission.ANALYTICS_READ,
      },
    ],
  },
  {
    label: msg('common.organization'),
    items: [
      { href: '/team', label: msg('shell.team'), icon: Users, permission: Permission.MEMBERS_READ },
      {
        href: '/roles',
        label: msg('shell.roles'),
        icon: Shield,
        permission: Permission.ROLES_READ,
      },
      {
        href: '/audit',
        label: msg('shell.auditLog'),
        icon: ScrollText,
        permission: Permission.AUDIT_READ,
      },
      {
        href: '/settings/organization',
        label: msg('shell.settings'),
        icon: Building2,
        permission: Permission.ORG_READ,
      },
      {
        href: '/settings/billing',
        label: msg('common.billing'),
        icon: CreditCard,
        permission: Permission.ORG_BILLING_MANAGE,
      },
    ],
  },
];

/** Page titles for the top bar, keyed by the first path segment(s). */
export function pageTitleFor(pathname: string, t: T): string {
  const all = NAV_SECTIONS.flatMap((s) => s.items);
  const match = all.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  if (match) return t(match.label);
  if (pathname.startsWith('/settings/profile')) return t('shell.yourProfile');
  if (pathname.startsWith('/settings')) return t('nav.settings');
  return t('app.productNameShort');
}
