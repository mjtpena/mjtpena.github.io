---
title: "Real-Time Dashboards in Microsoft Fabric"
description: "Real-time dashboards bring your streaming data to life. Today I'm exploring how to build effective real-time visualizations in Fabric."
author: Michael John Peña
draft: false
date: 2024-06-04
tags:
  - Microsoft Fabric
  - Dashboards
  - Real-Time Intelligence
  - Visualization
  - Analytics
---

Real-time dashboards bring your streaming data to life. Today I'm exploring how to build effective real-time visualizations in Fabric.

## Dashboard Components

```
Real-Time Dashboard:
├── Tiles (visualizations)
├── Parameters (filters)
├── Auto-refresh settings
├── Data sources (Eventhouses, KQL queries)
└── Sharing and permissions
```

## Creating a Dashboard

### Basic Structure

```python
# Create Real-Time Dashboard via Fabric REST API
import requests
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default")

headers = {
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
}

workspace_id = "your-workspace-id"
url = f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items"

# Create dashboard
dashboard_payload = {
    "displayName": "Operations Dashboard",
    "type": "Dashboard",
    "definition": {
        "pages": [
            {"name": "Overview", "tiles": []},
            {"name": "Details", "tiles": []}
        ],
        "autoRefresh": {"enabled": True, "defaultInterval": "1m"}
    }
}

response = requests.post(url, headers=headers, json=dashboard_payload)
dashboard_id = response.json().get("id")
print(f"Created dashboard: {dashboard_id}")
```

### Adding Tiles

```python
# Add metric tile
metric_tile = {
    "type": "stat",
    "title": "Active Devices",
    "position": {"x": 0, "y": 0, "width": 4, "height": 2},
    "query": {
        "database": "IoTAnalytics",
        "query": """
            SensorData
            | where EventTime > ago(5m)
            | summarize dcount(DeviceId)
        """
    },
    "visualization": {
        "type": "stat",
        "colorMode": "value",
        "thresholds": [
            {"value": 0, "color": "red"},
            {"value": 50, "color": "yellow"},
            {"value": 100, "color": "green"}
        ]
    }
}

# Add time chart tile
timechart_tile = {
    "type": "timechart",
    "title": "Sensor Values (Last Hour)",
    "position": {"x": 4, "y": 0, "width": 8, "height": 4},
    "query": {
        "database": "IoTAnalytics",
        "query": """
            SensorData
            | where EventTime > ago(1h)
            | summarize avg(Value) by bin(EventTime, 1m), DeviceId
        """
    },
    "visualization": {
        "type": "linechart",
        "xAxis": {"label": "Time"},
        "yAxis": {"label": "Value"},
        "legend": {"position": "right"}
    }
}

# Add table tile
table_tile = {
    "type": "table",
    "title": "Recent Alerts",
    "position": {"x": 0, "y": 4, "width": 12, "height": 4},
    "query": {
        "database": "IoTAnalytics",
        "query": """
            SensorData
            | where EventTime > ago(1h)
            | where Value > 100 or Value < 0
            | project EventTime, DeviceId, Value, SensorType
            | order by EventTime desc
            | take 20
        """
    },
    "visualization": {
        "type": "table",
        "columns": [
            {"field": "EventTime", "header": "Time", "format": "datetime"},
            {"field": "DeviceId", "header": "Device"},
            {"field": "Value", "header": "Value", "format": "number:2"},
            {"field": "SensorType", "header": "Type"}
        ]
    }
}
```

## Parameter Configuration

```python
# Define dashboard parameters
parameters = [
    {
        "name": "TimeRange",
        "type": "timespan",
        "displayName": "Time Range",
        "defaultValue": "1h",
        "options": [
            {"label": "Last 15 minutes", "value": "15m"},
            {"label": "Last hour", "value": "1h"},
            {"label": "Last 24 hours", "value": "24h"},
            {"label": "Last 7 days", "value": "7d"}
        ]
    },
    {
        "name": "DeviceFilter",
        "type": "string",
        "displayName": "Device",
        "defaultValue": "*",
        "source": {
            "type": "query",
            "query": "SensorData | distinct DeviceId | order by DeviceId"
        }
    },
    {
        "name": "SensorType",
        "type": "multi-select",
        "displayName": "Sensor Types",
        "defaultValue": ["temperature", "humidity"],
        "source": {
            "type": "query",
            "query": "SensorData | distinct SensorType"
        }
    }
]

# Use parameters in queries
parameterized_query = """
    SensorData
    | where EventTime > ago(['TimeRange'])
    | where DeviceId == ['DeviceFilter'] or ['DeviceFilter'] == "*"
    | where SensorType in (['SensorType'])
    | summarize avg(Value) by bin(EventTime, 5m), DeviceId
"""
```

## Visualization Types

### Statistical Tiles

```kusto
// Single value
SensorData
| where EventTime > ago(5m)
| summarize avg(Value)

// With comparison
SensorData
| summarize
    Current = avgif(Value, EventTime > ago(1h)),
    Previous = avgif(Value, EventTime between (ago(2h) .. ago(1h)))
| extend Change = (Current - Previous) / Previous * 100
```

### Time Charts

```kusto
// Multi-series line chart
SensorData
| where EventTime > ago(24h)
| summarize avg(Value) by bin(EventTime, 15m), DeviceId
| render timechart with (
    title="Device Values Over Time",
    xtitle="Time",
    ytitle="Average Value"
)

// Area chart with stacking
SensorData
| where EventTime > ago(24h)
| summarize sum(Value) by bin(EventTime, 1h), SensorType
| render areachart with (kind=stacked)
```

### Maps

```kusto
// Geospatial visualization
SensorData
| where EventTime > ago(1h)
| extend Lat = todouble(Location.lat), Lon = todouble(Location.lon)
| summarize AvgValue = avg(Value), Count = count() by Lat, Lon, DeviceId
| render scatterchart with (kind=map)
```

### Heatmaps

```kusto
// Time-based heatmap
SensorData
| where EventTime > ago(7d)
| extend Hour = hourofday(EventTime), Day = dayofweek(EventTime)
| summarize avg(Value) by Hour, Day
| render columnchart with (kind=unstacked)
```

## Auto-Refresh Configuration

```python
auto_refresh_config = {
    "enabled": True,
    "minInterval": "30s",
    "defaultInterval": "1m",
    "maxInterval": "1h",
    "userOverride": True,
    "pauseOnInactivity": {
        "enabled": True,
        "timeout": "10m"
    }
}
```

## Drill-Down and Cross-Filtering

```python
# Configure cross-filtering
cross_filter_config = {
    "tiles": [
        {
            "id": "device-chart",
            "filterField": "DeviceId",
            "targetTiles": ["sensor-details", "alert-table"]
        },
        {
            "id": "time-selector",
            "filterField": "EventTime",
            "filterType": "range",
            "targetTiles": ["all"]
        }
    ]
}

# Drill-down configuration
drill_down_config = {
    "tile": "summary-chart",
    "levels": [
        {
            "field": "Location",
            "query": "SensorData | summarize count() by Location"
        },
        {
            "field": "Building",
            "query": "SensorData | where Location == [selected] | summarize count() by Building"
        },
        {
            "field": "DeviceId",
            "query": "SensorData | where Building == [selected] | summarize avg(Value) by DeviceId"
        }
    ]
}
```

## Alerts from Dashboards

```python
# Create alert based on tile
alert_config = {
    "name": "High Temperature Alert",
    "tile": "temperature-stat",
    "condition": {
        "type": "threshold",
        "operator": "greaterThan",
        "value": 100,
        "frequency": "1m"
    },
    "actions": [
        {
            "type": "email",
            "recipients": ["ops@company.com"]
        },
        {
            "type": "teams",
            "webhook": "https://outlook.office.com/webhook/..."
        }
    ]
}
```

## Embedding Dashboards

```html
<!-- Embed in web application -->
<iframe
    src="https://app.fabric.microsoft.com/embed/dashboard/{dashboard-id}?autoRefresh=true"
    frameborder="0"
    allowfullscreen="true"
    style="width: 100%; height: 600px;">
</iframe>

<!-- With authentication -->
<script>
async function embedDashboard() {
    const token = await getAccessToken();

    const embedConfig = {
        type: 'dashboard',
        id: 'dashboard-id',
        embedUrl: 'https://app.fabric.microsoft.com/embed/dashboard/...',
        accessToken: token,
        settings: {
            filterPaneEnabled: true,
            navContentPaneEnabled: false
        }
    };

    const dashboard = powerbi.embed(container, embedConfig);
}
</script>
```

## Performance Optimization

### Query Caching

```python
tile_config = {
    "query": "...",
    "caching": {
        "enabled": True,
        "maxAge": "5m",
        "shareAcrossUsers": True
    }
}
```

### Materialized Views for Dashboards

```kusto
// Create materialized view for dashboard queries
.create materialized-view DashboardSummary on table SensorData
{
    SensorData
    | summarize
        AvgValue = avg(Value),
        MaxValue = max(Value),
        MinValue = min(Value),
        Count = count()
        by DeviceId, SensorType, bin(EventTime, 5m)
}

// Dashboard queries automatically use materialized view
// when query pattern matches
```

## Best Practices

1. **Limit time ranges** - Don't query more data than needed
2. **Use materialized views** - Pre-aggregate for common queries
3. **Set appropriate refresh** - Balance freshness and performance
4. **Design for mobile** - Test on different screen sizes
5. **Use parameters** - Enable user customization

## What's Next

Tomorrow I'll cover Data Activator GA and automated actions.

## Resources

- [Real-Time Dashboards](https://learn.microsoft.com/fabric/real-time-intelligence/dashboards)
- [KQL Visualization](https://learn.microsoft.com/kusto/query/render-operator)
- [Dashboard Best Practices](https://learn.microsoft.com/fabric/real-time-intelligence/dashboard-best-practices)
