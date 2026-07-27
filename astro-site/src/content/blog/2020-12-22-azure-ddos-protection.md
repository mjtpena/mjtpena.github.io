---
title: "Azure DDoS Protection: Defend Against Attacks"
author: Michael John Peña
draft: false
date: 2020-12-22
tags:
  - Azure
  - Security
  - DDoS
  - Networking

---

I wrote "Azure DDoS Protection: Defend Against Attacks" to share practical, production-minded guidance on this topic.

## Protection Tiers

| Feature | Basic (Free) | Standard |
|---------|--------------|----------|
| Protection | L3/L4 | L3/L4 |
| Automatic mitigation | ✓ | ✓ |
| Attack metrics | ✗ | ✓ |
| Attack alerts | ✗ | ✓ |
| Post-attack reports | ✗ | ✓ |
| Cost guarantee | ✗ | ✓ |
| Rapid Response | ✗ | ✓ |

## Enable DDoS Protection Standard

```bash
# Create DDoS protection plan
az network ddos-protection create \
    --name my-ddos-plan \
    --resource-group myRG \
    --location eastus

# Associate with VNet
az network vnet update \
    --name myVNet \
    --resource-group myRG \
    --ddos-protection-plan /subscriptions/.../ddosProtectionPlans/my-ddos-plan \
    --ddos-protection true
```

## Protection Scope

DDoS Protection Standard protects:
- Public IP addresses
- Load balancers
- Application gateways
- Azure Firewall
- VPN gateways

## Attack Types Mitigated

| Attack Type | Description |
|-------------|-------------|
| Volumetric | Flood bandwidth (UDP, ICMP) |
| Protocol | Exploit L3/L4 weaknesses (SYN flood) |
| Application | Target L7 (HTTP floods) |

## Monitoring and Alerts

```bash
# Create alert rule
az monitor metrics alert create \
    --name "ddos-attack-alert" \
    --resource-group myRG \
    --scopes /subscriptions/.../publicIPAddresses/my-pip \
    --condition "avg UnderDDoSAttack > 0" \
    --window-size 5m \
    --evaluation-frequency 1m \
    --action /subscriptions/.../actionGroups/security-team \
    --description "DDoS attack detected"
```

## DDoS Metrics

```kusto
// Query DDoS metrics
AzureMetrics
| where ResourceProvider == "MICROSOFT.NETWORK"
| where MetricName in ("IfUnderDDoSAttack", "PacketsDroppedDDoS", "PacketsForwardedDDoS")
| project TimeGenerated, Resource, MetricName, Average
| render timechart
```

## Diagnostic Logs

```bash
# Enable diagnostic settings
az monitor diagnostic-settings create \
    --name ddos-diagnostics \
    --resource /subscriptions/.../publicIPAddresses/my-pip \
    --logs '[{
        "category": "DDoSProtectionNotifications",
        "enabled": true
    },{
        "category": "DDoSMitigationFlowLogs",
        "enabled": true
    },{
        "category": "DDoSMitigationReports",
        "enabled": true
    }]' \
    --workspace /subscriptions/.../workspaces/security-logs
```

## Analyze Attack

```kusto
// DDoS notification logs
AzureDiagnostics
| where Category == "DDoSProtectionNotifications"
| project TimeGenerated, Message, ActionType, AttackVector

// Mitigation flow logs
AzureDiagnostics
| where Category == "DDoSMitigationFlowLogs"
| summarize PacketsDropped = sum(PacketsDropped_d),
    PacketsForwarded = sum(PacketsForwarded_d)
    by bin(TimeGenerated, 5m)
| render timechart
```

## DDoS Rapid Response

For Standard tier customers under attack:
1. Open support ticket (Severity A)
2. DDoS Rapid Response team engages
3. Custom mitigation rules applied
4. Attack analysis provided

## Cost Protection

During DDoS attacks, you may incur:
- Bandwidth overage
- Scale-out costs

DDoS Protection Standard provides cost credits for attack-related scaling.

## Best Practices

1. Enable Standard on production VNets
2. Configure alerts for attacks
3. Enable diagnostic logging
4. Review attack reports
5. Use Application Gateway WAF for L7

Azure DDoS Protection: resilience against the largest attacks.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
