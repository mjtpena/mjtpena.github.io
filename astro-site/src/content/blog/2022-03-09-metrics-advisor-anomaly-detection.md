---
title: "Azure Metrics Advisor: Intelligent Anomaly Detection for Time Series Data"
author: Michael John Peña
draft: false
date: 2022-03-09
tags:
  - Azure
  - Metrics Advisor
  - AI
  - Anomaly Detection
  - Monitoring
---

## What Metrics Advisor Does

The service provides:
- **Smart anomaly detection**: ML-powered detection without manual threshold tuning
- **Root cause analysis**: Automatic correlation across dimensions
- **Alerting**: Configurable notifications when anomalies occur
- **Feedback loops**: Learn from your corrections to improve accuracy

## Setting Up Your First Data Feed

Connect to your data source:

```python
from azure.ai.metricsadvisor import MetricsAdvisorClient, MetricsAdvisorAdministrationClient
from azure.ai.metricsadvisor.models import (
    SqlServerDataFeedSource,
    DataFeedSchema,
    DataFeedMetric,
    DataFeedDimension,
    DataFeedGranularity,
    DataFeedIngestionSettings,
)
from azure.core.credentials import AzureKeyCredential
import os
from datetime import datetime

endpoint = os.environ["METRICS_ADVISOR_ENDPOINT"]
subscription_key = os.environ["METRICS_ADVISOR_SUBSCRIPTION_KEY"]
api_key = os.environ["METRICS_ADVISOR_API_KEY"]

credential = AzureKeyCredential(subscription_key)
admin_client = MetricsAdvisorAdministrationClient(
    endpoint=endpoint,
    credential=credential
)

# Define the data source
data_source = SqlServerDataFeedSource(
    connection_string=os.environ["SQL_CONNECTION_STRING"],
    query="""
        SELECT
            [timestamp],
            region,
            product_category,
            SUM(revenue) as revenue,
            COUNT(*) as transaction_count,
            AVG(processing_time_ms) as avg_processing_time
        FROM sales_metrics
        WHERE [timestamp] >= @StartTime AND [timestamp] < @EndTime
        GROUP BY [timestamp], region, product_category
    """
)

# Define schema
schema = DataFeedSchema(
    metrics=[
        DataFeedMetric(name="revenue", display_name="Revenue"),
        DataFeedMetric(name="transaction_count", display_name="Transaction Count"),
        DataFeedMetric(name="avg_processing_time", display_name="Avg Processing Time (ms)")
    ],
    dimensions=[
        DataFeedDimension(name="region", display_name="Region"),
        DataFeedDimension(name="product_category", display_name="Product Category")
    ],
    timestamp_column="timestamp"
)

# Create the data feed
data_feed = admin_client.create_data_feed(
    name="Sales Metrics Feed",
    source=data_source,
    granularity=DataFeedGranularity(granularity_type="Hourly"),
    schema=schema,
    ingestion_settings=DataFeedIngestionSettings(
        ingestion_begin_time=datetime(2022, 1, 1),
        data_source_request_concurrency=1
    ),
    options={
        "description": "Hourly sales metrics for anomaly detection",
        "rollup_settings": {
            "rollup_type": "AutoRollup",
            "rollup_method": "Sum"
        },
        "missing_data_point_fill_settings": {
            "fill_type": "SmartFilling"
        }
    }
)

print(f"Data feed created: {data_feed.id}")
```

## Connecting Different Data Sources

### Azure Blob Storage

```python
from azure.ai.metricsadvisor.models import AzureBlobDataFeedSource

blob_source = AzureBlobDataFeedSource(
    connection_string=os.environ["BLOB_CONNECTION_STRING"],
    container="metrics",
    blob_template="%Y/%m/%d/metrics.json"
)
```

### Azure Data Lake Gen2

```python
from azure.ai.metricsadvisor.models import AzureDataLakeStorageGen2DataFeedSource

adls_source = AzureDataLakeStorageGen2DataFeedSource(
    account_name="mydatalake",
    account_key=os.environ["ADLS_ACCOUNT_KEY"],
    file_system_name="metrics",
    directory_template="%Y/%m/%d",
    file_template="metrics.parquet"
)
```

### Azure Application Insights

```python
from azure.ai.metricsadvisor.models import AzureApplicationInsightsDataFeedSource

app_insights_source = AzureApplicationInsightsDataFeedSource(
    azure_cloud="Azure",
    application_id=os.environ["APP_INSIGHTS_APP_ID"],
    api_key=os.environ["APP_INSIGHTS_API_KEY"],
    query="""
        requests
        | where timestamp >= datetime(@StartTime) and timestamp < datetime(@EndTime)
        | summarize
            request_count = count(),
            avg_duration = avg(duration),
            failure_rate = countif(success == false) * 100.0 / count()
        by bin(timestamp, 1h), cloud_RoleName
    """
)
```

## Configuring Anomaly Detection

Create detection configurations:

```python
from azure.ai.metricsadvisor.models import (
    MetricDetectionCondition,
    SmartDetectionCondition,
    HardThresholdCondition,
    ChangeThresholdCondition,
    SuppressCondition
)

# Get the metric IDs from your data feed
data_feed = admin_client.get_data_feed(data_feed_id)
revenue_metric_id = next(m.id for m in data_feed.schema.metrics if m.name == "revenue")

# Create detection configuration
detection_config = admin_client.create_detection_configuration(
    name="Revenue Anomaly Detection",
    metric_id=revenue_metric_id,
    whole_series_detection_condition=MetricDetectionCondition(
        # Smart detection uses ML to adapt thresholds
        smart_detection_condition=SmartDetectionCondition(
            sensitivity=80,  # 0-100, higher = more sensitive
            anomaly_detector_direction="Both",  # "Up", "Down", "Both"
            suppress_condition=SuppressCondition(
                min_number=3,  # Minimum anomalies to trigger
                min_ratio=50   # Percentage of points that must be anomalous
            )
        )
    ),
    series_group_detection_conditions=[
        # Override for specific dimension combinations
        {
            "series_group_key": {"region": "APAC"},
            "smart_detection_condition": SmartDetectionCondition(
                sensitivity=90,  # More sensitive for APAC
                anomaly_detector_direction="Both"
            )
        }
    ]
)

print(f"Detection config created: {detection_config.id}")
```

## Setting Up Alerts

Configure alerting for detected anomalies:

```python
from azure.ai.metricsadvisor.models import (
    MetricAlertConfiguration,
    MetricAnomalyAlertScope,
    MetricAnomalyAlertConditions,
    MetricBoundaryCondition,
    TopNGroupScope,
    SeverityCondition,
    EmailNotificationHook,
    WebNotificationHook
)

# Create email hook
email_hook = admin_client.create_hook(
    EmailNotificationHook(
        name="Ops Team Email",
        emails_to_alert=["ops@contoso.com", "oncall@contoso.com"],
        description="Alert the operations team"
    )
)

# Create webhook for integration
webhook_hook = admin_client.create_hook(
    WebNotificationHook(
        name="PagerDuty Integration",
        endpoint="https://events.pagerduty.com/v2/enqueue",
        username="",
        password="",
        headers={"Content-Type": "application/json"},
        description="Send alerts to PagerDuty"
    )
)

# Create alert configuration
alert_config = admin_client.create_alert_configuration(
    name="Revenue Alert",
    metric_alert_configurations=[
        MetricAlertConfiguration(
            detection_configuration_id=detection_config.id,
            alert_scope=MetricAnomalyAlertScope(
                scope_type="All"
            ),
            alert_conditions=MetricAnomalyAlertConditions(
                severity_condition=SeverityCondition(
                    min_alert_severity="Medium",
                    max_alert_severity="High"
                )
            ),
            alert_snooze_condition={
                "auto_snooze": 3,  # Hours to snooze after alert
                "snooze_scope": "Series"
            }
        )
    ],
    hook_ids=[email_hook.id, webhook_hook.id]
)

print(f"Alert configuration created: {alert_config.id}")
```

## Querying Anomalies

Retrieve detected anomalies:

```python
from datetime import datetime, timedelta

client = MetricsAdvisorClient(endpoint, credential)

# Get anomalies for a specific detection config
start_time = datetime.now() - timedelta(days=7)
end_time = datetime.now()

anomalies = client.list_anomalies(
    detection_configuration_id=detection_config.id,
    start_time=start_time,
    end_time=end_time
)

for anomaly in anomalies:
    print(f"Timestamp: {anomaly.timestamp}")
    print(f"Severity: {anomaly.severity}")
    print(f"Value: {anomaly.value}")
    print(f"Expected: {anomaly.expected_value}")
    print(f"Dimension: {anomaly.dimension}")
    print("---")
```

## Root Cause Analysis

Diagnose the cause of anomalies:

```python
# Get incidents (groups of related anomalies)
incidents = client.list_incidents(
    detection_configuration_id=detection_config.id,
    start_time=start_time,
    end_time=end_time
)

for incident in incidents:
    print(f"Incident ID: {incident.id}")
    print(f"Status: {incident.status}")
    print(f"Severity: {incident.severity}")
    print(f"Start time: {incident.start_time}")

    # Get root cause analysis
    root_causes = client.list_incident_root_causes(
        detection_configuration_id=detection_config.id,
        incident_id=incident.id
    )

    print("Root causes:")
    for cause in root_causes:
        print(f"  Score: {cause.score:.2%}")
        print(f"  Dimension: {cause.dimension}")
        print(f"  Description: {cause.description}")
```

## Providing Feedback

Improve detection accuracy with feedback:

```python
from azure.ai.metricsadvisor.models import (
    AnomalyFeedback,
    ChangePointFeedback,
    CommentFeedback,
    PeriodFeedback
)

# Mark a false positive
feedback = AnomalyFeedback(
    metric_id=revenue_metric_id,
    dimension_key={"region": "EMEA", "product_category": "Electronics"},
    start_time=datetime(2022, 3, 1, 14, 0),
    end_time=datetime(2022, 3, 1, 15, 0),
    value="NotAnomaly"  # or "Anomaly" to confirm
)

client.add_feedback(feedback)

# Add a comment for context
comment = CommentFeedback(
    metric_id=revenue_metric_id,
    dimension_key={"region": "EMEA", "product_category": "Electronics"},
    start_time=datetime(2022, 3, 1, 14, 0),
    end_time=datetime(2022, 3, 1, 15, 0),
    value="This was expected due to scheduled maintenance"
)

client.add_feedback(comment)

# Mark seasonal patterns
period_feedback = PeriodFeedback(
    metric_id=revenue_metric_id,
    dimension_key={"region": "APAC"},
    start_time=datetime(2022, 1, 1),
    end_time=datetime(2022, 3, 9),
    value=24,  # 24-hour seasonality
    period_type="AssignValue"
)

client.add_feedback(period_feedback)
```

## Building a Dashboard

Create a monitoring dashboard with anomaly data:

```python
from flask import Flask, render_template, jsonify
import json

app = Flask(__name__)

@app.route('/api/anomalies/<detection_config_id>')
def get_anomalies(detection_config_id):
    client = MetricsAdvisorClient(endpoint, credential)

    start_time = datetime.now() - timedelta(days=7)
    end_time = datetime.now()

    anomalies = client.list_anomalies(
        detection_configuration_id=detection_config_id,
        start_time=start_time,
        end_time=end_time
    )

    anomaly_data = []
    for a in anomalies:
        anomaly_data.append({
            "timestamp": a.timestamp.isoformat(),
            "severity": a.severity,
            "value": a.value,
            "expected": a.expected_value,
            "dimension": dict(a.dimension) if a.dimension else {}
        })

    return jsonify(anomaly_data)

@app.route('/api/incidents/<detection_config_id>')
def get_incidents(detection_config_id):
    client = MetricsAdvisorClient(endpoint, credential)

    start_time = datetime.now() - timedelta(days=7)
    end_time = datetime.now()

    incidents = client.list_incidents(
        detection_configuration_id=detection_config_id,
        start_time=start_time,
        end_time=end_time
    )

    incident_data = []
    for i in incidents:
        root_causes = list(client.list_incident_root_causes(
            detection_configuration_id=detection_config_id,
            incident_id=i.id
        ))

        incident_data.append({
            "id": i.id,
            "severity": i.severity,
            "status": i.status,
            "start_time": i.start_time.isoformat(),
            "root_causes": [
                {"score": rc.score, "dimension": dict(rc.dimension)}
                for rc in root_causes[:3]
            ]
        })

    return jsonify(incident_data)
```

## Integration with Azure Monitor

Send anomalies to Azure Monitor:

```python
from azure.monitor.ingestion import LogsIngestionClient
from azure.identity import DefaultAzureCredential

def send_anomalies_to_monitor(anomalies, rule_id, stream_name):
    credential = DefaultAzureCredential()
    client = LogsIngestionClient(
        endpoint=os.environ["MONITOR_INGESTION_ENDPOINT"],
        credential=credential
    )

    logs = []
    for anomaly in anomalies:
        logs.append({
            "TimeGenerated": anomaly.timestamp.isoformat(),
            "Severity": anomaly.severity,
            "MetricValue": anomaly.value,
            "ExpectedValue": anomaly.expected_value,
            "Dimension": json.dumps(dict(anomaly.dimension)),
            "Source": "MetricsAdvisor"
        })

    client.upload(rule_id=rule_id, stream_name=stream_name, logs=logs)
```

## Best Practices

1. **Start with smart detection**: Let ML determine thresholds before customizing
2. **Use dimension rollups**: Detect anomalies at aggregate and detailed levels
3. **Provide feedback regularly**: Improve accuracy over time
4. **Set appropriate sensitivity**: Balance between noise and missed anomalies
5. **Configure alert snoozing**: Prevent alert fatigue during ongoing incidents

## Conclusion

Azure Metrics Advisor transforms metric monitoring from reactive to proactive. By leveraging AI for anomaly detection and root cause analysis, teams can identify and resolve issues faster, often before they impact users.

The service is particularly valuable for:
- DevOps and SRE teams monitoring application performance
- Business analysts tracking KPIs
- IoT scenarios with massive data volumes
- Any system where manual threshold management is impractical

## Resources

- [Metrics Advisor Documentation](https://docs.microsoft.com/en-us/azure/cognitive-services/metrics-advisor/)
- [Python SDK Reference](https://docs.microsoft.com/en-us/python/api/azure-ai-metricsadvisor/)
- [Anomaly Detection Best Practices](https://docs.microsoft.com/en-us/azure/cognitive-services/metrics-advisor/how-tos/anomaly-detection)
