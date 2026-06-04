import { IAuthProvider, AuthProviderConfig, AuthCredentials, AuthResult } from '../types';

export class DIDProvider implements IAuthProvider {
  config: AuthProviderConfig;
  private resolverUrl: string;

  constructor(id: string, name: string, resolverUrl: string = 'https://dev.uniresolver.io/1.0/identifiers/') {
    this.config = { id, name, type: 'did' };
    this.resolverUrl = resolverUrl;
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    try {
      if (!credentials.did || !credentials.signature || !credentials.challenge) {
        throw new Error('DID, signature, or challenge is missing');
      }

      // Mock implementation
      if (credentials.signature === 'invalid_signature') {
        throw new Error('Invalid cryptographic signature for DID');
      }

      const didMethod = credentials.did.split(':')[1];
      const address = didMethod === 'stellar' ? credentials.did.split(':')[2] : undefined;

      return {
        success: true,
        providerId: this.config.id,
        token: `did_token_${credentials.did}`,
        rawProfile: {
          id: credentials.did,
          address: address || 'G_MOCK_ADDRESS',
        }
      };
    } catch (error: any) {
      return {
        success: false,
        providerId: this.config.id,
        error: error.message || error
      };
    }
  }
}
