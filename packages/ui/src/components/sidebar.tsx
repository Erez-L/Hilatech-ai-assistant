'use client';

import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cn } from '../lib/cn';
import { useUiStrings } from '../lib/ui-strings';

export interface SidebarProps extends React.HTMLAttributes<HTMLElement> {
  /** Header slot (brand, organization switcher). */
  header?: React.ReactNode;
  /** Footer slot (user menu, help). */
  footer?: React.ReactNode;
}

/** Vertical navigation rail. Width and positioning are controlled by the shell around it. */
export function Sidebar({ header, footer, className, children, ...props }: SidebarProps) {
  const ui = useUiStrings();
  return (
    <aside
      className={cn(
        'flex h-full w-64 flex-col border-e border-border bg-surface text-fg',
        className,
      )}
      {...props}
    >
      {header ? <div className="flex flex-col gap-2 px-3 pt-4 pb-2">{header}</div> : null}
      <nav
        aria-label={ui.primaryNavigation}
        className="flex-1 overflow-y-auto px-3 py-2 scrollbar-thin"
      >
        {children}
      </nav>
      {footer ? <div className="border-t border-border px-3 py-3">{footer}</div> : null}
    </aside>
  );
}

export interface SidebarSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
}

export function SidebarSection({ label, className, children, ...props }: SidebarSectionProps) {
  const id = React.useId();
  return (
    <div
      className={cn('mb-4 flex flex-col gap-0.5', className)}
      role="group"
      aria-labelledby={label ? id : undefined}
      {...props}
    >
      {label ? (
        <p id={id} className="mt-1 mb-1.5 px-2.5 text-xs font-medium text-fg-subtle">
          {label}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export interface SidebarNavItemProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Render the child (e.g. Next.js Link) instead of an <a>. */
  asChild?: boolean;
  active?: boolean;
  icon?: React.ReactNode;
  /** Trailing element: count, badge, or "soon" marker. */
  trailing?: React.ReactNode;
  disabled?: boolean;
}

export const SidebarNavItem = React.forwardRef<HTMLAnchorElement, SidebarNavItemProps>(
  function SidebarNavItem(
    { asChild, active, icon, trailing, disabled, className, children, ...props },
    ref,
  ) {
    const Comp = asChild ? Slot : 'a';
    return (
      <Comp
        ref={ref}
        aria-current={active ? 'page' : undefined}
        aria-disabled={disabled || undefined}
        className={cn(
          'group flex h-9 items-center gap-2.5 rounded-sm px-2.5 text-sm font-medium outline-none',
          'transition-colors duration-100',
          'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring',
          active
            ? 'bg-accent-soft text-accent-soft-fg'
            : 'text-fg-muted hover:bg-surface-muted hover:text-fg',
          disabled && 'pointer-events-none opacity-50',
          '[&_svg]:size-4 [&_svg]:shrink-0',
          className,
        )}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {icon ? (
              <span
                className={cn(
                  'flex items-center',
                  active ? 'text-accent' : 'text-fg-subtle group-hover:text-fg-muted',
                )}
              >
                {icon}
              </span>
            ) : null}
            <span className="flex-1 truncate">{children}</span>
            {trailing ? <span className="flex items-center">{trailing}</span> : null}
          </>
        )}
      </Comp>
    );
  },
);

/** Inner layout for a nav item when using asChild (so the Link receives the styling). */
export function SidebarNavItemContent({
  icon,
  trailing,
  active,
  children,
}: Pick<SidebarNavItemProps, 'icon' | 'trailing' | 'active' | 'children'>) {
  return (
    <>
      {icon ? (
        <span
          className={cn(
            'flex items-center',
            active ? 'text-accent' : 'text-fg-subtle group-hover:text-fg-muted',
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="flex-1 truncate">{children}</span>
      {trailing ? <span className="flex items-center">{trailing}</span> : null}
    </>
  );
}
