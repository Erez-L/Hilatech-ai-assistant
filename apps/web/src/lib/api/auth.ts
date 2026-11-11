import type {
  AuthResponse,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  LoginRequest,
  RegisterRequest,
  ResetPasswordRequest,
  Session,
  VerifyEmailRequest,
} from '@hilatech/contracts';
import { api } from './client';
import type { AuthSessionInfo } from './types';

interface RawSession {
  familyId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  lastActiveAt?: string;
  lastUsedAt?: string;
  expiresAt?: string;
  current?: boolean;
}

export const authApi = {
  register: (body: RegisterRequest) =>
    api.post<AuthResponse>('/auth/register', body, { auth: false, organization: false }),
  login: (body: LoginRequest) =>
    api.post<AuthResponse>('/auth/login', body, { auth: false, organization: false }),
  refresh: () => api.refresh(),
  logout: () =>
    api.post<void>('/auth/logout', undefined, { retryOnUnauthorized: false, organization: false }),
  me: () => api.get<Session>('/auth/me'),
  forgotPassword: (body: ForgotPasswordRequest) =>
    api.post<void>('/auth/forgot-password', body, { auth: false, organization: false }),
  resetPassword: (body: ResetPasswordRequest) =>
    api.post<void>('/auth/reset-password', body, { auth: false, organization: false }),
  verifyEmail: (body: VerifyEmailRequest) =>
    api.post<void>('/auth/verify-email', body, { auth: false, organization: false }),
  resendVerification: () =>
    api.post<void>('/auth/resend-verification', undefined, { organization: false }),
  changePassword: (body: ChangePasswordRequest) =>
    api.post<void>('/auth/change-password', body, { organization: false }),
  sessions: async (): Promise<AuthSessionInfo[]> => {
    const raw = await api.get<RawSession[]>('/auth/sessions', { organization: false });
    return raw.map((s) => ({
      familyId: s.familyId,
      userAgent: s.userAgent ?? null,
      ipAddress: s.ipAddress ?? null,
      createdAt: s.createdAt,
      lastUsedAt: s.lastActiveAt ?? s.lastUsedAt ?? s.createdAt,
      expiresAt: s.expiresAt ?? null,
      current: !!s.current,
    }));
  },
  revokeSession: (familyId: string) =>
    api.delete<void>(`/auth/sessions/${encodeURIComponent(familyId)}`, { organization: false }),
};
