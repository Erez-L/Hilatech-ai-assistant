'use client';

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

function AreaLink({ navArea, href, active }: { navArea: NavArea; href: string; active: boolean }) {
  const t = useT();
  const Icon = navArea.icon;
  return (
    <Link
      href={href}
      data-tone={navArea.tone}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'group flex min-w-0 flex-1 flex-col items-center gap-1 rounded-lg px-0.5 py-1 text-center text-2xs font-semibold transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        active ? 'bg-tone-soft font-bold text-tone-fg' : 'text-fg hover:bg-surface-muted',
      )}
    >
      <span
        className={cn(
          'flex size-10 items-center justify-center rounded-md transition-transform group-active:scale-95 [&_svg]:size-5',
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

/** One area in the side rail: its name with a coloured tile, and under it the screens the role can open. */
function AreaGroup({
  navArea,
  items,
  pathname,
}: {
  navArea: NavArea;
  items: NavArea['items'];
  pathname: string;
}) {
  const t = useT();
  const Icon = navArea.icon;
  const headingId = `area-${navArea.key}`;
  return (
    <section data-tone={navArea.tone} aria-labelledby={headingId} className="flex flex-col gap-0.5">
      <h2
        id={headingId}
        className="flex items-center gap-2 px-1.5 py-0.5 text-sm font-extrabold text-fg"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-tone text-tone-on shadow-[0_6px_14px_-6px_var(--tone)] [&_svg]:size-4">
          <Icon aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate">{t(navArea.label)}</span>
      </h2>
      <ul className="flex flex-col gap-0.5 ps-3">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const ItemIcon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-7 items-center gap-2 rounded-md border-s-[3px] px-2 text-sm transition-colors [&_svg]:size-4 [&_svg]:shrink-0',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                  active
                    ? 'border-tone-bright bg-surface font-bold text-fg'
                    : 'border-transparent font-medium text-fg hover:bg-surface/60',
                )}
              >
                <ItemIcon aria-hidden className={active ? undefined : 'opacity-80'} />
                <span className="min-w-0 flex-1 truncate">{t(item.label)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The areas of the product. On wide screens a rail at the start edge that lists every area with its screens;
 * it is dark in both themes and the same in every area. On narrow screens a bar at the bottom of the screen with one link
 * per area, and the screens of the current area are tabs above the page (see `AreaTabs`).
 */
export function AreaRail({ placement }: { placement: 'side' | 'bottom' }) {
  const t = useT();
  const { areas, current, pathname } = useAreas();
  if (placement === 'side') {
    return (
      <nav
        aria-label={t('shell.areas')}
        className="area-rail flex h-full w-[13.5rem] flex-col gap-2 overflow-y-auto border-e px-2.5 py-2.5"
      >
        {areas.map(({ navArea, items }) => (
          <AreaGroup key={navArea.key} navArea={navArea} items={items} pathname={pathname} />
        ))}
      </nav>
    );
  }
  return (
    <nav
      aria-label={t('shell.areas')}
      className="fixed inset-x-0 bottom-0 z-30 flex items-stretch gap-0.5 border-t border-border bg-surface px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] lg:hidden"
    >
      {areas.map(({ navArea, items }) => (
        <AreaLink
          key={navArea.key}
          navArea={navArea}
          href={items[0]!.href}
          active={current?.key === navArea.key}
        />
      ))}
    </nav>
  );
}

/**
 * The screens of the current area, as pill links above the page on narrow screens (the side
 * rail lists them on wide ones). Hidden when the area has one screen. */
export function AreaTabs() {
  const t = useT();
  const { areas, current, pathname } = useAreas();
  const entry = areas.find((a) => a.navArea.key === current?.key);
  if (!entry || entry.items.length < 2) return null;
  return (
    <nav
      aria-label={t('shell.areaScreens', { name: t(entry.navArea.label) })}
      className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:hidden"
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
