---
title: Azure VMware Solution - Running VMware Workloads in Azure
author: Michael John Peña
draft: false
date: 2021-04-27
url: /blog/azure-vmware-solution-hybrid-cloud/
tags:
  - Azure
  - VMware
  - Hybrid Cloud
  - Migration
  - Infrastructure

---

I wrote "2021-04-27-azure-vmware-solution-hybrid-cloud" to share practical, production-minded guidance on this topic.

## Understanding Azure VMware Solution

### What AVS Provides

```
┌─────────────────────────────────────────────────────────┐
│               Azure VMware Solution                      │
│  ┌────────────────────────────────────────────────────┐ │
│  │         VMware Software Stack                      │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐          │ │
│  │  │ vSphere  │ │  vSAN    │ │   NSX-T  │          │ │
│  │  │ (ESXi)   │ │ Storage  │ │ Network  │          │ │
│  │  └──────────┘ └──────────┘ └──────────┘          │ │
│  │                                                    │ │
│  │  ┌──────────────────────────────────────────────┐ │ │
│  │  │           Your VMs and Workloads             │ │ │
│  │  │  • Windows/Linux servers                     │ │ │
│  │  │  • Applications                              │ │ │
│  │  │  • Databases                                 │ │ │
│  │  └──────────────────────────────────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  Azure Integration:                                      │
│  • ExpressRoute connectivity                            │
│  • Azure services (Storage, SQL, etc.)                  │
│  • Azure Active Directory                               │
│  • Azure Monitor                                        │
└─────────────────────────────────────────────────────────┘
```

### Key Components

- **Private Cloud** - Dedicated VMware environment
- **Clusters** - Groups of ESXi hosts (minimum 3)
- **vSAN** - Software-defined storage
- **NSX-T** - Software-defined networking
- **HCX** - Workload mobility and migration

## Planning Your AVS Deployment

### Sizing Considerations

```python
# AVS sizing calculator
def calculate_avs_sizing(workloads):
    """Calculate required AVS hosts based on workload requirements"""

    total_vcpu = sum(w['vcpu'] for w in workloads)
    total_memory_gb = sum(w['memory_gb'] for w in workloads)
    total_storage_tb = sum(w['storage_tb'] for w in workloads)

    # AVS host specifications (AV36 node)
    host_vcpu = 36  # Physical cores (72 logical with HT)
    host_memory_gb = 576
    host_storage_tb = 15.2  # Raw vSAN capacity

    # Calculate with overhead (typically 20-30% for HA, vSAN, etc.)
    overhead = 1.3

    hosts_by_cpu = (total_vcpu * overhead) / (host_vcpu * 4)  # 4:1 overcommit
    hosts_by_memory = (total_memory_gb * overhead) / host_memory_gb
    hosts_by_storage = (total_storage_tb * overhead) / (host_storage_tb * 0.7)  # vSAN overhead

    required_hosts = max(
        3,  # Minimum cluster size
        int(max(hosts_by_cpu, hosts_by_memory, hosts_by_storage)) + 1
    )

    return {
        'total_vcpu_required': total_vcpu,
        'total_memory_required_gb': total_memory_gb,
        'total_storage_required_tb': total_storage_tb,
        'hosts_required': required_hosts,
        'recommendation': f"Deploy {required_hosts} AV36 hosts"
    }

# Example workloads
workloads = [
    {'name': 'SQL Server', 'vcpu': 16, 'memory_gb': 128, 'storage_tb': 2},
    {'name': 'App Server 1', 'vcpu': 8, 'memory_gb': 32, 'storage_tb': 0.5},
    {'name': 'App Server 2', 'vcpu': 8, 'memory_gb': 32, 'storage_tb': 0.5},
    {'name': 'Web Servers', 'vcpu': 24, 'memory_gb': 48, 'storage_tb': 0.3},
    {'name': 'Dev/Test', 'vcpu': 32, 'memory_gb': 64, 'storage_tb': 1},
]

sizing = calculate_avs_sizing(workloads)
print(sizing)
```

### Network Planning

```
On-Premises Network          Azure Network          AVS Network
─────────────────────────────────────────────────────────────

192.168.0.0/16 ────────── ExpressRoute ────────── 10.0.0.0/22
                               │                  (Management)
                               │
                    ┌──────────┴──────────┐       10.1.0.0/22
                    │   Azure VNet         │       (vMotion)
                    │   10.100.0.0/16      │
                    │                      │       10.2.0.0/22
                    │   • Azure Services   │       (Workload)
                    │   • Jump boxes       │
                    │   • DNS              │
                    └──────────────────────┘

Required CIDR blocks for AVS:
- /22 for management network
- Non-overlapping with on-premises and Azure VNets
```

## Deploying AVS

### Using Azure CLI

```bash
# Register provider
az provider register -n Microsoft.AVS

# Create private cloud
az vmware private-cloud create \
    --name myAVSPrivateCloud \
    --resource-group avs-rg \
    --location eastus \
    --sku AV36 \
    --cluster-size 3 \
    --network-block 10.0.0.0/22 \
    --nsxt-password "ComplexPassword123!" \
    --vcenter-password "ComplexPassword456!"

# Wait for deployment (can take 3-4 hours)
az vmware private-cloud show \
    --name myAVSPrivateCloud \
    --resource-group avs-rg \
    --query "provisioningState"

# Get connection info
az vmware private-cloud show \
    --name myAVSPrivateCloud \
    --resource-group avs-rg \
    --query "{vcenter: endpoints.vcsa, nsxt: endpoints.nsxtManager}"
```

### Using Terraform

```hcl
provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "avs" {
  name     = "avs-resource-group"
  location = "East US"
}

resource "azurerm_vmware_private_cloud" "main" {
  name                = "my-avs-privatecloud"
  resource_group_name = azurerm_resource_group.avs.name
  location            = azurerm_resource_group.avs.location
  sku_name            = "av36"

  management_cluster {
    size = 3
  }

  network_subnet_cidr         = "10.0.0.0/22"
  internet_connection_enabled = false

  nsxt_password    = var.nsxt_password
  vcenter_password = var.vcenter_password

  tags = {
    Environment = "Production"
  }
}

# ExpressRoute circuit for connectivity
resource "azurerm_vmware_express_route_authorization" "main" {
  name             = "avs-authorization"
  private_cloud_id = azurerm_vmware_private_cloud.main.id
}

# Connect to Azure VNet
resource "azurerm_virtual_network_gateway_connection" "avs" {
  name                = "avs-connection"
  location            = azurerm_resource_group.avs.location
  resource_group_name = azurerm_resource_group.avs.name

  type                            = "ExpressRoute"
  virtual_network_gateway_id      = azurerm_virtual_network_gateway.main.id
  express_route_circuit_id        = azurerm_vmware_private_cloud.main.circuit[0].express_route_id
  authorization_key               = azurerm_vmware_express_route_authorization.main.express_route_authorization_key
}
```

## Configuring Connectivity

### ExpressRoute Global Reach

```bash
# Connect on-premises to AVS via Global Reach
az network express-route peering connection create \
    --resource-group avs-rg \
    --name GlobalReachToAVS \
    --circuit-name onprem-expressroute \
    --peering-name AzurePrivatePeering \
    --peer-circuit /subscriptions/.../expressRouteCircuits/avs-circuit \
    --address-prefix 10.5.0.0/29
```

### Internet Connectivity

```bash
# Enable managed SNAT for internet access
az vmware private-cloud update \
    --name myAVSPrivateCloud \
    --resource-group avs-rg \
    --internet Enabled

# Or use Azure Firewall/NVA for controlled egress
# Configure NSX-T default route to point to Azure Firewall
```

## Migration with HCX

### HCX Deployment

```bash
# Install HCX addon
az vmware addon hcx create \
    --resource-group avs-rg \
    --private-cloud myAVSPrivateCloud \
    --offer VMware-HCX-Enterprise

# Get HCX cloud manager URL
az vmware addon hcx show \
    --resource-group avs-rg \
    --private-cloud myAVSPrivateCloud
```

### Migration Types

```yaml
HCX Migration Options:
  Cold Migration:
    - VM powered off during migration
    - Best for: Non-critical workloads
    - Downtime: Full migration duration

  vMotion (HCX vMotion):
    - Live migration with minimal downtime
    - Best for: Production workloads
    - Downtime: Seconds

  Bulk Migration:
    - Multiple VMs in parallel
    - Scheduled switchover
    - Best for: Large-scale migrations
    - Downtime: Switchover window

  Replication Assisted vMotion (RAV):
    - Combines replication with vMotion
    - Best for: Large VMs, slow links
    - Downtime: Seconds
```

### Migration Script

```python
# Example: HCX migration automation
from hcxsdk import HCXClient

# Connect to HCX
hcx = HCXClient(
    cloud_url="https://hcx-cloud.avs.azure.com",
    connector_url="https://hcx-connector.onprem.local",
    username="administrator@vsphere.local",
    password="password"
)

# Define migration plan
migration_plan = {
    "name": "Phase1-Migration",
    "vms": [
        {"name": "web-server-01", "target_folder": "Production/Web"},
        {"name": "web-server-02", "target_folder": "Production/Web"},
        {"name": "app-server-01", "target_folder": "Production/App"}
    ],
    "target_compute": "AVS-Cluster-01",
    "target_datastore": "vSAN-Datastore",
    "target_network": "workload-segment",
    "migration_type": "bulk",
    "switchover_schedule": "2021-04-28T02:00:00Z"
}

# Create and start migration
job = hcx.create_migration(migration_plan)
job.start()

# Monitor progress
while job.status != "completed":
    print(f"Progress: {job.progress}%")
    time.sleep(60)

print(f"Migration completed: {job.summary}")
```

## Integrating with Azure Services

### Azure NetApp Files for Storage

```bash
# Create Azure NetApp Files volume
az netappfiles volume create \
    --resource-group avs-rg \
    --account-name avsnetapp \
    --pool-name avspool \
    --name avs-datastore \
    --location eastus \
    --service-level Premium \
    --vnet azure-vnet \
    --subnet anf-subnet \
    --protocol-types NFSv3 \
    --usage-threshold 4096

# Mount in AVS as NFS datastore
# Use vCenter to add NFS datastore pointing to ANF volume
```

### Azure Backup for AVS

```bash
# Enable Azure Backup for AVS VMs
az backup vault create \
    --resource-group avs-rg \
    --name avs-backup-vault \
    --location eastus

# Configure backup policy
az backup policy create \
    --resource-group avs-rg \
    --vault-name avs-backup-vault \
    --name avs-daily-policy \
    --policy @backup-policy.json
```

### Azure Monitor Integration

```bash
# Enable diagnostics
az vmware private-cloud diagnostic-setting create \
    --name avs-diagnostics \
    --resource-group avs-rg \
    --private-cloud myAVSPrivateCloud \
    --logs '[{"category":"VMwareSyslog","enabled":true}]' \
    --metrics '[{"category":"AllMetrics","enabled":true}]' \
    --workspace /subscriptions/.../workspaces/avs-logs
```

## Best Practices

1. **Plan network addressing carefully** - Avoid CIDR conflicts
2. **Use HCX for migrations** - Simplifies workload mobility
3. **Implement proper RBAC** - Limit vCenter access
4. **Enable monitoring** - Integrate with Azure Monitor
5. **Plan for disaster recovery** - Use Azure Site Recovery
6. **Optimize costs** - Right-size clusters, use reserved instances
7. **Leverage Azure services** - Don't rebuild what Azure offers
8. **Maintain compliance** - AVS inherits Azure certifications

## When to Use AVS

```yaml
Good fit for AVS:
  - Existing VMware investments
  - Rapid cloud migration
  - Disaster recovery
  - Datacenter extension
  - License optimization (AHUB)
  - Regulated workloads

Consider alternatives when:
  - Starting fresh (Azure native)
  - Cost-sensitive small workloads
  - No VMware expertise
  - Serverless-first strategy
```

## Conclusion

Azure VMware Solution provides a seamless path to the cloud for VMware workloads, combining familiar tools with Azure's global infrastructure and services. Whether you're extending your datacenter, migrating workloads, or implementing disaster recovery, AVS offers the flexibility and integration capabilities needed for modern hybrid cloud architectures.

