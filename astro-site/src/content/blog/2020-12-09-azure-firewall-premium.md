---
title: "Azure Firewall: Network Security Fundamentals"
author: Michael John Peña
draft: false
date: 2020-12-09
tags:
  - Azure
  - Firewall
  - Security
  - Networking

---

I wrote "Azure Firewall: Network Security Fundamentals" to share practical, production-minded guidance on this topic.

## Core Features

| Feature | Description |
|---------|-------------|
| L3-L7 filtering | Network and application layer filtering |
| FQDN filtering | Filter by fully qualified domain names |
| Threat intelligence | Block known malicious IPs and domains |
| NAT support | DNAT and SNAT capabilities |
| DNS proxy | Custom DNS with filtering |
| Forced tunneling | Route all traffic through on-premises |

## Creating Azure Firewall

```bash
# Create firewall subnet (must be named AzureFirewallSubnet)
az network vnet subnet create \
    --name AzureFirewallSubnet \
    --resource-group myRG \
    --vnet-name hub-vnet \
    --address-prefixes 10.0.1.0/24

# Create public IP
az network public-ip create \
    --name fw-pip \
    --resource-group myRG \
    --allocation-method Static \
    --sku Standard

# Create firewall
az network firewall create \
    --name my-firewall \
    --resource-group myRG \
    --location eastus

# Configure IP
az network firewall ip-config create \
    --firewall-name my-firewall \
    --resource-group myRG \
    --name fw-config \
    --public-ip-address fw-pip \
    --vnet-name hub-vnet
```

## Network Rules

```bash
# Create network rule collection
az network firewall network-rule create \
    --firewall-name my-firewall \
    --resource-group myRG \
    --collection-name AllowInternet \
    --name AllowHTTPS \
    --protocols TCP \
    --source-addresses 10.0.0.0/8 \
    --destination-addresses '*' \
    --destination-ports 443 \
    --action Allow \
    --priority 200
```

## Application Rules (FQDN Filtering)

```bash
# Allow specific FQDNs
az network firewall application-rule create \
    --firewall-name my-firewall \
    --resource-group myRG \
    --collection-name AllowWeb \
    --name AllowMicrosoft \
    --source-addresses 10.0.0.0/8 \
    --protocols Http=80 Https=443 \
    --fqdn-tags WindowsUpdate MicrosoftActiveProtectionService \
    --action Allow \
    --priority 100
```

## FQDN Tags

Built-in tags for common services:

| Tag | Description |
|-----|-------------|
| WindowsUpdate | Windows Update endpoints |
| WindowsDiagnostics | Windows diagnostic services |
| MicrosoftActiveProtectionService | Windows Defender |
| AppServiceEnvironment | ASE management |
| AzureBackup | Azure Backup services |
| HDInsight | HDInsight cluster management |
| AzureKubernetesService | AKS management |

## NAT Rules (DNAT)

```bash
# Create DNAT rule for RDP access
az network firewall nat-rule create \
    --firewall-name my-firewall \
    --resource-group myRG \
    --collection-name AllowRDP \
    --name RDPtoVM1 \
    --source-addresses '*' \
    --destination-addresses <firewall-public-ip> \
    --destination-ports 3389 \
    --protocols TCP \
    --translated-address 10.0.2.4 \
    --translated-port 3389 \
    --action Dnat \
    --priority 100
```

## Threat Intelligence

```bash
# Enable threat intelligence filtering
az network firewall update \
    --name my-firewall \
    --resource-group myRG \
    --threat-intel-mode Alert  # or Deny
```

## DNS Settings

```bash
# Configure DNS proxy
az network firewall update \
    --name my-firewall \
    --resource-group myRG \
    --dns-servers 168.63.129.16 \
    --enable-dns-proxy true
```

## Route Traffic Through Firewall

```bash
# Create route table
az network route-table create \
    --name spoke-routes \
    --resource-group myRG \
    --location eastus

# Add default route to firewall
az network route-table route create \
    --route-table-name spoke-routes \
    --resource-group myRG \
    --name ToFirewall \
    --address-prefix 0.0.0.0/0 \
    --next-hop-type VirtualAppliance \
    --next-hop-ip-address <firewall-private-ip>

# Associate with spoke subnet
az network vnet subnet update \
    --name workload-subnet \
    --vnet-name spoke-vnet \
    --resource-group myRG \
    --route-table spoke-routes
```

## Diagnostic Logs

```bash
# Enable logging to Log Analytics
az monitor diagnostic-settings create \
    --name firewall-logs \
    --resource /subscriptions/.../azureFirewalls/my-firewall \
    --logs '[{
        "category": "AzureFirewallApplicationRule",
        "enabled": true
    },{
        "category": "AzureFirewallNetworkRule",
        "enabled": true
    },{
        "category": "AzureFirewallDnsProxy",
        "enabled": true
    }]' \
    --workspace /subscriptions/.../workspaces/my-logs
```

## KQL Queries

```kusto
// Application rule hits
AzureDiagnostics
| where Category == "AzureFirewallApplicationRule"
| parse msg_s with Protocol " request from " SourceIP ":" SourcePort " to " FQDN ":" * ". Action: " Action "." *
| project TimeGenerated, Protocol, SourceIP, FQDN, Action
| order by TimeGenerated desc

// Network rule hits
AzureDiagnostics
| where Category == "AzureFirewallNetworkRule"
| parse msg_s with Protocol " request from " SourceIP ":" SourcePort " to " DestIP ":" DestPort ". Action: " Action
| project TimeGenerated, Protocol, SourceIP, DestIP, DestPort, Action
| order by TimeGenerated desc

// Threat intelligence blocks
AzureDiagnostics
| where Category == "AzureFirewallApplicationRule" or Category == "AzureFirewallNetworkRule"
| where msg_s contains "ThreatIntel"
| project TimeGenerated, msg_s
```

## Hub-Spoke Architecture

```
                    ┌─────────────────┐
                    │   On-Premises   │
                    └────────┬────────┘
                             │ VPN/ExpressRoute
                    ┌────────┴────────┐
                    │    Hub VNet     │
                    │ ┌─────────────┐ │
                    │ │   Azure     │ │
                    │ │  Firewall   │ │
                    │ └─────────────┘ │
                    └───────┬─────────┘
              ┌─────────────┼─────────────┐
              │             │             │
        ┌─────┴─────┐ ┌─────┴─────┐ ┌─────┴─────┐
        │  Spoke 1  │ │  Spoke 2  │ │  Spoke 3  │
        │  (Web)    │ │  (App)    │ │  (Data)   │
        └───────────┘ └───────────┘ └───────────┘
```

## Pricing

- Deployment: ~$1.25/hour (~$912/month)
- Data processing: $0.016/GB

## Best Practices

1. **Use firewall policies**: Centralize rule management
2. **Implement least privilege**: Only allow required traffic
3. **Enable logging**: Critical for security auditing
4. **Use FQDN tags**: Simplify management for known services
5. **Plan IP addressing**: Consider growth in subnet sizing
6. **Monitor costs**: Data processing can add up

Azure Firewall: cloud-native network security without the complexity.

## Resources

- [Azure Firewall Documentation](https://docs.microsoft.com/en-us/azure/firewall/)
- [Azure Firewall FAQ](https://docs.microsoft.com/en-us/azure/firewall/firewall-faq)
- [Azure Network Security Best Practices](https://docs.microsoft.com/en-us/azure/security/fundamentals/network-best-practices)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
