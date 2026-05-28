import { IAuthProvider, AuthProviderConfig, AuthCredentials, AuthResult } from '../types';

export class OAuthProvider implements IAuthProvider {
  config: AuthProviderConfig;
  private clientId: string;
  private clientSecret: string;
  private authUrl: string;

  constructor(id: string, name: string, clientId: string, clientSecret: string, authUrl: string) {
    this.config = { id, name, type: 'oauth' };
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.authUrl = authUrl;
  }

  async authenticate(credentials: AuthCredentials): Promise<AuthResult> {
    try {
      if (!credentials.code) {
        throw new Error('OAuth code is missing');
      }

      // Mock implementation: In a real scenario, we'd exchange code for token here
      if (credentials.code === 'invalid_code') {
        throw new Error('Invalid OAuth code');
      }

      return {
        success: true,
        providerId: this.config.id,
        token: `oauth_token_${credentials.code}`,
        rawProfile: {
          sub: `user_${credentials.code}`,
          email: `${credentials.code}@example.com`,
          name: `User ${credentials.code}`
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

  async validateToken(token: string): Promise<boolean> {
    return token.startsWith('oauth_token_');
  }
}
