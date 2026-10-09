---
title: "Custom Logs in Azure Monitor: Ingesting Any Data Source"
description: "Custom logs enable comprehensive observability across all your applications and services."
author: Michael John Peña
draft: false
date: 2022-02-27
url: /blog/custom-logs-azure-monitor/
tags:
  - Azure
  - Monitoring
  - custom-logs
  - data-ingestion
---

## Custom Table Setup

```bicep
// Create custom table in Log Analytics
resource customTable 'Microsoft.OperationalInsights/workspaces/tables@2021-12-01-preview' = {
  parent: logAnalyticsWorkspace
  name: 'ApplicationLogs_CL'
  properties: {
    schema: {
      name: 'ApplicationLogs_CL'
      columns: [
        { name: 'TimeGenerated', type: 'datetime' }
        { name: 'Application', type: 'string' }
        { name: 'Environment', type: 'string' }
        { name: 'Level', type: 'string' }
        { name: 'Message', type: 'string' }
        { name: 'UserId', type: 'string' }
        { name: 'CorrelationId', type: 'string' }
        { name: 'Exception', type: 'string' }
        { name: 'Properties', type: 'dynamic' }
      ]
    }
    retentionInDays: 90
  }
}
```

## Data Collection Endpoint

```bicep
resource dataCollectionEndpoint 'Microsoft.Insights/dataCollectionEndpoints@2021-09-01-preview' = {
  name: 'dce-custom-logs'
  location: location
  properties: {
    networkAcls: {
      publicNetworkAccess: 'Enabled'
    }
  }
}

output ingestionEndpoint string = dataCollectionEndpoint.properties.logsIngestion.endpoint
```

## Data Collection Rule for Custom Logs

```bicep
resource customLogDCR 'Microsoft.Insights/dataCollectionRules@2021-09-01-preview' = {
  name: 'dcr-custom-application-logs'
  location: location
  properties: {
    dataCollectionEndpointId: dataCollectionEndpoint.id
    streamDeclarations: {
      'Custom-ApplicationLogs': {
        columns: [
          { name: 'TimeGenerated', type: 'datetime' }
          { name: 'Application', type: 'string' }
          { name: 'Environment', type: 'string' }
          { name: 'Level', type: 'string' }
          { name: 'Message', type: 'string' }
          { name: 'UserId', type: 'string' }
          { name: 'CorrelationId', type: 'string' }
          { name: 'Exception', type: 'string' }
          { name: 'Properties', type: 'dynamic' }
        ]
      }
    }
    destinations: {
      logAnalytics: [
        {
          workspaceResourceId: logAnalyticsWorkspace.id
          name: 'workspace'
        }
      ]
    }
    dataFlows: [
      {
        streams: ['Custom-ApplicationLogs']
        destinations: ['workspace']
        transformKql: '''
          source
          | extend
              Severity = case(
                  Level == "Critical", 1,
                  Level == "Error", 2,
                  Level == "Warning", 3,
                  Level == "Information", 4,
                  5
              ),
              HasException = isnotempty(Exception)
        '''
        outputStream: 'Custom-ApplicationLogs_CL'
      }
    ]
  }
}

output dcrImmutableId string = customLogDCR.properties.immutableId
```

## .NET SDK for Log Ingestion

```csharp
using Azure.Identity;
using Azure.Monitor.Ingestion;

public class LogIngestionService
{
    private readonly LogsIngestionClient _client;
    private readonly string _ruleId;
    private readonly string _streamName;

    public LogIngestionService(string endpoint, string ruleId, string streamName)
    {
        _client = new LogsIngestionClient(
            new Uri(endpoint),
            new DefaultAzureCredential());
        _ruleId = ruleId;
        _streamName = streamName;
    }

    public async Task SendLogsAsync(IEnumerable<ApplicationLog> logs)
    {
        var entries = logs.Select(log => BinaryData.FromObjectAsJson(new
        {
            TimeGenerated = log.Timestamp,
            Application = log.Application,
            Environment = log.Environment,
            Level = log.Level.ToString(),
            Message = log.Message,
            UserId = log.UserId,
            CorrelationId = log.CorrelationId,
            Exception = log.Exception?.ToString(),
            Properties = log.Properties
        }));

        await _client.UploadAsync(_ruleId, _streamName, entries);
    }
}

public class ApplicationLog
{
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public string Application { get; set; }
    public string Environment { get; set; }
    public LogLevel Level { get; set; }
    public string Message { get; set; }
    public string UserId { get; set; }
    public string CorrelationId { get; set; }
    public Exception Exception { get; set; }
    public Dictionary<string, object> Properties { get; set; }
}
```

## Python SDK

```python
from azure.identity import DefaultAzureCredential
from azure.monitor.ingestion import LogsIngestionClient
from datetime import datetime
import json

class CustomLogIngestion:
    def __init__(self, endpoint: str, rule_id: str, stream_name: str):
        self.client = LogsIngestionClient(
            endpoint=endpoint,
            credential=DefaultAzureCredential()
        )
        self.rule_id = rule_id
        self.stream_name = stream_name

    def send_logs(self, logs: list):
        """Send custom logs to Azure Monitor."""
        entries = []
        for log in logs:
            entry = {
                "TimeGenerated": log.get("timestamp", datetime.utcnow().isoformat()),
                "Application": log.get("application"),
                "Environment": log.get("environment"),
                "Level": log.get("level"),
                "Message": log.get("message"),
                "UserId": log.get("user_id"),
                "CorrelationId": log.get("correlation_id"),
                "Exception": log.get("exception"),
                "Properties": log.get("properties", {})
            }
            entries.append(entry)

        self.client.upload(
            rule_id=self.rule_id,
            stream_name=self.stream_name,
            logs=entries
        )

# Usage
client = CustomLogIngestion(
    endpoint="https://dce-xxxx.australiaeast.ingest.monitor.azure.com",
    rule_id="dcr-xxxxxxxx",
    stream_name="Custom-ApplicationLogs"
)

client.send_logs([
    {
        "application": "MyWebApp",
        "environment": "Production",
        "level": "Error",
        "message": "Database connection failed",
        "user_id": "user123",
        "correlation_id": "abc-123",
        "exception": "ConnectionTimeoutException: ...",
        "properties": {
            "database": "orders-db",
            "retry_count": 3
        }
    }
])
```

## File-Based Custom Logs

For applications that write to files:

```bicep
resource fileLogDCR 'Microsoft.Insights/dataCollectionRules@2021-09-01-preview' = {
  name: 'dcr-file-logs'
  location: location
  kind: 'Windows'
  properties: {
    dataSources: {
      logFiles: [
        {
          name: 'appLogFiles'
          streams: ['Custom-AppFileLogs']
          filePatterns: [
            'C:\\Logs\\MyApp\\*.log'
            'D:\\Applications\\*.log'
          ]
          format: 'text'
          settings: {
            text: {
              recordStartTimestampFormat: 'yyyy-MM-dd HH:mm:ss'
            }
          }
        }
      ]
    }
    streamDeclarations: {
      'Custom-AppFileLogs': {
        columns: [
          { name: 'TimeGenerated', type: 'datetime' }
          { name: 'RawData', type: 'string' }
          { name: 'FilePath', type: 'string' }
        ]
      }
    }
    destinations: {
      logAnalytics: [
        {
          workspaceResourceId: logAnalyticsWorkspace.id
          name: 'workspace'
        }
      ]
    }
    dataFlows: [
      {
        streams: ['Custom-AppFileLogs']
        destinations: ['workspace']
        transformKql: '''
          source
          | parse RawData with Timestamp:datetime " [" Level:string "] " Message:string
          | project TimeGenerated, Level, Message, FilePath
        '''
        outputStream: 'Custom-ParsedAppLogs_CL'
      }
    ]
  }
}
```

Custom logs enable comprehensive observability across all your applications and services.
