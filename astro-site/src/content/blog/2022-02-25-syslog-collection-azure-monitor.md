---
title: "Syslog Collection with Azure Monitor: Linux Log Management"
description: "Comprehensive syslog collection provides essential visibility into Linux system security and operations."
author: Michael John Peña
draft: false
date: 2022-02-25
url: /blog/syslog-collection-azure-monitor/
tags:
  - Azure
  - Monitoring
  - Linux
  - syslog
---

## Configuring Syslog Collection

```bicep
resource syslogDCR 'Microsoft.Insights/dataCollectionRules@2021-09-01-preview' = {
  name: 'dcr-linux-syslog'
  location: location
  kind: 'Linux'
  properties: {
    dataSources: {
      syslog: [
        {
          name: 'syslogAuthSecurity'
          streams: ['Microsoft-Syslog']
          facilityNames: [
            'auth'
            'authpriv'
          ]
          logLevels: [
            'Debug'
            'Info'
            'Notice'
            'Warning'
            'Error'
            'Critical'
            'Alert'
            'Emergency'
          ]
        }
        {
          name: 'syslogSystem'
          streams: ['Microsoft-Syslog']
          facilityNames: [
            'kern'
            'daemon'
            'syslog'
            'cron'
          ]
          logLevels: [
            'Warning'
            'Error'
            'Critical'
            'Alert'
            'Emergency'
          ]
        }
        {
          name: 'syslogApplications'
          streams: ['Microsoft-Syslog']
          facilityNames: [
            'local0'
            'local1'
            'local2'
            'local3'
            'local4'
            'local5'
            'local6'
            'local7'
          ]
          logLevels: [
            'Info'
            'Notice'
            'Warning'
            'Error'
            'Critical'
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
        streams: ['Microsoft-Syslog']
        destinations: ['workspace']
      }
    ]
  }
}
```

## Syslog with Transformation

```bicep
resource syslogTransformDCR 'Microsoft.Insights/dataCollectionRules@2021-09-01-preview' = {
  name: 'dcr-syslog-transformed'
  location: location
  kind: 'Linux'
  properties: {
    dataSources: {
      syslog: [
        {
          name: 'allSyslog'
          streams: ['Microsoft-Syslog']
          facilityNames: ['*']
          logLevels: ['*']
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
        streams: ['Microsoft-Syslog']
        destinations: ['workspace']
        transformKql: '''
          source
          | where SeverityLevel <= 4
          | extend
              ParsedProcess = extract("([a-zA-Z0-9_-]+)\\[([0-9]+)\\]", 1, ProcessName),
              ProcessId = extract("([a-zA-Z0-9_-]+)\\[([0-9]+)\\]", 2, ProcessName),
              IsSSH = SyslogMessage contains "sshd",
              IsSudo = SyslogMessage contains "sudo",
              IsCron = Facility == "cron"
          | project-away ProcessName
          | extend ProcessName = ParsedProcess
        '''
        outputStream: 'Microsoft-Syslog'
      }
    ]
  }
}
```

## Forwarding Syslog to Azure

Configure rsyslog to forward to AMA:

```bash
# /etc/rsyslog.d/95-omsagent.conf
# Forward to Azure Monitor Agent

# Template for structured logging
template(name="AzureMonitorFormat" type="string"
  string="%TIMESTAMP:::date-rfc3339% %HOSTNAME% %syslogtag%%msg:::sp-if-no-1st-sp%%msg:::drop-last-lf%\n")

# Forward auth messages
auth,authpriv.*  action(type="omfwd"
  target="127.0.0.1"
  port="28330"
  protocol="tcp"
  template="AzureMonitorFormat")

# Forward kernel messages
kern.*  action(type="omfwd"
  target="127.0.0.1"
  port="28330"
  protocol="tcp"
  template="AzureMonitorFormat")

# Forward application logs
local0.*;local1.*;local2.*;local3.*  action(type="omfwd"
  target="127.0.0.1"
  port="28330"
  protocol="tcp"
  template="AzureMonitorFormat")
```

## Centralized Syslog Server

```bicep
// Syslog forwarder VM
resource syslogForwarder 'Microsoft.Compute/virtualMachines@2021-11-01' = {
  name: 'vm-syslog-forwarder'
  location: location
  properties: {
    hardwareProfile: {
      vmSize: 'Standard_D2s_v3'
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: '0001-com-ubuntu-server-focal'
        sku: '20_04-lts-gen2'
        version: 'latest'
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: syslogNic.id
        }
      ]
    }
  }
}

// NSG rule for syslog
resource syslogNsgRule 'Microsoft.Network/networkSecurityGroups/securityRules@2021-08-01' = {
  parent: nsg
  name: 'allow-syslog'
  properties: {
    priority: 100
    direction: 'Inbound'
    access: 'Allow'
    protocol: 'Udp'
    sourceAddressPrefix: 'VirtualNetwork'
    sourcePortRange: '*'
    destinationAddressPrefix: '*'
    destinationPortRange: '514'
  }
}
```

Configure the forwarder:

```bash
#!/bin/bash
# setup-syslog-forwarder.sh

# Install rsyslog
apt-get update
apt-get install -y rsyslog

# Configure to receive remote syslog
cat > /etc/rsyslog.d/10-remote.conf << 'EOF'
# Provide UDP syslog reception
module(load="imudp")
input(type="imudp" port="514")

# Provide TCP syslog reception
module(load="imtcp")
input(type="imtcp" port="514")

# Forward everything to Azure Monitor Agent
*.* action(type="omfwd"
  target="127.0.0.1"
  port="28330"
  protocol="tcp")
EOF

# Restart rsyslog
systemctl restart rsyslog
```

## Querying Syslog Data

```kusto
// Authentication summary
Syslog
| where TimeGenerated > ago(24h)
| where Facility in ("auth", "authpriv")
| where SyslogMessage contains "Accepted" or SyslogMessage contains "Failed"
| extend
    AuthResult = case(
        SyslogMessage contains "Accepted", "Success",
        SyslogMessage contains "Failed", "Failed",
        "Unknown"
    ),
    User = extract("for (\\w+)", 1, SyslogMessage),
    SourceIP = extract("from ([0-9.]+)", 1, SyslogMessage)
| summarize
    SuccessCount = countif(AuthResult == "Success"),
    FailedCount = countif(AuthResult == "Failed")
    by Computer, User, SourceIP, bin(TimeGenerated, 1h)

// Security alerts
Syslog
| where TimeGenerated > ago(1h)
| where SeverityLevel <= 3  // Warning and above
| where Facility in ("auth", "authpriv", "kern")
| project TimeGenerated, Computer, Facility, SeverityLevel, SyslogMessage
| order by SeverityLevel asc, TimeGenerated desc
```

## Alerting on Syslog Events

```bicep
resource sshBruteForceAlert 'Microsoft.Insights/scheduledQueryRules@2021-08-01' = {
  name: 'alert-ssh-brute-force'
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
            Syslog
            | where Facility == "authpriv"
            | where SyslogMessage contains "Failed password"
            | summarize FailedAttempts = count() by Computer, bin(TimeGenerated, 5m)
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

Comprehensive syslog collection provides essential visibility into Linux system security and operations.
