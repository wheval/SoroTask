import dotenv from 'dotenv';

dotenv.config();

 export function loadConfig() {
   const required = [
     'SOROBAN_RPC_URL',
     'NETWORK_PASSPHRASE',
     'KEEPER_SECRET',
     'CONTRACT_ID',
     'POLLING_INTERVAL_MS',
   ];

   const missing = required.filter((key) => !process.env[key]);

   if (missing.length > 0) {
     throw new Error(
       `Missing required environment variables: ${missing.join(', ')}`,
     );
   }

   const pollIntervalMs = parseInt(process.env.POLLING_INTERVAL_MS, 10) || 10000;

   return {
     rpcUrl: process.env.SOROBAN_RPC_URL,
     networkPassphrase: process.env.NETWORK_PASSPHRASE,
     keeperSecret: process.env.KEEPER_SECRET,
     contractId: process.env.CONTRACT_ID,
     pollIntervalMs,
     minPollingIntervalMs:
       parseInt(process.env.MIN_POLLING_INTERVAL_MS, 10) || 1000,
     maxPollingIntervalMs:
       parseInt(process.env.MAX_POLLING_INTERVAL_MS, 10) || 60000,
     // Retry configuration
     maxRetries: parseInt(process.env.MAX_RETRIES, 10) || 3,
     retryBaseDelayMs: parseInt(process.env.RETRY_BASE_DELAY_MS, 10) || 1000,
     maxRetryDelayMs: parseInt(process.env.MAX_RETRY_DELAY_MS, 10) || 30000,
     // Circuit breaker configuration
     circuitFailureThreshold:
       parseInt(process.env.CIRCUIT_FAILURE_THRESHOLD, 10) || 5,
     circuitRecoveryTimeoutMs:
       parseInt(process.env.CIRCUIT_RECOVERY_TIMEOUT_MS, 10) || 30000,
     // SLO configuration thresholds (in milliseconds)
     sloPollFreshnessMs:
       parseInt(process.env.SLO_POLL_FRESHNESS_MS, 10) || 60000, // Poll should complete within 60s
     // Default to 3x poll interval if not set
     sloExecutionTimelinessMs:
       parseInt(process.env.SLO_EXECUTION_TIMELINESS_MS, 10) || (() => {
         const base = parseInt(process.env.POLLING_INTERVAL_MS, 10) || 10000;
         return base * 3;
       })(),
     // Logging configuration
     logLevel: process.env.LOG_LEVEL || 'info',
     nodeEnv: process.env.NODE_ENV || 'production',
   };
 }
