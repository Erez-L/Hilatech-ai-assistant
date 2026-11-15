import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  BookOpen,
  Bot,
  FlaskConical,
  Building2,
  Contact,
  FileUp,
  Handshake,
  ListChecks,
  Factory,
  LayoutDashboard,
  Sun,
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

/**
 * The product is organised in a few areas, each with one colour. The rail shows the areas; the screens of the
 * current area are tabs above the page. Every screen belongs to exactly one area.
 */
export interface NavArea {
  key: 'today' | 'customers' | 'sales' | 'ai' | 'operations' | 'organization';
  label: Msg;
  tone: NavTone;
  icon: LucideIcon;
  items: NavItem[];
}

function area(
  key: NavArea['key'],
  label: Msg,
  tone: NavTone,
  icon: LucideIcon,
  items: Omit<NavItem, 'tone'>[],
): NavArea {
  return { key, label, tone, icon, items: items.map((item) => ({ ...item, tone })) };
}

export const NAV_AREAS: NavArea[] = [
  area('today', msg('shell.today'), 'teal', Sun, [
    { href: '/dashboard', label: msg('shell.dashboard'), icon: LayoutDashboard },
    {
      href: '/tasks',
      label: msg('shell.tasks'),
      icon: ListChecks,
      permission: Permission.TASKS_READ,
    },
    {
      href: '/analytics',
      label: msg('shell.reports'),
      icon: BarChart3,
      permission: Permission.ANALYTICS_READ,
    },
  ]),
  area('customers', msg('shell.customers'), 'blue', Contact, [
    { href: '/leads', label: msg('shell.leads'), icon: Target, permission: Permission.LEADS_READ },
    {
      href: '/contacts',
      label: msg('shell.contacts'),
      icon: Contact,
      permission: Permission.CONTACTS_READ,
    },
    {
      href: '/companies',
      label: msg('shell.companies'),
      icon: Factory,
      permission: Permission.COMPANIES_READ,
    },
    {
      href: '/conversations',
      label: msg('shell.conversations'),
      icon: MessageSquare,
      permission: Permission.CONVERSATIONS_READ,
    },
  ]),
  area('sales', msg('shell.sales'), 'violet', Handshake, [
    {
      href: '/deals',
      label: msg('shell.deals'),
      icon: Handshake,
      permission: Permission.DEALS_READ,
    },
  ]),
  area('ai', msg('common.ai'), 'pink', Sparkles, [
    {
      href: '/assistant',
      label: msg('shell.assistant'),
      icon: Sparkles,
      permission: Permission.AI_ASSISTANT_USE,
    },
    { href: '/agents', label: msg('shell.agents'), icon: Bot, permission: Permission.AGENTS_READ },
    {
      href: '/knowledge',
      label: msg('shell.knowledge'),
      icon: BookOpen,
      permission: Permission.KNOWLEDGE_READ,
    },
    {
      href: '/evaluations',
      label: msg('shell.evaluations'),
      icon: FlaskConical,
      permission: Permission.AGENTS_READ,
    },
  ]),
  area('operations', msg('shell.operations'), 'orange', Workflow, [
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
      href: '/imports',
      label: msg('shell.imports'),
      icon: FileUp,
      permission: Permission.DATA_IMPORT,
    },
  ]),
  // Billing, AI settings and the profile are tabs of the Settings screen, so they are not listed twice.
  area('organization', msg('common.organization'), 'slate', Building2, [
    { href: '/team', label: msg('shell.team'), icon: Users, permission: Permission.MEMBERS_READ },
    { href: '/roles', label: msg('shell.roles'), icon: Shield, permission: Permission.ROLES_READ },
    {
      href: '/audit',
      label: msg('shell.auditLog'),
      icon: ScrollText,
      permission: Permission.AUDIT_READ,
    },
    { href: '/settings', label: msg('shell.settings'), icon: Building2 },
  ]),
];

const ALL_ITEMS = NAV_AREAS.flatMap((a) => a.items);
const owns = (item: NavItem, pathname: string) =>
  pathname === item.href || pathname.startsWith(`${item.href}/`);

/** The area a path belongs to. */
export function areaFor(pathname: string): NavArea | undefined {
  return NAV_AREAS.find((a) => a.items.some((item) => owns(item, pathname)));
}

/** The screens of an area the current role may open. */
export function visibleItems(navArea: NavArea, permissions: readonly string[]): NavItem[] {
  return navArea.items.filter((item) => !item.permission || permissions.includes(item.permission));
}

/** The nav item that owns a path (used for the area's tone and icon). */
export function navItemFor(pathname: string): NavItem | undefined {
  return ALL_ITEMS.find((item) => owns(item, pathname));
}

/** Page titles for the top bar, keyed by the first path segment(s). */
export function pageTitleFor(pathname: string, t: T): string {
  if (pathname.startsWith('/settings/profile')) return t('shell.yourProfile');
  const match = navItemFor(pathname);
  if (match) return t(match.label);
  return t('app.productNameShort');
}
