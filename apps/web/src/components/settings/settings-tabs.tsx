'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Permission } from '@hilatech/contracts';
import { cn } from '@hilatech/ui';
import { useCan } from '@/hooks/use-can';
import { useT } from '@/i18n/provider';
import { msg } from '@/i18n/msg';

const TABS = [
  {
    href: '/settings/organization',
    label: msg('common.organization'),
    permission: Permission.ORG_READ,
  },
  {
    href: '/settings/billing',
    label: msg('common.billing'),
    permission: Permission.ORG_BILLING_MANAGE,
  },
  { href: '/settings/ai', label: msg('common.ai'), permission: Permission.AI_CONFIG_READ },
  { href: '/settings/profile', label: msg('settings.yourProfile') },
] as const;

export function SettingsTabs() {
  const t = useT();
  const pathname = usePathname();
  const canOrg = useCan(Permission.ORG_READ);
  const canBilling = useCan(Permission.ORG_BILLING_MANAGE);
  const canAi = useCan(Permission.AI_CONFIG_READ);
  const visible = TABS.filter((t) => {
    if (!('permission' in t)) return true;
    if (t.permission === Permission.ORG_READ) return canOrg;
    if (t.permission === Permission.AI_CONFIG_READ) return canAi;
    return canBilling;
  });
  return (
    <nav
      aria-label={t('settings.settingsSections')}
      className="flex w-fit max-w-full items-center gap-1 self-start overflow-x-auto rounded-md bg-surface-muted p-1"
    >
      {visible.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative inline-flex h-8 shrink-0 items-center rounded-sm px-3.5 text-sm font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
              active ? 'bg-surface font-semibold text-fg shadow-xs' : 'text-fg-muted hover:text-fg',
            )}
          >
            {t(tab.label)}
          </Link>
        );
      })}
    </nav>
  );
}
