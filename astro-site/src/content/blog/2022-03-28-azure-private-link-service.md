---
title: "Azure Private Link Service: Expose Your Services Privately"
author: Michael John Peña
draft: false
date: 2022-03-28
tags:
  - Azure
  - Private Link
  - Networking
  - Security
  - Architecture
---

## Private Link Service vs Private Endpoint

- **Private Endpoint**: Consume services privately (you're the client)
- **Private Link Service**: Expose services privately (you're the provider)

## Use Cases

1. **SaaS providers**: Offer services to customers without public exposure
2. **Internal services**: Share services across subscriptions/tenants
3. **Partner integration**: Provide APIs to partners securely
4. **Multi-tenant architectures**: Isolate tenant data access

## Architecture

```
Consumer VNet                              Provider VNet
┌────────────────┐                        ┌────────────────┐
│                │                        │                │
│ ┌────────────┐ │    Private Link        │ ┌────────────┐ │
│ │  Private   │ ├────────────────────────┤►│  Standard  │ │
│ │  Endpoint  │ │      Connection        │ │    Load    │ │
│ │  10.1.0.5  │ │                        │ │  Balancer  │ │
│ └────────────┘ │                        │ └─────┬──────┘ │
│                │                        │       │        │
└────────────────┘                        │ ┌─────┴──────┐ │
                                          │ │   VMs /    │ │
                                          │ │  Service   │ │
                                          │ └────────────┘ │
                                          └────────────────┘
```

## Creating a Private Link Service

### Prerequisites

```bash
# Create a Standard Load Balancer
az network lb create \
    --name provider-lb \
    --resource-group provider-rg \
    --sku Standard \
    --frontend-ip-name frontend \
    --backend-pool-name backend

# Create health probe
az network lb probe create \
    --lb-name provider-lb \
    --resource-group provider-rg \
    --name health-probe \
    --protocol tcp \
    --port 443

# Create load balancing rule
az network lb rule create \
    --lb-name provider-lb \
    --resource-group provider-rg \
    --name https-rule \
    --frontend-ip-name frontend \
    --backend-pool-name backend \
    --protocol tcp \
    --frontend-port 443 \
    --backend-port 443 \
    --probe-name health-probe
```

### Create Private Link Service

```bash
# Create the Private Link Service
az network private-link-service create \
    --name my-private-link-service \
    --resource-group provider-rg \
    --vnet-name provider-vnet \
    --subnet pls-subnet \
    --lb-name provider-lb \
    --lb-frontend-ip-configs frontend \
    --location eastus
```

### Terraform Configuration

```hcl
# Provider-side: Create Private Link Service
resource "azurerm_private_link_service" "api_service" {
  name                = "pls-api-service"
  location            = var.location
  resource_group_name = var.resource_group_name

  load_balancer_frontend_ip_configuration_ids = [
    azurerm_lb.api.frontend_ip_configuration[0].id
  ]

  nat_ip_configuration {
    name      = "primary"
    subnet_id = azurerm_subnet.pls.id
    primary   = true
  }

  # Control who can create private endpoints to this service
  visibility_subscription_ids = var.allowed_subscription_ids
  auto_approval_subscription_ids = var.auto_approve_subscription_ids

  tags = {
    environment = "production"
    service     = "api"
  }
}

# Load Balancer for the backend service
resource "azurerm_lb" "api" {
  name                = "lb-api"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "Standard"

  frontend_ip_configuration {
    name                          = "frontend"
    subnet_id                     = azurerm_subnet.backend.id
    private_ip_address_allocation = "Dynamic"
  }
}

resource "azurerm_lb_backend_address_pool" "api" {
  loadbalancer_id = azurerm_lb.api.id
  name            = "backend-pool"
}

resource "azurerm_lb_probe" "api" {
  loadbalancer_id = azurerm_lb.api.id
  name            = "health-probe"
  port            = 443
}

resource "azurerm_lb_rule" "api" {
  loadbalancer_id                = azurerm_lb.api.id
  name                           = "https-rule"
  protocol                       = "Tcp"
  frontend_port                  = 443
  backend_port                   = 443
  frontend_ip_configuration_name = "frontend"
  backend_address_pool_ids       = [azurerm_lb_backend_address_pool.api.id]
  probe_id                       = azurerm_lb_probe.api.id
}
```

## Consumer Configuration

```hcl
# Consumer-side: Create Private Endpoint to the service
resource "azurerm_private_endpoint" "api_consumer" {
  name                = "pe-api-service"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = azurerm_subnet.consumer.id

  private_service_connection {
    name                           = "api-service-connection"
    private_connection_resource_id = data.azurerm_private_link_service.api.id
    is_manual_connection           = var.requires_approval
    request_message                = var.requires_approval ? "Please approve access" : null
  }
}

# Reference the provider's Private Link Service
data "azurerm_private_link_service" "api" {
  name                = "pls-api-service"
  resource_group_name = "provider-rg"
}
```

## Approval Workflows

### Auto-Approval

```hcl
resource "azurerm_private_link_service" "auto_approve" {
  name                = "pls-auto-approve"
  # ...

  # Automatically approve connections from these subscriptions
  auto_approval_subscription_ids = [
    var.trusted_subscription_1,
    var.trusted_subscription_2
  ]

  # These subscriptions can see and connect to the service
  visibility_subscription_ids = [
    var.trusted_subscription_1,
    var.trusted_subscription_2,
    var.partner_subscription
  ]
}
```

### Manual Approval

```bash
# List pending connections
az network private-endpoint-connection list \
    --name my-private-link-service \
    --resource-group provider-rg \
    --type Microsoft.Network/privateLinkServices

# Approve a connection
az network private-endpoint-connection approve \
    --name "consumer-pe.{guid}" \
    --resource-name my-private-link-service \
    --resource-group provider-rg \
    --type Microsoft.Network/privateLinkServices \
    --description "Approved by admin"

# Reject a connection
az network private-endpoint-connection reject \
    --name "consumer-pe.{guid}" \
    --resource-name my-private-link-service \
    --resource-group provider-rg \
    --type Microsoft.Network/privateLinkServices \
    --description "Not authorized"
```

## Multi-Region Setup

```hcl
# Deploy Private Link Service in multiple regions
locals {
  regions = {
    primary   = "eastus"
    secondary = "westus2"
  }
}

resource "azurerm_private_link_service" "regional" {
  for_each            = local.regions
  name                = "pls-api-${each.key}"
  location            = each.value
  resource_group_name = var.resource_group_name

  load_balancer_frontend_ip_configuration_ids = [
    azurerm_lb.api[each.key].frontend_ip_configuration[0].id
  ]

  nat_ip_configuration {
    name      = "primary"
    subnet_id = azurerm_subnet.pls[each.key].id
    primary   = true
  }
}
```

## Monitoring and Diagnostics

```python
# Query Private Link Service metrics
from azure.mgmt.monitor import MonitorManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
monitor_client = MonitorManagementClient(credential, subscription_id)

metrics = monitor_client.metrics.list(
    resource_uri=f"/subscriptions/{subscription_id}/resourceGroups/{rg}/providers/Microsoft.Network/privateLinkServices/{pls_name}",
    timespan="PT1H",
    interval="PT1M",
    metricnames="BytesSent,BytesReceived,NatPortsAllocated",
    aggregation="Average"
)

for item in metrics.value:
    print(f"{item.name.value}:")
    for ts in item.timeseries:
        for data in ts.data:
            print(f"  {data.time_stamp}: {data.average}")
```

## Security Considerations

### Network Security Groups

```hcl
# NSG for Private Link Service subnet
resource "azurerm_network_security_group" "pls" {
  name                = "nsg-pls"
  location            = var.location
  resource_group_name = var.resource_group_name

  # Allow traffic from Private Link infrastructure
  security_rule {
    name                       = "AllowPrivateLinkInbound"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "10.0.0.0/8"  # Adjust to your network
    destination_address_prefix = "*"
  }
}
```

### Disable Network Policies

```bash
# Private Link Service requires network policies disabled on the subnet
az network vnet subnet update \
    --name pls-subnet \
    --vnet-name provider-vnet \
    --resource-group provider-rg \
    --disable-private-link-service-network-policies true
```

## Common Patterns

### SaaS Multi-Tenant Architecture

```hcl
# Per-tenant Private Link Service
resource "azurerm_private_link_service" "tenant" {
  for_each            = var.tenants
  name                = "pls-tenant-${each.key}"
  location            = var.location
  resource_group_name = var.resource_group_name

  load_balancer_frontend_ip_configuration_ids = [
    azurerm_lb.tenant[each.key].frontend_ip_configuration[0].id
  ]

  nat_ip_configuration {
    name      = "primary"
    subnet_id = azurerm_subnet.pls.id
    primary   = true
  }

  # Only this tenant can connect
  visibility_subscription_ids = [each.value.subscription_id]
  auto_approval_subscription_ids = [each.value.subscription_id]

  tags = {
    tenant = each.key
  }
}
```

### Internal API Gateway

```hcl
# Expose API Gateway via Private Link
resource "azurerm_private_link_service" "apim" {
  name                = "pls-api-gateway"
  location            = var.location
  resource_group_name = var.resource_group_name

  load_balancer_frontend_ip_configuration_ids = [
    azurerm_lb.apim.frontend_ip_configuration[0].id
  ]

  nat_ip_configuration {
    name      = "primary"
    subnet_id = azurerm_subnet.apim_pls.id
    primary   = true
  }

  # Allow all internal subscriptions
  visibility_subscription_ids = var.internal_subscription_ids
}
```

## Pricing Considerations

Private Link Service pricing:
- Per hour charge for the service
- Per GB data processed
- No charge for connections

```python
# Estimate monthly cost
def estimate_pls_cost(hours_per_month=730, gb_processed=1000):
    hourly_rate = 0.01  # Example rate
    per_gb_rate = 0.01  # Example rate

    hourly_cost = hours_per_month * hourly_rate
    data_cost = gb_processed * per_gb_rate

    return {
        "hourly_cost": hourly_cost,
        "data_cost": data_cost,
        "total": hourly_cost + data_cost
    }
```

## Best Practices

1. **Use Standard Load Balancer**: Required for Private Link Service
2. **Plan NAT IP allocation**: Each connection consumes NAT ports
3. **Implement approval workflows**: Don't auto-approve unknown subscriptions
4. **Monitor connection status**: Alert on rejected or pending connections
5. **Document service endpoints**: Provide clear consumer documentation
6. **Test failover**: Verify behavior when backend instances change

## Conclusion

Azure Private Link Service enables secure, private service exposure:
- No public internet exposure for your services
- Cross-subscription and cross-tenant access
- Approval-based access control
- Seamless integration with existing load balancers

For organizations building shared services or SaaS platforms, Private Link Service is essential for secure, scalable access.

## Resources

- [Private Link Service Documentation](https://docs.microsoft.com/en-us/azure/private-link/private-link-service-overview)
- [Create Private Link Service](https://docs.microsoft.com/en-us/azure/private-link/create-private-link-service-portal)
- [Private Link Pricing](https://azure.microsoft.com/en-us/pricing/details/private-link/)
