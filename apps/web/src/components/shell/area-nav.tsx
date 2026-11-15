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
        'group flex items-center font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        compact
          ? 'min-w-0 flex-1 flex-col gap-1 rounded-lg px-0.5 py-1 text-center text-2xs'
          : 'w-full gap-2.5 rounded-md px-2 py-1.5 text-start text-sm',
        active
          ? compact
            ? 'bg-tone-soft font-bold text-tone-fg'
            : 'bg-surface font-bold text-tone-fg shadow-xs'
          : compact
            ? 'text-fg hover:bg-surface-muted'
            : 'text-fg hover:bg-surface/70',
      )}
    >
      <span
        className={cn(
          'flex shrink-0 items-center justify-center rounded-md transition-transform group-active:scale-95',
          compact ? 'size-10 [&_svg]:size-5' : 'size-8 [&_svg]:size-[1.125rem]',
          active
            ? 'bg-tone text-tone-on shadow-[0_8px_18px_-8px_var(--tone)]'
            : compact
              ? 'bg-tone-soft text-tone-fg'
              : 'bg-surface text-tone-fg shadow-xs',
        )}
      >
        <Icon aria-hidden />
      </span>
      <span className={cn('truncate', compact ? 'max-w-full' : 'min-w-0 flex-1')}>
        {t(navArea.label)}
      </span>
    </Link>
  );
}

/**
 * The areas of the product. On wide screens a rail at the start edge, tinted with the current area's colour, with each area's name beside its icon; on narrow screens a bar at the
 * bottom of the screen. Each area keeps its own colour, and its first permitted screen opens on click.
 */
export function AreaRail({ placement }: { placement: 'side' | 'bottom' }) {
  const t = useT();
  const { areas, current } = useAreas();
  const bottom = placement === 'bottom';
  return (
    <nav
      aria-label={t('shell.areas')}
      data-tone={bottom ? undefined : (current?.tone ?? 'slate')}
      className={cn(
        bottom
          ? 'bg-surface fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-0.5 border-t border-border px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden'
          : 'area-rail flex h-full w-[12.5rem] flex-col gap-1 border-e px-2.5 py-3',
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
      className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1"
    >
      {entry.items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex h-9 shrink-0 items-center rounded-full px-3.5 text-sm transition-colors',
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
