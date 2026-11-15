'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { Sparkles } from 'lucide-react';
import { Permission } from '@hilatech/contracts';
import { PageIconProvider, Spinner, TopBar, Wordmark } from '@hilatech/ui';
import { useSession } from '@/stores/session';
import { AreaRail, AreaTabs } from './area-nav';
import { OrgSwitcher } from './org-switcher';
import { NotificationsMenu } from './notifications-menu';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import { areaFor, navItemFor } from './nav';
import { useT } from '@/i18n/provider';

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const sessionLoaded = useSession((s) => s.sessionLoaded);
  const canAskAssistant = useSession((s) => s.permissions.includes(Permission.AI_ASSISTANT_USE));
  const tone = areaFor(pathname)?.tone;
  const AreaIcon = navItemFor(pathname)?.icon;

  // Dialogs, menus and toasts render at the end of <body>, outside the page: the area's colour is set there
  // too, so a popup in Sales looks like Sales.
  React.useEffect(() => {
    if (!tone) return;
    document.body.dataset.tone = tone;
    return () => {
      delete document.body.dataset.tone;
    };
  }, [tone]);

  return (
    <div className="flex min-h-dvh bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[60] focus:rounded-sm focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-fg"
      >
        {t('shell.skipToContent')}
      </a>
      {/* Areas: a rail on wide screens, a bar at the bottom on narrow ones. */}
      <div className="sticky top-0 hidden h-dvh shrink-0 lg:block">
        <AreaRail placement="side" />
      </div>
      <AreaRail placement="bottom" />

      <div data-tone={tone} className="area-wash flex min-w-0 flex-1 flex-col">
        <TopBar
          start={
            <>
              <Link
                href="/dashboard"
                aria-label={t('app.productNameShort')}
                className="flex h-9 items-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Wordmark compact />
              </Link>
              <OrgSwitcher className="w-auto max-w-[11rem] sm:max-w-[14rem]" />
            </>
          }
          end={
            <>
              <NotificationsMenu />
              <ThemeToggle />
              <div className="mx-1 h-5 w-px bg-border" aria-hidden />
              <UserMenu />
            </>
          }
        >
          {canAskAssistant ? (
            // The assistant is one click away from every screen; it opens the assistant, it does not act here.
            <Link
              href="/assistant"
              data-tone="pink"
              className="hidden h-10 min-w-0 max-w-md flex-1 items-center gap-2 rounded-md border-2 border-tone bg-surface px-3 text-sm text-fg-muted transition-colors hover:bg-tone-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring md:flex"
            >
              <Sparkles className="size-4 shrink-0 text-tone-fg" aria-hidden />
              <span className="truncate">{t('shell.askAssistant')}</span>
            </Link>
          ) : null}
        </TopBar>
        <main
          id="main"
          tabIndex={-1}
          className="relative flex-1 px-3 pt-3 pb-24 outline-none sm:px-5 lg:px-6 lg:pt-4 lg:pb-6"
        >
          <div className="mx-auto w-full max-w-[90rem]">
            {sessionLoaded ? (
              <>
                <AreaTabs />
                <PageIconProvider icon={AreaIcon ? <AreaIcon /> : null}>
                  {children}
                </PageIconProvider>
              </>
            ) : (
              <div className="flex min-h-[40vh] items-center justify-center" role="status">
                <Spinner label={t('shell.switchingOrganization')} />
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
