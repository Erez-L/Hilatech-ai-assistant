'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Badge,
  Sidebar,
  SidebarNavItem,
  SidebarNavItemContent,
  SidebarSection,
  Wordmark,
} from '@hilatech/ui';
import { useSession } from '@/stores/session';
import { NAV_SECTIONS } from './nav';
import { OrgSwitcher } from './org-switcher';
import { useT } from '@/i18n/provider';

export function AppSidebar({
  onNavigate,
  className,
}: {
  onNavigate?: () => void;
  className?: string;
}) {
  const t = useT();
  const pathname = usePathname();
  const permissions = useSession((s) => s.permissions);

  return (
    <Sidebar
      className={className}
      header={
        <>
          <Link
            href="/dashboard"
            className="flex h-9 items-center rounded-sm px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={onNavigate}
          >
            <Wordmark compact />
          </Link>
          <OrgSwitcher />
        </>
      }
    >
      {NAV_SECTIONS.map((section, index) => {
        const items = section.items.filter(
          (item) => !item.permission || permissions.includes(item.permission),
        );
        if (items.length === 0) return null;
        return (
          <SidebarSection
            key={section.label?.key ?? index}
            label={section.label ? t(section.label) : undefined}
          >
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <SidebarNavItem key={item.href} asChild active={active} data-tone={item.tone}>
                  <Link href={item.href} onClick={onNavigate}>
                    <SidebarNavItemContent
                      active={active}
                      icon={<Icon aria-hidden />}
                      trailing={
                        item.upcoming ? (
                          <Badge
                            variant="outline"
                            className="px-1.5 py-0 text-[0.625rem] leading-4"
                          >
                            {t('shell.soon')}
                          </Badge>
                        ) : undefined
                      }
                    >
                      {t(item.label)}
                    </SidebarNavItemContent>
                  </Link>
                </SidebarNavItem>
              );
            })}
          </SidebarSection>
        );
      })}
    </Sidebar>
  );
}
