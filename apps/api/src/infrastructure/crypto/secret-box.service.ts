import { ErrorCode } from '@hilatech/contracts';
import { SecretBox } from '@hilatech/shared';
import { HttpStatus, Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { AppConfig } from '../../config/app-config.service';

/**
 * Organization-bound secret encryption (AES-256-GCM, `SecretBox` from `@hilatech/shared`). The
 * organization id is the AAD, so a ciphertext copied to another tenant's row never decrypts. Plaintext
 * secrets exist only in memory for the duration of a call and are never logged or returned to clients.
 */
@Injectable()
export class SecretBoxService {
  private readonly box: SecretBox | null;

  constructor(config: AppConfig) {
    const key = config.get('CREDENTIALS_ENCRYPTION_KEY');
    this.box = key ? new SecretBox(key) : null;
  }

  get isConfigured(): boolean {
    return this.box !== null;
  }

  encrypt(organizationId: string, plaintext: string): string {
    return this.require().encrypt(plaintext, organizationId);
  }

  decrypt(organizationId: string, envelope: string): string {
    return this.require().decrypt(envelope, organizationId);
  }

  private require(): SecretBox {
    if (!this.box) {
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        'Secret storage is not configured (CREDENTIALS_ENCRYPTION_KEY is missing)',
      );
    }
    return this.box;
  }
}
