---
title: High-Bandwidth Connectivity with Azure ExpressRoute Direct
author: Michael John Peña
draft: false
date: 2021-07-09
url: /blog/expressroute-direct/
tags:
  - Azure
  - Networking
  - ExpressRoute
  - Hybrid Cloud
  - Connectivity

---

I wrote "2021-07-09-expressroute-direct" to share practical, production-minded guidance on this topic.

# Understanding ExpressRoute Direct

ExpressRoute Direct offers:

- Direct physical connectivity to Microsoft's network
- 10 Gbps or 100 Gbps port pairs
- Support for massive data ingestion scenarios
- Multiple circuits on a single port pair
- MACsec encryption for Layer 2 security
- QinQ VLAN tagging support

# Creating an ExpressRoute Direct Resource

Set up ExpressRoute Direct:

```bash
# Create ExpressRoute Direct resource
az network express-route port create \
    --resource-group rg-networking \
    --name er-direct-eastus \
    --peering-location "Equinix-Seattle-SE2" \
    --bandwidth-in-gbps 100 \
    --encapsulation Dot1Q

# Get port details including LOA (Letter of Authorization)
az network express-route port show \
    --resource-group rg-networking \
    --name er-direct-eastus \
    --query "{name: name, location: peeringLocation, bandwidth: bandwidthInGbps, provisionedBandwidth: provisionedBandwidthInGbps, etherType: etherType}"
```

# Configuring ExpressRoute Direct with Terraform

Infrastructure as code for ExpressRoute Direct:

```hcl
# Express Route Direct resource
resource "azurerm_express_route_port" "er_direct" {
  name                = "er-direct-eastus"
  resource_group_name = azurerm_resource_group.networking.name
  location            = azurerm_resource_group.networking.location

  peering_location = "Equinix-Seattle-SE2"
  bandwidth_in_gbps = 100
  encapsulation     = "Dot1Q"

  link1 {
    admin_enabled                 = true
    macsec_cak_keyvault_secret_id = azurerm_key_vault_secret.macsec_cak.id
    macsec_ckn_keyvault_secret_id = azurerm_key_vault_secret.macsec_ckn.id
    macsec_cipher                 = "GcmAes256"
  }

  link2 {
    admin_enabled                 = true
    macsec_cak_keyvault_secret_id = azurerm_key_vault_secret.macsec_cak.id
    macsec_ckn_keyvault_secret_id = azurerm_key_vault_secret.macsec_ckn.id
    macsec_cipher                 = "GcmAes256"
  }

  tags = {
    Environment = "Production"
    CostCenter  = "Networking"
  }
}

# MACsec secrets in Key Vault
resource "azurerm_key_vault_secret" "macsec_cak" {
  name         = "er-macsec-cak"
  value        = var.macsec_cak_value
  key_vault_id = azurerm_key_vault.networking.id
}

resource "azurerm_key_vault_secret" "macsec_ckn" {
  name         = "er-macsec-ckn"
  value        = var.macsec_ckn_value
  key_vault_id = azurerm_key_vault.networking.id
}

# Create ExpressRoute circuit on the Direct port
resource "azurerm_express_route_circuit" "production" {
  name                  = "er-circuit-production"
  resource_group_name   = azurerm_resource_group.networking.name
  location              = azurerm_resource_group.networking.location

  express_route_port_id = azurerm_express_route_port.er_direct.id
  bandwidth_in_gbps     = 10

  sku {
    tier   = "Premium"
    family = "MeteredData"
  }

  tags = {
    Environment = "Production"
  }
}

resource "azurerm_express_route_circuit" "disaster_recovery" {
  name                  = "er-circuit-dr"
  resource_group_name   = azurerm_resource_group.networking.name
  location              = azurerm_resource_group.networking.location

  express_route_port_id = azurerm_express_route_port.er_direct.id
  bandwidth_in_gbps     = 5

  sku {
    tier   = "Premium"
    family = "UnlimitedData"
  }

  tags = {
    Environment = "DR"
  }
}
```

# Configuring MACsec Encryption

Enable Layer 2 encryption for enhanced security:

```python
from azure.mgmt.network import NetworkManagementClient
from azure.identity import DefaultAzureCredential
import secrets

credential = DefaultAzureCredential()
network_client = NetworkManagementClient(credential, subscription_id)

# Generate MACsec keys (in production, use HSM or secure key generation)
def generate_macsec_keys():
    # CAK (Connectivity Association Key) - 32 bytes for AES-256
    cak = secrets.token_hex(32)
    # CKN (Connectivity Association Key Name) - typically 32 bytes
    ckn = secrets.token_hex(32)
    return cak, ckn

cak, ckn = generate_macsec_keys()

# Store in Key Vault
from azure.keyvault.secrets import SecretClient

kv_client = SecretClient(
    vault_url="https://networking-keyvault.vault.azure.net",
    credential=credential
)

kv_client.set_secret("er-macsec-cak", cak)
kv_client.set_secret("er-macsec-ckn", ckn)

# Configure MACsec on ExpressRoute Direct
er_port = network_client.express_route_ports.get(
    resource_group_name="rg-networking",
    express_route_port_name="er-direct-eastus"
)

# Update link configuration
er_port.links[0].mac_sec_config = {
    "ckn_secret_identifier": f"https://networking-keyvault.vault.azure.net/secrets/er-macsec-ckn",
    "cak_secret_identifier": f"https://networking-keyvault.vault.azure.net/secrets/er-macsec-cak",
    "cipher": "GcmAes256",
    "sci_state": "Enabled"
}

er_port.links[1].mac_sec_config = {
    "ckn_secret_identifier": f"https://networking-keyvault.vault.azure.net/secrets/er-macsec-ckn",
    "cak_secret_identifier": f"https://networking-keyvault.vault.azure.net/secrets/er-macsec-cak",
    "cipher": "GcmAes256",
    "sci_state": "Enabled"
}

network_client.express_route_ports.begin_create_or_update(
    resource_group_name="rg-networking",
    express_route_port_name="er-direct-eastus",
    parameters=er_port
)
```

# Creating Circuits on ExpressRoute Direct

Provision multiple circuits on your Direct ports:

```python
# Create production circuit
production_circuit = network_client.express_route_circuits.begin_create_or_update(
    resource_group_name="rg-networking",
    circuit_name="er-circuit-production",
    parameters={
        "location": "eastus",
        "sku": {
            "name": "Premium_MeteredData",
            "tier": "Premium",
            "family": "MeteredData"
        },
        "properties": {
            "expressRoutePort": {
                "id": f"/subscriptions/{subscription_id}/resourceGroups/rg-networking/providers/Microsoft.Network/expressRoutePorts/er-direct-eastus"
            },
            "bandwidthInGbps": 10
        }
    }
).result()

# Configure private peering
private_peering = network_client.express_route_circuit_peerings.begin_create_or_update(
    resource_group_name="rg-networking",
    circuit_name="er-circuit-production",
    peering_name="AzurePrivatePeering",
    peering_parameters={
        "properties": {
            "peeringType": "AzurePrivatePeering",
            "peerASN": 65001,
            "primaryPeerAddressPrefix": "192.168.1.0/30",
            "secondaryPeerAddressPrefix": "192.168.1.4/30",
            "vlanId": 100,
            "state": "Enabled"
        }
    }
).result()

# Configure Microsoft peering for Office 365 and Dynamics 365
microsoft_peering = network_client.express_route_circuit_peerings.begin_create_or_update(
    resource_group_name="rg-networking",
    circuit_name="er-circuit-production",
    peering_name="MicrosoftPeering",
    peering_parameters={
        "properties": {
            "peeringType": "MicrosoftPeering",
            "peerASN": 65001,
            "primaryPeerAddressPrefix": "192.168.2.0/30",
            "secondaryPeerAddressPrefix": "192.168.2.4/30",
            "vlanId": 200,
            "microsoftPeeringConfig": {
                "advertisedPublicPrefixes": ["203.0.113.0/24"],
                "customerASN": 65001,
                "routingRegistryName": "ARIN"
            }
        }
    }
).result()
```

# Connecting Virtual Networks

Link VNets to your ExpressRoute circuit:

```python
# Create Virtual Network Gateway
vnet_gateway = network_client.virtual_network_gateways.begin_create_or_update(
    resource_group_name="rg-networking",
    virtual_network_gateway_name="er-gateway-hub",
    parameters={
        "location": "eastus",
        "properties": {
            "gatewayType": "ExpressRoute",
            "sku": {
                "name": "ErGw3AZ",
                "tier": "ErGw3AZ"
            },
            "ipConfigurations": [{
                "name": "gwipconfig",
                "properties": {
                    "subnet": {
                        "id": f"/subscriptions/{subscription_id}/resourceGroups/rg-networking/providers/Microsoft.Network/virtualNetworks/hub-vnet/subnets/GatewaySubnet"
                    },
                    "publicIPAddress": {
                        "id": f"/subscriptions/{subscription_id}/resourceGroups/rg-networking/providers/Microsoft.Network/publicIPAddresses/er-gateway-pip"
                    }
                }
            }]
        }
    }
).result()

# Create connection to ExpressRoute circuit
connection = network_client.virtual_network_gateway_connections.begin_create_or_update(
    resource_group_name="rg-networking",
    virtual_network_gateway_connection_name="er-connection-production",
    parameters={
        "location": "eastus",
        "properties": {
            "connectionType": "ExpressRoute",
            "virtualNetworkGateway1": {
                "id": vnet_gateway.id
            },
            "peer": {
                "id": f"/subscriptions/{subscription_id}/resourceGroups/rg-networking/providers/Microsoft.Network/expressRouteCircuits/er-circuit-production"
            },
            "authorizationKey": "circuit-authorization-key",
            "routingWeight": 10
        }
    }
).result()
```

# Monitoring ExpressRoute Direct

Monitor port and circuit health:

```python
from azure.mgmt.monitor import MonitorManagementClient

monitor_client = MonitorManagementClient(credential, subscription_id)

# Get ExpressRoute Direct metrics
def get_port_metrics(resource_group, port_name, metric_names, timespan="PT1H"):
    resource_uri = f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/expressRoutePorts/{port_name}"

    metrics = monitor_client.metrics.list(
        resource_uri=resource_uri,
        metricnames=",".join(metric_names),
        timespan=timespan,
        interval="PT5M",
        aggregation="Average,Maximum"
    )

    for metric in metrics.value:
        print(f"\nMetric: {metric.name.value}")
        for timeseries in metric.timeseries:
            for data in timeseries.data:
                print(f"  {data.time_stamp}: Avg={data.average}, Max={data.maximum}")

# Monitor port utilization
get_port_metrics(
    "rg-networking",
    "er-direct-eastus",
    ["PortBitsInPerSecond", "PortBitsOutPerSecond", "AdminState", "LineProtocol"]
)

# Set up alerts for high utilization
alert_rule = {
    "location": "global",
    "properties": {
        "description": "Alert when ExpressRoute port utilization exceeds 80%",
        "severity": 2,
        "enabled": True,
        "evaluationFrequency": "PT5M",
        "windowSize": "PT15M",
        "criteria": {
            "odata.type": "Microsoft.Azure.Monitor.SingleResourceMultipleMetricCriteria",
            "allOf": [
                {
                    "name": "HighPortUtilization",
                    "metricName": "PortBitsInPerSecond",
                    "dimensions": [],
                    "operator": "GreaterThan",
                    "threshold": 80000000000,  # 80 Gbps for 100G port
                    "timeAggregation": "Average"
                }
            ]
        },
        "actions": [
            {
                "actionGroupId": f"/subscriptions/{subscription_id}/resourceGroups/rg-monitoring/providers/Microsoft.Insights/actionGroups/network-alerts"
            }
        ],
        "scopes": [
            f"/subscriptions/{subscription_id}/resourceGroups/rg-networking/providers/Microsoft.Network/expressRoutePorts/er-direct-eastus"
        ]
    }
}
```

# Bandwidth Management

Manage bandwidth allocation across circuits:

```python
# List all circuits on ExpressRoute Direct
er_port = network_client.express_route_ports.get(
    resource_group_name="rg-networking",
    express_route_port_name="er-direct-eastus"
)

print(f"Total Bandwidth: {er_port.bandwidth_in_gbps} Gbps")
print(f"Provisioned Bandwidth: {er_port.provisioned_bandwidth_in_gbps} Gbps")
print(f"Available Bandwidth: {er_port.bandwidth_in_gbps - er_port.provisioned_bandwidth_in_gbps} Gbps")

# Get circuits using this port
circuits = network_client.express_route_circuits.list_by_resource_group("rg-networking")

for circuit in circuits:
    if circuit.express_route_port:
        print(f"\nCircuit: {circuit.name}")
        print(f"  Bandwidth: {circuit.bandwidth_in_gbps} Gbps")
        print(f"  Service Provider Status: {circuit.service_provider_provisioning_state}")

# Resize a circuit
def resize_circuit(circuit_name, new_bandwidth_gbps):
    circuit = network_client.express_route_circuits.get(
        resource_group_name="rg-networking",
        circuit_name=circuit_name
    )

    circuit.bandwidth_in_gbps = new_bandwidth_gbps

    result = network_client.express_route_circuits.begin_create_or_update(
        resource_group_name="rg-networking",
        circuit_name=circuit_name,
        parameters=circuit
    ).result()

    print(f"Circuit {circuit_name} resized to {new_bandwidth_gbps} Gbps")
    return result

# Scale up production circuit
resize_circuit("er-circuit-production", 20)
```

# Conclusion

Azure ExpressRoute Direct provides the highest level of connectivity to Azure with dedicated 10 Gbps or 100 Gbps ports. This solution is ideal for organizations with massive data transfer requirements, strict compliance needs, or those wanting complete control over their Azure connectivity.

With features like MACsec encryption, multiple circuit support, and flexible bandwidth allocation, ExpressRoute Direct enables enterprises to build robust, secure, and high-performance hybrid cloud architectures. While it requires more initial investment and network expertise, the benefits for large-scale workloads are substantial.

