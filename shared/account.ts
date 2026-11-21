import type { WorkspacePreferences } from './preferences.ts';

export const ACCOUNT_PROVIDERS = { google: 'Google', github: 'GitHub', discord: 'Discord' } as const;
export type AccountProvider = keyof typeof ACCOUNT_PROVIDERS;
export const ACCOUNT_AUTH_PATHS = {
  google: 'https://accounts.google.com/o/oauth2/v2/auth', github: 'https://github.com/login/oauth/authorize', discord: 'https://discord.com/oauth2/authorize',
} as const;
export const isAccountProvider = (value: unknown): value is AccountProvider => typeof value === 'string' && Object.hasOwn(ACCOUNT_PROVIDERS, value);
export const isAccountId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export type PublicAccount = { id: string; name: string; email: string };
export type AccountStatus = { providers: AccountProvider[]; passwords: boolean; user: PublicAccount | null; background: boolean; settings?: WorkspacePreferences };
export const guestAccount = (): AccountStatus => ({ providers: [], passwords: false, user: null, background: false });

export type AccountLink = { purpose: 'signup' | 'reset'; token: string };
export function parseAccountLink(hash: string): AccountLink | undefined {
  const match = /^#(signup|reset)=([A-Za-z0-9_-]{43})$/.exec(hash);
  if (match) return { purpose: match[1] === 'signup' ? 'signup' : 'reset', token: match[2] };
}
