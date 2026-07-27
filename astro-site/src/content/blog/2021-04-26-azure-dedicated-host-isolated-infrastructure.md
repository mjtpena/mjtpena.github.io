---
title: Azure Dedicated Host - Running VMs on Isolated Physical Servers
author: Michael John Peña
draft: false
date: 2021-04-26
url: /blog/azure-dedicated-host-isolated-infrastructure/
tags:
  - Azure
  - Dedicated Host
  - Infrastructure
  - Compliance
  - Security

---


Azure Dedicated Host is the offering I typically reach for when a client's security or compliance team says "I can't be on shared hardware." The use cases are specific: BYOL licensing that requires hardware affinity, compliance frameworks that mandate single-tenant compute (IRAP, some healthcare standards), or workloads where noisy-neighbour effects on CPU or memory bandwidth are an operational concern. Dedicated Hosts are priced per host SKU, not per VM, so the economics only work if you're filling the host with enough VMs to justify the flat cost. The operational benefit is predictable: you control which update domain and fault domain your VMs land on, and you can control when host maintenance happens.

## Understanding Azure Dedicated Host

### What You Get

```
┌──────────────────────────────────────────────┐
│           Dedicated Host (Physical Server)    │
│  ┌─────────────────────────────────────────┐  │
│  │     Your VMs Only                       │  │
│  │  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐    │  │
│  │  │ VM1 │  │ VM2 │  │ VM3 │  │ VM4 │    │  │
│  │  └─────┘  └─────┘  └─────┘  └─────┘    │  │
│  │                                         │  │
│  │     No other Azure customers' VMs      │  │
│  └─────────────────────────────────────────┘  │
│                                               │
│  Physical isolation:                          │
│  • Dedicated CPU cores                        │
│  • Dedicated memory                           │
│  • Control over maintenance events            │
│  • Compliance certifications apply            │
└──────────────────────────────────────────────┘
```

### When to Use Dedicated Hosts

- **Regulatory compliance** - HIPAA, PCI-DSS, FedRAMP
- **Licensing requirements** - SQL Server, Windows Server
- **Security policies** - Prohibit multi-tenant infrastructure
- **Performance isolation** - No noisy neighbor concerns
- **Maintenance control** - Schedule updates on your terms

## Creating Dedicated Hosts

### Using Azure CLI

```bash
# Create host group
az vm host group create \
    --name myHostGroup \
    --resource-group myResourceGroup \
    --location eastus \
    --platform-fault-domain-count 2 \
    --automatic-placement true \
    --zone 1

# Create dedicated host
az vm host create \
    --name myHost1 \
    --resource-group myResourceGroup \
    --host-group myHostGroup \
    --sku DSv3-Type1 \
    --platform-fault-domain 0 \
    --auto-replace true

# Create second host for HA
az vm host create \
    --name myHost2 \
    --resource-group myResourceGroup \
    --host-group myHostGroup \
    --sku DSv3-Type1 \
    --platform-fault-domain 1 \
    --auto-replace true
```

### Using Terraform

```hcl
resource "azurerm_resource_group" "dedicated" {
  name     = "dedicated-host-rg"
  location = "East US"
}

resource "azurerm_dedicated_host_group" "main" {
  name                        = "my-host-group"
  resource_group_name         = azurerm_resource_group.dedicated.name
  location                    = azurerm_resource_group.dedicated.location
  platform_fault_domain_count = 2
  automatic_placement_enabled = true
  zone                        = "1"

  tags = {
    Environment = "Production"
    Compliance  = "HIPAA"
  }
}

resource "azurerm_dedicated_host" "host1" {
  name                    = "dedicated-host-1"
  dedicated_host_group_id = azurerm_dedicated_host_group.main.id
  location                = azurerm_resource_group.dedicated.location
  sku_name               = "DSv3-Type1"
  platform_fault_domain   = 0
  auto_replace_on_failure = true

  tags = {
    Environment = "Production"
  }
}

resource "azurerm_dedicated_host" "host2" {
  name                    = "dedicated-host-2"
  dedicated_host_group_id = azurerm_dedicated_host_group.main.id
  location                = azurerm_resource_group.dedicated.location
  sku_name               = "DSv3-Type1"
  platform_fault_domain   = 1
  auto_replace_on_failure = true

  tags = {
    Environment = "Production"
  }
}
```

## Host SKUs and Capacity

### Available SKU Families

```yaml
Dsv3-Type1:
  vCPUs: 48
  Memory: 192 GB
  Supported VMs: D2s_v3, D4s_v3, D8s_v3, D16s_v3, D32s_v3, D48s_v3

Dsv3-Type2:
  vCPUs: 56
  Memory: 224 GB
  Supported VMs: D2s_v3, D4s_v3, D8s_v3, D16s_v3, D32s_v3, D48s_v3, D64s_v3

Esv3-Type1:
  vCPUs: 48
  Memory: 384 GB
  Supported VMs: E2s_v3, E4s_v3, E8s_v3, E16s_v3, E20s_v3, E32s_v3, E48s_v3

Fsv2-Type2:
  vCPUs: 72
  Memory: 144 GB
  Supported VMs: F2s_v2, F4s_v2, F8s_v2, F16s_v2, F32s_v2, F48s_v2, F72s_v2

Msv2-Type1:
  vCPUs: 128
  Memory: 2048 GB
  Supported VMs: M32ms, M64s, M64ms, M128s, M128ms
```

### Capacity Planning

```python
# Calculate VM capacity on a host
def calculate_host_capacity(host_sku, vm_sizes):
    """Calculate how many VMs fit on a dedicated host"""

    host_specs = {
        "Dsv3-Type1": {"vcpus": 48, "memory_gb": 192},
        "Dsv3-Type2": {"vcpus": 56, "memory_gb": 224},
        "Esv3-Type1": {"vcpus": 48, "memory_gb": 384}
    }

    vm_specs = {
        "D4s_v3": {"vcpus": 4, "memory_gb": 16},
        "D8s_v3": {"vcpus": 8, "memory_gb": 32},
        "D16s_v3": {"vcpus": 16, "memory_gb": 64},
        "E8s_v3": {"vcpus": 8, "memory_gb": 64}
    }

    host = host_specs[host_sku]
    remaining_vcpus = host["vcpus"]
    remaining_memory = host["memory_gb"]

    allocation = {}
    for vm_size in vm_sizes:
        vm = vm_specs[vm_size]
        count = min(
            remaining_vcpus // vm["vcpus"],
            remaining_memory // vm["memory_gb"]
        )
        allocation[vm_size] = count
        remaining_vcpus -= count * vm["vcpus"]
        remaining_memory -= count * vm["memory_gb"]

    return allocation

# Example
allocation = calculate_host_capacity(
    "Dsv3-Type1",
    ["D8s_v3", "D4s_v3"]
)
print(allocation)  # {'D8s_v3': 6, 'D4s_v3': 0} - vcpu limited
```

## Creating VMs on Dedicated Hosts

### Automatic Placement

```bash
# VM automatically placed on available host in group
az vm create \
    --resource-group myResourceGroup \
    --name myVM \
    --image UbuntuLTS \
    --size Standard_D8s_v3 \
    --host-group myHostGroup \
    --admin-username azureuser \
    --ssh-key-value ~/.ssh/id_rsa.pub
```

### Manual Placement

```bash
# VM placed on specific host
az vm create \
    --resource-group myResourceGroup \
    --name myVM \
    --image UbuntuLTS \
    --size Standard_D8s_v3 \
    --host myHost1 \
    --admin-username azureuser \
    --ssh-key-value ~/.ssh/id_rsa.pub
```

### Terraform VM on Dedicated Host

```hcl
resource "azurerm_linux_virtual_machine" "dedicated_vm" {
  name                = "dedicated-vm-1"
  resource_group_name = azurerm_resource_group.dedicated.name
  location            = azurerm_resource_group.dedicated.location
  size                = "Standard_D8s_v3"
  admin_username      = "adminuser"

  # Place on dedicated host
  dedicated_host_id = azurerm_dedicated_host.host1.id

  network_interface_ids = [
    azurerm_network_interface.example.id,
  ]

  admin_ssh_key {
    username   = "adminuser"
    public_key = file("~/.ssh/id_rsa.pub")
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "Premium_LRS"
  }

  source_image_reference {
    publisher = "Canonical"
    offer     = "UbuntuServer"
    sku       = "18.04-LTS"
    version   = "latest"
  }

  tags = {
    Environment = "Production"
  }
}
```

## Maintenance Control

### Create Maintenance Configuration

```bash
# Create maintenance configuration
az maintenance configuration create \
    --resource-group myResourceGroup \
    --name myMaintenanceConfig \
    --maintenance-scope Host \
    --location eastus \
    --maintenance-window-start-date-time "2021-04-26 00:00" \
    --maintenance-window-duration "05:00" \
    --maintenance-window-recur-every "Week Saturday,Sunday" \
    --maintenance-window-time-zone "Pacific Standard Time"

# Assign to host group
az maintenance assignment create \
    --resource-group myResourceGroup \
    --maintenance-configuration-id /subscriptions/.../maintenanceConfigurations/myMaintenanceConfig \
    --name hostGroupAssignment \
    --provider-name Microsoft.Compute \
    --resource-name myHostGroup \
    --resource-type hostGroups
```

### Programmatic Maintenance Control

```python
from azure.mgmt.maintenance import MaintenanceManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
client = MaintenanceManagementClient(credential, subscription_id)

# Check pending maintenance
updates = client.apply_updates.list_by_parent(
    resource_group_name="myResourceGroup",
    provider_name="Microsoft.Compute",
    resource_type="hostGroups",
    resource_name="myHostGroup"
)

for update in updates:
    print(f"Update: {update.name}")
    print(f"  Status: {update.status}")
    print(f"  Impact: {update.impact_type}")

# Apply maintenance during window
client.apply_updates.create_or_update_by_parent(
    resource_group_name="myResourceGroup",
    provider_name="Microsoft.Compute",
    resource_type="hosts",
    resource_name="myHostGroup",
    apply_update_name="myHost1"
)
```

## High Availability Patterns

### Multi-Host Setup

```hcl
# Create hosts across fault domains and availability zones
variable "host_configs" {
  default = [
    { name = "host-zone1-fd0", zone = "1", fault_domain = 0 },
    { name = "host-zone1-fd1", zone = "1", fault_domain = 1 },
    { name = "host-zone2-fd0", zone = "2", fault_domain = 0 },
    { name = "host-zone2-fd1", zone = "2", fault_domain = 1 }
  ]
}

resource "azurerm_dedicated_host_group" "ha_group" {
  for_each = toset(["1", "2"])

  name                        = "host-group-zone-${each.value}"
  resource_group_name         = azurerm_resource_group.dedicated.name
  location                    = azurerm_resource_group.dedicated.location
  platform_fault_domain_count = 2
  zone                        = each.value
  automatic_placement_enabled = true
}

resource "azurerm_dedicated_host" "ha_hosts" {
  for_each = { for idx, config in var.host_configs : config.name => config }

  name                    = each.value.name
  dedicated_host_group_id = azurerm_dedicated_host_group.ha_group[each.value.zone].id
  location                = azurerm_resource_group.dedicated.location
  sku_name               = "DSv3-Type1"
  platform_fault_domain   = each.value.fault_domain
  auto_replace_on_failure = true
}
```

### VM Placement Strategy

```python
def distribute_vms_across_hosts(vms, hosts):
    """Distribute VMs across hosts for HA"""
    # Sort hosts by current capacity
    hosts_by_capacity = sorted(hosts, key=lambda h: h.available_vcpus, reverse=True)

    vm_placement = []
    for vm in vms:
        # Find host with capacity in different fault domain
        for host in hosts_by_capacity:
            if host.available_vcpus >= vm.vcpus:
                vm_placement.append({
                    "vm": vm.name,
                    "host": host.name,
                    "zone": host.zone,
                    "fault_domain": host.fault_domain
                })
                host.available_vcpus -= vm.vcpus
                break
        else:
            raise Exception(f"No capacity for VM {vm.name}")

        # Re-sort for next iteration
        hosts_by_capacity = sorted(hosts, key=lambda h: h.available_vcpus, reverse=True)

    return vm_placement
```

## Cost Optimization

### Reserved Instances

```bash
# Purchase 1-year reservation for dedicated host
az reservations reservation-order purchase \
    --applied-scope-type Single \
    --billing-scope /subscriptions/{subscription-id} \
    --display-name "Dedicated Host Reservation" \
    --quantity 1 \
    --sku DSv3-Type1 \
    --term P1Y \
    --billing-plan Monthly
```

### Monitoring Utilization

```python
from azure.mgmt.compute import ComputeManagementClient

def get_host_utilization(resource_group, host_group_name):
    """Get utilization metrics for dedicated hosts"""
    compute_client = ComputeManagementClient(credential, subscription_id)

    hosts = compute_client.dedicated_hosts.list_by_host_group(
        resource_group, host_group_name
    )

    for host in hosts:
        vms = compute_client.dedicated_hosts.get(
            resource_group, host_group_name, host.name,
            expand="instanceView"
        )

        total_vcpus = host.sku.capacity
        used_vcpus = sum(vm.size.vcpus for vm in vms.virtual_machines)

        print(f"Host: {host.name}")
        print(f"  Total vCPUs: {total_vcpus}")
        print(f"  Used vCPUs: {used_vcpus}")
        print(f"  Utilization: {used_vcpus/total_vcpus*100:.1f}%")
```

## Best Practices

1. **Plan capacity** - Understand VM sizes and host capacity
2. **Use automatic placement** - Let Azure optimize placement
3. **Implement HA** - Use multiple hosts across fault domains/zones
4. **Schedule maintenance** - Control update timing
5. **Monitor utilization** - Maximize investment value
6. **Consider reservations** - Significant savings for long-term use
7. **Document compliance** - Map hosts to compliance requirements
8. **Automate deployment** - Use IaC for consistency

## Conclusion

Azure Dedicated Host provides the physical isolation required for compliance-sensitive workloads while maintaining the flexibility of cloud infrastructure. By understanding capacity planning, maintenance control, and high availability patterns, you can deploy dedicated infrastructure that meets your organization's strictest requirements while optimizing costs.

