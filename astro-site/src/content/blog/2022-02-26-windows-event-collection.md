---
title: "Windows Event Collection: Comprehensive Monitoring with AMA"
author: Michael John Peña
draft: false
date: 2022-02-26
url: /blog/windows-event-collection/
tags:
  - azure
  - monitoring
  - windows
  - security

---

I wrote "Windows Event Collection: Comprehensive Monitoring with AMA" to share practical, production-minded guidance on this topic.

## XPath Query Basics

XPath queries filter events at the source:

```xml
<!-- Basic structure -->
<QueryList>
  <Query Id="0" Path="Security">
    <Select Path="Security">*[System[(EventID=4624)]]</Select>
  </Query>
</QueryList>
```

## Comprehensive Event Collection DCR

```bicep
resource windowsEventDCR 'Microsoft.Insights/dataCollectionRules@2021-09-01-preview' = {
  name: 'dcr-windows-events'
  location: location
  kind: 'Windows'
  properties: {
    dataSources: {
      windowsEventLogs: [
        {
          name: 'securityEvents'
          streams: ['Microsoft-SecurityEvent']
          xPathQueries: [
            // Successful logons
            'Security!*[System[(EventID=4624)]]'
            // Failed logons
            'Security!*[System[(EventID=4625)]]'
            // Account lockout
            'Security!*[System[(EventID=4740)]]'
            // Privileged logon
            'Security!*[System[(EventID=4672)]]'
            // Process creation
            'Security!*[System[(EventID=4688)]]'
            // Service installation
            'Security!*[System[(EventID=4697)]]'
            // User account changes
            'Security!*[System[(EventID>=4720 and EventID<=4735)]]'
            // Security group changes
            'Security!*[System[(EventID>=4727 and EventID<=4737)]]'
          ]
        }
        {
          name: 'applicationErrors'
          streams: ['Microsoft-Event']
          xPathQueries: [
            // Error and Critical events
            'Application!*[System[(Level=1 or Level=2)]]'
            // .NET Runtime errors
            'Application!*[System[Provider[@Name=".NET Runtime"]]]'
            // Application crashes
            'Application!*[System[Provider[@Name="Application Error"]]]'
          ]
        }
        {
          name: 'systemEvents'
          streams: ['Microsoft-Event']
          xPathQueries: [
            // Critical and Error
            'System!*[System[(Level=1 or Level=2)]]'
            // Service state changes
            'System!*[System[Provider[@Name="Service Control Manager"] and (EventID=7045 or EventID=7040)]]'
            // Blue screen events
            'System!*[System[Provider[@Name="Microsoft-Windows-WER-SystemErrorReporting"]]]'
          ]
        }
        {
          name: 'powershellEvents'
          streams: ['Microsoft-Event']
          xPathQueries: [
            // PowerShell script block logging
            'Microsoft-Windows-PowerShell/Operational!*[System[(EventID=4104)]]'
            // PowerShell module logging
            'Microsoft-Windows-PowerShell/Operational!*[System[(EventID=4103)]]'
          ]
        }
        {
          name: 'defendorEvents'
          streams: ['Microsoft-Event']
          xPathQueries: [
            // Windows Defender detections
            'Microsoft-Windows-Windows Defender/Operational!*[System[(EventID=1116 or EventID=1117)]]'
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
        streams: ['Microsoft-SecurityEvent']
        destinations: ['workspace']
      }
      {
        streams: ['Microsoft-Event']
        destinations: ['workspace']
      }
    ]
  }
}
```

## Security-Focused Collection

```bicep
resource securityDCR 'Microsoft.Insights/dataCollectionRules@2021-09-01-preview' = {
  name: 'dcr-security-events'
  location: location
  kind: 'Windows'
  properties: {
    dataSources: {
      windowsEventLogs: [
        {
          name: 'accountActivity'
          streams: ['Microsoft-SecurityEvent']
          xPathQueries: [
            // Account logon events
            'Security!*[System[(EventID=4624 or EventID=4625 or EventID=4634 or EventID=4648)]]'
            // Account management
            'Security!*[System[(EventID>=4720 and EventID<=4767)]]'
            // Privilege use
            'Security!*[System[(EventID=4672 or EventID=4673 or EventID=4674)]]'
          ]
        }
        {
          name: 'processActivity'
          streams: ['Microsoft-SecurityEvent']
          xPathQueries: [
            // Process creation with command line (requires audit policy)
            'Security!*[System[(EventID=4688)]]'
            // Process termination
            'Security!*[System[(EventID=4689)]]'
          ]
        }
        {
          name: 'networkActivity'
          streams: ['Microsoft-SecurityEvent']
          xPathQueries: [
            // Firewall rule changes
            'Security!*[System[(EventID>=4946 and EventID<=4954)]]'
            // Network share access
            'Security!*[System[(EventID=5140 or EventID=5145)]]'
          ]
        }
      ]
    }
    destinations: {
      logAnalytics: [
        {
          workspaceResourceId: logAnalyticsWorkspace.id
          name: 'sentinelWorkspace'
        }
      ]
    }
    dataFlows: [
      {
        streams: ['Microsoft-SecurityEvent']
        destinations: ['sentinelWorkspace']
        transformKql: '''
          source
          | extend
              AccountDomain = extract("^([^\\\\]+)\\\\", 1, TargetUserName),
              AccountName = extract("\\\\(.+)$", 1, TargetUserName)
          | where AccountName !in ("SYSTEM", "LOCAL SERVICE", "NETWORK SERVICE")
        '''
      }
    ]
  }
}
```

## Querying Windows Events

```kusto
// Failed logon analysis
SecurityEvent
| where TimeGenerated > ago(24h)
| where EventID == 4625
| extend
    FailureReason = case(
        SubStatus == "0xc0000064", "Unknown username",
        SubStatus == "0xc000006a", "Wrong password",
        SubStatus == "0xc0000072", "Account disabled",
        SubStatus == "0xc0000234", "Account locked",
        SubStatus == "0xc0000193", "Account expired",
        "Other"
    )
| summarize
    FailedAttempts = count(),
    UniqueAccounts = dcount(TargetUserName)
    by Computer, FailureReason, SourceIP = IpAddress, bin(TimeGenerated, 1h)
| where FailedAttempts > 5

// Privileged account usage
SecurityEvent
| where EventID == 4672
| where TimeGenerated > ago(7d)
| summarize
    PrivilegedLogons = count(),
    FirstSeen = min(TimeGenerated),
    LastSeen = max(TimeGenerated)
    by Account, Computer
| order by PrivilegedLogons desc

// Suspicious PowerShell activity
Event
| where EventLog == "Microsoft-Windows-PowerShell/Operational"
| where EventID == 4104
| where RenderedDescription contains_any (
    "Invoke-Expression",
    "IEX",
    "DownloadString",
    "EncodedCommand",
    "bypass",
    "-enc"
)
| project TimeGenerated, Computer, RenderedDescription
```

## Alerting Rules

```bicep
resource bruteForceAlert 'Microsoft.Insights/scheduledQueryRules@2021-08-01' = {
  name: 'alert-brute-force-attempt'
  location: location
  properties: {
    severity: 2
    enabled: true
    evaluationFrequency: 'PT5M'
    windowSize: 'PT15M'
    scopes: [logAnalyticsWorkspace.id]
    criteria: {
      allOf: [
        {
          query: '''
            SecurityEvent
            | where EventID == 4625
            | summarize FailedAttempts = count() by TargetUserName, IpAddress, bin(TimeGenerated, 5m)
            | where FailedAttempts > 10
          '''
          timeAggregation: 'Count'
          operator: 'GreaterThan'
          threshold: 0
        }
      ]
    }
    actions: {
      actionGroups: [securityActionGroup.id]
    }
  }
}
```

Comprehensive Windows Event collection is essential for security monitoring and compliance.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
