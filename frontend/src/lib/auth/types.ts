import { User } from '../../../types/auth';

export interface AuthCredentials {
  [key: string]: any;
}

export interface AuthProviderConfig {
  id: string;
  name: string;
  type: 'oauth' | 'saml' | 'did' | 'custom';
}

export interface AuthResult {
  success: boolean;
  user?: Partial<User>;
  error?: Error | string;
  providerId: string;
  token?: string;
  rawProfile?: any;
}

export interface IAuthProvider {
  config: AuthProviderConfig;
  authenticate(credentials: AuthCredentials): Promise<AuthResult>;
  validateToken?(token: string): Promise<boolean>;
  logout?(token: string): Promise<void>;
}

export interface IdentityProfile {
  providerId: string;
  providerUserId: string;
  email?: string;
  name?: string;
  address?: string; // Stellar address
  attributes?: Record<string, any>;
}

export interface IdentityResolutionResult {
  success: boolean;
  user?: User;
  error?: string;
}
