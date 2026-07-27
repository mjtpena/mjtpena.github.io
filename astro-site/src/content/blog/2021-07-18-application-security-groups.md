---
title: Application Security Groups for Simplified Network Security
author: Michael John Peña
draft: false
date: 2021-07-18
url: /blog/application-security-groups/
tags:
  - Azure
  - Networking
  - Security
  - ASG
  - Infrastructure

---

I wrote "2021-07-18-application-security-groups" to share practical, production-minded guidance on this topic.

# Why Application Security Groups?

Traditional NSG rules use IP addresses, which creates challenges:

- IP addresses change when VMs are recreated
- Rules become hard to read with many IP ranges
- Scaling requires constant rule updates

ASGs solve these problems by:

- Grouping VMs logically by application role
- Rules remain valid even when IPs change
- New VMs automatically inherit rules when added to ASG

# Creating Application Security Groups

Set up ASGs for a multi-tier application:

```bash
# Create ASGs for each tier
az network asg create \
    --resource-group rg-networking \
    --name asg-web-servers

az network asg create \
    --resource-group rg-networking \
    --name asg-api-servers

az network asg create \
    --resource-group rg-networking \
    --name asg-database-servers

az network asg create \
    --resource-group rg-networking \
    --name asg-management
```

# Terraform Configuration

Complete ASG implementation with Terraform:

```hcl
# Application Security Groups
resource "azurerm_application_security_group" "web" {
  name                = "asg-web-servers"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  tags = {
    Tier        = "Web"
    Application = "Frontend"
  }
}

resource "azurerm_application_security_group" "api" {
  name                = "asg-api-servers"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  tags = {
    Tier        = "API"
    Application = "Backend"
  }
}

resource "azurerm_application_security_group" "database" {
  name                = "asg-database-servers"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  tags = {
    Tier        = "Database"
    Application = "Data"
  }
}

resource "azurerm_application_security_group" "management" {
  name                = "asg-management"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  tags = {
    Tier        = "Management"
    Application = "Operations"
  }
}

resource "azurerm_application_security_group" "monitoring" {
  name                = "asg-monitoring"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  tags = {
    Tier        = "Monitoring"
    Application = "Operations"
  }
}

# NSG with ASG-based rules
resource "azurerm_network_security_group" "application" {
  name                = "nsg-application"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  # Web tier rules
  security_rule {
    name                                       = "allow-https-to-web"
    priority                                   = 100
    direction                                  = "Inbound"
    access                                     = "Allow"
    protocol                                   = "Tcp"
    source_port_range                          = "*"
    destination_port_range                     = "443"
    source_address_prefix                      = "Internet"
    destination_application_security_group_ids = [azurerm_application_security_group.web.id]
  }

  security_rule {
    name                                       = "allow-http-to-web"
    priority                                   = 110
    direction                                  = "Inbound"
    access                                     = "Allow"
    protocol                                   = "Tcp"
    source_port_range                          = "*"
    destination_port_range                     = "80"
    source_address_prefix                      = "Internet"
    destination_application_security_group_ids = [azurerm_application_security_group.web.id]
  }

  # Web to API communication
  security_rule {
    name                                       = "allow-web-to-api"
    priority                                   = 200
    direction                                  = "Inbound"
    access                                     = "Allow"
    protocol                                   = "Tcp"
    source_port_range                          = "*"
    destination_port_range                     = "8080"
    source_application_security_group_ids      = [azurerm_application_security_group.web.id]
    destination_application_security_group_ids = [azurerm_application_security_group.api.id]
  }

  # API to Database communication
  security_rule {
    name                                       = "allow-api-to-database"
    priority                                   = 300
    direction                                  = "Inbound"
    access                                     = "Allow"
    protocol                                   = "Tcp"
    source_port_range                          = "*"
    destination_port_range                     = "1433"
    source_application_security_group_ids      = [azurerm_application_security_group.api.id]
    destination_application_security_group_ids = [azurerm_application_security_group.database.id]
  }

  # Management access
  security_rule {
    name                                       = "allow-ssh-from-management"
    priority                                   = 400
    direction                                  = "Inbound"
    access                                     = "Allow"
    protocol                                   = "Tcp"
    source_port_range                          = "*"
    destination_port_range                     = "22"
    source_application_security_group_ids      = [azurerm_application_security_group.management.id]
    destination_application_security_group_ids = [
      azurerm_application_security_group.web.id,
      azurerm_application_security_group.api.id
    ]
  }

  security_rule {
    name                                       = "allow-rdp-from-management"
    priority                                   = 410
    direction                                  = "Inbound"
    access                                     = "Allow"
    protocol                                   = "Tcp"
    source_port_range                          = "*"
    destination_port_range                     = "3389"
    source_application_security_group_ids      = [azurerm_application_security_group.management.id]
    destination_application_security_group_ids = [azurerm_application_security_group.database.id]
  }

  # Monitoring access
  security_rule {
    name                                       = "allow-monitoring-agents"
    priority                                   = 500
    direction                                  = "Inbound"
    access                                     = "Allow"
    protocol                                   = "Tcp"
    source_port_range                          = "*"
    destination_port_ranges                    = ["9090", "9100"]  # Prometheus ports
    source_application_security_group_ids      = [azurerm_application_security_group.monitoring.id]
    destination_application_security_group_ids = [
      azurerm_application_security_group.web.id,
      azurerm_application_security_group.api.id,
      azurerm_application_security_group.database.id
    ]
  }

  # Deny all other inbound
  security_rule {
    name                       = "deny-all-inbound"
    priority                   = 4096
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  tags = {
    Environment = "Production"
  }
}
```

# Associating NICs with ASGs

Add VM network interfaces to ASGs:

```hcl
# Web server NIC with ASG association
resource "azurerm_network_interface" "web" {
  count               = 3
  name                = "nic-web-${count.index}"
  resource_group_name = azurerm_resource_group.compute.name
  location            = azurerm_resource_group.compute.location

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.web.id
    private_ip_address_allocation = "Dynamic"
  }
}

resource "azurerm_network_interface_application_security_group_association" "web" {
  count                         = 3
  network_interface_id          = azurerm_network_interface.web[count.index].id
  application_security_group_id = azurerm_application_security_group.web.id
}

# API server NIC with ASG association
resource "azurerm_network_interface" "api" {
  count               = 2
  name                = "nic-api-${count.index}"
  resource_group_name = azurerm_resource_group.compute.name
  location            = azurerm_resource_group.compute.location

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.api.id
    private_ip_address_allocation = "Dynamic"
  }
}

resource "azurerm_network_interface_application_security_group_association" "api" {
  count                         = 2
  network_interface_id          = azurerm_network_interface.api[count.index].id
  application_security_group_id = azurerm_application_security_group.api.id
}

# Database server NIC with ASG association
resource "azurerm_network_interface" "database" {
  name                = "nic-database-primary"
  resource_group_name = azurerm_resource_group.compute.name
  location            = azurerm_resource_group.compute.location

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.data.id
    private_ip_address_allocation = "Dynamic"
  }
}

resource "azurerm_network_interface_application_security_group_association" "database" {
  network_interface_id          = azurerm_network_interface.database.id
  application_security_group_id = azurerm_application_security_group.database.id
}
```

# Managing ASG Memberships Programmatically

Add and remove VMs from ASGs dynamically:

```python
from azure.mgmt.network import NetworkManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
network_client = NetworkManagementClient(credential, subscription_id)

def add_nic_to_asg(nic_resource_group, nic_name, asg_id):
    """Add a network interface to an Application Security Group."""

    nic = network_client.network_interfaces.get(nic_resource_group, nic_name)

    # Get current ASG associations
    current_asgs = nic.ip_configurations[0].application_security_groups or []
    current_asg_ids = [asg.id for asg in current_asgs]

    # Add new ASG if not already present
    if asg_id not in current_asg_ids:
        current_asgs.append({"id": asg_id})
        nic.ip_configurations[0].application_security_groups = current_asgs

        result = network_client.network_interfaces.begin_create_or_update(
            nic_resource_group,
            nic_name,
            nic
        ).result()

        print(f"Added {nic_name} to ASG")
        return result

    print(f"{nic_name} already in ASG")
    return nic

def remove_nic_from_asg(nic_resource_group, nic_name, asg_id):
    """Remove a network interface from an Application Security Group."""

    nic = network_client.network_interfaces.get(nic_resource_group, nic_name)

    current_asgs = nic.ip_configurations[0].application_security_groups or []
    new_asgs = [asg for asg in current_asgs if asg.id != asg_id]

    if len(new_asgs) < len(current_asgs):
        nic.ip_configurations[0].application_security_groups = new_asgs

        result = network_client.network_interfaces.begin_create_or_update(
            nic_resource_group,
            nic_name,
            nic
        ).result()

        print(f"Removed {nic_name} from ASG")
        return result

    print(f"{nic_name} was not in ASG")
    return nic

def list_asg_members(asg_resource_group, asg_name):
    """List all NICs that are members of an ASG."""

    asg = network_client.application_security_groups.get(asg_resource_group, asg_name)
    asg_id = asg.id

    members = []

    # List all NICs and check membership
    nics = network_client.network_interfaces.list_all()
    for nic in nics:
        if nic.ip_configurations:
            asgs = nic.ip_configurations[0].application_security_groups or []
            for asg in asgs:
                if asg.id == asg_id:
                    members.append({
                        "nic_name": nic.name,
                        "resource_group": nic.id.split("/")[4],
                        "private_ip": nic.ip_configurations[0].private_ip_address
                    })

    return members

# Example usage
asg_id = f"/subscriptions/{subscription_id}/resourceGroups/rg-networking/providers/Microsoft.Network/applicationSecurityGroups/asg-web-servers"

# Add new web server to ASG
add_nic_to_asg("rg-compute", "nic-web-new", asg_id)

# List all web servers
members = list_asg_members("rg-networking", "asg-web-servers")
for member in members:
    print(f"  {member['nic_name']}: {member['private_ip']}")
```

# Multiple ASG Memberships

VMs can belong to multiple ASGs:

```hcl
# Server that needs both API and monitoring access
resource "azurerm_network_interface" "api_with_monitoring" {
  name                = "nic-api-monitored"
  resource_group_name = azurerm_resource_group.compute.name
  location            = azurerm_resource_group.compute.location

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.api.id
    private_ip_address_allocation = "Dynamic"
  }
}

# Associate with API ASG
resource "azurerm_network_interface_application_security_group_association" "api_role" {
  network_interface_id          = azurerm_network_interface.api_with_monitoring.id
  application_security_group_id = azurerm_application_security_group.api.id
}

# Also associate with monitoring agent ASG
resource "azurerm_network_interface_application_security_group_association" "monitoring_role" {
  network_interface_id          = azurerm_network_interface.api_with_monitoring.id
  application_security_group_id = azurerm_application_security_group.monitoring.id
}
```

# ASG Best Practices

```python
# Best practices for ASG design
best_practices = {
    "naming_conventions": [
        "Use consistent naming: asg-{role}-{environment}",
        "Include application/service name in tags",
        "Document purpose in description"
    ],
    "design_principles": [
        "Create ASGs based on application roles, not subnets",
        "Keep ASGs within same region as VMs",
        "Use ASGs instead of IP addresses whenever possible"
    ],
    "security": [
        "Combine ASGs with service tags for comprehensive rules",
        "Use multiple ASGs for VMs with multiple roles",
        "Review ASG membership regularly"
    ],
    "limitations": [
        "Max 3,000 ASGs per subscription per region",
        "ASG and resources must be in same region",
        "Cannot use ASGs across different VNets in NSG rules"
    ]
}

for category, items in best_practices.items():
    print(f"\n{category.upper().replace('_', ' ')}:")
    for item in items:
        print(f"  - {item}")
```

# Conclusion

Application Security Groups transform network security management from IP-centric to application-centric. By grouping VMs logically based on their workload, you create more maintainable, readable security rules that automatically apply to new resources.

The combination of ASGs with NSGs provides a powerful framework for implementing zero-trust networking and microsegmentation in Azure. As your infrastructure scales, ASGs ensure security policies remain consistent without constant manual updates.

