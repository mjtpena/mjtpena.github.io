---
title: Network Security Groups - Microsegmentation in Azure
author: Michael John Peña
draft: false
date: 2021-07-17
url: /blog/network-security-groups/
tags:
  - Azure
  - Networking
  - Security
  - NSG
  - Infrastructure

---

I wrote "2021-07-17-network-security-groups" to share practical, production-minded guidance on this topic.

# NSG Rule Basics

NSG rules are evaluated by priority (100-4096, lower = higher priority):

- **Direction**: Inbound or Outbound
- **Priority**: 100-4096 (lower numbers processed first)
- **Source/Destination**: IP, CIDR, service tag, or ASG
- **Protocol**: TCP, UDP, ICMP, or Any
- **Port Range**: Single port, range, or * for all
- **Action**: Allow or Deny

# Creating NSGs with Terraform

Comprehensive NSG configuration:

```hcl
# Web Tier NSG
resource "azurerm_network_security_group" "web" {
  name                = "nsg-web-tier"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  # Allow HTTPS from Internet
  security_rule {
    name                       = "allow-https-inbound"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  # Allow HTTP from Internet (redirect to HTTPS)
  security_rule {
    name                       = "allow-http-inbound"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  # Allow Azure Load Balancer health probes
  security_rule {
    name                       = "allow-lb-probe"
    priority                   = 120
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "AzureLoadBalancer"
    destination_address_prefix = "*"
  }

  # Allow outbound to API tier
  security_rule {
    name                       = "allow-to-api-tier"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "8080"
    source_address_prefix      = "*"
    destination_address_prefix = "10.0.2.0/24"
  }

  tags = {
    Environment = "Production"
    Tier        = "Web"
  }
}

# API Tier NSG
resource "azurerm_network_security_group" "api" {
  name                = "nsg-api-tier"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  # Allow from Web Tier only
  security_rule {
    name                       = "allow-from-web-tier"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "8080"
    source_address_prefix      = "10.0.1.0/24"
    destination_address_prefix = "*"
  }

  # Allow health checks from Load Balancer
  security_rule {
    name                       = "allow-lb-health"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "8080"
    source_address_prefix      = "AzureLoadBalancer"
    destination_address_prefix = "*"
  }

  # Deny direct internet access
  security_rule {
    name                       = "deny-internet-inbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  # Allow outbound to SQL
  security_rule {
    name                       = "allow-to-sql"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "1433"
    source_address_prefix      = "*"
    destination_address_prefix = "10.0.3.0/24"
  }

  tags = {
    Environment = "Production"
    Tier        = "API"
  }
}

# Data Tier NSG
resource "azurerm_network_security_group" "data" {
  name                = "nsg-data-tier"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  # Allow SQL from API Tier
  security_rule {
    name                       = "allow-sql-from-api"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "1433"
    source_address_prefix      = "10.0.2.0/24"
    destination_address_prefix = "*"
  }

  # Deny all other inbound
  security_rule {
    name                       = "deny-all-inbound"
    priority                   = 4000
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  # Deny internet outbound
  security_rule {
    name                       = "deny-internet-outbound"
    priority                   = 4000
    direction                  = "Outbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "Internet"
  }

  tags = {
    Environment = "Production"
    Tier        = "Data"
  }
}

# Associate NSGs with subnets
resource "azurerm_subnet_network_security_group_association" "web" {
  subnet_id                 = azurerm_subnet.web.id
  network_security_group_id = azurerm_network_security_group.web.id
}

resource "azurerm_subnet_network_security_group_association" "api" {
  subnet_id                 = azurerm_subnet.api.id
  network_security_group_id = azurerm_network_security_group.api.id
}

resource "azurerm_subnet_network_security_group_association" "data" {
  subnet_id                 = azurerm_subnet.data.id
  network_security_group_id = azurerm_network_security_group.data.id
}
```

# Using Service Tags

Leverage Azure service tags for dynamic rule updates:

```hcl
resource "azurerm_network_security_group" "managed_services" {
  name                = "nsg-managed-services"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  # Allow Azure Backup
  security_rule {
    name                       = "allow-azure-backup"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "AzureBackup"
  }

  # Allow Azure Storage
  security_rule {
    name                       = "allow-azure-storage"
    priority                   = 110
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "Storage.EastUS"
  }

  # Allow Azure Monitor
  security_rule {
    name                       = "allow-azure-monitor"
    priority                   = 120
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "AzureMonitor"
  }

  # Allow Azure Key Vault
  security_rule {
    name                       = "allow-keyvault"
    priority                   = 130
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "AzureKeyVault"
  }

  # Allow Azure Active Directory
  security_rule {
    name                       = "allow-aad"
    priority                   = 140
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "*"
    destination_address_prefix = "AzureActiveDirectory"
  }

  # Allow Azure SQL
  security_rule {
    name                       = "allow-azure-sql"
    priority                   = 150
    direction                  = "Outbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_ranges    = ["1433", "11000-11999"]
    source_address_prefix      = "*"
    destination_address_prefix = "Sql.EastUS"
  }
}
```

# NSG Flow Logs

Enable NSG flow logs for traffic analysis:

```python
from azure.mgmt.network import NetworkManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
network_client = NetworkManagementClient(credential, subscription_id)

def enable_nsg_flow_logs(nsg_resource_group, nsg_name, storage_account_id, workspace_id):
    """Enable NSG flow logs with traffic analytics."""

    flow_log = network_client.flow_logs.begin_create_or_update(
        resource_group_name="NetworkWatcherRG",
        network_watcher_name="NetworkWatcher_eastus",
        flow_log_name=f"flowlog-{nsg_name}",
        parameters={
            "location": "eastus",
            "properties": {
                "targetResourceId": f"/subscriptions/{subscription_id}/resourceGroups/{nsg_resource_group}/providers/Microsoft.Network/networkSecurityGroups/{nsg_name}",
                "storageId": storage_account_id,
                "enabled": True,
                "retentionPolicy": {
                    "days": 30,
                    "enabled": True
                },
                "format": {
                    "type": "JSON",
                    "version": 2
                },
                "flowAnalyticsConfiguration": {
                    "networkWatcherFlowAnalyticsConfiguration": {
                        "enabled": True,
                        "workspaceId": workspace_id,
                        "workspaceRegion": "eastus",
                        "trafficAnalyticsInterval": 10
                    }
                }
            }
        }
    ).result()

    return flow_log

# Enable for all NSGs
storage_id = f"/subscriptions/{subscription_id}/resourceGroups/rg-monitoring/providers/Microsoft.Storage/storageAccounts/flowlogsstorage"
workspace_id = "log-analytics-workspace-guid"

for nsg in ["nsg-web-tier", "nsg-api-tier", "nsg-data-tier"]:
    enable_nsg_flow_logs("rg-networking", nsg, storage_id, workspace_id)
    print(f"Enabled flow logs for {nsg}")
```

# Diagnosing NSG Issues

Troubleshoot connectivity problems:

```python
def diagnose_nsg_rules(resource_group, vm_name, direction, remote_ip, remote_port, protocol="TCP"):
    """Check effective NSG rules for a VM."""

    # Get effective security rules
    effective_rules = network_client.network_interfaces.list_effective_network_security_groups(
        resource_group_name=resource_group,
        network_interface_name=f"{vm_name}-nic"
    ).result()

    print(f"Effective rules for {vm_name} ({direction}):")

    for nsg in effective_rules.value:
        print(f"\n  NSG: {nsg.network_security_group.id.split('/')[-1]}")

        rules = nsg.effective_security_rules if direction == "Inbound" else nsg.effective_security_rules
        for rule in sorted(rules, key=lambda x: x.priority):
            if rule.direction.lower() == direction.lower():
                print(f"    [{rule.priority}] {rule.name}: {rule.access}")
                print(f"        Source: {rule.source_address_prefix or rule.source_address_prefixes}")
                print(f"        Dest: {rule.destination_address_prefix or rule.destination_address_prefixes}:{rule.destination_port_range or rule.destination_port_ranges}")

    # Use IP flow verify to test specific connection
    result = network_client.network_watchers.begin_verify_ip_flow(
        resource_group_name="NetworkWatcherRG",
        network_watcher_name="NetworkWatcher_eastus",
        parameters={
            "targetResourceId": f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Compute/virtualMachines/{vm_name}",
            "direction": direction,
            "protocol": protocol,
            "localPort": "*",
            "remotePort": str(remote_port),
            "localIPAddress": "10.0.1.4",  # VM IP
            "remoteIPAddress": remote_ip
        }
    ).result()

    print(f"\nIP Flow Verify: {result.access}")
    if result.rule_name:
        print(f"  Matching Rule: {result.rule_name}")

    return result

# Test connectivity
diagnose_nsg_rules("rg-compute", "vm-web-01", "Inbound", "0.0.0.0", 443)
```

# Managing NSGs at Scale

Automate NSG management across resources:

```python
def audit_nsg_rules(subscription_id, required_deny_rules):
    """Audit all NSGs for compliance with security policies."""

    nsgs = network_client.network_security_groups.list_all()
    non_compliant = []

    for nsg in nsgs:
        has_required_rules = True

        for required_rule in required_deny_rules:
            found = False
            for rule in nsg.security_rules:
                if (rule.direction == required_rule["direction"] and
                    rule.access == "Deny" and
                    rule.destination_port_range == required_rule["port"]):
                    found = True
                    break

            if not found:
                has_required_rules = False
                non_compliant.append({
                    "nsg": nsg.name,
                    "resource_group": nsg.id.split("/")[4],
                    "missing_rule": required_rule
                })

    return non_compliant

# Check for required deny rules
required_rules = [
    {"direction": "Inbound", "port": "22"},   # SSH should be restricted
    {"direction": "Inbound", "port": "3389"}, # RDP should be restricted
]

issues = audit_nsg_rules(subscription_id, required_rules)
for issue in issues:
    print(f"NSG {issue['nsg']} missing rule for port {issue['missing_rule']['port']}")
```

# Conclusion

Network Security Groups are fundamental to Azure network security, providing stateful packet filtering at the subnet and NIC level. Effective NSG design follows the principle of least privilege, using explicit deny rules and service tags to maintain security while allowing necessary traffic.

Enable NSG flow logs and traffic analytics to gain visibility into your network traffic patterns and quickly identify security issues. Regular auditing of NSG rules ensures compliance with security policies and helps identify overly permissive configurations.

