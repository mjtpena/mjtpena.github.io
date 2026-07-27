---
title: Configuring Azure Firewall Rules for Enterprise Security
author: Michael John Peña
draft: false
date: 2021-07-16
url: /blog/azure-firewall-rules/
tags:
  - Azure
  - Networking
  - Security
  - Firewall
  - Infrastructure
---

Azure Firewall rules are the configuration work that determines whether your network security posture is genuinely restrictive or accidentally permissive. Azure Firewall has three rule types with different evaluation orders and capabilities: Network rules (Layer 3/4, IP and port-based allow/deny), Application rules (Layer 7 FQDN-based filtering with TLS inspection for Premium), and NAT rules (DNAT for inbound traffic). The processing order matters: DNAT rules first, then Network rules, then Application rules, with deny-all as the implicit default. The mistake I've seen in multiple deployments is relying on application rules for non-HTTP traffic—application rules only work for HTTP/HTTPS/SQL; for everything else, network rules are what you need. Firewall Policy is the current management model; the legacy portal configuration is being deprecated.

# Azure Firewall Rule Types

Azure Firewall supports three types of rules:

- **NAT Rules**: Translate inbound traffic to private IPs
- **Network Rules**: Filter traffic by IP, port, and protocol
- **Application Rules**: Filter traffic by FQDN

# Deploying Azure Firewall

Set up Azure Firewall with Terraform:

```hcl
# Public IP for Azure Firewall
resource "azurerm_public_ip" "firewall" {
  name                = "pip-firewall"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = ["1", "2", "3"]

  tags = {
    Environment = "Production"
  }
}

# Azure Firewall
resource "azurerm_firewall" "main" {
  name                = "fw-hub"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location
  sku_name            = "AZFW_VNet"
  sku_tier            = "Standard"
  zones               = ["1", "2", "3"]

  ip_configuration {
    name                 = "configuration"
    subnet_id            = azurerm_subnet.firewall.id
    public_ip_address_id = azurerm_public_ip.firewall.id
  }

  tags = {
    Environment = "Production"
  }
}

# Firewall Policy
resource "azurerm_firewall_policy" "main" {
  name                = "fw-policy-main"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location
  sku                 = "Standard"

  dns {
    proxy_enabled = true
    servers       = ["168.63.129.16"]  # Azure DNS
  }

  threat_intelligence_mode = "Alert"

  tags = {
    Environment = "Production"
  }
}
```

# Network Rules

Configure network-level filtering:

```hcl
# Network Rule Collection Group
resource "azurerm_firewall_policy_rule_collection_group" "network" {
  name               = "network-rules-group"
  firewall_policy_id = azurerm_firewall_policy.main.id
  priority           = 100

  # Allow Azure services
  network_rule_collection {
    name     = "azure-services"
    priority = 100
    action   = "Allow"

    rule {
      name                  = "allow-azure-monitor"
      protocols             = ["TCP"]
      source_addresses      = ["10.0.0.0/8"]
      destination_addresses = ["AzureMonitor"]
      destination_ports     = ["443"]
    }

    rule {
      name                  = "allow-azure-storage"
      protocols             = ["TCP"]
      source_addresses      = ["10.0.0.0/8"]
      destination_addresses = ["Storage.EastUS"]
      destination_ports     = ["443"]
    }

    rule {
      name                  = "allow-azure-keyvault"
      protocols             = ["TCP"]
      source_addresses      = ["10.0.0.0/8"]
      destination_addresses = ["AzureKeyVault"]
      destination_ports     = ["443"]
    }

    rule {
      name                  = "allow-azure-sql"
      protocols             = ["TCP"]
      source_addresses      = ["10.0.2.0/24"]  # Data subnet
      destination_addresses = ["Sql.EastUS"]
      destination_ports     = ["1433"]
    }
  }

  # Internal network rules
  network_rule_collection {
    name     = "internal-traffic"
    priority = 200
    action   = "Allow"

    rule {
      name                  = "spoke-to-spoke"
      protocols             = ["TCP", "UDP"]
      source_addresses      = ["10.1.0.0/16", "10.2.0.0/16"]
      destination_addresses = ["10.1.0.0/16", "10.2.0.0/16"]
      destination_ports     = ["*"]
    }

    rule {
      name                  = "allow-dns"
      protocols             = ["UDP", "TCP"]
      source_addresses      = ["10.0.0.0/8"]
      destination_addresses = ["168.63.129.16"]
      destination_ports     = ["53"]
    }

    rule {
      name                  = "allow-ntp"
      protocols             = ["UDP"]
      source_addresses      = ["10.0.0.0/8"]
      destination_addresses = ["*"]
      destination_ports     = ["123"]
    }
  }

  # Deny rules (explicit)
  network_rule_collection {
    name     = "deny-rules"
    priority = 1000
    action   = "Deny"

    rule {
      name                  = "deny-internet-from-data"
      protocols             = ["Any"]
      source_addresses      = ["10.0.2.0/24"]  # Data subnet
      destination_addresses = ["Internet"]
      destination_ports     = ["*"]
    }
  }
}
```

# Application Rules

Configure FQDN-based filtering:

```hcl
# Application Rule Collection Group
resource "azurerm_firewall_policy_rule_collection_group" "application" {
  name               = "application-rules-group"
  firewall_policy_id = azurerm_firewall_policy.main.id
  priority           = 200

  # Allow Windows Update
  application_rule_collection {
    name     = "windows-update"
    priority = 100
    action   = "Allow"

    rule {
      name = "allow-windows-update"
      protocols {
        type = "Https"
        port = 443
      }
      protocols {
        type = "Http"
        port = 80
      }
      source_addresses  = ["10.0.0.0/8"]
      destination_fqdns = [
        "*.windowsupdate.microsoft.com",
        "*.update.microsoft.com",
        "*.windowsupdate.com",
        "download.microsoft.com",
        "wustat.windows.com",
        "ntservicepack.microsoft.com"
      ]
    }
  }

  # Allow development tools
  application_rule_collection {
    name     = "development-tools"
    priority = 200
    action   = "Allow"

    rule {
      name = "allow-github"
      protocols {
        type = "Https"
        port = 443
      }
      source_addresses  = ["10.3.0.0/24"]  # Dev subnet
      destination_fqdns = [
        "github.com",
        "*.github.com",
        "*.githubusercontent.com",
        "*.githubassets.com"
      ]
    }

    rule {
      name = "allow-npm-nuget"
      protocols {
        type = "Https"
        port = 443
      }
      source_addresses  = ["10.3.0.0/24"]
      destination_fqdns = [
        "registry.npmjs.org",
        "*.npmjs.org",
        "*.nuget.org",
        "api.nuget.org"
      ]
    }

    rule {
      name = "allow-docker"
      protocols {
        type = "Https"
        port = 443
      }
      source_addresses  = ["10.3.0.0/24"]
      destination_fqdns = [
        "*.docker.io",
        "*.docker.com",
        "production.cloudflare.docker.com"
      ]
    }
  }

  # Allow Azure services by FQDN tag
  application_rule_collection {
    name     = "azure-services-fqdn"
    priority = 300
    action   = "Allow"

    rule {
      name = "allow-azure-backup"
      protocols {
        type = "Https"
        port = 443
      }
      source_addresses      = ["10.0.0.0/8"]
      destination_fqdn_tags = ["AzureBackup"]
    }

    rule {
      name = "allow-windows-diagnostics"
      protocols {
        type = "Https"
        port = 443
      }
      source_addresses      = ["10.0.0.0/8"]
      destination_fqdn_tags = ["WindowsDiagnostics"]
    }

    rule {
      name = "allow-azure-kubernetes"
      protocols {
        type = "Https"
        port = 443
      }
      source_addresses      = ["10.1.0.0/16"]
      destination_fqdn_tags = ["AzureKubernetesService"]
    }
  }
}
```

# NAT Rules (DNAT)

Configure inbound NAT rules:

```hcl
# NAT Rule Collection Group
resource "azurerm_firewall_policy_rule_collection_group" "nat" {
  name               = "nat-rules-group"
  firewall_policy_id = azurerm_firewall_policy.main.id
  priority           = 50

  nat_rule_collection {
    name     = "inbound-nat"
    priority = 100
    action   = "Dnat"

    # NAT for web server
    rule {
      name                = "web-server-https"
      protocols           = ["TCP"]
      source_addresses    = ["*"]
      destination_address = azurerm_public_ip.firewall.ip_address
      destination_ports   = ["443"]
      translated_address  = "10.1.1.10"  # Internal web server
      translated_port     = "443"
    }

    # NAT for jump box (SSH)
    rule {
      name                = "jumpbox-ssh"
      protocols           = ["TCP"]
      source_addresses    = ["203.0.113.0/24"]  # Allowed source IPs
      destination_address = azurerm_public_ip.firewall.ip_address
      destination_ports   = ["2222"]
      translated_address  = "10.0.3.10"  # Jumpbox IP
      translated_port     = "22"
    }

    # NAT for RDP (from specific IPs)
    rule {
      name                = "rdp-management"
      protocols           = ["TCP"]
      source_addresses    = ["198.51.100.0/24"]  # Corporate IPs
      destination_address = azurerm_public_ip.firewall.ip_address
      destination_ports   = ["3389"]
      translated_address  = "10.0.3.20"  # Management VM
      translated_port     = "3389"
    }
  }
}
```

# IP Groups for Rule Management

Use IP Groups to simplify rule management:

```hcl
# IP Groups
resource "azurerm_ip_group" "developers" {
  name                = "ipgroup-developers"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  cidrs = [
    "10.3.1.0/24",
    "10.3.2.0/24"
  ]

  tags = {
    Team = "Development"
  }
}

resource "azurerm_ip_group" "production_servers" {
  name                = "ipgroup-production"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  cidrs = [
    "10.1.1.0/24",
    "10.1.2.0/24"
  ]

  tags = {
    Environment = "Production"
  }
}

resource "azurerm_ip_group" "trusted_partners" {
  name                = "ipgroup-partners"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  cidrs = [
    "203.0.113.0/24",
    "198.51.100.0/24"
  ]

  tags = {
    Type = "External Partners"
  }
}

# Use IP Groups in rules
resource "azurerm_firewall_policy_rule_collection_group" "with_ip_groups" {
  name               = "ip-group-rules"
  firewall_policy_id = azurerm_firewall_policy.main.id
  priority           = 300

  network_rule_collection {
    name     = "dev-to-prod"
    priority = 100
    action   = "Allow"

    rule {
      name              = "allow-dev-to-prod-http"
      protocols         = ["TCP"]
      source_ip_groups  = [azurerm_ip_group.developers.id]
      destination_ip_groups = [azurerm_ip_group.production_servers.id]
      destination_ports = ["80", "443"]
    }
  }
}
```

# Threat Intelligence

Configure threat intelligence-based filtering:

```python
from azure.mgmt.network import NetworkManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
network_client = NetworkManagementClient(credential, subscription_id)

# Update firewall policy with threat intelligence
def configure_threat_intelligence(resource_group, policy_name, mode="Alert"):
    """
    Modes:
    - Off: Disabled
    - Alert: Log only
    - Deny: Log and block
    """
    policy = network_client.firewall_policies.get(resource_group, policy_name)

    policy.threat_intel_mode = mode

    # Add threat intelligence allowlist
    policy.threat_intel_whitelist = {
        "fqdns": [
            "legitimate-domain.com"  # False positive exclusion
        ],
        "ip_addresses": [
            "203.0.113.50"  # Known safe IP
        ]
    }

    result = network_client.firewall_policies.begin_create_or_update(
        resource_group,
        policy_name,
        policy
    ).result()

    return result

# Enable threat intelligence in Deny mode
configure_threat_intelligence("rg-networking", "fw-policy-main", "Deny")
```

# Monitoring Firewall Rules

Enable diagnostic logging and monitoring:

```bash
# Enable diagnostic settings
az monitor diagnostic-settings create \
    --resource /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-networking/providers/Microsoft.Network/azureFirewalls/fw-hub \
    --name fw-diagnostics \
    --workspace /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-monitoring/providers/Microsoft.OperationalInsights/workspaces/log-analytics-ws \
    --logs '[
        {"category": "AzureFirewallApplicationRule", "enabled": true},
        {"category": "AzureFirewallNetworkRule", "enabled": true},
        {"category": "AzureFirewallDnsProxy", "enabled": true}
    ]' \
    --metrics '[{"category": "AllMetrics", "enabled": true}]'
```

```python
# Query firewall logs
def query_firewall_denied_traffic(workspace_id, hours=24):
    """Query denied traffic in last N hours."""

    query = f"""
    AzureDiagnostics
    | where Category == "AzureFirewallNetworkRule" or Category == "AzureFirewallApplicationRule"
    | where TimeGenerated > ago({hours}h)
    | where msg_s contains "Deny"
    | parse msg_s with Protocol " request from " SourceIP ":" SourcePort " to " DestinationIP ":" DestinationPort ". Action: " Action "." *
    | summarize Count=count() by SourceIP, DestinationIP, DestinationPort, Action
    | order by Count desc
    | take 100
    """

    from azure.monitor.query import LogsQueryClient
    logs_client = LogsQueryClient(credential)

    result = logs_client.query_workspace(workspace_id, query)

    print("Top Denied Traffic:")
    for row in result.tables[0].rows:
        print(f"  {row[0]} -> {row[1]}:{row[2]} - {row[3]} ({row[4]} times)")

    return result
```

# Conclusion

Azure Firewall provides comprehensive network security with multiple rule types for different filtering needs. Network rules filter by IP and port, application rules filter by FQDN, and NAT rules enable secure inbound access.

Key best practices include using IP Groups for easier management, enabling threat intelligence, implementing proper logging, and organizing rules into logical collections with appropriate priorities. Regular review of denied traffic logs helps identify legitimate traffic that may need rule adjustments.
