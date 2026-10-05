export interface IEncryptionService {
  encrypt(value: string): Promise<string>;
  decrypt(value: string): Promise<string>;
}
export const ENCRYPTION_SERVICE = Symbol('ENCRYPTION_SERVICE');
