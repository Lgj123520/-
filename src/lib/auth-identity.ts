const ACCOUNT_EMAIL_DOMAIN = 'account.local';

export function isEmailLike(input: string): boolean {
  return input.includes('@');
}

export function normalizeAccountInput(input: string): string {
  return input.trim().toLowerCase();
}

export function accountToEmail(account: string): string {
  return `${normalizeAccountInput(account)}@${ACCOUNT_EMAIL_DOMAIN}`;
}

export function resolveLoginEmail(accountOrEmail: string): string {
  const v = normalizeAccountInput(accountOrEmail);
  if (isEmailLike(v)) return v;
  return accountToEmail(v);
}

export function displayAccountFromUser(user: { email?: string | null; user_metadata?: Record<string, unknown> }): string {
  const metaAccount = user.user_metadata?.account;
  if (typeof metaAccount === 'string' && metaAccount.trim()) return metaAccount;
  const email = user.email ?? '';
  const suffix = `@${ACCOUNT_EMAIL_DOMAIN}`;
  if (email.endsWith(suffix)) return email.slice(0, -suffix.length);
  return email;
}
