---
title: "Real-Time Dashboards in Fabric: Live Data Visualization"
author: Michael John Peña
draft: false
date: 2023-07-22
tags:
  - Microsoft Fabric
  - Dashboards
  - Real-Time Analytics
  - Visualization

---

I wrote "Real-Time Dashboards in Fabric: Live Data Visualization" to share practical, production-minded guidance on this topic.

## Understanding Real-Time Dashboards

```python
# Real-Time Dashboard features
dashboard_features = {
    "auto_refresh": "Automatic data refresh (configurable interval)",
    "low_latency": "Sub-second query execution",
    "multiple_sources": "Query multiple KQL databases",
    "rich_visuals": "Charts, maps, tables, and more",
    "interactivity": "Filters and parameters"
}

# Use cases
use_cases = [
    "Operations center monitoring",
    "IoT device dashboards",
    "Application performance monitoring",
    "Security operations center",
    "Business KPIs"
]
```

## Creating a Real-Time Dashboard

```
1. In your workspace, click "+ New" > "Real-Time Dashboard"
2. Name your dashboard
3. Click "Create"
4. You enter the dashboard editor
```

## Adding Data Sources

```kql
// Connect to KQL database
// 1. Click "Add data source"
// 2. Select your KQL database
// 3. Name the connection

// You can add multiple data sources for cross-database queries
```

## Creating Tiles

### Basic Query Tile

```kql
// Tile 1: Current Device Count
// Query:
telemetry
| where timestamp > ago(5m)
| summarize count = dcount(device_id)
| project count

// Visualization: Stat (big number)
// Refresh: 30 seconds
```

### Time Series Chart

```kql
// Tile 2: Temperature Over Time
// Query:
telemetry
| where timestamp > ago(1h)
| summarize avg_temp = avg(temperature) by bin(timestamp, 1m)
| order by timestamp asc

// Visualization: Line chart
// X-axis: timestamp
// Y-axis: avg_temp
// Refresh: 1 minute
```

### Multi-Series Chart

```kql
// Tile 3: Temperature by Device
// Query:
telemetry
| where timestamp > ago(1h)
| summarize avg_temp = avg(temperature) by bin(timestamp, 5m), device_id
| order by timestamp asc

// Visualization: Line chart with series
// Series: device_id
```

### Table Visualization

```kql
// Tile 4: Recent Alerts
// Query:
alerts
| where timestamp > ago(24h)
| order by timestamp desc
| take 10
| project timestamp, device_id, alert_type, severity, message

// Visualization: Table
// Columns: All
// Conditional formatting: severity column
```

### Map Visualization

```kql
// Tile 5: Device Locations
// Query:
device_locations
| join kind=inner (
    telemetry
    | where timestamp > ago(5m)
    | summarize last_reading = max(temperature) by device_id
) on device_id
| project latitude, longitude, device_id, last_reading

// Visualization: Map
// Latitude: latitude
// Longitude: longitude
// Size/Color: last_reading
```

### Pie/Donut Chart

```kql
// Tile 6: Events by Type
// Query:
events
| where timestamp > ago(1h)
| summarize count = count() by event_type
| order by count desc

// Visualization: Pie chart
// Labels: event_type
// Values: count
```

## Adding Parameters

### Time Range Parameter

```kql
// Create parameter for dynamic time filtering
// 1. Click "Parameters" > "Add parameter"
// 2. Configure:

parameter_config = {
    "name": "TimeRange",
    "type": "DateTime range",
    "default": "Last 1 hour",
    "options": [
        "Last 15 minutes",
        "Last 1 hour",
        "Last 24 hours",
        "Last 7 days",
        "Custom"
    ]
}

// Use in query:
telemetry
| where timestamp between (_startTime .. _endTime)
| summarize count() by bin(timestamp, 5m)
```

### Dropdown Parameter

```kql
// Device selector parameter
// 1. Add parameter
// 2. Configure:

parameter_config = {
    "name": "DeviceFilter",
    "type": "Single select",
    "source": "Query",
    "query": "telemetry | distinct device_id | order by device_id"
}

// Use in query:
telemetry
| where device_id == DeviceFilter or DeviceFilter == "All"
| summarize avg(temperature) by bin(timestamp, 1m)
```

## Conditional Formatting

```python
# Add conditional formatting to tiles:

formatting_rules = {
    "color_by_value": {
        "ranges": [
            {"min": 0, "max": 20, "color": "blue"},
            {"min": 20, "max": 30, "color": "green"},
            {"min": 30, "max": 100, "color": "red"}
        ]
    },
    "icons": {
        "rules": [
            {"condition": "value > 30", "icon": "warning"},
            {"condition": "value < 10", "icon": "alert"}
        ]
    },
    "thresholds": {
        "warning": 25,
        "critical": 30,
        "visual": "Color band on chart"
    }
}
```

## Dashboard Layout

```python
# Organize tiles effectively:

layout_tips = {
    "hierarchy": "Most important metrics at top-left",
    "grouping": "Related metrics together",
    "sizing": "Big numbers for KPIs, smaller for details",
    "spacing": "Consistent margins between tiles",
    "headers": "Use text tiles for section headers"
}

# Example layout:
"""
+---------------------------+
| [KPI 1] [KPI 2] [KPI 3]   |  <- Top: Key metrics
+---------------------------+
| [Time Series Chart]       |  <- Middle: Trends
+---------------------------+
| [Table]     | [Map]       |  <- Bottom: Details
+---------------------------+
"""
```

## Auto-Refresh Configuration

```python
# Configure refresh intervals per tile:

refresh_config = {
    "real_time_metrics": "30 seconds",
    "trending_charts": "1 minute",
    "historical_data": "5 minutes",
    "static_reference": "30 minutes"
}

# Set default dashboard refresh:
# Dashboard settings > Default refresh > Select interval
```

## Sharing and Embedding

```python
# Share dashboard:
# 1. Click "Share" in toolbar
# 2. Add users or groups
# 3. Set permission level (View/Edit)

# Embed in portal:
# 1. Click "Embed"
# 2. Copy iframe code
# 3. Add to internal portal

# Note: Viewers need Fabric access
```

## Complete Dashboard Example

```kql
// Operations Dashboard with 6 tiles:

// Tile 1: Active Devices (Stat)
telemetry
| where timestamp > ago(5m)
| summarize active = dcount(device_id)

// Tile 2: Avg Temperature (Stat)
telemetry
| where timestamp > ago(5m)
| summarize avg_temp = round(avg(temperature), 1)

// Tile 3: Alert Count (Stat with threshold)
alerts
| where timestamp > ago(1h)
| where severity in ("Critical", "High")
| count

// Tile 4: Temperature Trend (Line)
telemetry
| where timestamp > ago(4h)
| summarize avg_temp = avg(temperature) by bin(timestamp, 5m)
| render timechart

// Tile 5: Top Alerting Devices (Bar)
alerts
| where timestamp > ago(24h)
| summarize alert_count = count() by device_id
| top 10 by alert_count
| render barchart

// Tile 6: Recent Events (Table)
events
| where timestamp > ago(1h)
| order by timestamp desc
| take 20
| project timestamp, device_id, event_type, details
```

## Best Practices

```python
best_practices = {
    "performance": [
        "Limit query result size",
        "Use appropriate time ranges",
        "Aggregate at source when possible"
    ],
    "usability": [
        "Clear tile titles",
        "Consistent color schemes",
        "Logical layout flow"
    ],
    "maintenance": [
        "Document data sources",
        "Version control queries",
        "Test with sample data"
    ]
}
```

Tomorrow we'll explore Fabric Data Science capabilities.

## Resources

- [Real-Time Dashboard Documentation](https://learn.microsoft.com/en-us/fabric/real-time-analytics/dashboard-real-time-create)
- [KQL Visualizations](https://learn.microsoft.com/en-us/azure/data-explorer/kusto/query/renderoperator)
- [Dashboard Best Practices](https://learn.microsoft.com/en-us/fabric/real-time-analytics/dashboard-best-practices)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
