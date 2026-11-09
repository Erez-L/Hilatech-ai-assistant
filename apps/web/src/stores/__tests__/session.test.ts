import { beforeEach, describe, expect, it } from 'vitest';
import type { AuthResponse, Session } from '@hilatech/contracts';
import { STORAGE_KEYS } from '@/lib/env';
import { resolveActiveOrganizationId, useSession } from '../session';

const user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'noa@example.com',
  firstName: 'Noa',
  lastName: 'Levi',
  avatarUrl: null,
  emailVerifiedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};
const orgA = { id: 'org-a', name: 'A', slug: 'a', logoUrl: null, roleKey: 'owner', roleName: 'Owner' };
const orgB = { id: 'org-b', name: 'B', slug: 'b', logoUrl: null, roleKey: 'member', roleName: 'Member' };

const auth = (organizations = [orgA, orgB]): AuthResponse => ({
  accessToken: 'tok',
  expiresIn: 900,
  tokenType: 'Bearer',
  user,
  organizations,
});

describe('useSession', () => {
  beforeEach(() => {
    window.localStorage.clear();
    useSession.setState({
      status: 'idle',
      accessToken: null,
      user: null,
      organizations: [],
      activeOrganizationId: null,
      activeOrganization: null,
      permissions: [],
      sessionLoaded: false,
    });
  });

  it('resolveActiveOrganizationId prefers a persisted membership, else the first organization', () => {
    expect(resolveActiveOrganizationId([orgA, orgB], 'org-b')).toBe('org-b');
    expect(resolveActiveOrganizationId([orgA, orgB], 'org-zzz')).toBe('org-a');
    expect(resolveActiveOrganizationId([], 'org-a')).toBeNull();
  });

  it('applies an auth response, selects the first organization and persists only the id', () => {
    useSession.getState().applyAuthResponse(auth());
    const s = useSession.getState();
    expect(s.status).toBe('authenticated');
    expect(s.accessToken).toBe('tok');
    expect(s.user?.email).toBe('noa@example.com');
    expect(s.activeOrganizationId).toBe('org-a');
    expect(s.activeOrganization?.name).toBe('A');
    expect(window.localStorage.getItem(STORAGE_KEYS.activeOrganizationId)).toBe('org-a');
    // Access token is never persisted.
    expect(JSON.stringify(window.localStorage)).not.toContain('tok');
  });

  it('restores the persisted organization when still a member', () => {
    window.localStorage.setItem(STORAGE_KEYS.activeOrganizationId, 'org-b');
    useSession.getState().applyAuthResponse(auth());
    expect(useSession.getState().activeOrganizationId).toBe('org-b');
  });

  it('applySession resolves permissions and marks the session loaded when the server answered for the active organization', () => {
    useSession.getState().applyAuthResponse(auth());
    const session: Session = {
      user,
      organizations: [orgA, orgB],
      activeOrganization: orgA,
      permissions: ['members:read', 'organization:read'],
    };
    useSession.getState().applySession(session, 'org-a');
    const s = useSession.getState();
    expect(s.permissions).toEqual(['members:read', 'organization:read']);
    expect(s.sessionLoaded).toBe(true);
  });

  it('applySession without a resolved organization selects one and waits for the follow-up fetch', () => {
    useSession.getState().setAccessToken('tok');
    useSession.getState().setStatus('authenticated');
    useSession.getState().applySession(
      { user, organizations: [orgA, orgB], activeOrganization: null, permissions: [] },
      null,
    );
    const s = useSession.getState();
    expect(s.activeOrganizationId).toBe('org-a');
    expect(s.sessionLoaded).toBe(false);
  });

  it('applySession with no organizations is immediately loaded (onboarding case)', () => {
    useSession.getState().applySession({ user, organizations: [], activeOrganization: null, permissions: [] }, null);
    expect(useSession.getState().sessionLoaded).toBe(true);
    expect(useSession.getState().activeOrganizationId).toBeNull();
  });

  it('setActiveOrganization switches, persists and clears permissions until re-resolved', () => {
    useSession.getState().applyAuthResponse(auth());
    useSession.getState().applySession(
      { user, organizations: [orgA, orgB], activeOrganization: orgA, permissions: ['x'] },
      'org-a',
    );
    useSession.getState().setActiveOrganization('org-b');
    const s = useSession.getState();
    expect(s.activeOrganizationId).toBe('org-b');
    expect(s.activeOrganization?.name).toBe('B');
    expect(s.permissions).toEqual([]);
    expect(s.sessionLoaded).toBe(false);
    expect(window.localStorage.getItem(STORAGE_KEYS.activeOrganizationId)).toBe('org-b');
  });

  it('clear() forgets everything and marks the session unauthenticated', () => {
    useSession.getState().applyAuthResponse(auth());
    useSession.getState().clear();
    const s = useSession.getState();
    expect(s.status).toBe('unauthenticated');
    expect(s.accessToken).toBeNull();
    expect(s.user).toBeNull();
    expect(s.organizations).toEqual([]);
  });
});
