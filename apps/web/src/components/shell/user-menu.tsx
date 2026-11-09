'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Settings2, UserRound } from 'lucide-react';
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@hilatech/ui';
import { authApi } from '@/lib/api';
import { useSession } from '@/stores/session';

export function useSignOut() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return async () => {
    try {
      await authApi.logout();
    } catch {
      // The cookie may already be gone; the client state is cleared regardless.
    }
    useSession.getState().clear();
    queryClient.clear();
    router.replace('/login');
    toast.success('Signed out');
  };
}

export function UserMenu() {
  const user = useSession((s) => s.user);
  const signOut = useSignOut();
  if (!user) return null;
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Account menu for ${fullName}`}
          className="flex size-9 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <Avatar
            src={user.avatarUrl}
            firstName={user.firstName}
            lastName={user.lastName}
            size="md"
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="text-sm font-medium text-fg">{fullName}</span>
          <span className="truncate text-xs font-normal text-fg-muted">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">
            <UserRound aria-hidden />
            Your profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/organization">
            <Settings2 aria-hidden />
            Organization settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOut aria-hidden />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
