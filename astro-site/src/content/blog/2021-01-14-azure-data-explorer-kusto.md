---
title: "Azure Data Explorer: Real-Time Analytics with Kusto"
author: Michael John Peña
draft: false
date: 2021-01-14
tags:
  - Azure
  - Data Explorer
  - Kusto
  - Analytics
---

If you've used Log Analytics or Sentinel, you've already used Azure Data Explorer—they're built on the same engine. ADX as a standalone product is the thing you reach for when "we have billions of telemetry events and we want sub-second queries on them" graduates from problem to product. KQL is the language, the column store is purpose-built for time-series, and ingestion handles streaming and batch without breaking a sweat. I keep recommending it for IoT analytics and product telemetry where Synapse would be too heavy and Cosmos too expensive.

## Create Cluster and Database

```bash
# Create ADX cluster
az kusto cluster create \
    --name myadxcluster \
    --resource-group myRG \
    --location eastus \
    --sku name="Standard_D13_v2" tier="Standard"

# Create database
az kusto database create \
    --cluster-name myadxcluster \
    --resource-group myRG \
    --database-name telemetry \
    --soft-delete-period P365D \
    --hot-cache-period P31D
```

## Kusto Query Language (KQL) Basics

```kusto
// Filter and project
Telemetry
| where Timestamp > ago(1h)
| where DeviceType == "Sensor"
| project Timestamp, DeviceId, Temperature, Humidity
| limit 100

// Aggregations
Telemetry
| where Timestamp > ago(24h)
| summarize
    AvgTemp = avg(Temperature),
    MaxTemp = max(Temperature),
    MinTemp = min(Temperature),
    Count = count()
    by bin(Timestamp, 1h), DeviceId
| order by Timestamp desc

// Time series analysis
Telemetry
| where Timestamp > ago(7d)
| make-series AvgTemp = avg(Temperature) on Timestamp step 1h by DeviceId
| render timechart
```

## Create Tables

```kusto
// Create table
.create table Telemetry (
    Timestamp: datetime,
    DeviceId: string,
    DeviceType: string,
    Temperature: real,
    Humidity: real,
    Pressure: real
)

// Create ingestion mapping for JSON
.create table Telemetry ingestion json mapping 'TelemetryMapping'
'['
'    {"column":"Timestamp", "path":"$.timestamp", "datatype":"datetime"},'
'    {"column":"DeviceId", "path":"$.deviceId", "datatype":"string"},'
'    {"column":"DeviceType", "path":"$.deviceType", "datatype":"string"},'
'    {"column":"Temperature", "path":"$.temperature", "datatype":"real"},'
'    {"column":"Humidity", "path":"$.humidity", "datatype":"real"},'
'    {"column":"Pressure", "path":"$.pressure", "datatype":"real"}'
']'
```

## Streaming Ingestion

```csharp
using Kusto.Data;
using Kusto.Ingest;

var ingestUri = "https://ingest-myadxcluster.eastus.kusto.windows.net";
var kustoConnectionStringBuilder = new KustoConnectionStringBuilder(ingestUri)
    .WithAadApplicationKeyAuthentication(appId, appKey, tenantId);

using var ingestClient = KustoIngestFactory.CreateStreamingIngestClient(
    kustoConnectionStringBuilder);

var data = new
{
    timestamp = DateTime.UtcNow,
    deviceId = "sensor-001",
    deviceType = "Sensor",
    temperature = 23.5,
    humidity = 65.2,
    pressure = 1013.25
};

var json = JsonSerializer.Serialize(data);
using var stream = new MemoryStream(Encoding.UTF8.GetBytes(json));

var properties = new KustoIngestionProperties("telemetry", "Telemetry")
{
    Format = DataSourceFormat.json,
    IngestionMapping = new IngestionMapping
    {
        IngestionMappingReference = "TelemetryMapping"
    }
};

await ingestClient.IngestFromStreamAsync(stream, properties);
```

## Event Hub Ingestion

```kusto
// Create data connection from Event Hub
.create table Telemetry ingestion json mapping 'EventHubMapping' '[...]'

// Connect Event Hub (via Azure Portal or ARM template)
// Data flows automatically from Event Hub to ADX
```

## Advanced KQL

```kusto
// Anomaly detection
Telemetry
| where Timestamp > ago(7d)
| make-series AvgTemp = avg(Temperature) on Timestamp step 1h
| extend anomalies = series_decompose_anomalies(AvgTemp)
| mv-expand Timestamp, AvgTemp, anomalies
| where anomalies != 0
| project Timestamp, AvgTemp, AnomalyScore = anomalies

// Pattern detection
Telemetry
| where Timestamp > ago(1d)
| summarize Count = count() by DeviceId, bin(Timestamp, 5m)
| evaluate autocluster()

// Forecasting
Telemetry
| where Timestamp > ago(30d)
| make-series AvgTemp = avg(Temperature) on Timestamp step 1h
| extend forecast = series_decompose_forecast(AvgTemp, 24)
| project Timestamp, AvgTemp, Forecast = forecast
```

## Materialized Views

```kusto
// Create materialized view for pre-aggregated data
.create materialized-view HourlyTelemetry on table Telemetry
{
    Telemetry
    | summarize
        AvgTemp = avg(Temperature),
        AvgHumidity = avg(Humidity),
        Count = count()
        by DeviceId, bin(Timestamp, 1h)
}

// Query materialized view (fast!)
HourlyTelemetry
| where Timestamp > ago(7d)
| order by Timestamp desc
```

## Connect to Power BI

```kusto
// In Power BI:
// Get Data → Azure → Azure Data Explorer

// Optimize query for Power BI
let
    Source = AzureDataExplorer.Contents("myadxcluster.eastus.kusto.windows.net", "telemetry"),
    Query = Source{[Name="Telemetry"]}[Data],
    Filtered = Table.SelectRows(Query, each [Timestamp] > DateTime.AddDays(DateTime.LocalNow(), -30))
in
    Filtered
```

Azure Data Explorer: petabyte-scale analytics in seconds.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
