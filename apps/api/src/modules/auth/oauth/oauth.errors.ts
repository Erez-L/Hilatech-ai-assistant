import { type OAuthProfile } from './oauth.providers';

export type { OAuthProfile };

/** Why a social sign-in was refused; the code is passed to the web login page as `?oauth_error=`. */
export type SocialLoginErrorCode =
  /** The provider returned no email address (or none we can use). */
  | 'email_missing'
  /** An account with this email exists and the provider did not verify the address, so it cannot be linked. */
  | 'account_exists'
  /** The account is deactivated. */
  | 'inactive';

export class SocialLoginError extends Error {
  constructor(readonly code: SocialLoginErrorCode) {
    super(`Social sign-in refused: ${code}`);
    this.name = 'SocialLoginError';
  }
}
