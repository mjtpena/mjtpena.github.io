---
title: "Azure Data Explorer: Fast Analytics on Log Data"
author: Michael John Peña
draft: false
date: 2020-08-31
tags:
  - Azure
  - Azure Data Explorer
  - KQL
  - Log Analytics

---

I wrote "Azure Data Explorer: Fast Analytics on Log Data" to share practical, production-minded guidance on this topic.

## Why ADX?

- Sub-second queries on billions of rows
- Native time-series optimizations
- KQL query language (surprisingly intuitive)
- Built-in streaming ingestion

## KQL Basics

```kql
// Find slow requests in the last hour
requests
| where timestamp > ago(1h)
| where duration > 5000  // milliseconds
| project timestamp, name, duration, resultCode
| order by duration desc
| take 100
```

```kql
// Aggregate by time buckets
requests
| where timestamp > ago(24h)
| summarize count(), avg(duration) by bin(timestamp, 1h)
| render timechart
```

```kql
// Join with exceptions
requests
| where timestamp > ago(1h)
| join kind=inner (
    exceptions
    | where timestamp > ago(1h)
) on operation_Id
| project timestamp, requestName=name, exceptionType=type, exceptionMessage=message
```

## Ingestion Options

```csharp
// Streaming ingestion via SDK
var kustoUri = "https://myadx.australiaeast.kusto.windows.net";
var ingestUri = "https://ingest-myadx.australiaeast.kusto.windows.net";

using var client = KustoIngestFactory.CreateStreamingIngestClient(kustoUri);
using var stream = new MemoryStream(Encoding.UTF8.GetBytes(jsonData));

await client.IngestFromStreamAsync(
    stream,
    new KustoIngestionProperties("database", "table")
    {
        Format = DataSourceFormat.json
    });
```

For log analytics at scale, ADX is hard to beat.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
