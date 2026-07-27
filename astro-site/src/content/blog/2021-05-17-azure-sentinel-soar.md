---
title: "Azure Sentinel SOAR: Automating Security Response"
author: Michael John Peña
draft: false
date: 2021-05-17
tags:
  - Azure
  - Security
  - Sentinel
  - SOAR
  - Automation

---

I wrote "Azure Sentinel SOAR: Automating Security Response" to share practical, production-minded guidance on this topic.

## What is SOAR?

SOAR combines three capabilities:
- **Orchestration**: Connecting security tools
- **Automation**: Automatic response to threats
- **Response**: Standardized incident handling

In Sentinel, SOAR is implemented through Playbooks (Logic Apps) and Automation Rules.

## Setting Up Azure Sentinel

```bash
# Create Log Analytics workspace
az monitor log-analytics workspace create \
    --name sentinel-workspace \
    --resource-group security-rg \
    --location eastus \
    --retention-time 90

# Enable Sentinel on workspace
az sentinel onboarding-state create \
    --workspace-name sentinel-workspace \
    --resource-group security-rg
```

## Creating Playbooks

Playbooks are Logic Apps triggered by Sentinel incidents:

```json
{
  "definition": {
    "$schema": "https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#",
    "triggers": {
      "Microsoft_Sentinel_incident": {
        "type": "ApiConnectionWebhook",
        "inputs": {
          "body": {
            "callback_url": "@{listCallbackUrl()}"
          },
          "host": {
            "connection": {
              "name": "@parameters('$connections')['azuresentinel']['connectionId']"
            }
          },
          "path": "/incident-creation"
        }
      }
    },
    "actions": {
      "Get_incident": {
        "type": "ApiConnection",
        "inputs": {
          "host": {
            "connection": {
              "name": "@parameters('$connections')['azuresentinel']['connectionId']"
            }
          },
          "method": "get",
          "path": "/Incidents/subscriptions/@{triggerBody()?['workspaceSubscriptionId']}/resourceGroups/@{triggerBody()?['workspaceResourceGroup']}/workspaces/@{triggerBody()?['workspaceId']}/incidents/@{triggerBody()?['object']?['properties']?['incidentNumber']}"
        }
      },
      "Enrich_with_TI": {
        "type": "Http",
        "inputs": {
          "method": "GET",
          "uri": "https://api.threatintelligence.com/lookup",
          "queries": {
            "ip": "@{body('Get_incident')?['properties']?['relatedEntities'][0]?['properties']?['address']}"
          },
          "headers": {
            "Authorization": "Bearer @{parameters('TI_API_Key')}"
          }
        },
        "runAfter": {
          "Get_incident": ["Succeeded"]
        }
      },
      "Update_incident_with_enrichment": {
        "type": "ApiConnection",
        "inputs": {
          "host": {
            "connection": {
              "name": "@parameters('$connections')['azuresentinel']['connectionId']"
            }
          },
          "method": "put",
          "path": "/Incidents",
          "body": {
            "incidentArmId": "@{body('Get_incident')?['id']}",
            "tagsToAdd": {
              "TagsToAdd": [
                {
                  "Tag": "@{body('Enrich_with_TI')?['reputation']}"
                }
              ]
            }
          }
        },
        "runAfter": {
          "Enrich_with_TI": ["Succeeded"]
        }
      }
    }
  }
}
```

## Common Playbook Patterns

### Block IP Address

```json
{
  "actions": {
    "Get_IP_entities": {
      "type": "ApiConnection",
      "inputs": {
        "host": {
          "connection": {
            "name": "@parameters('$connections')['azuresentinel']['connectionId']"
          }
        },
        "method": "post",
        "path": "/entities/ip"
      }
    },
    "For_each_IP": {
      "type": "Foreach",
      "foreach": "@body('Get_IP_entities')?['IPs']",
      "actions": {
        "Add_to_NSG_deny_rule": {
          "type": "ApiConnection",
          "inputs": {
            "host": {
              "connection": {
                "name": "@parameters('$connections')['arm']['connectionId']"
              }
            },
            "method": "patch",
            "path": "/subscriptions/@{parameters('SubscriptionId')}/resourceGroups/@{parameters('ResourceGroup')}/providers/Microsoft.Network/networkSecurityGroups/@{parameters('NSGName')}/securityRules/DenyMaliciousIPs",
            "body": {
              "properties": {
                "sourceAddressPrefixes": "@union(body('Get_current_NSG_rule')?['properties']?['sourceAddressPrefixes'], array(items('For_each_IP')?['Address']))"
              }
            }
          }
        }
      },
      "runAfter": {
        "Get_IP_entities": ["Succeeded"]
      }
    }
  }
}
```

### Disable Compromised User

```python
# Azure Function for user remediation
import logging
import azure.functions as func
from msgraph.core import GraphClient
from azure.identity import DefaultAzureCredential

def main(req: func.HttpRequest) -> func.HttpResponse:
    # Get user principal name from Sentinel incident
    user_upn = req.params.get('upn')

    if not user_upn:
        return func.HttpResponse("UPN required", status_code=400)

    # Initialize Graph client
    credential = DefaultAzureCredential()
    client = GraphClient(credential=credential)

    # Disable user account
    response = client.patch(
        f'/users/{user_upn}',
        json={'accountEnabled': False}
    )

    if response.status_code == 204:
        # Revoke all sessions
        client.post(f'/users/{user_upn}/revokeSignInSessions')

        # Add to risky users
        logging.info(f"Disabled user: {user_upn}")
        return func.HttpResponse(f"User {user_upn} disabled and sessions revoked")

    return func.HttpResponse(f"Failed to disable user", status_code=500)
```

### Isolate VM

```json
{
  "actions": {
    "Get_VM_entities": {
      "type": "ApiConnection",
      "inputs": {
        "path": "/entities/host"
      }
    },
    "For_each_VM": {
      "type": "Foreach",
      "foreach": "@body('Get_VM_entities')?['Hosts']",
      "actions": {
        "Get_VM_network_interfaces": {
          "type": "ApiConnection",
          "inputs": {
            "method": "get",
            "path": "/subscriptions/@{parameters('SubscriptionId')}/resourceGroups/@{items('For_each_VM')?['AzureID']}/providers/Microsoft.Compute/virtualMachines/@{items('For_each_VM')?['HostName']}"
          }
        },
        "Apply_isolation_NSG": {
          "type": "ApiConnection",
          "inputs": {
            "method": "put",
            "path": "/subscriptions/@{parameters('SubscriptionId')}/resourceGroups/@{parameters('ResourceGroup')}/providers/Microsoft.Network/networkInterfaces/@{body('Get_VM_network_interfaces')?['properties']?['networkInterfaces'][0]?['id']}",
            "body": {
              "properties": {
                "networkSecurityGroup": {
                  "id": "/subscriptions/@{parameters('SubscriptionId')}/resourceGroups/@{parameters('ResourceGroup')}/providers/Microsoft.Network/networkSecurityGroups/IsolationNSG"
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

## Automation Rules

Automation rules trigger playbooks automatically:

```bash
# Create automation rule
az sentinel automation-rule create \
    --name "Auto-enrich high severity incidents" \
    --resource-group security-rg \
    --workspace-name sentinel-workspace \
    --order 1 \
    --triggering-logic '{
        "isEnabled": true,
        "triggersOn": "Incidents",
        "triggersWhen": "Created",
        "conditions": [
            {
                "conditionType": "Property",
                "conditionProperties": {
                    "propertyName": "IncidentSeverity",
                    "operator": "Equals",
                    "propertyValues": ["High"]
                }
            }
        ]
    }' \
    --actions '[
        {
            "actionType": "RunPlaybook",
            "actionConfiguration": {
                "logicAppResourceId": "/subscriptions/.../logicApps/Enrich-Incident"
            }
        }
    ]'
```

## Integration with Azure Functions

For complex logic, use Azure Functions:

```python
# Function to analyze threat intelligence
import azure.functions as func
from azure.keyvault.secrets import SecretClient
from azure.identity import DefaultAzureCredential
import requests

def main(req: func.HttpRequest) -> func.HttpResponse:
    indicator = req.params.get('indicator')
    indicator_type = req.params.get('type')  # ip, domain, hash

    # Get API keys from Key Vault
    credential = DefaultAzureCredential()
    kv_client = SecretClient(
        vault_url="https://security-vault.vault.azure.net",
        credential=credential
    )

    # Query multiple TI sources
    results = {
        'indicator': indicator,
        'type': indicator_type,
        'sources': []
    }

    # VirusTotal
    vt_key = kv_client.get_secret("virustotal-api-key").value
    vt_response = query_virustotal(indicator, indicator_type, vt_key)
    results['sources'].append({'name': 'VirusTotal', 'data': vt_response})

    # AbuseIPDB (for IPs)
    if indicator_type == 'ip':
        abuse_key = kv_client.get_secret("abuseipdb-api-key").value
        abuse_response = query_abuseipdb(indicator, abuse_key)
        results['sources'].append({'name': 'AbuseIPDB', 'data': abuse_response})

    # Calculate risk score
    results['risk_score'] = calculate_risk_score(results['sources'])
    results['recommendation'] = get_recommendation(results['risk_score'])

    return func.HttpResponse(
        json.dumps(results),
        mimetype="application/json"
    )

def calculate_risk_score(sources):
    scores = []
    for source in sources:
        if source['name'] == 'VirusTotal':
            positives = source['data'].get('positives', 0)
            total = source['data'].get('total', 1)
            scores.append(positives / total * 100)
        elif source['name'] == 'AbuseIPDB':
            scores.append(source['data'].get('abuseConfidenceScore', 0))

    return sum(scores) / len(scores) if scores else 0

def get_recommendation(risk_score):
    if risk_score > 80:
        return "BLOCK_IMMEDIATELY"
    elif risk_score > 50:
        return "INVESTIGATE"
    else:
        return "MONITOR"
```

## Incident Response Workflow

Complete incident response automation:

```yaml
# Pseudo-code workflow
name: "Malware Detection Response"
trigger: Sentinel Incident (Malware detected)

steps:
  1. Enrich incident:
     - Query file hash in TI databases
     - Get user context from Azure AD
     - Check device compliance status

  2. Assess severity:
     - If TI score > 80 AND user is privileged:
         severity = Critical
     - Else if TI score > 50:
         severity = High

  3. Containment (if Critical):
     - Isolate affected device via Defender ATP
     - Disable user account
     - Block file hash tenant-wide

  4. Investigation:
     - Query all devices for same file hash
     - Check user's recent sign-ins
     - Look for lateral movement

  5. Notification:
     - Create ServiceNow ticket
     - Send Teams notification to SOC
     - Page on-call if after hours

  6. Documentation:
     - Add all enrichment to incident
     - Update incident status
     - Add timeline comments
```

## Resources

- [Azure Sentinel Playbooks](https://docs.microsoft.com/en-us/azure/sentinel/tutorial-respond-threats-playbook)
- [Automation Rules](https://docs.microsoft.com/en-us/azure/sentinel/automate-incident-handling-with-automation-rules)
- [Sentinel Community Playbooks](https://github.com/Azure/Azure-Sentinel/tree/master/Playbooks)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
