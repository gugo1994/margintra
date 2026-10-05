import { ConfigService } from '@nestjs/config';
import { createCipheriv, randomBytes } from 'node:crypto';
import { AesGcmEncryptionService } from '../../src/modules/billing/stripe/services/aes-gcm-encryption.service';
describe('AES-GCM billing encryption', () => {
  it('round trips without plaintext disclosure and uses the versioned envelope', async () => {
    const key = randomBytes(32).toString('base64');
    const service = new AesGcmEncryptionService(
      new ConfigService({ billing: { encryptionKey: key } }),
    );
    const encrypted = await service.encrypt('rk_test_sensitive');
    expect(encrypted).not.toContain('rk_test_sensitive');
    expect(Buffer.from(encrypted, 'base64')[0]).toBe(1);
    await expect(service.decrypt(encrypted)).resolves.toBe('rk_test_sensitive');
  });
  it('rejects tampering', async () => {
    const service = new AesGcmEncryptionService(
      new ConfigService({ billing: { encryptionKey: randomBytes(32).toString('base64') } }),
    );
    const envelope = Buffer.from(await service.encrypt('secret'), 'base64');
    envelope[29] = (envelope[29] ?? 0) ^ 1;
    expect(() => service.decrypt(envelope.toString('base64'))).toThrow();
  });
  it('reads legacy pre-launch AAD envelopes without using it for new encryption', async () => {
    const keyBytes = randomBytes(32);
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', keyBytes, nonce);
    cipher.setAAD(Buffer.from('MarginOS.Billing.v1'));
    const encrypted = Buffer.concat([cipher.update('rk_test_legacy', 'utf8'), cipher.final()]);
    const envelope = Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), encrypted]);
    const service = new AesGcmEncryptionService(
      new ConfigService({ billing: { encryptionKey: keyBytes.toString('base64') } }),
    );
    await expect(service.decrypt(envelope.toString('base64'))).resolves.toBe('rk_test_legacy');
  });
});
