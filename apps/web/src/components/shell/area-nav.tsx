'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@hilatech/ui';
import { useSession } from '@/stores/session';
import { useT } from '@/i18n/provider';
import { NAV_AREAS, areaFor, visibleItems, type NavArea } from './nav';

function useAreas() {
  const pathname = usePathname();
  const permissions = useSession((s) => s.permissions);
  const areas = NAV_AREAS.map((navArea) => ({
    navArea,
    items: visibleItems(navArea, permissions),
  })).filter((entry) => entry.items.length > 0);
  return { areas, current: areaFor(pathname), pathname };
}

function AreaLink({
  navArea,
  href,
  active,
  compact,
}: {
  navArea: NavArea;
  href: string;
  active: boolean;
  compact?: boolean;
}) {
  const t = useT();
  const Icon = navArea.icon;
  return (
    <Link
      href={href}
      data-tone={navArea.tone}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'group flex flex-col items-center gap-1 rounded-lg text-center font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        compact ? 'min-w-0 flex-1 px-0.5 py-1 text-2xs' : 'w-[5.75rem] px-1 py-1.5 text-xs',
        active ? 'bg-tone-soft font-bold text-tone-fg' : 'text-fg hover:bg-surface-muted',
      )}
    >
      <span
        className={cn(
          'flex items-center justify-center rounded-md transition-transform group-active:scale-95 [&_svg]:size-5',
          compact ? 'size-10' : 'size-11',
          active
            ? 'bg-tone text-tone-on shadow-[0_8px_18px_-8px_var(--tone)]'
            : 'bg-tone-soft text-tone-fg',
        )}
      >
        <Icon aria-hidden />
      </span>
      <span className="max-w-full truncate">{t(navArea.label)}</span>
    </Link>
  );
}

/**
 * The areas of the product. On wide screens a light rail at the start edge; on narrow screens a bar at the
 * bottom of the screen. Each area keeps its own colour, and its first permitted screen opens on click.
 */
export function AreaRail({ placement }: { placement: 'side' | 'bottom' }) {
  const t = useT();
  const { areas, current } = useAreas();
  const bottom = placement === 'bottom';
  return (
    <nav
      aria-label={t('shell.areas')}
      className={cn(
        'bg-surface',
        bottom
          ? 'fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-0.5 border-t border-border px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden'
          : 'flex h-full w-[6.5rem] flex-col items-center gap-1 border-e border-border py-3',
      )}
    >
      {areas.map(({ navArea, items }) => (
        <React.Fragment key={navArea.key}>
          {!bottom && navArea.key === 'organization' ? <span className="flex-1" /> : null}
          <AreaLink
            navArea={navArea}
            href={items[0]!.href}
            active={current?.key === navArea.key}
            compact={bottom}
          />
        </React.Fragment>
      ))}
    </nav>
  );
}

/** The screens of the current area, as pill links above the page. Hidden when the area has one screen. */
export function AreaTabs() {
  const t = useT();
  const { areas, current, pathname } = useAreas();
  const entry = areas.find((a) => a.navArea.key === current?.key);
  if (!entry || entry.items.length < 2) return null;
  return (
    <nav
      aria-label={t('shell.areaScreens', { name: t(entry.navArea.label) })}
      className="-mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1 pb-1"
    >
      {entry.items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-10 shrink-0 items-center rounded-full px-4 text-sm transition-colors',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              active
                ? 'bg-tone font-bold text-tone-on shadow-[0_8px_18px_-10px_var(--tone)]'
                : 'border border-border-strong bg-surface font-semibold text-fg hover:border-tone hover:text-tone-fg',
            )}
          >
            {t(item.label)}
          </Link>
        );
      })}
    </nav>
  );
}
