---
title: "Microsoft Fabric Real-Time Intelligence: Patterns for Streaming Analytics"
author: Michael John Peña
draft: false
date: 2025-06-18
tags:
  - Microsoft Fabric
  - Real-Time Intelligence
  - KQL
  - Streaming
  - Data Engineering
---

Microsoft Fabric's Real-Time Intelligence workload has matured significantly since GA. We've implemented several production streaming scenarios, and I want to share the patterns that work.

## Real-Time Intelligence Architecture

The Real-Time Intelligence stack in Fabric:

1. **Real-Time Hub**: Discover and connect to streaming sources
2. **Eventstream**: Ingest and transform streaming data
3. **KQL Database**: Store and query time-series data
4. **Real-Time Dashboard**: Visualize live data
5. **Data Activator**: Trigger actions on conditions

These components work together to enable end-to-end streaming analytics without leaving Fabric.

## Pattern 1: IoT Telemetry Pipeline

For IoT scenarios, the typical flow:

```
IoT Devices → Event Hubs → Eventstream → KQL Database → Dashboard
                              ↓
                        Lakehouse (historical)
```

**Eventstream Configuration:**

```json
{
  "source": {
    "type": "eventhub",
    "connectionString": "@Microsoft.KeyVault(...)",
    "consumerGroup": "fabric-ingestion"
  },
  "transformations": [
    {
      "type": "parse_json",
      "inputColumn": "body",
      "outputColumns": ["device_id", "temperature", "humidity", "timestamp"]
    },
    {
      "type": "filter",
      "condition": "temperature IS NOT NULL"
    },
    {
      "type": "aggregate",
      "window": "TumblingWindow(minute, 1)",
      "groupBy": ["device_id"],
      "aggregations": [
        {"column": "temperature", "function": "avg", "alias": "avg_temp"},
        {"column": "temperature", "function": "max", "alias": "max_temp"},
        {"column": "temperature", "function": "min", "alias": "min_temp"}
      ]
    }
  ],
  "destinations": [
    {"type": "kql_database", "table": "device_telemetry_1min"},
    {"type": "lakehouse", "table": "raw_telemetry", "format": "delta"}
  ]
}
```

**KQL Queries for Analysis:**

```kql
// Real-time device status
device_telemetry_1min
| where timestamp > ago(5m)
| summarize
    latest_temp = arg_max(timestamp, avg_temp),
    anomaly_count = countif(max_temp > 85 or min_temp < 32)
    by device_id
| extend status = iff(anomaly_count > 0, "Warning", "Normal")

// Temperature trends with anomaly detection
device_telemetry_1min
| where timestamp > ago(1h)
| make-series avg_temp=avg(avg_temp) on timestamp step 1m by device_id
| extend (anomalies, score, baseline) = series_decompose_anomalies(avg_temp)
| mv-expand timestamp, avg_temp, anomalies, score, baseline
| where anomalies != 0
```

## Pattern 2: Real-Time Fraud Detection

For transactional systems requiring immediate analysis:

```python
# Eventstream transformation for fraud scoring
from evenstream import EventstreamProcessor

processor = EventstreamProcessor()

@processor.on_event
async def process_transaction(event):
    # Enrich with historical data
    customer_history = await kql_query(f"""
        transactions
        | where customer_id == '{event.customer_id}'
        | where timestamp > ago(30d)
        | summarize
            avg_amount = avg(amount),
            stddev_amount = stdev(amount),
            transaction_count = count()
    """)

    # Calculate risk score
    amount_zscore = abs(event.amount - customer_history.avg_amount) / customer_history.stddev_amount

    # Check velocity
    recent_count = await kql_query(f"""
        transactions
        | where customer_id == '{event.customer_id}'
        | where timestamp > ago(1h)
        | count
    """)

    risk_score = calculate_risk(amount_zscore, recent_count, event)

    return {
        **event,
        "risk_score": risk_score,
        "flagged": risk_score > 0.8
    }

@processor.destination("kql_database", table="transactions_scored")
@processor.destination("activator", condition="risk_score > 0.8")
async def route_output(event):
    return event
```

**Data Activator for Alerts:**

```yaml
trigger:
  name: FraudAlert
  source: transactions_scored
  condition: risk_score > 0.8
  actions:
    - type: email
      to: fraud-team@company.com
      subject: "High Risk Transaction Detected"
      body: |
        Transaction ID: {{transaction_id}}
        Customer: {{customer_id}}
        Amount: ${{amount}}
        Risk Score: {{risk_score}}

    - type: teams_message
      channel: fraud-alerts
      message: "🚨 High risk transaction: {{transaction_id}} - ${{amount}}"

    - type: http_webhook
      url: https://fraud-system.internal/api/review
      method: POST
      body:
        transaction_id: "{{transaction_id}}"
        action: "flag_for_review"
```

## Pattern 3: Operational Dashboards

For real-time operational visibility:

**KQL Database Schema:**

```kql
// Create tables optimized for real-time queries
.create table service_metrics (
    timestamp: datetime,
    service_name: string,
    endpoint: string,
    response_time_ms: real,
    status_code: int,
    error_message: string
)

// Create aggregation policy for efficient querying
.alter table service_metrics policy update
```
  [
    {
      "IsEnabled": true,
      "Source": "service_metrics",
      "Query": "service_metrics | summarize count(), avg(response_time_ms), percentile(response_time_ms, 95) by bin(timestamp, 1m), service_name",
      "IsTransactional": false
    }
  ]
```

**Real-Time Dashboard KQL:**

```kql
// Service health overview
service_metrics_1min
| where timestamp > ago(15m)
| summarize
    request_count = sum(count_),
    avg_latency = avg(avg_response_time_ms),
    p95_latency = avg(percentile_response_time_ms_95),
    error_rate = sumif(count_, status_code >= 500) / sum(count_) * 100
    by service_name
| extend health = case(
    error_rate > 5, "Critical",
    error_rate > 1, "Warning",
    p95_latency > 1000, "Degraded",
    "Healthy")

// Latency trend visualization
service_metrics_1min
| where timestamp > ago(1h)
| where service_name == "api-gateway"
| project timestamp, avg_response_time_ms, percentile_response_time_ms_95
| render timechart
```

## Pattern 4: Hybrid Real-Time + Batch

Combine streaming with batch for complete analytics:

```
Real-Time Path:
  Events → Eventstream → KQL Database → Dashboard (seconds latency)

Batch Path:
  Events → Lakehouse (raw) → Spark Transform → Lakehouse (curated) → Power BI (minutes/hours latency)
```

**Lakehouse Integration:**

```python
# Eventstream writes to both KQL and Lakehouse
# Notebook for historical analysis

# Read from Lakehouse
historical = spark.table("lakehouse.raw_events") \
    .filter("event_date >= date_sub(current_date(), 30)")

# Read recent from KQL using Kusto connector
from kusto.data import KustoClient

kusto = KustoClient("https://your-kql.fabric.microsoft.com")
recent = kusto.execute_query("events | where timestamp > ago(1d)")
recent_df = spark.createDataFrame(recent.primary_results[0].to_dataframe())

# Combine for comprehensive analysis
combined = historical.union(recent_df)
```

## Performance Optimization

**KQL Database Tuning:**

```kql
// Partition by time for efficient queries
.alter table events policy partitioning
```
{
  "EffectiveDateTime": "2025-01-01",
  "PartitionKeys": [
    {
      "ColumnName": "timestamp",
      "Kind": "Hash",
      "Properties": {
        "Function": "TimeRangePartitioner",
        "NumberOfPartitions": 64
      }
    }
  ]
}

// Create hot cache policy
.alter table events policy caching hot = 7d

// Set retention
.alter table events policy retention softdelete = 365d
```

**Eventstream Scaling:**

```json
{
  "scaling": {
    "mode": "auto",
    "minPartitions": 2,
    "maxPartitions": 16,
    "scaleUpThreshold": 0.8,
    "scaleDownThreshold": 0.2
  }
}
```

## When to Use Real-Time Intelligence

**Good Fit:**
- Sub-second to minute latency requirements
- Time-series data (IoT, logs, metrics)
- Anomaly detection and alerting
- Operational dashboards
- Event-driven architectures

**Not Ideal For:**
- Complex joins across large datasets
- Historical reporting (use Lakehouse + Power BI)
- ML training (use Data Science workload)
- One-time analysis (use SQL endpoint)

## Conclusion

Real-Time Intelligence in Fabric provides a complete streaming analytics platform:
- Ingest with Eventstream
- Store and query with KQL
- Visualize with Real-Time Dashboards
- Act with Data Activator

The patterns above cover common scenarios. The key is understanding when real-time is necessary vs. when near-real-time (minute-level from Lakehouse) is sufficient.

For most business analytics, near-real-time is enough. Reserve Real-Time Intelligence for truly time-sensitive use cases where the cost of latency is high.

## Resources

- [Real-Time Intelligence Documentation](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/)
- [KQL Reference](https://learn.microsoft.com/en-us/azure/data-explorer/kusto/query/)
- [Eventstream Guide](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/event-streams/)
- [Data Activator](https://learn.microsoft.com/en-us/fabric/data-activator/)
