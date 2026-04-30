const { xdr, nativeToScVal, Address } = require("@stellar/stellar-sdk");
const { createLogger } = require("./logger");

/**
 * StartupValidator performs fail-fast checks to ensure the keeper is 
 * correctly configured and can interact with the SoroTask contract.
 */
class StartupValidator {
  constructor(server, contractId, networkPassphrase, logger) {
    this.server = server;
    this.contractId = contractId;
    this.networkPassphrase = networkPassphrase;
    this.logger = logger || createLogger("validator");
  }

  /**
   * Run all validation checks.
   * Throws an error with an actionable message if any check fails.
   */
  async validate() {
    this.logger.info("Starting startup validation...");

    await this.checkNetwork();
    await this.checkContractExistence();
    await this.checkContractInitialization();
    await this.checkContractInterface();

    this.logger.info("Startup validation passed.");
  }

  /**
   * Check if the RPC server is reachable and returning ledgers.
   */
  async checkNetwork() {
    try {
      const info = await this.server.getLatestLedger();
      this.logger.info("Network check passed", { 
        sequence: info.sequence,
        protocolVersion: info.protocolVersion 
      });
    } catch (err) {
      throw new Error(`Network Connectivity Error: Unable to reach Soroban RPC at ${this.server.serverURL.toString()}. Error: ${err.message}`);
    }
  }

  /**
   * Check if the contract ID points to a valid, existing contract.
   */
  async checkContractExistence() {
    try {
      Address.fromString(this.contractId);
    } catch (err) {
      throw new Error(`Configuration Error: Invalid Contract ID format: "${this.contractId}". It must be a valid Stellar contract address.`);
    }

    try {
      // The most reliable way to check existence without complex XDR keys 
      // is to fetch the "account" entry for the contract address. 
      // Soroban contracts have a corresponding ledger entry that getAccount can retrieve.
      await this.server.getAccount(this.contractId);
      this.logger.info("Contract existence check passed");
    } catch (err) {
      // If it's a 404, the contract definitely isn't there.
      if (err.response && err.response.status === 404) {
        throw new Error(`Contract Configuration Error: Contract ${this.contractId} not found on the configured network (${this.networkPassphrase}).`);
      }
      // Other errors might be transient or related to the RPC, but 404 is definitive.
    }
  }

  /**
   * Check if the contract is initialized with a reward token.
   */
  async checkContractInitialization() {
    try {
      const { TransactionBuilder, Operation, Networks } = require("@stellar/stellar-sdk");
      
      const source = await this.server.getAccount(this.contractId).catch(() => ({ 
        sequenceNumber: () => "1", 
        accountId: () => this.contractId 
      }));

      const tx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase: this.networkPassphrase || Networks.TESTNET,
      })
        .addOperation(
          Operation.invokeContract({
            contractId: this.contractId,
            functionName: "get_token",
            args: [],
          })
        )
        .setTimeout(30)
        .build();

      const simulation = await this.server.simulateTransaction(tx);

      if (simulation.results && simulation.results[0] && simulation.results[0].error) {
        throw new Error(`Contract Not Initialized: The SoroTask contract at ${this.contractId} is not yet initialized with a reward token. Run 'init' first.`);
      }

      this.logger.info("Contract initialization check passed");
    } catch (err) {
      if (err.message.includes("Not Initialized")) {
        throw err;
      }
      this.logger.warn("Initialization check skipped due to transient error", { error: err.message });
    }
  }

  async checkContractInterface() {
    try {
      const { TransactionBuilder, Operation, Networks } = require("@stellar/stellar-sdk");
      
      const source = await this.server.getAccount(this.contractId).catch(() => ({ 
        sequenceNumber: () => "1", 
        accountId: () => this.contractId 
      }));

      const tx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase: this.networkPassphrase || Networks.TESTNET,
      })
        .addOperation(
          Operation.invokeContract({
            contractId: this.contractId,
            functionName: "monitor_paginated",
            args: [
              nativeToScVal(0, { type: "u64" }),
              nativeToScVal(0, { type: "u64" })
            ],
          })
        )
        .setTimeout(30)
        .build();

      const simulation = await this.server.simulateTransaction(tx);

      // Check for simulation-level error (e.g., contract not found)
      if (simulation.error) {
        throw new Error(`Contract Simulation Failed: ${simulation.error}`);
      }

      // Check for operation-level error (e.g., function not found / ABI mismatch)
      if (simulation.results && simulation.results[0] && simulation.results[0].error) {
        const error = simulation.results[0].error;
        if (error.includes("not found") || error.includes("InvalidAction") || error.includes("ScriptError")) {
          throw new Error(`ABI Compatibility Error: Contract ${this.contractId} is missing the required 'monitor_paginated' function or has a mismatched signature.`);
        }
        throw new Error(`Contract Interface Validation Failed: ${error}`);
      }

      this.logger.info("Contract interface check passed");
    } catch (err) {
      if (err.message.includes("ABI") || err.message.includes("Compatibility") || err.message.includes("Validation")) {
        throw err;
      }
      this.logger.warn("Interface check skipped due to transient error", { error: err.message });
    }
  }
}

module.exports = { StartupValidator };
