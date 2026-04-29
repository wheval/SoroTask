# Prometheus Metrics

The SoroTask Keeper exposes operational metrics in Prometheus format for monitoring and alerting via Grafana or other observability platforms.

## Endpoint

```
GET /metrics/prometheus
```

The metrics are exposed at `http://localhost:3000/metrics/prometheus` by default (port configurable via `METRICS_PORT` environment variable).

## Exposed Metrics

### Task Execution Metrics

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_tasks_checked_total` | Counter | Total number of tasks checked for execution eligibility |
| `keeper_tasks_due_total` | Counter | Total number of tasks that were due for execution |
| `keeper_tasks_executed_total` | Counter | Total number of tasks executed successfully |
| `keeper_tasks_failed_total` | Counter | Total number of tasks that failed during execution |
| `keeper_tasks_skipped_idempotency_total` | Counter | Total number of tasks skipped due to idempotency lock |

### Fee and Performance Metrics

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_avg_fee_paid_xlm` | Gauge | Average transaction fee paid in XLM (rolling average over last 100 transactions) |
| `keeper_last_cycle_duration_ms` | Gauge | Duration of the last polling cycle in milliseconds |

### Gas Monitoring Metrics

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_low_gas_count` | Gauge | Number of tasks currently with low gas balance |

### Health Metrics

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_uptime_seconds` | Gauge | Keeper service uptime in seconds since start |
| `keeper_rpc_connected` | Gauge | RPC connection status (1 = connected, 0 = disconnected) |

### SLO (Service Level Objectives) Metrics

**Poll Freshness** — measures whether polling cycles complete within the expected interval.

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_poll_freshness_seconds` | Gauge | Seconds since the last successful polling cycle completed |
| `keeper_poll_interval_seconds` | Histogram | Seconds between consecutive polling cycle completions |
| `keeper_poll_freshness_slo_success_total` | Counter | Total polls that met the freshness SLO threshold |
| `keeper_poll_freshness_slo_failure_total` | Counter | Total polls that missed the freshness SLO threshold |
| `keeper_slo_poll_freshness_rate` | Gauge | Rolling rate of poll freshness SLO success (0-1) |

**Execution Timeliness** — measures how quickly tasks are executed after becoming due.

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_task_execution_lateness_ledgers` | Histogram | Difference in ledger numbers between task scheduled due time and actual execution |
| `keeper_execution_timeliness_slo_success_total` | Counter | Total tasks executed within the timeliness SLO threshold |
| `keeper_execution_timeliness_slo_failure_total` | Counter | Total tasks that missed the timeliness SLO threshold |
| `keeper_slo_execution_timeliness_rate` | Gauge | Rolling rate of execution timeliness SLO success (0-1) |

**Retry Metrics**

| Metric Name | Type | Description |
|-------------|------|-------------|
| `keeper_retry_delay_seconds` | Histogram | Seconds waited before a retry attempt is made |
| `keeper_retry_time_in_queue_seconds` | Histogram | Seconds a task spent waiting in retry queue before next attempt |
| `keeper_retry_attempts_total` | Counter | Total number of retry attempts made (labeled by outcome: success, failure, duplicate) |
| `keeper_retries_exhausted_total` | Counter | Total tasks that exhausted all retry attempts |
| `keeper_retries_executed_total` | Counter | Total retried tasks that eventually succeeded |
| `keeper_retries_failed_total` | Counter | Total retried tasks that ultimately failed |
| `keeper_retry_queue_size` | Gauge | Current number of tasks pending retry |

### Default Process Metrics

The following Node.js process metrics are also exposed automatically:

- `process_cpu_user_seconds_total` — User CPU time spent
- `process_cpu_system_seconds_total` — System CPU time spent
- `process_cpu_seconds_total` — Total CPU time spent
- `process_resident_memory_bytes` — Resident memory size
- `process_heap_bytes` — Process heap size
- `nodejs_eventloop_lag_seconds` — Event loop lag
- `nodejs_active_handles_total` — Number of active handles
- `nodejs_active_requests_total` — Number of active requests

## Configuration

Set the metrics server port via environment variable:

```bash
METRICS_PORT=3000
```

### SLO Thresholds

- `SLO_POLL_FRESHNESS_MS` — Maximum allowed milliseconds between poll cycle completions (default: 60000)
- `SLO_EXECUTION_TIMELINESS_MS` — Maximum allowed milliseconds a task may be late before counting as SLO failure (default: 3 * POLLING_INTERVAL_MS)

## Prometheus Configuration

Add the following to your `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'sorotask-keeper'
    scrape_interval: 15s
    static_configs:
      - targets: ['localhost:3000']
    metrics_path: '/metrics/prometheus'
```

## Grafana Dashboard

A sample Grafana dashboard configuration is available at [grafana-dashboard.json](./grafana-dashboard.json). Import this JSON file into Grafana to get started with pre-configured panels for all key metrics.

### Example SLO Queries

**Poll Freshness SLO Rate (5m window):**
```promql
rate(keeper_poll_freshness_slo_success_total[5m]) / rate(keeper_poll_freshness_slo_success_total[5m] + keeper_poll_freshness_slo_failure_total[5m])
```

**Execution Timeliness SLO Rate (5m window):**
```promql
rate(keeper_execution_timeliness_slo_success_total[5m]) / rate(keeper_execution_timeliness_slo_success_total[5m] + keeper_execution_timeliness_slo_failure_total[5m])
```

**Retry Queue Size:**
```promql
keeper_retry_queue_size
```

**Task Lateness Distribution:**
```promql
histogram_quantile(0.95, rate(keeper_task_execution_lateness_ledgers_bucket[5m]))
```

## Legacy JSON Endpoint

The original JSON metrics endpoint remains available at `/metrics` for backward compatibility:

```
GET /metrics
```

Returns metrics in JSON format with additional gas configuration details.

## Example Response

```
# HELP keeper_tasks_checked_total Total number of tasks checked for execution eligibility
# TYPE keeper_tasks_checked_total counter
keeper_tasks_checked_total 1250

# HELP keeper_tasks_executed_total Total number of tasks executed successfully
# TYPE keeper_tasks_executed_total counter
keeper_tasks_executed_total 342

# HELP keeper_slo_poll_freshness_rate Rolling rate of poll freshness SLO success (0-1)
# TYPE keeper_slo_poll_freshness_rate gauge
keeper_slo_poll_freshness_rate 0.98

# HELP keeper_uptime_seconds Keeper service uptime in seconds since start
# TYPE keeper_uptime_seconds gauge
keeper_uptime_seconds 86400
```
