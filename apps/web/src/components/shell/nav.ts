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

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Permission required to see the item (hidden otherwise). */
  permission?: string;
  /** Marks features planned for a later milestone (placeholder pages). */
  upcoming?: boolean;
}

export interface NavSection {
  label?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Customers',
    items: [
      {
        href: '/leads',
        label: 'Leads',
        icon: Target,
        permission: Permission.LEADS_READ,
        upcoming: true,
      },
      {
        href: '/contacts',
        label: 'Contacts',
        icon: Contact,
        permission: Permission.CONTACTS_READ,
        upcoming: true,
      },
      {
        href: '/conversations',
        label: 'Conversations',
        icon: MessageSquare,
        permission: Permission.CONVERSATIONS_READ,
        upcoming: true,
      },
    ],
  },
  {
    label: 'AI',
    items: [
      {
        href: '/assistant',
        label: 'Assistant',
        icon: Sparkles,
        permission: Permission.AI_ASSISTANT_USE,
        upcoming: true,
      },
      {
        href: '/agents',
        label: 'Agents',
        icon: Bot,
        permission: Permission.AGENTS_READ,
        upcoming: true,
      },
      {
        href: '/knowledge',
        label: 'Knowledge',
        icon: BookOpen,
        permission: Permission.KNOWLEDGE_READ,
        upcoming: true,
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      {
        href: '/automations',
        label: 'Automations',
        icon: Workflow,
        permission: Permission.AUTOMATIONS_READ,
        upcoming: true,
      },
      {
        href: '/integrations',
        label: 'Integrations',
        icon: Plug,
        permission: Permission.INTEGRATIONS_READ,
        upcoming: true,
      },
      {
        href: '/analytics',
        label: 'Analytics',
        icon: BarChart3,
        permission: Permission.ANALYTICS_READ,
        upcoming: true,
      },
    ],
  },
  {
    label: 'Organization',
    items: [
      { href: '/team', label: 'Team', icon: Users, permission: Permission.MEMBERS_READ },
      { href: '/roles', label: 'Roles', icon: Shield, permission: Permission.ROLES_READ },
      { href: '/audit', label: 'Audit log', icon: ScrollText, permission: Permission.AUDIT_READ },
      {
        href: '/settings/organization',
        label: 'Settings',
        icon: Building2,
        permission: Permission.ORG_READ,
      },
      {
        href: '/settings/billing',
        label: 'Billing',
        icon: CreditCard,
        permission: Permission.ORG_BILLING_MANAGE,
      },
    ],
  },
];

/** Page titles for the top bar, keyed by the first path segment(s). */
export function pageTitleFor(pathname: string): string {
  const all = NAV_SECTIONS.flatMap((s) => s.items);
  const match = all.find((i) => pathname === i.href || pathname.startsWith(`${i.href}/`));
  if (match) return match.label;
  if (pathname.startsWith('/settings/profile')) return 'Your profile';
  if (pathname.startsWith('/settings')) return 'Settings';
  return 'HilaTech';
}
