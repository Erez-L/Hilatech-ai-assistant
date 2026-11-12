'use client';

import * as React from 'react';
import { usePathname } from 'next/navigation';
import { Menu } from 'lucide-react';
import { IconButton, PageIconProvider, Sheet, SheetContent, Spinner, TopBar } from '@hilatech/ui';
import { useSession } from '@/stores/session';
import { AppSidebar } from './app-sidebar';
import { NotificationsMenu } from './notifications-menu';
import { ThemeToggle } from './theme-toggle';
import { UserMenu } from './user-menu';
import { navItemFor, pageTitleFor } from './nav';
import { useT } from '@/i18n/provider';

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = React.useState(false);
  const sessionLoaded = useSession((s) => s.sessionLoaded);
  const title = pageTitleFor(pathname, t);
  const area = navItemFor(pathname);
  const AreaIcon = area?.icon;

  return (
    <div className="flex min-h-dvh bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:start-3 focus:z-[60] focus:rounded-sm focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-fg"
      >
        {t('shell.skipToContent')}
      </a>
      {/* Desktop sidebar */}
      <div className="sticky top-0 hidden h-dvh shrink-0 lg:block">
        <AppSidebar />
      </div>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="start"
          title={t('shell.navigation')}
          closeOutside
          className="w-64 lg:hidden"
        >
          <AppSidebar onNavigate={() => setMobileOpen(false)} className="h-dvh" />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          start={
            <>
              <IconButton
                label={t('shell.openNavigation')}
                className="lg:hidden"
                onClick={() => setMobileOpen(true)}
              >
                <Menu aria-hidden />
              </IconButton>
              <span className="truncate text-sm font-medium text-fg-muted">{title}</span>
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
        />
        <main
          id="main"
          tabIndex={-1}
          data-tone={area?.tone}
          className="relative flex-1 px-4 py-6 outline-none sm:px-6 lg:px-8 lg:py-8"
        >
          <div className="mx-auto w-full max-w-6xl">
            {sessionLoaded ? (
              <PageIconProvider icon={AreaIcon ? <AreaIcon /> : null}>{children}</PageIconProvider>
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
