'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LifeBuoy } from 'lucide-react';
import { Badge, Sidebar, SidebarNavItem, SidebarNavItemContent, SidebarSection, Wordmark } from '@hilatech/ui';
import { useSession } from '@/stores/session';
import { NAV_SECTIONS } from './nav';
import { OrgSwitcher } from './org-switcher';

export function AppSidebar({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
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
      footer={
        <p className="flex items-center gap-2 px-2.5 text-xs text-fg-subtle">
          <LifeBuoy className="size-3.5" aria-hidden />
          Foundation milestone
        </p>
      }
    >
      {NAV_SECTIONS.map((section, index) => {
        const items = section.items.filter((item) => !item.permission || permissions.includes(item.permission));
        if (items.length === 0) return null;
        return (
          <SidebarSection key={section.label ?? index} label={section.label}>
            {items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <SidebarNavItem key={item.href} asChild active={active}>
                  <Link href={item.href} onClick={onNavigate}>
                    <SidebarNavItemContent
                      active={active}
                      icon={<Icon aria-hidden />}
                      trailing={
                        item.upcoming ? (
                          <Badge variant="outline" className="px-1.5 py-0 text-[0.625rem] leading-4">
                            Soon
                          </Badge>
                        ) : undefined
                      }
                    >
                      {item.label}
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
