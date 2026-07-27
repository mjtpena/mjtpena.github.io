---
title: Simplified Outbound Connectivity with Azure NAT Gateway
author: Michael John Peña
draft: false
date: 2021-07-12
url: /blog/azure-nat-gateway/
tags:
  - Azure
  - Networking
  - NAT Gateway
  - Security
  - Infrastructure

---

I wrote "2021-07-12-azure-nat-gateway" to share practical, production-minded guidance on this topic.

# Why NAT Gateway?

NAT Gateway solves several problems:

- **SNAT Port Exhaustion**: Each NAT Gateway supports up to 64,000 concurrent connections per public IP
- **Simplified Architecture**: No need for public IPs on individual VMs
- **Predictable Outbound IPs**: Known source IPs for firewall whitelisting
- **High Availability**: Built-in zone redundancy

# Creating NAT Gateway

Deploy NAT Gateway using Azure CLI:

```bash
# Create public IP for NAT Gateway
az network public-ip create \
    --resource-group rg-networking \
    --name nat-gateway-pip \
    --sku Standard \
    --allocation-method Static \
    --zone 1 2 3

# Create public IP prefix for multiple outbound IPs
az network public-ip prefix create \
    --resource-group rg-networking \
    --name nat-gateway-pip-prefix \
    --length 29

# Create NAT Gateway
az network nat gateway create \
    --resource-group rg-networking \
    --name nat-gateway-main \
    --public-ip-addresses nat-gateway-pip \
    --public-ip-prefixes nat-gateway-pip-prefix \
    --idle-timeout 10

# Associate NAT Gateway with subnet
az network vnet subnet update \
    --resource-group rg-networking \
    --vnet-name vnet-main \
    --name subnet-backend \
    --nat-gateway nat-gateway-main
```

# Terraform Configuration

Complete NAT Gateway setup with Terraform:

```hcl
# Public IP for NAT Gateway
resource "azurerm_public_ip" "nat" {
  name                = "nat-gateway-pip"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = ["1", "2", "3"]

  tags = {
    Environment = "Production"
    Purpose     = "NAT Gateway"
  }
}

# Public IP Prefix for additional outbound IPs
resource "azurerm_public_ip_prefix" "nat" {
  name                = "nat-gateway-pip-prefix"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location
  prefix_length       = 29  # 8 IP addresses
  sku                 = "Standard"
  zones               = ["1", "2", "3"]

  tags = {
    Environment = "Production"
  }
}

# NAT Gateway
resource "azurerm_nat_gateway" "main" {
  name                    = "nat-gateway-main"
  resource_group_name     = azurerm_resource_group.networking.name
  location                = azurerm_resource_group.networking.location
  sku_name                = "Standard"
  idle_timeout_in_minutes = 10
  zones                   = ["1", "2", "3"]

  tags = {
    Environment = "Production"
  }
}

# Associate public IP with NAT Gateway
resource "azurerm_nat_gateway_public_ip_association" "main" {
  nat_gateway_id       = azurerm_nat_gateway.main.id
  public_ip_address_id = azurerm_public_ip.nat.id
}

# Associate public IP prefix with NAT Gateway
resource "azurerm_nat_gateway_public_ip_prefix_association" "main" {
  nat_gateway_id      = azurerm_nat_gateway.main.id
  public_ip_prefix_id = azurerm_public_ip_prefix.nat.id
}

# Associate NAT Gateway with subnets
resource "azurerm_subnet_nat_gateway_association" "backend" {
  subnet_id      = azurerm_subnet.backend.id
  nat_gateway_id = azurerm_nat_gateway.main.id
}

resource "azurerm_subnet_nat_gateway_association" "compute" {
  subnet_id      = azurerm_subnet.compute.id
  nat_gateway_id = azurerm_nat_gateway.main.id
}
```

# Scaling Outbound Connections

Add more public IPs to scale SNAT ports:

```python
from azure.mgmt.network import NetworkManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
network_client = NetworkManagementClient(credential, subscription_id)

# Calculate required public IPs based on expected connections
def calculate_required_ips(expected_connections_per_second, connection_duration_seconds=60):
    """
    Each public IP provides ~64,000 SNAT ports
    Connections are held for their duration
    """
    concurrent_connections = expected_connections_per_second * connection_duration_seconds
    ports_per_ip = 64000
    required_ips = (concurrent_connections // ports_per_ip) + 1
    return max(1, required_ips)

# Example: 10,000 connections/sec with 30 second duration
required = calculate_required_ips(10000, 30)
print(f"Required public IPs: {required}")

# Add additional public IPs
def add_public_ip_to_nat(resource_group, nat_gateway_name, pip_name):
    # Create new public IP
    pip = network_client.public_ip_addresses.begin_create_or_update(
        resource_group,
        pip_name,
        {
            "location": "eastus",
            "sku": {"name": "Standard"},
            "public_ip_allocation_method": "Static",
            "zones": ["1", "2", "3"]
        }
    ).result()

    # Get current NAT Gateway
    nat_gateway = network_client.nat_gateways.get(resource_group, nat_gateway_name)

    # Add new IP to the list
    if nat_gateway.public_ip_addresses is None:
        nat_gateway.public_ip_addresses = []

    nat_gateway.public_ip_addresses.append({"id": pip.id})

    # Update NAT Gateway
    result = network_client.nat_gateways.begin_create_or_update(
        resource_group,
        nat_gateway_name,
        nat_gateway
    ).result()

    return result

# Add 4 more public IPs
for i in range(4):
    add_public_ip_to_nat("rg-networking", "nat-gateway-main", f"nat-pip-{i+2}")
    print(f"Added nat-pip-{i+2}")
```

# NAT Gateway vs Load Balancer Outbound

Compare NAT Gateway with Load Balancer SNAT:

```python
# Comparison helper
def compare_outbound_options():
    comparison = {
        "NAT Gateway": {
            "snat_ports_per_ip": 64000,
            "port_allocation": "Dynamic (on-demand)",
            "idle_timeout": "4-120 minutes configurable",
            "zone_redundancy": "Built-in",
            "cost": "Per hour + per GB processed",
            "use_case": "General outbound connectivity"
        },
        "Load Balancer": {
            "snat_ports_per_ip": "1024-64000 (configurable)",
            "port_allocation": "Pre-allocated per backend",
            "idle_timeout": "4-30 minutes",
            "zone_redundancy": "Requires configuration",
            "cost": "Included with Standard LB",
            "use_case": "When already using LB for inbound"
        },
        "Public IP on VM": {
            "snat_ports_per_ip": "N/A (direct outbound)",
            "port_allocation": "N/A",
            "idle_timeout": "4 minutes default",
            "zone_redundancy": "N/A",
            "cost": "Per public IP",
            "use_case": "Simple single-VM scenarios"
        }
    }

    for option, details in comparison.items():
        print(f"\n{option}:")
        for key, value in details.items():
            print(f"  {key}: {value}")

compare_outbound_options()
```

# Monitoring NAT Gateway

Monitor SNAT usage and performance:

```python
from azure.mgmt.monitor import MonitorManagementClient

monitor_client = MonitorManagementClient(credential, subscription_id)

def get_nat_gateway_metrics(resource_group, nat_name):
    resource_uri = f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/natGateways/{nat_name}"

    metrics = monitor_client.metrics.list(
        resource_uri=resource_uri,
        metricnames="SNATConnectionCount,TotalConnectionCount,ByteCount,PacketCount,PacketDropCount,DatapathAvailability",
        timespan="PT1H",
        interval="PT5M",
        aggregation="Average,Total,Maximum"
    )

    for metric in metrics.value:
        print(f"\n{metric.name.value}:")
        for ts in metric.timeseries:
            for data in ts.data[-5:]:  # Last 5 data points
                print(f"  {data.time_stamp}:")
                if data.average is not None:
                    print(f"    Avg: {data.average}")
                if data.total is not None:
                    print(f"    Total: {data.total}")
                if data.maximum is not None:
                    print(f"    Max: {data.maximum}")

get_nat_gateway_metrics("rg-networking", "nat-gateway-main")

# Create alert for high SNAT usage
alert = {
    "location": "global",
    "properties": {
        "description": "Alert when SNAT connection count is high",
        "severity": 2,
        "enabled": True,
        "evaluationFrequency": "PT5M",
        "windowSize": "PT15M",
        "criteria": {
            "odata.type": "Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria",
            "allOf": [{
                "name": "HighSNATConnections",
                "metricName": "SNATConnectionCount",
                "operator": "GreaterThan",
                "threshold": 50000,  # 78% of single IP capacity
                "timeAggregation": "Maximum"
            }]
        },
        "actions": [{
            "actionGroupId": f"/subscriptions/{subscription_id}/resourceGroups/rg-monitoring/providers/Microsoft.Insights/actionGroups/network-alerts"
        }]
    }
}
```

# Diagnostic Logging

Enable diagnostic logs for troubleshooting:

```bash
# Enable diagnostic settings
az monitor diagnostic-settings create \
    --resource /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-networking/providers/Microsoft.Network/natGateways/nat-gateway-main \
    --name nat-diagnostics \
    --workspace /subscriptions/$SUBSCRIPTION_ID/resourceGroups/rg-monitoring/providers/Microsoft.OperationalInsights/workspaces/log-analytics-ws \
    --logs '[
        {
            "category": "DDoSProtectionNotifications",
            "enabled": true
        },
        {
            "category": "DDoSMitigationFlowLogs",
            "enabled": true
        },
        {
            "category": "DDoSMitigationReports",
            "enabled": true
        }
    ]' \
    --metrics '[
        {
            "category": "AllMetrics",
            "enabled": true
        }
    ]'
```

# Multiple NAT Gateways

Use multiple NAT Gateways for different subnets:

```hcl
# NAT Gateway per environment
locals {
  environments = {
    "production" = {
      subnets     = ["subnet-prod-app", "subnet-prod-data"]
      idle_timeout = 10
    }
    "staging" = {
      subnets     = ["subnet-staging"]
      idle_timeout = 4
    }
    "development" = {
      subnets     = ["subnet-dev"]
      idle_timeout = 4
    }
  }
}

resource "azurerm_public_ip" "nat" {
  for_each = local.environments

  name                = "nat-pip-${each.key}"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_nat_gateway" "env" {
  for_each = local.environments

  name                    = "nat-gateway-${each.key}"
  resource_group_name     = azurerm_resource_group.networking.name
  location                = azurerm_resource_group.networking.location
  sku_name                = "Standard"
  idle_timeout_in_minutes = each.value.idle_timeout

  tags = {
    Environment = each.key
  }
}

resource "azurerm_nat_gateway_public_ip_association" "env" {
  for_each = local.environments

  nat_gateway_id       = azurerm_nat_gateway.env[each.key].id
  public_ip_address_id = azurerm_public_ip.nat[each.key].id
}
```

# Best Practices

Key recommendations for NAT Gateway:

```python
# Best practices checklist
best_practices = {
    "sizing": [
        "Plan for peak connection counts",
        "Each public IP = 64,000 SNAT ports",
        "Use IP prefixes for easier management at scale"
    ],
    "availability": [
        "NAT Gateway is zone-redundant by default",
        "Ensure public IPs are also zone-redundant",
        "No additional configuration needed for HA"
    ],
    "monitoring": [
        "Monitor SNATConnectionCount vs capacity",
        "Track PacketDropCount for issues",
        "Alert on DatapathAvailability < 100%"
    ],
    "security": [
        "NAT Gateway does not support inbound connections",
        "Use in combination with NSGs",
        "Outbound IPs are predictable for whitelisting"
    ],
    "cost_optimization": [
        "NAT Gateway has per-hour and per-GB costs",
        "Consolidate subnets where possible",
        "Consider if needed for all subnets"
    ]
}

for category, items in best_practices.items():
    print(f"\n{category.upper()}:")
    for item in items:
        print(f"  - {item}")
```

# Conclusion

Azure NAT Gateway simplifies outbound connectivity while providing superior scalability compared to other options. With dynamic SNAT port allocation and support for multiple public IPs, it eliminates port exhaustion issues that plague high-throughput applications.

The key benefits include predictable outbound IPs for security whitelisting, built-in zone redundancy, and no impact on inbound connectivity. For any production workload requiring reliable outbound internet access, NAT Gateway should be your first choice.

