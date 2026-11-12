import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BookOpen,
  Bot,
  FlaskConical,
  Building2,
  Contact,
  CreditCard,
  FileUp,
  Handshake,
  ListChecks,
  Factory,
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

/** Colour identity of an area; drives the nav icon tile and the page accents (see styles.css). */
export type NavTone = 'teal' | 'blue' | 'violet' | 'pink' | 'orange' | 'green' | 'slate';

export interface NavItem {
  href: string;
  tone: NavTone;
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
    items: [
      { href: '/dashboard', tone: 'teal', label: msg('shell.dashboard'), icon: LayoutDashboard },
    ],
  },
  {
    label: msg('shell.customers'),
    items: [
      {
        href: '/leads',
        tone: 'blue',
        label: msg('shell.leads'),
        icon: Target,
        permission: Permission.LEADS_READ,
      },
      {
        href: '/contacts',
        tone: 'blue',
        label: msg('shell.contacts'),
        icon: Contact,
        permission: Permission.CONTACTS_READ,
      },
      {
        href: '/companies',
        tone: 'blue',
        label: msg('shell.companies'),
        icon: Factory,
        permission: Permission.COMPANIES_READ,
      },
      {
        href: '/deals',
        tone: 'violet',
        label: msg('shell.deals'),
        icon: Handshake,
        permission: Permission.DEALS_READ,
      },
      {
        href: '/tasks',
        tone: 'orange',
        label: msg('shell.tasks'),
        icon: ListChecks,
        permission: Permission.TASKS_READ,
      },
      {
        href: '/conversations',
        tone: 'teal',
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
        tone: 'pink',
        label: msg('shell.assistant'),
        icon: Sparkles,
        permission: Permission.AI_ASSISTANT_USE,
      },
      {
        href: '/agents',
        tone: 'pink',
        label: msg('shell.agents'),
        icon: Bot,
        permission: Permission.AGENTS_READ,
      },
      {
        href: '/evaluations',
        tone: 'pink',
        label: msg('shell.evaluations'),
        icon: FlaskConical,
        permission: Permission.AGENTS_READ,
      },
      {
        href: '/knowledge',
        tone: 'green',
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
        tone: 'orange',
        label: msg('shell.automations'),
        icon: Workflow,
        permission: Permission.AUTOMATIONS_READ,
      },
      {
        href: '/integrations',
        tone: 'orange',
        label: msg('shell.integrations'),
        icon: Plug,
        permission: Permission.INTEGRATIONS_READ,
      },
      {
        href: '/imports',
        tone: 'orange',
        label: msg('shell.imports'),
        icon: FileUp,
        permission: Permission.DATA_IMPORT,
      },
      {
        href: '/analytics',
        tone: 'violet',
        label: msg('shell.analytics'),
        icon: BarChart3,
        permission: Permission.ANALYTICS_READ,
      },
    ],
  },
  {
    label: msg('common.organization'),
    items: [
      {
        href: '/team',
        tone: 'slate',
        label: msg('shell.team'),
        icon: Users,
        permission: Permission.MEMBERS_READ,
      },
      {
        href: '/roles',
        tone: 'slate',
        label: msg('shell.roles'),
        icon: Shield,
        permission: Permission.ROLES_READ,
      },
      {
        href: '/audit',
        tone: 'slate',
        label: msg('shell.auditLog'),
        icon: ScrollText,
        permission: Permission.AUDIT_READ,
      },
      {
        href: '/settings/organization',
        tone: 'slate',
        label: msg('shell.settings'),
        icon: Building2,
        permission: Permission.ORG_READ,
      },
      {
        href: '/settings/billing',
        tone: 'slate',
        label: msg('common.billing'),
        icon: CreditCard,
        permission: Permission.ORG_BILLING_MANAGE,
      },
    ],
  },
];

/** The nav item that owns a path (used for the area's tone and icon). */
export function navItemFor(pathname: string): NavItem | undefined {
  return NAV_SECTIONS.flatMap((s) => s.items).find(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  );
}

/** Page titles for the top bar, keyed by the first path segment(s). */
export function pageTitleFor(pathname: string, t: T): string {
  const all = NAV_SECTIONS.flatMap((s) => s.items);
  const match = all.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  if (match) return t(match.label);
  if (pathname.startsWith('/settings/profile')) return t('shell.yourProfile');
  if (pathname.startsWith('/settings')) return t('nav.settings');
  return t('app.productNameShort');
}
