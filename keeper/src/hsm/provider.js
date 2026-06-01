class HSMProvider {
  constructor(opts = {}) {
    this.logger = opts.logger || console;
  }

  // Generate a new key inside the HSM and return key id and public key
  async generateKey({ keyId, algorithm = 'ed25519', usage = 'sign' } = {}) {
    throw new Error('Not implemented');
  }

  // Return public key material for keyId
  async getPublicKey(keyId) {
    throw new Error('Not implemented');
  }

  // Request HSM to sign a digest — private key never leaves HSM
  async sign(keyId, data, options = {}) {
    throw new Error('Not implemented');
  }

  // Rotate key material (create new version) and return new key version id
  async rotateKey(keyId, options = {}) {
    throw new Error('Not implemented');
  }

  // Activate/deactivate key
  async activateKey(keyId) {
    throw new Error('Not implemented');
  }

  async deactivateKey(keyId) {
    throw new Error('Not implemented');
  }

  // List keys and metadata
  async listKeys() {
    throw new Error('Not implemented');
  }
}

module.exports = { HSMProvider };
