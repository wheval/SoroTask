import { AuthPipeline } from '../AuthPipeline';
import { IdentityManager } from '../IdentityManager';
import { OAuthProvider } from '../providers/OAuthProvider';

describe('AuthPipeline', () => {
  let pipeline: AuthPipeline;
  let identityManager: IdentityManager;
  let mockProvider: OAuthProvider;

  beforeEach(() => {
    identityManager = new IdentityManager();
    pipeline = new AuthPipeline(identityManager, { enableErrorTracking: false });
    mockProvider = new OAuthProvider('oauth', 'Mock OAuth', 'client', 'secret', 'url');
    pipeline.registerProvider(mockProvider);
  });

  it('should register and retrieve providers', () => {
    expect(pipeline.getProvider('oauth')).toBeDefined();
    expect(pipeline.getRegisteredProviders().length).toBe(1);
    
    expect(() => {
      pipeline.registerProvider(mockProvider);
    }).toThrow('Provider with id oauth is already registered.');
  });

  it('should fail if provider is not found', async () => {
    const result = await pipeline.authenticate('non_existent', {});
    expect(result.success).toBe(false);
    expect(result.error).toBe('Provider non_existent not found.');
  });

  it('should authenticate and resolve identity successfully', async () => {
    const result = await pipeline.authenticate('oauth', { code: '12345' });
    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user?.id).toBe('user_12345');
    expect(result.user?.email).toBe('12345@example.com');
  });

  it('should handle provider authentication failures', async () => {
    const result = await pipeline.authenticate('oauth', { code: 'invalid_code' });
    expect(result.success).toBe(false);
    expect(result.error).toBe('Invalid OAuth code');
  });

  it('should handle identity resolution failures gracefully', async () => {
    // Mock the provider to return success but bad payload that crashes resolution
    jest.spyOn(mockProvider, 'authenticate').mockResolvedValue({
      success: true,
      providerId: 'oauth',
      // omitting rawProfile causes IdentityManager to fail
    });

    const result = await pipeline.authenticate('oauth', { code: '12345' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Cannot resolve identity');
  });
});
