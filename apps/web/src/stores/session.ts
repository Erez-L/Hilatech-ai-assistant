import { create } from 'zustand';
import type { AuthResponse, AuthUser, OrganizationSummary, Session } from '@hilatech/contracts';
import { STORAGE_KEYS } from '@/lib/env';

export type SessionStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionState {
  status: SessionStatus;
  /** Short-lived access token. Memory only — never persisted. */
  accessToken: string | null;
  user: AuthUser | null;
  organizations: OrganizationSummary[];
  /** Selected organization id (persisted in localStorage, id only). */
  activeOrganizationId: string | null;
  activeOrganization: OrganizationSummary | null;
  /** Permissions resolved by GET /auth/me for the active organization. */
  permissions: string[];
  /** True once GET /auth/me has resolved at least once for the current token. */
  sessionLoaded: boolean;

  setStatus: (status: SessionStatus) => void;
  setAccessToken: (token: string | null) => void;
  applyAuthResponse: (auth: AuthResponse) => void;
  /** @param requestedOrganizationId the organization header used for this /auth/me call (null when none was sent). */
  applySession: (session: Session, requestedOrganizationId?: string | null) => void;
  setActiveOrganization: (id: string | null) => void;
  updateUser: (user: Partial<AuthUser>) => void;
  clear: () => void;
}

export function readPersistedOrganizationId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(STORAGE_KEYS.activeOrganizationId);
  } catch {
    return null;
  }
}

function persistOrganizationId(id: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (id) window.localStorage.setItem(STORAGE_KEYS.activeOrganizationId, id);
    else window.localStorage.removeItem(STORAGE_KEYS.activeOrganizationId);
  } catch {
    // Storage may be unavailable (private mode); the selection then lives in memory only.
  }
}

/** Pick the organization to activate: persisted choice if still a member, otherwise the first one. */
export function resolveActiveOrganizationId(
  organizations: OrganizationSummary[],
  preferred: string | null,
): string | null {
  if (organizations.length === 0) return null;
  if (preferred && organizations.some((o) => o.id === preferred)) return preferred;
  return organizations[0]?.id ?? null;
}

const initialState = {
  status: 'idle' as SessionStatus,
  accessToken: null,
  user: null,
  organizations: [] as OrganizationSummary[],
  activeOrganizationId: null,
  activeOrganization: null,
  permissions: [] as string[],
  sessionLoaded: false,
};

export const useSession = create<SessionState>()((set, get) => ({
  ...initialState,

  setStatus: (status) => set({ status }),

  setAccessToken: (accessToken) => set({ accessToken }),

  applyAuthResponse: (auth) => {
    const preferred = get().activeOrganizationId ?? readPersistedOrganizationId();
    const activeOrganizationId = resolveActiveOrganizationId(auth.organizations, preferred);
    persistOrganizationId(activeOrganizationId);
    set({
      status: 'authenticated',
      accessToken: auth.accessToken,
      user: auth.user,
      organizations: auth.organizations,
      activeOrganizationId,
      activeOrganization: auth.organizations.find((o) => o.id === activeOrganizationId) ?? null,
    });
  },

  applySession: (session, requestedOrganizationId = null) => {
    const preferred = get().activeOrganizationId ?? readPersistedOrganizationId();
    const activeOrganizationId =
      session.activeOrganization?.id ?? resolveActiveOrganizationId(session.organizations, preferred);
    persistOrganizationId(activeOrganizationId);
    // Permissions are final when the server resolved an organization, the user has none, or the
    // response already answers the organization we asked for. Otherwise a re-fetch with the
    // organization header follows (the query key includes the organization id).
    const sessionLoaded =
      session.activeOrganization !== null ||
      session.organizations.length === 0 ||
      requestedOrganizationId === activeOrganizationId;
    set({
      status: 'authenticated',
      user: session.user,
      organizations: session.organizations,
      activeOrganizationId,
      activeOrganization:
        session.activeOrganization ?? session.organizations.find((o) => o.id === activeOrganizationId) ?? null,
      permissions: session.permissions,
      sessionLoaded,
    });
  },

  setActiveOrganization: (id) => {
    persistOrganizationId(id);
    const org = get().organizations.find((o) => o.id === id) ?? null;
    set({ activeOrganizationId: id, activeOrganization: org, permissions: [], sessionLoaded: false });
  },

  updateUser: (patch) => {
    const user = get().user;
    if (!user) return;
    set({ user: { ...user, ...patch } });
  },

  clear: () => {
    set({ ...initialState, status: 'unauthenticated' });
  },
}));
