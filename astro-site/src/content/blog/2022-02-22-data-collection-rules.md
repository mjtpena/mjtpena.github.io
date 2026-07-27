---
title: "Azure Data Collection Rules: Modern Log Ingestion"
author: Michael John Peña
draft: false
date: 2022-02-22
url: /blog/data-collection-rules/
tags:
  - azure
  - monitoring
  - log-analytics
  - data-collection

---

I wrote "Azure Data Collection Rules: Modern Log Ingestion" to share practical, production-minded guidance on this topic.

## Understanding Data Collection Rules

DCRs define:
- What data to collect
- How to transform data
- Where to send data

## Creating a Data Collection Rule

```bicep
resource dataCollectionRule 'Microsoft.Insights/dataCollectionRules@2021-09-01-preview' = {
  name: 'dcr-vm-monitoring'
  location: location
  kind: 'Windows'
  properties: {
    dataSources: {
      windowsEventLogs: [
        {
          name: 'eventLogsDataSource'
          streams: [
            'Microsoft-Event'
          ]
          xPathQueries: [
            'Application!*[System[(Level=1 or Level=2 or Level=3)]]'
            'System!*[System[(Level=1 or Level=2 or Level=3)]]'
            'Security!*[System[(band(Keywords,13510798882111488))]]'
          ]
        }
      ]
      performanceCounters: [
        {
          name: 'perfCounterDataSource'
          streams: [
            'Microsoft-Perf'
          ]
          samplingFrequencyInSeconds: 60
          counterSpecifiers: [
            '\\Processor Information(_Total)\\% Processor Time'
            '\\Memory\\% Committed Bytes In Use'
            '\\LogicalDisk(_Total)\\% Free Space'
            '\\PhysicalDisk(_Total)\\Avg. Disk Queue Length'
          ]
        }
      ]
    }
    destinations: {
      logAnalytics: [
        {
          workspaceResourceId: logAnalyticsWorkspace.id
          name: 'centralWorkspace'
        }
      ]
    }
    dataFlows: [
      {
        streams: [
          'Microsoft-Event'
          'Microsoft-Perf'
        ]
        destinations: [
          'centralWorkspace'
        ]
      }
    ]
  }
}

// Associate DCR with VMs
resource dcrAssociation 'Microsoft.Insights/dataCollectionRuleAssociations@2021-09-01-preview' = {
  scope: virtualMachine
  name: 'vm-dcr-association'
  properties: {
    dataCollectionRuleId: dataCollectionRule.id
  }
}
```

## Data Transformation

Transform data before ingestion:

```bicep
resource dcrWithTransform 'Microsoft.Insights/dataCollectionRules@2021-09-01-preview' = {
  name: 'dcr-custom-transform'
  location: location
  properties: {
    dataSources: {
      syslog: [
        {
          name: 'syslogDataSource'
          streams: [
            'Microsoft-Syslog'
          ]
          facilityNames: [
            'auth'
            'authpriv'
            'daemon'
            'kern'
          ]
          logLevels: [
            'Warning'
            'Error'
            'Critical'
            'Alert'
            'Emergency'
          ]
        }
      ]
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
        streams: [
          'Microsoft-Syslog'
        ]
        destinations: [
          'workspace'
        ]
        transformKql: '''
          source
          | where SeverityLevel <= 4
          | extend
              ParsedMessage = parse_json(SyslogMessage),
              Environment = case(
                  Computer contains "prod", "Production",
                  Computer contains "stag", "Staging",
                  "Development"
              )
          | project-away SyslogMessage
        '''
        outputStream: 'Custom-TransformedSyslog_CL'
      }
    ]
  }
}
```

## Custom Log Ingestion

```bicep
resource customLogDCR 'Microsoft.Insights/dataCollectionRules@2021-09-01-preview' = {
  name: 'dcr-custom-logs'
  location: location
  properties: {
    streamDeclarations: {
      'Custom-AppLogs_CL': {
        columns: [
          {
            name: 'TimeGenerated'
            type: 'datetime'
          }
          {
            name: 'Application'
            type: 'string'
          }
          {
            name: 'Level'
            type: 'string'
          }
          {
            name: 'Message'
            type: 'string'
          }
          {
            name: 'UserId'
            type: 'string'
          }
          {
            name: 'CorrelationId'
            type: 'string'
          }
        ]
      }
    }
    dataSources: {}
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
        streams: [
          'Custom-AppLogs_CL'
        ]
        destinations: [
          'workspace'
        ]
        transformKql: '''
          source
          | where Level in ("Error", "Critical", "Warning")
          | extend
              Severity = case(
                  Level == "Critical", 1,
                  Level == "Error", 2,
                  Level == "Warning", 3,
                  4
              )
        '''
        outputStream: 'Custom-AppLogs_CL'
      }
    ]
  }
}
```

## Ingesting Custom Logs via API

```python
import requests
import json
from datetime import datetime
from azure.identity import DefaultAzureCredential

class LogIngestionClient:
    def __init__(self, dcr_endpoint: str, dcr_immutable_id: str, stream_name: str):
        self.endpoint = dcr_endpoint
        self.dcr_id = dcr_immutable_id
        self.stream = stream_name
        self.credential = DefaultAzureCredential()

    def send_logs(self, logs: list):
        """Send logs to Azure Monitor via Data Collection Rule."""
        url = f"{self.endpoint}/dataCollectionRules/{self.dcr_id}/streams/{self.stream}?api-version=2021-11-01-preview"

        token = self.credential.get_token("https://monitor.azure.com/.default")

        headers = {
            "Authorization": f"Bearer {token.token}",
            "Content-Type": "application/json"
        }

        response = requests.post(url, headers=headers, json=logs)
        response.raise_for_status()

        return response.status_code

# Usage
client = LogIngestionClient(
    dcr_endpoint="https://my-dcr-endpoint.australiaeast.ingest.monitor.azure.com",
    dcr_immutable_id="dcr-xxxxxxxx",
    stream_name="Custom-AppLogs_CL"
)

logs = [
    {
        "TimeGenerated": datetime.utcnow().isoformat(),
        "Application": "MyApp",
        "Level": "Error",
        "Message": "Database connection failed",
        "UserId": "user123",
        "CorrelationId": "abc-123-def"
    }
]

client.send_logs(logs)
```

## Multi-Destination Routing

```bicep
resource multiDestinationDCR 'Microsoft.Insights/dataCollectionRules@2021-09-01-preview' = {
  name: 'dcr-multi-destination'
  location: location
  properties: {
    dataSources: {
      performanceCounters: [
        {
          name: 'perfData'
          streams: ['Microsoft-Perf']
          samplingFrequencyInSeconds: 60
          counterSpecifiers: ['\\Processor(_Total)\\% Processor Time']
        }
      ]
    }
    destinations: {
      logAnalytics: [
        {
          workspaceResourceId: primaryWorkspace.id
          name: 'primaryWorkspace'
        }
        {
          workspaceResourceId: drWorkspace.id
          name: 'drWorkspace'
        }
      ]
      azureMonitorMetrics: {
        name: 'metrics'
      }
    }
    dataFlows: [
      {
        streams: ['Microsoft-Perf']
        destinations: ['primaryWorkspace', 'drWorkspace', 'metrics']
      }
    ]
  }
}
```

Data Collection Rules provide the flexibility and control needed for modern monitoring architectures.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
