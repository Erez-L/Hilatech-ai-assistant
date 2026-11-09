'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Plus } from 'lucide-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  cn,
} from '@hilatech/ui';
import { useSession } from '@/stores/session';

export function OrgSwitcher({ className }: { className?: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const organizations = useSession((s) => s.organizations);
  const active = useSession((s) => s.activeOrganization);
  const setActiveOrganization = useSession((s) => s.setActiveOrganization);

  const switchTo = (id: string) => {
    if (id === active?.id) return;
    setActiveOrganization(id);
    // Tenant data belongs to the previous organization; drop it and start fresh on the dashboard.
    queryClient.removeQueries({ queryKey: ['org'] });
    router.push('/dashboard');
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={
            active ? `Organization: ${active.name}. Switch organization` : 'Switch organization'
          }
          className={cn(
            'flex h-11 w-full items-center gap-2.5 rounded-md border border-transparent px-2 text-left',
            'transition-colors hover:border-border hover:bg-surface-muted',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            'data-[state=open]:border-border data-[state=open]:bg-surface-muted',
            className,
          )}
        >
          <Avatar
            size="md"
            src={active?.logoUrl}
            name={active?.name ?? 'Organization'}
            firstName={active?.name}
            className="rounded-sm bg-fg text-fg-inverted"
          />
          <span className="flex min-w-0 flex-1 flex-col leading-tight">
            <span className="truncate text-sm font-semibold text-fg">
              {active?.name ?? 'Select organization'}
            </span>
            <span className="truncate text-xs text-fg-muted">{active?.roleName ?? '—'}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {organizations.map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => switchTo(org.id)} className="gap-2.5">
            <Avatar
              size="sm"
              src={org.logoUrl}
              name={org.name}
              firstName={org.name}
              className="rounded-xs"
            />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate font-medium">{org.name}</span>
              <span className="truncate text-xs text-fg-muted">{org.roleName}</span>
            </span>
            {org.id === active?.id ? <Check className="!text-accent" aria-hidden /> : null}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding?new=1">
            <Plus aria-hidden />
            Create organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
