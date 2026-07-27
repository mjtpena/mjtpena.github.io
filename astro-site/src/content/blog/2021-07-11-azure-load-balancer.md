---
title: Azure Load Balancer - Distributing Traffic Effectively
author: Michael John Peña
draft: false
date: 2021-07-11
url: /blog/azure-load-balancer/
tags:
  - Azure
  - Networking
  - Load Balancer
  - High Availability
  - Infrastructure

---

I wrote "2021-07-11-azure-load-balancer" to share practical, production-minded guidance on this topic.

# Standard vs Basic Load Balancer

Azure offers two SKUs:

- **Basic**: Free, limited features, no SLA
- **Standard**: Zone-redundant, SLA-backed, supports availability zones

# Creating a Public Load Balancer

Set up an internet-facing load balancer:

```bash
# Create public IP for load balancer
az network public-ip create \
    --resource-group rg-loadbalancer \
    --name lb-public-ip \
    --sku Standard \
    --zone 1 2 3 \
    --allocation-method Static

# Create load balancer
az network lb create \
    --resource-group rg-loadbalancer \
    --name web-lb \
    --sku Standard \
    --public-ip-address lb-public-ip \
    --frontend-ip-name frontend-pool \
    --backend-pool-name backend-pool

# Create health probe
az network lb probe create \
    --resource-group rg-loadbalancer \
    --lb-name web-lb \
    --name health-probe-http \
    --protocol Http \
    --port 80 \
    --path /health \
    --interval 5 \
    --threshold 2

# Create load balancing rule
az network lb rule create \
    --resource-group rg-loadbalancer \
    --lb-name web-lb \
    --name http-rule \
    --protocol Tcp \
    --frontend-port 80 \
    --backend-port 80 \
    --frontend-ip-name frontend-pool \
    --backend-pool-name backend-pool \
    --probe-name health-probe-http \
    --idle-timeout 15 \
    --enable-tcp-reset true
```

# Terraform Configuration

Complete load balancer setup with Terraform:

```hcl
# Public IP for Load Balancer
resource "azurerm_public_ip" "lb" {
  name                = "lb-public-ip"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  allocation_method   = "Static"
  sku                 = "Standard"
  zones               = ["1", "2", "3"]

  tags = {
    Environment = "Production"
  }
}

# Load Balancer
resource "azurerm_lb" "web" {
  name                = "web-lb"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Standard"

  frontend_ip_configuration {
    name                 = "frontend-pool"
    public_ip_address_id = azurerm_public_ip.lb.id
  }

  tags = {
    Environment = "Production"
  }
}

# Backend Address Pool
resource "azurerm_lb_backend_address_pool" "web" {
  loadbalancer_id = azurerm_lb.web.id
  name            = "backend-pool"
}

# Health Probes
resource "azurerm_lb_probe" "http" {
  loadbalancer_id     = azurerm_lb.web.id
  name                = "http-probe"
  protocol            = "Http"
  port                = 80
  request_path        = "/health"
  interval_in_seconds = 5
  number_of_probes    = 2
}

resource "azurerm_lb_probe" "https" {
  loadbalancer_id     = azurerm_lb.web.id
  name                = "https-probe"
  protocol            = "Https"
  port                = 443
  request_path        = "/health"
  interval_in_seconds = 5
  number_of_probes    = 2
}

# Load Balancing Rules
resource "azurerm_lb_rule" "http" {
  loadbalancer_id                = azurerm_lb.web.id
  name                           = "http-rule"
  protocol                       = "Tcp"
  frontend_port                  = 80
  backend_port                   = 80
  frontend_ip_configuration_name = "frontend-pool"
  backend_address_pool_ids       = [azurerm_lb_backend_address_pool.web.id]
  probe_id                       = azurerm_lb_probe.http.id
  idle_timeout_in_minutes        = 15
  enable_tcp_reset               = true
  disable_outbound_snat          = true
}

resource "azurerm_lb_rule" "https" {
  loadbalancer_id                = azurerm_lb.web.id
  name                           = "https-rule"
  protocol                       = "Tcp"
  frontend_port                  = 443
  backend_port                   = 443
  frontend_ip_configuration_name = "frontend-pool"
  backend_address_pool_ids       = [azurerm_lb_backend_address_pool.web.id]
  probe_id                       = azurerm_lb_probe.https.id
  idle_timeout_in_minutes        = 15
  enable_tcp_reset               = true
  disable_outbound_snat          = true
}

# Outbound Rules
resource "azurerm_lb_outbound_rule" "web" {
  loadbalancer_id         = azurerm_lb.web.id
  name                    = "outbound-rule"
  protocol                = "All"
  backend_address_pool_id = azurerm_lb_backend_address_pool.web.id

  frontend_ip_configuration {
    name = "frontend-pool"
  }

  allocated_outbound_ports = 1024
  idle_timeout_in_minutes  = 4
}
```

# Internal Load Balancer

Create an internal load balancer for backend services:

```hcl
# Internal Load Balancer
resource "azurerm_lb" "internal" {
  name                = "api-internal-lb"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Standard"

  frontend_ip_configuration {
    name                          = "internal-frontend"
    subnet_id                     = azurerm_subnet.backend.id
    private_ip_address_allocation = "Static"
    private_ip_address            = "10.0.2.10"
    zones                         = ["1", "2", "3"]
  }

  tags = {
    Environment = "Production"
    Role        = "Internal"
  }
}

resource "azurerm_lb_backend_address_pool" "internal" {
  loadbalancer_id = azurerm_lb.internal.id
  name            = "api-backend-pool"
}

resource "azurerm_lb_probe" "api" {
  loadbalancer_id     = azurerm_lb.internal.id
  name                = "api-health-probe"
  protocol            = "Tcp"
  port                = 8080
  interval_in_seconds = 5
  number_of_probes    = 2
}

resource "azurerm_lb_rule" "api" {
  loadbalancer_id                = azurerm_lb.internal.id
  name                           = "api-rule"
  protocol                       = "Tcp"
  frontend_port                  = 8080
  backend_port                   = 8080
  frontend_ip_configuration_name = "internal-frontend"
  backend_address_pool_ids       = [azurerm_lb_backend_address_pool.internal.id]
  probe_id                       = azurerm_lb_probe.api.id
  idle_timeout_in_minutes        = 15
  enable_floating_ip             = false
  enable_tcp_reset               = true
}
```

# Adding VMs to Backend Pool

Associate virtual machines with the load balancer:

```python
from azure.mgmt.network import NetworkManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
network_client = NetworkManagementClient(credential, subscription_id)

# Associate NIC with backend pool
def add_vm_to_lb(resource_group, nic_name, backend_pool_id):
    nic = network_client.network_interfaces.get(resource_group, nic_name)

    # Update IP configuration with backend pool
    nic.ip_configurations[0].load_balancer_backend_address_pools = [
        {"id": backend_pool_id}
    ]

    result = network_client.network_interfaces.begin_create_or_update(
        resource_group,
        nic_name,
        nic
    ).result()

    return result

# Add multiple VMs
backend_pool_id = f"/subscriptions/{subscription_id}/resourceGroups/rg-loadbalancer/providers/Microsoft.Network/loadBalancers/web-lb/backendAddressPools/backend-pool"

for i in range(3):
    add_vm_to_lb("rg-vms", f"vm-web-{i}-nic", backend_pool_id)
    print(f"Added vm-web-{i} to load balancer")
```

# Session Persistence

Configure session affinity for stateful applications:

```hcl
# Load balancing rule with session persistence
resource "azurerm_lb_rule" "stateful_app" {
  loadbalancer_id                = azurerm_lb.web.id
  name                           = "stateful-app-rule"
  protocol                       = "Tcp"
  frontend_port                  = 8080
  backend_port                   = 8080
  frontend_ip_configuration_name = "frontend-pool"
  backend_address_pool_ids       = [azurerm_lb_backend_address_pool.web.id]
  probe_id                       = azurerm_lb_probe.http.id

  # Session persistence options:
  # - "Default" (None) - 5-tuple hash
  # - "SourceIP" - 2-tuple hash (source IP)
  # - "SourceIPProtocol" - 3-tuple hash (source IP + protocol)
  load_distribution = "SourceIP"

  idle_timeout_in_minutes = 30
  enable_tcp_reset        = true
}
```

# High Availability Ports

Enable HA ports for internal load balancers (network virtual appliances):

```hcl
# Internal LB with HA ports for NVA
resource "azurerm_lb" "nva" {
  name                = "nva-internal-lb"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku                 = "Standard"

  frontend_ip_configuration {
    name                          = "nva-frontend"
    subnet_id                     = azurerm_subnet.nva.id
    private_ip_address_allocation = "Static"
    private_ip_address            = "10.0.3.10"
  }
}

# HA Ports rule - load balances all ports and protocols
resource "azurerm_lb_rule" "ha_ports" {
  loadbalancer_id                = azurerm_lb.nva.id
  name                           = "ha-ports-rule"
  protocol                       = "All"
  frontend_port                  = 0
  backend_port                   = 0
  frontend_ip_configuration_name = "nva-frontend"
  backend_address_pool_ids       = [azurerm_lb_backend_address_pool.nva.id]
  probe_id                       = azurerm_lb_probe.nva.id
  enable_floating_ip             = true
}
```

# Inbound NAT Rules

Create direct NAT rules for specific VMs:

```bash
# Create inbound NAT rule for SSH to specific VM
az network lb inbound-nat-rule create \
    --resource-group rg-loadbalancer \
    --lb-name web-lb \
    --name ssh-vm-0 \
    --protocol Tcp \
    --frontend-port 2200 \
    --backend-port 22 \
    --frontend-ip-name frontend-pool

# Create NAT rule for VM 1
az network lb inbound-nat-rule create \
    --resource-group rg-loadbalancer \
    --lb-name web-lb \
    --name ssh-vm-1 \
    --protocol Tcp \
    --frontend-port 2201 \
    --backend-port 22 \
    --frontend-ip-name frontend-pool

# Associate NAT rule with NIC
az network nic ip-config inbound-nat-rule add \
    --resource-group rg-vms \
    --nic-name vm-web-0-nic \
    --ip-config-name ipconfig1 \
    --lb-name web-lb \
    --inbound-nat-rule ssh-vm-0
```

# Monitoring Load Balancer

Monitor health and performance:

```python
from azure.mgmt.monitor import MonitorManagementClient

monitor_client = MonitorManagementClient(credential, subscription_id)

# Get load balancer metrics
def get_lb_metrics(resource_group, lb_name):
    resource_uri = f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/loadBalancers/{lb_name}"

    metrics_to_query = [
        "ByteCount",
        "PacketCount",
        "SYNCount",
        "SnatConnectionCount",
        "AllocatedSnatPorts",
        "UsedSnatPorts",
        "HealthProbeStatus",
        "DipAvailability"
    ]

    metrics = monitor_client.metrics.list(
        resource_uri=resource_uri,
        metricnames=",".join(metrics_to_query),
        timespan="PT1H",
        interval="PT5M",
        aggregation="Average,Total"
    )

    for metric in metrics.value:
        print(f"\n{metric.name.value}:")
        for ts in metric.timeseries:
            for data in ts.data:
                avg = data.average if data.average else "N/A"
                total = data.total if data.total else "N/A"
                print(f"  {data.time_stamp}: Avg={avg}, Total={total}")

get_lb_metrics("rg-loadbalancer", "web-lb")

# Alert for unhealthy backend
alert_rule = {
    "location": "global",
    "properties": {
        "description": "Alert when backend health drops below threshold",
        "severity": 1,
        "enabled": True,
        "evaluationFrequency": "PT1M",
        "windowSize": "PT5M",
        "criteria": {
            "odata.type": "Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria",
            "allOf": [{
                "name": "BackendHealthAlert",
                "metricName": "DipAvailability",
                "operator": "LessThan",
                "threshold": 100,
                "timeAggregation": "Average"
            }]
        }
    }
}
```

# Conclusion

Azure Load Balancer is essential for building highly available applications. Whether you need public internet-facing load balancing or internal traffic distribution, Standard Load Balancer provides the features needed for production workloads.

Key considerations include choosing the right distribution mode for your application, configuring appropriate health probes, and properly managing SNAT ports for outbound connectivity. Combined with availability zones, Azure Load Balancer enables you to build resilient, scalable infrastructure.

