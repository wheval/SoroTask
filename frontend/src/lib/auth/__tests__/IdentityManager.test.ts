import { IdentityManager } from '../IdentityManager';

describe('IdentityManager', () => {
  let manager: IdentityManager;

  beforeEach(() => {
    manager = new IdentityManager();
  });

  it('should fail if authResult is not successful', async () => {
    const result = await manager.resolveIdentity({
      success: false,
      providerId: 'github',
      error: 'Auth failed'
    });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Cannot resolve identity from failed auth result');
  });

  it('should normalize OAuth profile correctly', async () => {
    const result = await manager.resolveIdentity({
      success: true,
      providerId: 'oauth',
      rawProfile: { sub: 'oauth_123', email: 'test@oauth.com', name: 'OAuth User' }
    });
    
    expect(result.success).toBe(true);
    expect(result.user?.id).toBe('oauth_123');
    expect(result.user?.email).toBe('test@oauth.com');
    expect(result.user?.role).toBe('user');
  });

  it('should normalize SAML profile correctly', async () => {
    const result = await manager.resolveIdentity({
      success: true,
      providerId: 'saml',
      rawProfile: {
        nameID: 'saml_123',
        attributes: {
          email: ['test@saml.com'],
          displayName: ['SAML User']
        }
      }
    });

    expect(result.success).toBe(true);
    expect(result.user?.id).toBe('saml_123');
    expect(result.user?.email).toBe('test@saml.com');
  });

  it('should normalize DID profile correctly', async () => {
    const result = await manager.resolveIdentity({
      success: true,
      providerId: 'did',
      rawProfile: {
        id: 'did:stellar:G123456',
        address: 'G123456'
      }
    });

    expect(result.success).toBe(true);
    expect(result.user?.id).toBe('did:stellar:G123456');
    expect(result.user?.address).toBe('G123456');
  });

  it('should reject unknown provider type', async () => {
    const result = await manager.resolveIdentity({
      success: true,
      providerId: 'unknown_provider',
      rawProfile: { id: '123' }
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Unsupported provider type');
  });
});
