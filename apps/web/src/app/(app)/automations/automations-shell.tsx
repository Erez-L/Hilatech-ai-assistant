'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Permission } from '@hilatech/contracts';
import { PageHeader, cn } from '@hilatech/ui';
import { PermissionGate } from '@/components/common/permission-gate';

const TABS = [
  { href: '/automations', label: 'Workflows', exact: true },
  { href: '/automations/templates', label: 'Templates' },
  { href: '/automations/executions', label: 'Executions' },
  { href: '/automations/webhooks', label: 'Webhooks' },
] as const;

export function AutomationsShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const editing =
    pathname === '/automations/new' || /^\/automations\/[0-9a-f-]{36}$/.test(pathname);
  return (
    <PermissionGate anyOf={[Permission.AUTOMATIONS_READ]}>
      <div className="flex flex-col gap-6">
        <PageHeader
          title="Automations"
          description="Workflows that react to events, schedules and webhooks, plus the webhooks that connect them to the outside world."
        />
        <nav
          aria-label="Automation sections"
          className="flex items-center gap-1 overflow-x-auto border-b border-border"
        >
          {TABS.map((tab) => {
            const active =
              'exact' in tab && tab.exact
                ? pathname === tab.href || editing
                : pathname === tab.href || pathname.startsWith(`${tab.href}/`);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative -mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm font-medium whitespace-nowrap transition-colors',
                  'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
                  active
                    ? 'border-accent text-fg'
                    : 'border-transparent text-fg-muted hover:text-fg',
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
        {children}
      </div>
    </PermissionGate>
  );
}
