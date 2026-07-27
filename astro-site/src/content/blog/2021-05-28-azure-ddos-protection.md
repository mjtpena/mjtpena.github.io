---
title: "Azure DDoS Protection: Defending Against Volumetric Attacks"
author: Michael John Peña
draft: false
date: 2021-05-28
tags:
  - Azure
  - Security
  - DDoS
  - Networking
  - Protection

---

I wrote "Azure DDoS Protection: Defending Against Volumetric Attacks" to share practical, production-minded guidance on this topic.

## DDoS Protection Tiers

**Basic (Free)**
- Always-on traffic monitoring
- Automatic mitigation
- Protection for Azure infrastructure
- No SLA or customization

**Standard (Paid)**
- All Basic features plus:
- Adaptive tuning per application
- Real-time metrics and diagnostics
- Cost protection guarantee
- DDoS Rapid Response (DRR)
- Attack mitigation reports

## Enabling DDoS Protection Standard

```bash
# Create DDoS Protection Plan
az network ddos-protection create \
    --name ddos-plan \
    --resource-group security-rg \
    --location eastus

# Associate with Virtual Network
az network vnet update \
    --name my-vnet \
    --resource-group my-rg \
    --ddos-protection-plan ddos-plan
```

Via Terraform:

```hcl
resource "azurerm_network_ddos_protection_plan" "main" {
  name                = "ddos-protection-plan"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
}

resource "azurerm_virtual_network" "main" {
  name                = "production-vnet"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  address_space       = ["10.0.0.0/16"]

  ddos_protection_plan {
    id     = azurerm_network_ddos_protection_plan.main.id
    enable = true
  }
}
```

## Protection Policies

Configure per-public-IP policies:

```python
from azure.mgmt.network import NetworkManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
network_client = NetworkManagementClient(credential, subscription_id)

# Create custom DDoS policy
ddos_policy = network_client.ddos_custom_policies.begin_create_or_update(
    resource_group_name="security-rg",
    ddos_custom_policy_name="web-app-policy",
    parameters={
        "location": "eastus",
        "protocol_custom_settings": [
            {
                "protocol": "Tcp",
                "trigger_rate_override": "default",
                "source_rate_override": "default",
                "trigger_sensitivity_override": "default"
            }
        ]
    }
).result()

# Associate with public IP
public_ip = network_client.public_ip_addresses.begin_create_or_update(
    resource_group_name="my-rg",
    public_ip_address_name="webapp-pip",
    parameters={
        "location": "eastus",
        "sku": {"name": "Standard"},
        "ddos_settings": {
            "ddos_custom_policy": {
                "id": ddos_policy.id
            },
            "protection_coverage": "Standard",
            "protected_ip": True
        }
    }
).result()
```

## Monitoring and Metrics

### Key Metrics to Monitor

```bash
# Get DDoS metrics
az monitor metrics list \
    --resource /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Network/publicIPAddresses/<pip> \
    --metric "DDoSAttackBytes" "DDoSAttackPackets" "IfUnderDDoSAttack" \
    --interval PT1M
```

### Azure Monitor Queries

```kusto
// DDoS attack overview
AzureDiagnostics
| where ResourceType == "PUBLICIPADDRESSES"
| where Category == "DDoSProtectionNotifications"
| project
    TimeGenerated,
    Message,
    publicIpAddress_s
| order by TimeGenerated desc

// Attack mitigation details
AzureDiagnostics
| where ResourceType == "PUBLICIPADDRESSES"
| where Category == "DDoSMitigationReports"
| extend AttackVectors = parse_json(attackVectors_s)
| mv-expand AttackVectors
| project
    TimeGenerated,
    publicIpAddress_s,
    AttackVector = tostring(AttackVectors.vectorType),
    MaxAttackBandwidth = todouble(attackBandwidth_s),
    TotalPackets = todouble(totalPackets_s)
```

### Alert Configuration

```bash
# Alert when under DDoS attack
az monitor metrics alert create \
    --name "DDoS Attack Alert" \
    --resource-group security-rg \
    --scopes /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Network/publicIPAddresses/<pip> \
    --condition "avg IfUnderDDoSAttack > 0" \
    --window-size 5m \
    --evaluation-frequency 1m \
    --action /subscriptions/<sub>/resourceGroups/<rg>/providers/microsoft.insights/actionGroups/security-team \
    --severity 0

# Alert on high packet rate
az monitor metrics alert create \
    --name "High DDoS Packet Rate" \
    --resource-group security-rg \
    --scopes /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Network/publicIPAddresses/<pip> \
    --condition "total InDDoSPackets > 1000000" \
    --window-size 5m \
    --evaluation-frequency 1m \
    --action /subscriptions/<sub>/resourceGroups/<rg>/providers/microsoft.insights/actionGroups/security-team \
    --severity 1
```

## Diagnostic Logging

```bash
# Enable DDoS diagnostic logs
az monitor diagnostic-settings create \
    --name ddos-diagnostics \
    --resource /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.Network/publicIPAddresses/<pip> \
    --workspace /subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.OperationalInsights/workspaces/security-workspace \
    --logs '[
        {"category": "DDoSProtectionNotifications", "enabled": true},
        {"category": "DDoSMitigationFlowLogs", "enabled": true},
        {"category": "DDoSMitigationReports", "enabled": true}
    ]' \
    --metrics '[{"category": "AllMetrics", "enabled": true}]'
```

## Attack Simulation Testing

Azure allows authorized testing:

```python
# Note: This requires coordination with Azure support
# and should only be done with proper authorization

def request_ddos_test():
    """Request DDoS simulation test from Azure"""
    # Contact Azure support or use authorized testing service
    # BreakingPoint Cloud is an approved partner

    test_params = {
        "target_ip": "20.1.2.3",
        "attack_types": [
            "TCP SYN Flood",
            "UDP Flood",
            "HTTP Flood"
        ],
        "duration_minutes": 15,
        "max_bandwidth_gbps": 10
    }

    # Azure validates you own the IP before testing
    return test_params
```

## Cost Protection

DDoS Standard includes cost protection:

```python
def estimate_ddos_attack_cost(attack_duration_hours, attack_bandwidth_gbps):
    """Estimate costs that would be incurred without protection"""

    # Normal egress costs ~$0.087/GB
    # Attack could generate massive egress

    attack_data_gb = attack_bandwidth_gbps * 3600 * attack_duration_hours / 8

    potential_cost = attack_data_gb * 0.087
    cost_protection_limit = 10000  # Azure covers up to this amount

    print(f"Attack data volume: {attack_data_gb:,.0f} GB")
    print(f"Potential egress cost: ${potential_cost:,.2f}")
    print(f"Cost protection coverage: ${min(potential_cost, cost_protection_limit):,.2f}")

    return {
        'data_volume_gb': attack_data_gb,
        'potential_cost': potential_cost,
        'protected_cost': min(potential_cost, cost_protection_limit)
    }

# 2-hour attack at 100 Gbps
estimate_ddos_attack_cost(2, 100)
```

## DDoS Rapid Response (DRR)

For active attack support:

```python
def engage_ddos_rapid_response():
    """Engage DDoS Rapid Response team during active attack"""

    # Requirements:
    # 1. DDoS Protection Standard enabled
    # 2. Active attack detected
    # 3. Contact Azure support

    engagement_info = {
        "support_ticket": "Create via Azure Portal",
        "severity": "A - Critical Impact",
        "category": "Security/DDoS Protection",
        "required_info": [
            "Subscription ID",
            "Public IP address under attack",
            "Attack start time",
            "Current impact description",
            "Contact information"
        ]
    }

    return engagement_info
```

## Integration with Application Gateway

```bash
# Application Gateway with DDoS protection
az network application-gateway create \
    --name my-appgw \
    --resource-group my-rg \
    --location eastus \
    --vnet-name my-vnet \
    --subnet appgw-subnet \
    --public-ip-address appgw-pip \
    --sku WAF_v2

# The public IP inherits DDoS protection from the VNet
```

## Best Practices

1. **Protect all public IPs**: Enable DDoS Standard on all VNets with public-facing resources
2. **Configure alerts**: Know immediately when attacks occur
3. **Enable all logs**: DDoS flow logs help post-attack analysis
4. **Test regularly**: Use authorized testing to validate protection
5. **Use with WAF**: DDoS handles volumetric attacks, WAF handles application-layer attacks

```python
def ddos_protection_checklist():
    return {
        "infrastructure": [
            "DDoS Protection Standard enabled on all production VNets",
            "Custom policies configured for critical public IPs",
            "Diagnostic logging enabled"
        ],
        "monitoring": [
            "Attack alerts configured",
            "Dashboard with DDoS metrics created",
            "Integration with SIEM (Sentinel)"
        ],
        "process": [
            "DRR engagement process documented",
            "Incident response playbook includes DDoS scenarios",
            "Regular testing scheduled"
        ]
    }
```

## Resources

- [Azure DDoS Protection Documentation](https://docs.microsoft.com/en-us/azure/ddos-protection/)
- [Best Practices](https://docs.microsoft.com/en-us/azure/ddos-protection/fundamental-best-practices)
- [Reference Architectures](https://docs.microsoft.com/en-us/azure/ddos-protection/ddos-protection-reference-architectures)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
