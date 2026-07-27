---
title: "Azure Security Center and Microsoft Defender: Unified Cloud Security"
author: Michael John Peña
draft: false
date: 2021-05-18
tags:
  - Azure
  - Security
  - Defender
  - Cloud Security
  - CSPM

---

I wrote "Azure Security Center and Microsoft Defender: Unified Cloud Security" to share practical, production-minded guidance on this topic.

## Understanding the Components

Microsoft Defender for Cloud includes:
- **CSPM** (Cloud Security Posture Management): Free tier with security recommendations
- **CWP** (Cloud Workload Protection): Paid plans for threat detection

Defender plans available:
- Defender for Servers
- Defender for App Service
- Defender for Storage
- Defender for SQL
- Defender for Kubernetes
- Defender for Container Registries
- Defender for Key Vault

## Enabling Defender Plans

```bash
# Enable Defender for Servers
az security pricing create \
    --name VirtualMachines \
    --tier Standard

# Enable Defender for Storage
az security pricing create \
    --name StorageAccounts \
    --tier Standard

# Enable Defender for SQL
az security pricing create \
    --name SqlServers \
    --tier Standard

# Enable Defender for Kubernetes
az security pricing create \
    --name KubernetesService \
    --tier Standard

# Check enabled plans
az security pricing list --output table
```

## Security Policies and Initiatives

Apply security policies via Azure Policy:

```bash
# Assign Azure Security Benchmark initiative
az policy assignment create \
    --name "Azure Security Benchmark" \
    --scope /subscriptions/<subscription-id> \
    --policy-set-definition /providers/Microsoft.Authorization/policySetDefinitions/1f3afdf9-d0c9-4c3d-847f-89da613e70a8

# Create custom security policy
az policy definition create \
    --name "Require-SQL-TDE" \
    --display-name "Require TDE on SQL Databases" \
    --description "Ensures Transparent Data Encryption is enabled" \
    --rules '{
        "if": {
            "allOf": [
                {
                    "field": "type",
                    "equals": "Microsoft.Sql/servers/databases"
                },
                {
                    "field": "Microsoft.Sql/servers/databases/transparentDataEncryption.status",
                    "notEquals": "Enabled"
                }
            ]
        },
        "then": {
            "effect": "deny"
        }
    }'
```

## Working with Recommendations

Query recommendations programmatically:

```python
from azure.identity import DefaultAzureCredential
from azure.mgmt.security import SecurityCenter

credential = DefaultAzureCredential()
client = SecurityCenter(credential, subscription_id, asc_location="centralus")

# Get all recommendations
recommendations = client.recommendations.list()

for rec in recommendations:
    if rec.state == "Unhealthy":
        print(f"Resource: {rec.resource_details.id}")
        print(f"Recommendation: {rec.display_name}")
        print(f"Severity: {rec.severity}")
        print(f"Remediation: {rec.remediation_description}")
        print("---")

# Get recommendation by ID
rec = client.recommendations.get(
    resource_id="/subscriptions/.../resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
    recommendation_id="recommendation-guid"
)
```

## Automated Remediation

Create workflow automation for auto-remediation:

```json
{
  "definition": {
    "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
    "triggers": {
      "When_an_Azure_Security_Center_Recommendation_is_created_or_triggered": {
        "type": "ApiConnectionWebhook",
        "inputs": {
          "body": {
            "callback_url": "@{listCallbackUrl()}"
          },
          "host": {
            "connection": {
              "name": "@parameters('$connections')['ascassessment']['connectionId']"
            }
          },
          "path": "/Microsoft.Security/Recommendations/subscribe"
        }
      }
    },
    "actions": {
      "Condition_Check_Recommendation_Type": {
        "type": "If",
        "expression": {
          "and": [
            {
              "equals": [
                "@triggerBody()?['properties']?['displayName']",
                "Storage account should use a private link connection"
              ]
            }
          ]
        },
        "actions": {
          "Enable_Private_Endpoint": {
            "type": "ApiConnection",
            "inputs": {
              "host": {
                "connection": {
                  "name": "@parameters('$connections')['arm']['connectionId']"
                }
              },
              "method": "put",
              "path": "/subscriptions/@{triggerBody()?['properties']?['resourceDetails']?['id']}/providers/Microsoft.Network/privateEndpoints/storage-pe",
              "body": {
                "location": "eastus",
                "properties": {
                  "privateLinkServiceConnections": [
                    {
                      "name": "storage-connection",
                      "properties": {
                        "privateLinkServiceId": "@{triggerBody()?['properties']?['resourceDetails']?['id']}",
                        "groupIds": ["blob"]
                      }
                    }
                  ],
                  "subnet": {
                    "id": "/subscriptions/.../subnets/private-endpoints"
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

## Defender for Servers

Configure Defender for Servers features:

```bash
# Enable auto-provisioning of Log Analytics agent
az security auto-provisioning-setting update \
    --name default \
    --auto-provision On

# Configure vulnerability assessment
az security va sql baseline set \
    --resource-group my-rg \
    --server-name my-sql-server \
    --database-name my-database \
    --workspace-id /subscriptions/.../workspaces/security-workspace
```

Query server vulnerabilities:

```kusto
// Find VMs with critical vulnerabilities
SecurityRecommendation
| where RecommendationDisplayName contains "vulnerability"
| where RecommendationState == "Unhealthy"
| extend Severity = tostring(parse_json(ExtendedProperties).Severity)
| where Severity == "Critical"
| project
    ResourceId,
    RecommendationDisplayName,
    Severity,
    RemediationDescription
```

## Defender for Containers

Secure your Kubernetes workloads:

```bash
# Enable Defender for AKS
az aks update \
    --name my-aks-cluster \
    --resource-group my-rg \
    --enable-defender

# Check Defender profile
az aks show \
    --name my-aks-cluster \
    --resource-group my-rg \
    --query securityProfile
```

Monitor container security:

```kusto
// Container security alerts
SecurityAlert
| where ProviderName == "Azure Security Center"
| where ResourceType == "Kubernetes Service"
| project
    TimeGenerated,
    AlertName,
    AlertSeverity,
    Description,
    RemediationSteps,
    Entities
| order by TimeGenerated desc
```

## Just-In-Time VM Access

Configure JIT access for secure VM management:

```python
from azure.mgmt.security import SecurityCenter

# Get JIT policies
jit_policies = client.jit_network_access_policies.list()

# Create JIT policy
policy = {
    "kind": "Basic",
    "properties": {
        "virtualMachines": [
            {
                "id": "/subscriptions/.../virtualMachines/secure-vm",
                "ports": [
                    {
                        "number": 22,
                        "protocol": "TCP",
                        "allowedSourceAddressPrefix": "*",
                        "maxRequestAccessDuration": "PT3H"
                    },
                    {
                        "number": 3389,
                        "protocol": "TCP",
                        "allowedSourceAddressPrefix": "*",
                        "maxRequestAccessDuration": "PT3H"
                    }
                ]
            }
        ]
    }
}

client.jit_network_access_policies.create_or_update(
    resource_group_name="my-rg",
    asc_location="centralus",
    jit_network_access_policy_name="default",
    body=policy
)

# Request JIT access
request = {
    "virtualMachines": [
        {
            "id": "/subscriptions/.../virtualMachines/secure-vm",
            "ports": [
                {
                    "number": 22,
                    "allowedSourceAddressPrefix": "203.0.113.10",
                    "endTimeUtc": "2021-05-18T15:00:00Z"
                }
            ]
        }
    ]
}

client.jit_network_access_policies.initiate(
    resource_group_name="my-rg",
    asc_location="centralus",
    jit_network_access_policy_name="default",
    body=request
)
```

## Security Score

Track and improve your security score:

```python
# Get secure score
secure_scores = client.secure_scores.list()

for score in secure_scores:
    print(f"Score: {score.current_score}/{score.max_score}")
    print(f"Percentage: {score.percentage}%")

# Get score by control
controls = client.secure_score_controls.list()

for control in controls:
    print(f"Control: {control.display_name}")
    print(f"Score: {control.current_score}/{control.max_score}")
    print(f"Unhealthy resources: {control.unhealthy_resource_count}")
```

## Continuous Export

Export security data to external systems:

```bash
# Export to Log Analytics
az security automation create \
    --name "export-to-la" \
    --resource-group security-rg \
    --scopes '[{"scopePath": "/subscriptions/<subscription-id>"}]' \
    --sources '[
        {"eventSource": "Alerts"},
        {"eventSource": "Recommendations"},
        {"eventSource": "SecureScores"}
    ]' \
    --actions '[{
        "actionType": "LogicApp",
        "logicAppResourceId": "/subscriptions/.../logicApps/export-to-la",
        "uri": "https://..."
    }]'

# Export to Event Hub
az security automation create \
    --name "export-to-eventhub" \
    --resource-group security-rg \
    --scopes '[{"scopePath": "/subscriptions/<subscription-id>"}]' \
    --sources '[{"eventSource": "Alerts"}]' \
    --actions '[{
        "actionType": "EventHub",
        "eventHubResourceId": "/subscriptions/.../eventhubs/security-alerts",
        "connectionString": "..."
    }]'
```

## Resources

- [Microsoft Defender for Cloud Documentation](https://docs.microsoft.com/en-us/azure/defender-for-cloud/)
- [Security Benchmark](https://docs.microsoft.com/en-us/security/benchmark/azure/)
- [Defender for Cloud REST API](https://docs.microsoft.com/en-us/rest/api/defenderforcloud/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
