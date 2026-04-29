// Simple metrics tests
const { Metrics } = require('../src/metrics');

describe('Metrics', () => {
  let metrics;

  beforeEach(() => {
    metrics = new Metrics();
  });

  it('should create Metrics instance', () => {
    expect(metrics).toBeDefined();
  });

  it('should have counters object', () => {
    expect(metrics.counters).toBeDefined();
    expect(typeof metrics.counters).toBe('object');
  });

  it('should have gauges object', () => {
    expect(metrics.gauges).toBeDefined();
    expect(typeof metrics.gauges).toBe('object');
  });

  it('should increment counter', () => {
    metrics.increment('tasksCheckedTotal');
    expect(metrics.counters.tasksCheckedTotal).toBe(1);
  });

  it('should record gauge value', () => {
    metrics.record('lastCycleDurationMs', 100);
    expect(metrics.gauges.lastCycleDurationMs).toBe(100);
  });

   it('should return snapshot', () => {
     const snapshot = metrics.snapshot();
     expect(snapshot).toBeDefined();
     expect(typeof snapshot).toBe('object');
   });

   describe('SLO configuration', () => {
     it('should set and get SLO thresholds', () => {
       metrics.setSloThreshold('pollFreshness', 30000);
       expect(metrics.getSloThreshold('pollFreshness')).toBe(30000);
       metrics.setSloThreshold('executionTimeliness', 120000);
       expect(metrics.getSloThreshold('executionTimeliness')).toBe(120000);
     });

     it('should have default SLO thresholds', () => {
       expect(metrics.sloThresholds.pollFreshnessMs).toBe(60000);
     });
   });

   describe('SLO counters', () => {
     it('should increment poll freshness SLO success', () => {
       metrics.increment('pollFreshnessSloSuccess');
       expect(metrics.counters.pollFreshnessSloSuccess).toBe(1);
     });

     it('should increment poll freshness SLO failure', () => {
       metrics.increment('pollFreshnessSloFailure');
       expect(metrics.counters.pollFreshnessSloFailure).toBe(1);
     });

     it('should increment execution timeliness SLO success', () => {
       metrics.increment('executionTimelinessSloSuccess');
       expect(metrics.counters.executionTimelinessSloSuccess).toBe(1);
     });

     it('should increment execution timeliness SLO failure', () => {
       metrics.increment('executionTimelinessSloFailure');
       expect(metrics.counters.executionTimelinessSloFailure).toBe(1);
     });

     it('should increment retries exhausted', () => {
       metrics.increment('retriesExhausted');
       expect(metrics.counters.retriesExhausted).toBe(1);
     });

     it('should increment retry attempts with outcome', () => {
       metrics.increment('retryAttemptsTotal', { outcome: 'success' });
       expect(metrics.counters.retryAttemptsTotal.success).toBe(1);
       metrics.increment('retryAttemptsTotal', { outcome: 'failure' });
       expect(metrics.counters.retryAttemptsTotal.failure).toBe(1);
       metrics.increment('retryAttemptsTotal', { outcome: 'duplicate' });
       expect(metrics.counters.retryAttemptsTotal.duplicate).toBe(1);
     });
   });

   describe('SLO gauges', () => {
     it('should record poll freshness seconds', () => {
       metrics.record('pollFreshnessSeconds', 5);
       expect(metrics.gauges.pollFreshnessSeconds).toBe(5);
     });

     it('should record oldest task age', () => {
       metrics.record('oldestTaskAgeSeconds', 120);
       expect(metrics.gauges.oldestTaskAgeSeconds).toBe(120);
     });

     it('should record retry queue size', () => {
       metrics.record('retryQueueSize', 3);
       expect(metrics.gauges.retryQueueSize).toBe(3);
     });

     it('should record SLO rates', () => {
       metrics.record('pollFreshnessSloRate', 0.95);
       metrics.record('executionTimelinessSloRate', 0.87);
       expect(metrics.gauges.pollFreshnessSloRate).toBe(0.95);
       expect(metrics.gauges.executionTimelinessSloRate).toBe(0.87);
     });
   });

   describe('SLO rate computation', () => {
     it('should compute SLO rates from counters', () => {
       // Initially no observations
       expect(metrics.gauges.pollFreshnessSloRate).toBe(0);
       metrics.increment('pollFreshnessSloSuccess');
       metrics.increment('pollFreshnessSloSuccess');
       metrics.increment('pollFreshnessSloFailure');
       // 2 success / 3 total = 0.666...
       expect(metrics.gauges.pollFreshnessSloRate).toBeCloseTo(2/3, 5);
     });
   });

   describe('setPollIntervalMs', () => {
     it('should update poll interval', () => {
       metrics.setPollIntervalMs(45000);
       expect(metrics.pollIntervalMs).toBe(45000);
     });
   });
 });
