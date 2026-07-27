---
title: "Azure Log Analytics Integration with Synapse"
author: Michael John Peña
draft: false
date: 2022-05-23
tags:
  - azure
  - log-analytics
  - synapse
  - monitoring

---

I wrote "Azure Log Analytics Integration with Synapse" to share practical, production-minded guidance on this topic.

## Exporting Logs to Synapse

Configure diagnostic settings to export to Data Lake:

```bicep
resource diagnosticSetting 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  name: 'export-to-datalake'
  scope: webApp
  properties: {
    workspaceId: logAnalyticsWorkspace.id
    storageAccountId: storageAccount.id
    logs: [
      {
        category: 'AppServiceHTTPLogs'
        enabled: true
        retentionPolicy: {
          enabled: true
          days: 90
        }
      }
      {
        category: 'AppServiceConsoleLogs'
        enabled: true
      }
      {
        category: 'AppServiceAppLogs'
        enabled: true
      }
    ]
    metrics: [
      {
        category: 'AllMetrics'
        enabled: true
      }
    ]
  }
}
```

## Querying Logs in Synapse

Use serverless SQL to query exported logs:

```sql
-- Query App Service HTTP logs from Data Lake
SELECT
    time,
    resourceId,
    JSON_VALUE(properties, '$.Method') as HttpMethod,
    JSON_VALUE(properties, '$.Protocol') as Protocol,
    JSON_VALUE(properties, '$.CsHost') as Host,
    JSON_VALUE(properties, '$.CsUriStem') as Path,
    CAST(JSON_VALUE(properties, '$.ScStatus') AS INT) as StatusCode,
    CAST(JSON_VALUE(properties, '$.TimeTaken') AS INT) as TimeTakenMs,
    JSON_VALUE(properties, '$.UserAgent') as UserAgent
FROM OPENROWSET(
    BULK 'https://datalake.blob.core.windows.net/logs/AppServiceHTTPLogs/**/*.json',
    FORMAT = 'CSV',
    FIELDQUOTE = '0x0b',
    FIELDTERMINATOR = '0x0b',
    ROWTERMINATOR = '\n'
)
WITH (doc NVARCHAR(MAX)) AS logs
CROSS APPLY OPENJSON(doc)
WITH (
    time DATETIME2 '$.time',
    resourceId NVARCHAR(500) '$.resourceId',
    properties NVARCHAR(MAX) '$.properties' AS JSON
)
WHERE time > DATEADD(day, -7, GETUTCDATE());

-- Analyze error rates
WITH HttpLogs AS (
    SELECT
        CAST(time AS DATE) as LogDate,
        DATEPART(HOUR, time) as LogHour,
        CAST(JSON_VALUE(properties, '$.ScStatus') AS INT) as StatusCode
    FROM OPENROWSET(
        BULK 'https://datalake.blob.core.windows.net/logs/AppServiceHTTPLogs/**/*.json',
        FORMAT = 'CSV',
        FIELDQUOTE = '0x0b',
        FIELDTERMINATOR = '0x0b'
    ) WITH (doc NVARCHAR(MAX)) AS logs
    CROSS APPLY OPENJSON(doc)
    WITH (
        time DATETIME2 '$.time',
        properties NVARCHAR(MAX) '$.properties' AS JSON
    )
)
SELECT
    LogDate,
    LogHour,
    COUNT(*) as TotalRequests,
    SUM(CASE WHEN StatusCode >= 400 THEN 1 ELSE 0 END) as ErrorCount,
    CAST(SUM(CASE WHEN StatusCode >= 400 THEN 1.0 ELSE 0 END) / COUNT(*) * 100 AS DECIMAL(5,2)) as ErrorRate
FROM HttpLogs
GROUP BY LogDate, LogHour
ORDER BY LogDate DESC, LogHour DESC;
```

## KQL Queries in Log Analytics

Complex log analysis:

```kql
// Application performance analysis
requests
| where timestamp > ago(24h)
| summarize
    RequestCount = count(),
    AvgDuration = avg(duration),
    P50 = percentile(duration, 50),
    P95 = percentile(duration, 95),
    P99 = percentile(duration, 99),
    FailureCount = countif(success == false)
    by bin(timestamp, 1h), cloud_RoleName
| render timechart

// Dependency analysis
dependencies
| where timestamp > ago(24h)
| where success == false
| summarize FailureCount = count() by target, type, resultCode
| top 20 by FailureCount
| render barchart

// End-to-end transaction tracing
let operationId = "abc123";
union requests, dependencies, traces, exceptions
| where operation_Id == operationId
| project
    timestamp,
    itemType,
    name = coalesce(name, message, outerMessage),
    duration = coalesce(duration, 0),
    success = coalesce(success, problemId == "")
| order by timestamp asc

// Slow query detection
AppTraces
| where Message contains "SQL"
| parse Message with * "Duration: " Duration:long "ms" *
| where Duration > 1000
| summarize
    SlowQueryCount = count(),
    AvgDuration = avg(Duration),
    MaxDuration = max(Duration)
    by bin(TimeGenerated, 1h)
| render timechart

// Resource utilization correlation
Perf
| where TimeGenerated > ago(1h)
| where ObjectName == "Processor" and CounterName == "% Processor Time"
| summarize AvgCPU = avg(CounterValue) by bin(TimeGenerated, 5m), Computer
| join kind=inner (
    requests
    | where timestamp > ago(1h)
    | summarize RequestCount = count() by bin(timestamp, 5m)
) on $left.TimeGenerated == $right.timestamp
| project TimeGenerated, Computer, AvgCPU, RequestCount
| render timechart
```

## Azure Function for Log Processing

Process logs with Azure Functions:

```csharp
using Microsoft.Azure.WebJobs;
using Microsoft.Extensions.Logging;
using Azure.Monitor.Query;
using Azure.Identity;

public class LogProcessor
{
    private readonly LogsQueryClient _logsClient;
    private readonly ILogger<LogProcessor> _logger;

    public LogProcessor(ILogger<LogProcessor> logger)
    {
        _logger = logger;
        _logsClient = new LogsQueryClient(new DefaultAzureCredential());
    }

    [FunctionName("ProcessLogs")]
    public async Task Run(
        [TimerTrigger("0 */15 * * * *")] TimerInfo timer)
    {
        var workspaceId = Environment.GetEnvironmentVariable("LOG_ANALYTICS_WORKSPACE_ID");

        var query = @"
            requests
            | where timestamp > ago(15m)
            | where success == false
            | summarize FailureCount = count() by cloud_RoleName, name, resultCode
            | where FailureCount > 10
        ";

        var response = await _logsClient.QueryWorkspaceAsync(
            workspaceId,
            query,
            new QueryTimeRange(TimeSpan.FromMinutes(15)));

        foreach (var row in response.Value.Table.Rows)
        {
            var roleName = row["cloud_RoleName"].ToString();
            var requestName = row["name"].ToString();
            var failureCount = Convert.ToInt32(row["FailureCount"]);

            _logger.LogWarning(
                "High failure rate detected: {RoleName}/{RequestName} - {Count} failures",
                roleName, requestName, failureCount);

            // Send alert
            await SendAlertAsync(roleName, requestName, failureCount);
        }
    }

    private async Task SendAlertAsync(string roleName, string requestName, int failureCount)
    {
        // Send to Teams, PagerDuty, etc.
    }
}
```

## Creating Custom Metrics

Export custom metrics from logs:

```kql
// Create custom metric from logs
let BusinessMetrics = AppTraces
| where Message startswith "OrderProcessed"
| parse Message with "OrderProcessed: " OrderId " Total: " Total:real " Items: " ItemCount:int
| summarize
    OrderCount = count(),
    TotalRevenue = sum(Total),
    AvgOrderValue = avg(Total),
    AvgItemsPerOrder = avg(ItemCount)
    by bin(TimeGenerated, 1h);

// Export to custom metrics
BusinessMetrics
| extend
    MetricName = "BusinessMetrics",
    Dimensions = pack("OrderCount", OrderCount, "Revenue", TotalRevenue)
```

## Summary

Log Analytics integration enables:

- Centralized log analysis
- Cross-service correlation
- Performance monitoring
- Custom metric creation
- Automated alerting

Build comprehensive observability for your applications.


