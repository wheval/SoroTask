// Simple metrics tests
const { Metrics, MetricsHistory } = require('../src/metrics');

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

  it('should report healthy status when polling is fresh and RPC is connected', () => {
    metrics.lastPollAt = new Date(Date.now());
    metrics.rpcConnected = true;
    metrics.gauges.rpcCircuitState = 0;

    const health = metrics.getHealthStatus(60000);
    expect(health.status).toBe('healthy');
    expect(health.statusDescription).toContain('operating normally');
    expect(health.healthIssues).toEqual([]);
  });

  it('should report degraded state for recent polls with RPC disconnection', () => {
    metrics.lastPollAt = new Date(Date.now());
    metrics.rpcConnected = false;
    metrics.gauges.rpcCircuitState = 0;

    const health = metrics.getHealthStatus(60000);
    expect(health.status).toBe('degraded');
    expect(health.healthIssues).toContain('RPC connectivity lost');
  });

  it('should report stale state when last poll is older than threshold', () => {
    metrics.lastPollAt = new Date(Date.now() - 120000);
    metrics.rpcConnected = true;
    metrics.gauges.rpcCircuitState = 0;

    const health = metrics.getHealthStatus(60000);
    expect(health.status).toBe('stale');
    expect(health.lastPollAgeMs).toBeGreaterThan(60000);
    expect(health.healthIssues).toContain('Polling has not updated within threshold');
  });

  it('should report unhealthy state when no polling has occurred', () => {
    metrics.lastPollAt = null;
    metrics.rpcConnected = false;
    metrics.gauges.rpcCircuitState = 2;

    const health = metrics.getHealthStatus(60000);
    expect(health.status).toBe('unhealthy');
    expect(health.healthIssues).toContain('No successful poll has completed yet');
  });

  it('should report degraded state when backlog pressure is high', () => {
    metrics.lastPollAt = new Date(Date.now());
    metrics.rpcConnected = true;
    metrics.gauges.rpcCircuitState = 0;
    metrics.updateHealth({ backlogSize: 250, retryBudgetPressure: 0.25 });

    const health = metrics.getHealthStatus(60000);
    expect(health.status).toBe('degraded');
    expect(health.healthIssues).toContain('Polling backlog pressure: 250 known task IDs');
  });

  it('should report unhealthy state when retry budget pressure is critical', () => {
    metrics.lastPollAt = new Date(Date.now());
    metrics.rpcConnected = true;
    metrics.gauges.rpcCircuitState = 0;
    metrics.updateHealth({ backlogSize: 120, retryBudgetPressure: 0.96 });

    const health = metrics.getHealthStatus(60000);
    expect(health.status).toBe('unhealthy');
    expect(health.statusDescription).toContain('overloaded by backlog or retry pressure');
  });
});
