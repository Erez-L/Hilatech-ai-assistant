'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Permission } from '@hilatech/contracts';
import { cn } from '@hilatech/ui';
import { useCan } from '@/hooks/use-can';
import { useT } from '@/i18n/provider';

/** Board / pipelines / report navigation shared by the deals pages (tabs are permission-gated). */
export function DealsTabs() {
  const t = useT();
  const pathname = usePathname();
  const canPipelines = useCan(Permission.PIPELINES_MANAGE);
  const canReport = useCan(Permission.ANALYTICS_READ);
  const tabs = [
    { href: '/deals', label: t('deals.board'), exact: true, show: true },
    { href: '/deals/report', label: t('deals.report'), exact: false, show: canReport },
    { href: '/deals/pipelines', label: t('deals.pipelines'), exact: false, show: canPipelines },
  ].filter((tab) => tab.show);
  if (tabs.length < 2) return null;
  return (
    <nav
      aria-label={t('deals.dealsSections')}
      className="flex items-center w-fit max-w-full gap-1 self-start overflow-x-auto rounded-md bg-surface-muted p-1"
    >
      {tabs.map((tab) => {
        const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative inline-flex h-8 shrink-0 items-center rounded-sm px-3.5 text-sm font-medium whitespace-nowrap transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
              active ? 'bg-surface font-semibold text-fg shadow-xs' : 'text-fg-muted hover:text-fg',
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
