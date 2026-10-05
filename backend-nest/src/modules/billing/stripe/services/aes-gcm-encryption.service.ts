import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { IEncryptionService } from '../interfaces/encryption.interface';
const VERSION = 1;
const NONCE_LENGTH = 12;
const AAD = Buffer.from('Margintra.Billing.v1');
const LEGACY_AAD = Buffer.from('MarginOS.Billing.v1');
@Injectable()
export class AesGcmEncryptionService implements IEncryptionService {
  private readonly key: Buffer;
  constructor(config: ConfigService) {
    this.key = Buffer.from(config.getOrThrow<string>('billing.encryptionKey'), 'base64');
    if (this.key.length !== 32)
      throw new Error('STRIPE_ENCRYPTION_KEY must be a base64-encoded 32-byte key.');
  }
  encrypt(value: string) {
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(AAD);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return Promise.resolve(
      Buffer.concat([Buffer.from([VERSION]), nonce, cipher.getAuthTag(), encrypted]).toString(
        'base64',
      ),
    );
  }
  decrypt(value: string) {
    const envelope = Buffer.from(value, 'base64');
    if (envelope.length < 30 || envelope[0] !== VERSION)
      throw new Error('Unsupported billing credential envelope.');
    for (const aad of [AAD, LEGACY_AAD]) {
      try {
        const decipher = createDecipheriv('aes-256-gcm', this.key, envelope.subarray(1, 13));
        decipher.setAAD(aad);
        decipher.setAuthTag(envelope.subarray(13, 29));
        return Promise.resolve(
          Buffer.concat([decipher.update(envelope.subarray(29)), decipher.final()]).toString(
            'utf8',
          ),
        );
      } catch {
        // Try the pre-launch legacy AAD once so locally persisted Stripe credentials remain readable.
      }
    }
    throw new Error('Unable to decrypt billing credential.');
  }
}
