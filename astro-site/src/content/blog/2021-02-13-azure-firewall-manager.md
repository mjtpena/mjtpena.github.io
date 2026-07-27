---
title: Centralized Security Management with Azure Firewall Manager
author: Michael John Peña
draft: false
date: 2021-02-13
url: /blog/azure-firewall-manager/
tags:
  - Azure
  - Security
  - Networking
  - Firewall
  - Enterprise

---

I wrote "2021-02-13-azure-firewall-manager" to share practical, production-minded guidance on this topic.

## Key Features

Azure Firewall Manager provides:

- **Hierarchical policy management** - Parent and child policies for inheritance
- **Global deployment** - Manage firewalls across regions and subscriptions
- **Secured Virtual Hub** - Integration with Virtual WAN
- **Third-party SECaaS** - Integration with security partners
- **DDoS protection** - Integrated DDoS Protection plans

## Creating Firewall Policies

Create a hierarchical policy structure:

```bash
# Create base (parent) policy
az network firewall policy create \
    --name fw-policy-base \
    --resource-group rg-firewall-demo \
    --location eastus \
    --sku Premium \
    --threat-intel-mode Alert \
    --intrusion-detection mode Alert

# Create regional child policy inheriting from base
az network firewall policy create \
    --name fw-policy-eastus \
    --resource-group rg-firewall-demo \
    --location eastus \
    --sku Premium \
    --base-policy fw-policy-base

az network firewall policy create \
    --name fw-policy-westeurope \
    --resource-group rg-firewall-demo \
    --location westeurope \
    --sku Premium \
    --base-policy fw-policy-base
```

## Configuring Rule Collections

### Network Rules

```bash
# Create rule collection group for network rules
az network firewall policy rule-collection-group create \
    --name rcg-network \
    --policy-name fw-policy-base \
    --resource-group rg-firewall-demo \
    --priority 200

# Add network rule collection
az network firewall policy rule-collection-group collection add-filter-collection \
    --resource-group rg-firewall-demo \
    --policy-name fw-policy-base \
    --rule-collection-group-name rcg-network \
    --name allow-internal-traffic \
    --collection-priority 100 \
    --action Allow \
    --rule-name allow-spoke-to-spoke \
    --rule-type NetworkRule \
    --source-addresses "10.0.0.0/8" \
    --destination-addresses "10.0.0.0/8" \
    --destination-ports '*' \
    --ip-protocols Any

# Add DNS rule
az network firewall policy rule-collection-group collection rule add \
    --resource-group rg-firewall-demo \
    --policy-name fw-policy-base \
    --rule-collection-group-name rcg-network \
    --collection-name allow-internal-traffic \
    --name allow-dns \
    --rule-type NetworkRule \
    --source-addresses "10.0.0.0/8" \
    --destination-addresses "168.63.129.16" \
    --destination-ports 53 \
    --ip-protocols UDP TCP
```

### Application Rules

```bash
# Create rule collection group for application rules
az network firewall policy rule-collection-group create \
    --name rcg-application \
    --policy-name fw-policy-base \
    --resource-group rg-firewall-demo \
    --priority 300

# Add application rule collection for web traffic
az network firewall policy rule-collection-group collection add-filter-collection \
    --resource-group rg-firewall-demo \
    --policy-name fw-policy-base \
    --rule-collection-group-name rcg-application \
    --name allow-web-outbound \
    --collection-priority 100 \
    --action Allow \
    --rule-name allow-microsoft \
    --rule-type ApplicationRule \
    --source-addresses "10.0.0.0/8" \
    --protocols Http=80 Https=443 \
    --target-fqdns "*.microsoft.com" "*.azure.com" "*.windows.net"

# Add rule for package managers
az network firewall policy rule-collection-group collection rule add \
    --resource-group rg-firewall-demo \
    --policy-name fw-policy-base \
    --rule-collection-group-name rcg-application \
    --collection-name allow-web-outbound \
    --name allow-package-managers \
    --rule-type ApplicationRule \
    --source-addresses "10.0.0.0/8" \
    --protocols Https=443 \
    --target-fqdns "pypi.org" "*.pypi.org" "npmjs.org" "*.npmjs.org" "nuget.org" "*.nuget.org"
```

### DNAT Rules

```bash
# Create rule collection group for DNAT
az network firewall policy rule-collection-group create \
    --name rcg-dnat \
    --policy-name fw-policy-base \
    --resource-group rg-firewall-demo \
    --priority 100

# Add DNAT rule for web server
az network firewall policy rule-collection-group collection add-nat-collection \
    --resource-group rg-firewall-demo \
    --policy-name fw-policy-base \
    --rule-collection-group-name rcg-dnat \
    --name dnat-web-servers \
    --collection-priority 100 \
    --action DNAT \
    --rule-name web-server-1 \
    --source-addresses '*' \
    --destination-addresses "20.0.0.1" \
    --destination-ports 443 \
    --ip-protocols TCP \
    --translated-address "10.10.1.10" \
    --translated-port 443
```

## Threat Intelligence Configuration

```python
import requests
from azure.identity import DefaultAzureCredential

def configure_threat_intel(subscription_id, resource_group, policy_name):
    """Configure threat intelligence settings for firewall policy."""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://management.azure.com/.default")

    url = f"https://management.azure.com/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/firewallPolicies/{policy_name}?api-version=2021-05-01"

    # Get current policy
    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    response = requests.get(url, headers=headers)
    policy = response.json()

    # Update threat intelligence settings
    policy["properties"]["threatIntelMode"] = "Deny"
    policy["properties"]["threatIntelWhitelist"] = {
        "ipAddresses": ["203.0.113.0/24"],  # Trusted IPs
        "fqdns": ["trusted.example.com"]     # Trusted domains
    }

    # Update policy
    response = requests.put(url, headers=headers, json=policy)
    return response.json()

def add_ip_groups(subscription_id, resource_group, ip_group_name, addresses):
    """Create IP Group for use in firewall rules."""

    credential = DefaultAzureCredential()
    token = credential.get_token("https://management.azure.com/.default")

    url = f"https://management.azure.com/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/ipGroups/{ip_group_name}?api-version=2021-05-01"

    body = {
        "location": "eastus",
        "properties": {
            "ipAddresses": addresses
        }
    }

    headers = {
        "Authorization": f"Bearer {token.token}",
        "Content-Type": "application/json"
    }

    response = requests.put(url, headers=headers, json=body)
    return response.json()

# Create IP groups for common use cases
add_ip_groups(
    subscription_id,
    "rg-firewall-demo",
    "ipg-internal-servers",
    ["10.10.1.0/24", "10.10.2.0/24"]
)

add_ip_groups(
    subscription_id,
    "rg-firewall-demo",
    "ipg-management-ips",
    ["10.0.0.10", "10.0.0.11", "10.0.0.12"]
)
```

## Intrusion Detection and Prevention (IDPS)

Configure IDPS for Premium SKU:

```bash
# Enable IDPS in Alert and Deny mode
az network firewall policy update \
    --name fw-policy-base \
    --resource-group rg-firewall-demo \
    --intrusion-detection mode Deny

# Configure IDPS signature overrides
az network firewall policy intrusion-detection add \
    --policy-name fw-policy-base \
    --resource-group rg-firewall-demo \
    --mode Off \
    --signature-id 2024897

# Add private IP ranges for IDPS
az network firewall policy intrusion-detection add \
    --policy-name fw-policy-base \
    --resource-group rg-firewall-demo \
    --private-ranges "10.0.0.0/8" "172.16.0.0/12" "192.168.0.0/16"
```

## TLS Inspection

Configure TLS inspection for deep packet inspection:

```bash
# Create Key Vault for certificates
az keyvault create \
    --name kv-firewall-certs \
    --resource-group rg-firewall-demo \
    --location eastus

# Create managed identity for firewall
az identity create \
    --name mi-firewall \
    --resource-group rg-firewall-demo

# Grant Key Vault access
az keyvault set-policy \
    --name kv-firewall-certs \
    --object-id $(az identity show --name mi-firewall --resource-group rg-firewall-demo --query principalId -o tsv) \
    --secret-permissions get list \
    --certificate-permissions get list

# Import CA certificate to Key Vault
az keyvault certificate import \
    --vault-name kv-firewall-certs \
    --name firewall-ca-cert \
    --file ca-certificate.pfx \
    --password "CertPassword"

# Enable TLS inspection on policy
az network firewall policy update \
    --name fw-policy-base \
    --resource-group rg-firewall-demo \
    --identity mi-firewall \
    --key-vault-secret-id "https://kv-firewall-certs.vault.azure.net/secrets/firewall-ca-cert"
```

## Managing Multiple Firewalls

Deploy and manage firewalls across regions:

```json
{
    "$schema": "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
    "contentVersion": "1.0.0.0",
    "parameters": {
        "regions": {
            "type": "array",
            "defaultValue": ["eastus", "westeurope", "southeastasia"]
        },
        "basePolicyId": {
            "type": "string"
        }
    },
    "resources": [
        {
            "type": "Microsoft.Network/firewallPolicies",
            "apiVersion": "2021-05-01",
            "name": "[concat('fw-policy-', parameters('regions')[copyIndex()])]",
            "location": "[parameters('regions')[copyIndex()]]",
            "copy": {
                "name": "policyLoop",
                "count": "[length(parameters('regions'))]"
            },
            "properties": {
                "sku": {
                    "tier": "Premium"
                },
                "basePolicy": {
                    "id": "[parameters('basePolicyId')]"
                },
                "threatIntelMode": "Deny"
            }
        },
        {
            "type": "Microsoft.Network/azureFirewalls",
            "apiVersion": "2021-05-01",
            "name": "[concat('fw-', parameters('regions')[copyIndex()])]",
            "location": "[parameters('regions')[copyIndex()]]",
            "dependsOn": [
                "[resourceId('Microsoft.Network/firewallPolicies', concat('fw-policy-', parameters('regions')[copyIndex()]))]"
            ],
            "copy": {
                "name": "firewallLoop",
                "count": "[length(parameters('regions'))]"
            },
            "properties": {
                "sku": {
                    "name": "AZFW_VNet",
                    "tier": "Premium"
                },
                "firewallPolicy": {
                    "id": "[resourceId('Microsoft.Network/firewallPolicies', concat('fw-policy-', parameters('regions')[copyIndex()]))]"
                }
            }
        }
    ]
}
```

## Monitoring and Analytics

Query firewall logs for security insights:

```kusto
// Top blocked threats by threat intelligence
AzureDiagnostics
| where Category == "AzureFirewallNetworkRule" or Category == "AzureFirewallApplicationRule"
| where Action_s == "Deny"
| where ThreatIntel_s != ""
| summarize Count = count() by ThreatIntel_s, SourceIP = SourceIp_s
| order by Count desc
| take 20

// IDPS alerts
AzureDiagnostics
| where Category == "AzureFirewallIdpsLog"
| where TimeGenerated > ago(24h)
| project TimeGenerated, SourceIp_s, DestIp_s, SignatureName_s, SignatureId_d, Severity_s
| order by Severity_s desc, TimeGenerated desc

// Application rule hits by FQDN
AzureDiagnostics
| where Category == "AzureFirewallApplicationRule"
| where TimeGenerated > ago(1h)
| extend FQDN = extract("to ([^:]+):", 1, msg_s)
| summarize Count = count() by FQDN, Action_s
| order by Count desc
| take 50

// Denied traffic analysis
AzureDiagnostics
| where Category in ("AzureFirewallNetworkRule", "AzureFirewallApplicationRule")
| where Action_s == "Deny"
| summarize
    DeniedCount = count(),
    UniqueSourceIPs = dcount(SourceIp_s)
    by bin(TimeGenerated, 1h)
| render timechart
```

## Best Practices

1. **Use hierarchical policies** for consistent baseline rules across all firewalls
2. **Enable threat intelligence** in Deny mode for production environments
3. **Configure IDPS** with Premium SKU for advanced threat protection
4. **Use IP Groups** for maintainable rule management
5. **Implement TLS inspection** for encrypted traffic visibility
6. **Monitor and alert** on blocked traffic and threat intelligence hits

## Conclusion

Azure Firewall Manager provides the centralized control needed for enterprise-scale firewall deployments. By using hierarchical policies and integrated threat protection features, you can maintain consistent security posture across all your Azure environments.

Start with a base policy defining organization-wide rules, then create regional child policies for location-specific requirements.

