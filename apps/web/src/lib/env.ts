/** Public runtime configuration. Values are inlined at build time by Next.js. */
export const env = {
  apiUrl: (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000').replace(/\/+$/, ''),
  appUrl: (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
} as const;

export const STORAGE_KEYS = {
  activeOrganizationId: 'hta.activeOrganizationId',
  theme: 'hta.theme',
  preferences: 'hta.preferences',
  sidebarCollapsed: 'hta.sidebarCollapsed',
} as const;
