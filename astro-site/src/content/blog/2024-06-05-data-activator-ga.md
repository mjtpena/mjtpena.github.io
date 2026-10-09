---
title: "Data Activator GA: Automated Actions from Data"
author: Michael John Peña
draft: false
date: 2024-06-05
tags:
  - Microsoft Fabric
  - Data Activator
  - Automation
  - Alerts
  - Real-Time
---

## What is Data Activator?

Data Activator monitors your data and triggers actions when conditions are met:

```
Data Source → Condition Detection → Action Trigger
     ↓              ↓                    ↓
Eventhouse      Rules/Triggers       Email/Teams/
Power BI        (no-code)           Power Automate
Event Streams
```

## Core Concepts

### Reflexes

A Reflex is a Data Activator item containing:
- **Objects**: Entities to monitor (devices, customers, orders)
- **Triggers**: Conditions that fire actions
- **Actions**: What happens when triggers fire

### Objects and Properties

```
Object: Device
├── Properties
│   ├── Temperature (numeric)
│   ├── Status (string)
│   └── LastSeen (datetime)
└── Triggers
    ├── HighTemperature
    ├── OfflineAlert
    └── AnomalyDetected
```

## Creating a Reflex

### From Event Stream

```python
# Connect Data Activator to Event Stream
reflex_config = {
    "name": "IoT Device Monitor",
    "source": {
        "type": "EventStream",
        "eventStreamId": event_stream_id,
        "keyColumn": "DeviceId"  # Groups events by device
    },
    "objects": [
        {
            "name": "Device",
            "keyProperty": "DeviceId",
            "properties": [
                {"name": "Temperature", "path": "$.readings.temperature", "type": "numeric"},
                {"name": "Humidity", "path": "$.readings.humidity", "type": "numeric"},
                {"name": "Status", "path": "$.status", "type": "string"},
                {"name": "Timestamp", "path": "$.timestamp", "type": "datetime"}
            ]
        }
    ]
}
```

### From Power BI

```python
# Connect to Power BI report
reflex_config = {
    "name": "Sales Monitor",
    "source": {
        "type": "PowerBI",
        "reportId": report_id,
        "datasetId": dataset_id
    },
    "objects": [
        {
            "name": "Region",
            "keyProperty": "RegionName",
            "properties": [
                {"name": "TotalSales", "measure": "Sum of Sales"},
                {"name": "OrderCount", "measure": "Count of Orders"},
                {"name": "AvgOrderValue", "measure": "Average Order Value"}
            ]
        }
    ]
}
```

## Trigger Types

### Threshold Triggers

```yaml
# Simple threshold
trigger:
  name: "High Temperature Alert"
  object: Device
  property: Temperature
  condition:
    type: threshold
    operator: greaterThan
    value: 80
  action:
    type: email
    recipients: ["ops@company.com"]

# Threshold with duration
trigger:
  name: "Sustained High Temperature"
  object: Device
  property: Temperature
  condition:
    type: threshold
    operator: greaterThan
    value: 80
    duration: "5m"  # Must exceed for 5 minutes
  action:
    type: teams
    channelId: "channel-123"
```

### Change Detection

```yaml
# Value change
trigger:
  name: "Status Change Alert"
  object: Device
  property: Status
  condition:
    type: change
    from: "online"
    to: "offline"
  action:
    type: email
    recipients: ["support@company.com"]
    template: "Device {{DeviceId}} went offline at {{Timestamp}}"

# Percentage change
trigger:
  name: "Sales Spike"
  object: Region
  property: TotalSales
  condition:
    type: percentageChange
    operator: greaterThan
    value: 20
    compareWindow: "1h"
  action:
    type: powerAutomate
    flowId: "flow-abc123"
```

### Pattern Detection

```yaml
# Anomaly detection
trigger:
  name: "Anomaly Detected"
  object: Device
  property: Temperature
  condition:
    type: anomaly
    sensitivity: medium  # low, medium, high
    lookbackWindow: "24h"
  action:
    type: teams
    message: "Anomaly detected for {{DeviceId}}: Temperature = {{Temperature}}"

# Missing data
trigger:
  name: "Device Offline"
  object: Device
  property: Timestamp
  condition:
    type: missing
    duration: "10m"  # No data for 10 minutes
  action:
    type: email
    recipients: ["support@company.com"]
```

## Actions

### Email Actions

```yaml
action:
  type: email
  recipients:
    - "team@company.com"
    - "{{Device.Owner}}"  # Dynamic recipient
  subject: "Alert: {{TriggerName}}"
  body: |
    Device: {{DeviceId}}
    Current Value: {{Temperature}}
    Threshold: 80
    Time: {{Timestamp}}

    View dashboard: https://fabric.microsoft.com/dashboard/...
```

### Teams Actions

```yaml
action:
  type: teams
  channelId: "19:abc123@thread.tacv2"
  adaptiveCard:
    type: "AdaptiveCard"
    body:
      - type: "TextBlock"
        text: "Alert: {{TriggerName}}"
        weight: "bolder"
        size: "large"
      - type: "FactSet"
        facts:
          - title: "Device"
            value: "{{DeviceId}}"
          - title: "Value"
            value: "{{Temperature}}"
          - title: "Time"
            value: "{{Timestamp}}"
    actions:
      - type: "Action.OpenUrl"
        title: "View Details"
        url: "https://fabric.microsoft.com/..."
```

### Power Automate Actions

```yaml
action:
  type: powerAutomate
  flowId: "flow-xyz789"
  parameters:
    deviceId: "{{DeviceId}}"
    alertType: "{{TriggerName}}"
    currentValue: "{{Temperature}}"
    timestamp: "{{Timestamp}}"
```

## Complex Scenarios

### Multi-Condition Triggers

```yaml
trigger:
  name: "Critical Situation"
  object: Device
  conditions:
    operator: AND
    items:
      - property: Temperature
        type: threshold
        operator: greaterThan
        value: 90
      - property: Humidity
        type: threshold
        operator: greaterThan
        value: 80
      - property: Status
        type: equals
        value: "production"
  action:
    type: teams
    urgency: "important"
```

### Aggregated Triggers

```yaml
trigger:
  name: "Multiple Devices Offline"
  object: Device
  aggregation:
    function: count
    filter:
      property: Status
      equals: "offline"
  condition:
    type: threshold
    operator: greaterThan
    value: 5  # More than 5 devices offline
  action:
    type: email
    urgency: "critical"
```

### Scheduled Digests

```yaml
trigger:
  name: "Daily Summary"
  schedule:
    type: daily
    time: "08:00"
    timezone: "Pacific Standard Time"
  query: |
    summarize
      TotalAlerts = count(),
      CriticalAlerts = countif(Severity == "Critical"),
      TopDevice = arg_max(AlertCount, DeviceId)
      over last 24h
  action:
    type: email
    template: "daily-summary"
```

## Integration with Other Fabric Items

### From Eventhouse

```kusto
// Create a view that Data Activator can monitor
.create function MonitorableDevices() {
    SensorData
    | where EventTime > ago(5m)
    | summarize
        LatestValue = arg_max(EventTime, Value),
        AvgValue = avg(Value),
        MaxValue = max(Value)
        by DeviceId
}
```

### From Lakehouse

```python
# Create Delta table for Data Activator
spark.sql("""
    CREATE TABLE IF NOT EXISTS gold.device_metrics
    AS SELECT
        DeviceId,
        current_timestamp() as MetricTime,
        avg(Value) as AvgValue,
        max(Value) as MaxValue,
        count(*) as ReadingCount
    FROM silver.sensor_readings
    WHERE EventTime > current_timestamp() - INTERVAL 1 HOUR
    GROUP BY DeviceId
""")
```

## Best Practices

1. **Start with high-value alerts** - Focus on actionable conditions
2. **Avoid alert fatigue** - Don't trigger too often
3. **Use appropriate channels** - Email for reports, Teams for urgent
4. **Include context** - Make alerts actionable
5. **Test thoroughly** - Verify triggers work as expected

## Monitoring and Management

```python
# Get trigger statistics
stats = client.data_activator.get_trigger_stats(
    reflex_id=reflex_id,
    time_range="7d"
)

print(f"Total triggers fired: {stats['total_fired']}")
print(f"Actions succeeded: {stats['actions_succeeded']}")
print(f"Actions failed: {stats['actions_failed']}")

# Pause/resume triggers
client.data_activator.pause_trigger(reflex_id, trigger_id)
client.data_activator.resume_trigger(reflex_id, trigger_id)
```

## What's Next

Tomorrow I'll cover Reflex triggers in more detail.

## Resources

- [Data Activator Documentation](https://learn.microsoft.com/fabric/data-activator/)
- [Trigger Types](https://learn.microsoft.com/fabric/data-activator/data-activator-triggers)
- [Action Configuration](https://learn.microsoft.com/fabric/data-activator/data-activator-actions)
