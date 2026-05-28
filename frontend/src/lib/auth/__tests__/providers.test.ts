import { OAuthProvider } from '../providers/OAuthProvider';
import { SAMLProvider } from '../providers/SAMLProvider';
import { DIDProvider } from '../providers/DIDProvider';

describe('Authentication Providers', () => {
  describe('OAuthProvider', () => {
    const provider = new OAuthProvider('google', 'Google OAuth', 'client_id', 'client_secret', 'https://oauth.google.com');

    it('should authenticate successfully with valid code', async () => {
      const result = await provider.authenticate({ code: 'valid_code' });
      expect(result.success).toBe(true);
      expect(result.token).toBe('oauth_token_valid_code');
      expect(result.rawProfile.sub).toBe('user_valid_code');
    });

    it('should fail with invalid code', async () => {
      const result = await provider.authenticate({ code: 'invalid_code' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid OAuth code');
    });

    it('should fail if code is missing', async () => {
      const result = await provider.authenticate({});
      expect(result.success).toBe(false);
      expect(result.error).toBe('OAuth code is missing');
    });
  });

  describe('SAMLProvider', () => {
    const provider = new SAMLProvider('corporate_saml', 'Corporate SAML', 'https://idp.example.com', 'sorotask_sp');

    it('should authenticate successfully with valid SAML response', async () => {
      const result = await provider.authenticate({ samlResponse: 'valid_base64_saml' });
      expect(result.success).toBe(true);
      expect(result.token).toContain('saml_token_');
      expect(result.rawProfile.attributes.email).toEqual(['saml.user@example.com']);
    });

    it('should fail with invalid SAML response', async () => {
      const result = await provider.authenticate({ samlResponse: 'invalid_saml' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid SAML response signature');
    });

    it('should fail if SAML response is missing', async () => {
      const result = await provider.authenticate({});
      expect(result.success).toBe(false);
      expect(result.error).toBe('SAMLResponse is missing');
    });
  });

  describe('DIDProvider', () => {
    const provider = new DIDProvider('stellar_did', 'Stellar DID Auth');

    it('should authenticate successfully with valid DID signature', async () => {
      const result = await provider.authenticate({ did: 'did:stellar:G123456789', signature: 'valid_sig', challenge: '1234' });
      expect(result.success).toBe(true);
      expect(result.token).toBe('did_token_did:stellar:G123456789');
      expect(result.rawProfile.address).toBe('G123456789');
    });

    it('should fail with invalid signature', async () => {
      const result = await provider.authenticate({ did: 'did:stellar:G123456789', signature: 'invalid_signature', challenge: '1234' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid cryptographic signature for DID');
    });

    it('should fail if required fields are missing', async () => {
      const result = await provider.authenticate({ did: 'did:stellar:G123456789' });
      expect(result.success).toBe(false);
      expect(result.error).toBe('DID, signature, or challenge is missing');
    });
  });
});
