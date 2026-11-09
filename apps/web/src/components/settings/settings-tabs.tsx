'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Permission } from '@hilatech/contracts';
import { cn } from '@hilatech/ui';
import { useCan } from '@/hooks/use-can';

const TABS = [
  { href: '/settings/organization', label: 'Organization', permission: Permission.ORG_READ },
  { href: '/settings/billing', label: 'Billing', permission: Permission.ORG_BILLING_MANAGE },
  { href: '/settings/ai', label: 'AI', permission: Permission.AI_CONFIG_READ },
  { href: '/settings/profile', label: 'Your profile' },
] as const;

export function SettingsTabs() {
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
    <nav aria-label="Settings sections" className="flex items-center gap-1 border-b border-border">
      {visible.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative -mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
              active ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
