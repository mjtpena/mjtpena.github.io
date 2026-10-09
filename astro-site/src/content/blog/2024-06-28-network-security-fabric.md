---
title: "Network Security in Microsoft Fabric"
description: "Network security provides defense in depth for your data platform. Today I'm exploring network security options in Microsoft Fabric."
author: Michael John Peña
draft: false
date: 2024-06-28
tags:
  - Microsoft Fabric
  - Network Security
  - Firewall
  - Virtual Network
  - Security
---

Network security provides defense in depth for your data platform. Today I'm exploring network security options in Microsoft Fabric.

## Network Security Layers

```
Fabric Network Security:
├── Service Tags
│   ├── PowerBI
│   ├── DataFactory
│   └── AzureStorage
├── IP Firewall Rules
│   ├── Allow specific IPs
│   ├── Block by default
│   └── Allow Azure services
├── Private Endpoints
│   ├── OneLake endpoints
│   ├── SQL endpoints
│   └── Workspace endpoints
├── Virtual Network
│   ├── VNET data gateway
│   ├── Managed VNET
│   └── Service endpoints
└── ExpressRoute
    └── Private peering
```

## Tenant Network Settings

```python
from dataclasses import dataclass
from typing import List, Optional
from enum import Enum

class NetworkAccessLevel(Enum):
    PUBLIC = "public"
    PRIVATE = "private"
    HYBRID = "hybrid"

@dataclass
class TenantNetworkConfig:
    allow_public_access: bool
    allow_azure_services: bool
    allowed_ip_ranges: List[str]
    blocked_ip_ranges: List[str]
    private_link_enabled: bool

class TenantNetworkManager:
    """Manage tenant-level network settings."""

    def __init__(self, admin_client):
        self.admin = admin_client

    def get_network_settings(self) -> dict:
        """Get current network configuration."""
        return self.admin.tenant_settings.get_network_settings()

    def configure_ip_firewall(
        self,
        allow_public: bool,
        allowed_ips: List[str],
        allow_azure_services: bool = True
    ):
        """Configure IP-based firewall rules."""
        config = {
            "publicNetworkAccess": "Enabled" if allow_public else "Disabled",
            "allowAzureServicesAccess": allow_azure_services,
            "ipRules": [
                {"value": ip, "action": "Allow"}
                for ip in allowed_ips
            ]
        }

        return self.admin.tenant_settings.update_network(config)

    def block_public_access(self):
        """Block all public internet access."""
        return self.configure_ip_firewall(
            allow_public=False,
            allowed_ips=[],
            allow_azure_services=False
        )

    def allow_corporate_only(self, corporate_ips: List[str]):
        """Allow only corporate IP ranges."""
        return self.configure_ip_firewall(
            allow_public=True,
            allowed_ips=corporate_ips,
            allow_azure_services=True
        )

    def enable_private_link(self):
        """Enable Private Link for the tenant."""
        return self.admin.tenant_settings.update(
            "PrivateLinkEnabled",
            enabled=True
        )

    def get_network_audit_log(self, days: int = 7) -> List[dict]:
        """Get network-related audit events."""
        return self.admin.audit_logs.query(
            filter=f"category eq 'Network' and createdDateTime ge datetime'{self._days_ago(days)}'"
        )

# Usage
network_mgr = TenantNetworkManager(admin_client)

# Configure corporate-only access
network_mgr.allow_corporate_only(
    corporate_ips=[
        "10.0.0.0/8",
        "192.168.0.0/16",
        "203.0.113.0/24"
    ]
)

# Enable Private Link
network_mgr.enable_private_link()
```

## Azure Service Tags

```python
class ServiceTagManager:
    """Work with Azure Service Tags for Fabric."""

    # Relevant service tags for Fabric
    SERVICE_TAGS = {
        "PowerBI": "PowerBI",
        "DataFactory": "DataFactory",
        "AzureStorage": "Storage",
        "AzureSQL": "Sql",
        "EventHub": "EventHub",
        "ServiceBus": "ServiceBus"
    }

    def __init__(self, network_client):
        self.network = network_client

    def get_service_tag_ips(self, tag_name: str, region: str = None) -> List[str]:
        """Get IP ranges for a service tag."""
        tags = self.network.service_tags.list(location=region or "global")

        for tag in tags.values:
            if tag.name == self.SERVICE_TAGS.get(tag_name, tag_name):
                if region:
                    return [
                        prefix
                        for prefix in tag.properties.address_prefixes
                        if region.lower() in prefix.lower()
                    ]
                return tag.properties.address_prefixes

        return []

    def create_nsg_rules_for_fabric(
        self,
        nsg_name: str,
        resource_group: str,
        allow_outbound: bool = True
    ):
        """Create NSG rules for Fabric connectivity."""
        rules = []

        if allow_outbound:
            # Allow outbound to Power BI
            rules.append({
                "name": "Allow-PowerBI-Outbound",
                "priority": 100,
                "direction": "Outbound",
                "access": "Allow",
                "protocol": "Tcp",
                "sourceAddressPrefix": "*",
                "sourcePortRange": "*",
                "destinationAddressPrefix": "PowerBI",
                "destinationPortRange": "443"
            })

            # Allow outbound to Azure Storage (for OneLake)
            rules.append({
                "name": "Allow-Storage-Outbound",
                "priority": 110,
                "direction": "Outbound",
                "access": "Allow",
                "protocol": "Tcp",
                "sourceAddressPrefix": "*",
                "sourcePortRange": "*",
                "destinationAddressPrefix": "Storage",
                "destinationPortRange": "443"
            })

            # Allow outbound to Data Factory
            rules.append({
                "name": "Allow-DataFactory-Outbound",
                "priority": 120,
                "direction": "Outbound",
                "access": "Allow",
                "protocol": "Tcp",
                "sourceAddressPrefix": "*",
                "sourcePortRange": "*",
                "destinationAddressPrefix": "DataFactory",
                "destinationPortRange": "443"
            })

        # Apply rules to NSG
        for rule in rules:
            self.network.security_rules.create_or_update(
                resource_group,
                nsg_name,
                rule["name"],
                rule
            )

        return rules

    def generate_firewall_rules(self, region: str) -> dict:
        """Generate firewall rules for on-premises connectivity."""
        rules = {
            "outbound_https": []
        }

        for tag_name, tag_value in self.SERVICE_TAGS.items():
            ips = self.get_service_tag_ips(tag_value, region)
            rules["outbound_https"].extend([
                {"destination": ip, "port": 443, "protocol": "TCP", "service": tag_name}
                for ip in ips
            ])

        return rules

# Usage
svc_tag_mgr = ServiceTagManager(network_client)

# Get Power BI IPs for firewall configuration
powerbi_ips = svc_tag_mgr.get_service_tag_ips("PowerBI", region="eastus")
print(f"Power BI IP ranges: {len(powerbi_ips)}")

# Create NSG rules for VMs that need Fabric access
svc_tag_mgr.create_nsg_rules_for_fabric(
    nsg_name="fabric-access-nsg",
    resource_group="rg-networking"
)
```

## Private Endpoints

```python
class PrivateEndpointManager:
    """Manage Private Endpoints for Fabric."""

    def __init__(self, network_client, fabric_client):
        self.network = network_client
        self.fabric = fabric_client

    def create_onelake_private_endpoint(
        self,
        name: str,
        resource_group: str,
        vnet_name: str,
        subnet_name: str,
        region: str
    ):
        """Create private endpoint for OneLake."""
        # Get Fabric resource ID
        fabric_resource = self.fabric.get_resource_info()

        endpoint_config = {
            "location": region,
            "properties": {
                "privateLinkServiceConnections": [{
                    "name": f"{name}-connection",
                    "properties": {
                        "privateLinkServiceId": fabric_resource["oneLakeResourceId"],
                        "groupIds": ["onelake"]
                    }
                }],
                "subnet": {
                    "id": f"/subscriptions/{self._subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/virtualNetworks/{vnet_name}/subnets/{subnet_name}"
                }
            }
        }

        return self.network.private_endpoints.create_or_update(
            resource_group,
            name,
            endpoint_config
        )

    def create_sql_private_endpoint(
        self,
        name: str,
        resource_group: str,
        workspace_id: str,
        vnet_name: str,
        subnet_name: str,
        region: str
    ):
        """Create private endpoint for SQL endpoint."""
        workspace_info = self.fabric.workspaces.get(workspace_id)

        endpoint_config = {
            "location": region,
            "properties": {
                "privateLinkServiceConnections": [{
                    "name": f"{name}-connection",
                    "properties": {
                        "privateLinkServiceId": workspace_info["sqlEndpointResourceId"],
                        "groupIds": ["sqlEndpoint"]
                    }
                }],
                "subnet": {
                    "id": f"/subscriptions/{self._subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/virtualNetworks/{vnet_name}/subnets/{subnet_name}"
                }
            }
        }

        return self.network.private_endpoints.create_or_update(
            resource_group,
            name,
            endpoint_config
        )

    def configure_private_dns(
        self,
        resource_group: str,
        vnet_name: str,
        dns_zone_name: str
    ):
        """Configure private DNS for Fabric endpoints."""
        # Create private DNS zone
        dns_zone = self.network.private_dns_zones.create_or_update(
            resource_group,
            dns_zone_name,
            {"location": "global"}
        )

        # Link DNS zone to VNet
        self.network.private_dns_zone_vnet_links.create_or_update(
            resource_group,
            dns_zone_name,
            f"{vnet_name}-link",
            {
                "location": "global",
                "properties": {
                    "virtualNetwork": {
                        "id": f"/subscriptions/{self._subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/virtualNetworks/{vnet_name}"
                    },
                    "registrationEnabled": False
                }
            }
        )

        return dns_zone

    def setup_complete_private_connectivity(
        self,
        resource_group: str,
        vnet_name: str,
        subnet_name: str,
        region: str
    ):
        """Set up complete private connectivity for Fabric."""
        # Create OneLake private endpoint
        onelake_pe = self.create_onelake_private_endpoint(
            name="pe-fabric-onelake",
            resource_group=resource_group,
            vnet_name=vnet_name,
            subnet_name=subnet_name,
            region=region
        )

        # Configure DNS zones
        dns_zones = [
            "privatelink.dfs.fabric.microsoft.com",
            "privatelink.pbidedicated.windows.net",
            "privatelink.analysis.windows.net"
        ]

        for zone in dns_zones:
            self.configure_private_dns(resource_group, vnet_name, zone)

        return {
            "onelake_endpoint": onelake_pe,
            "dns_zones": dns_zones
        }

# Usage
pe_mgr = PrivateEndpointManager(network_client, fabric_client)

# Set up complete private connectivity
pe_mgr.setup_complete_private_connectivity(
    resource_group="rg-fabric-network",
    vnet_name="vnet-fabric",
    subnet_name="snet-private-endpoints",
    region="eastus"
)
```

## VNet Data Gateway

```python
class VNetDataGatewayManager:
    """Manage VNet Data Gateway for secure on-premises connectivity."""

    def __init__(self, fabric_client, network_client):
        self.fabric = fabric_client
        self.network = network_client

    def create_vnet_gateway(
        self,
        name: str,
        resource_group: str,
        vnet_name: str,
        subnet_name: str,
        region: str,
        capacity_units: int = 2
    ):
        """Create a VNet Data Gateway."""
        gateway_config = {
            "name": name,
            "type": "VirtualNetwork",
            "location": region,
            "capacityUnits": capacity_units,
            "virtualNetwork": {
                "resourceGroup": resource_group,
                "name": vnet_name,
                "subnet": subnet_name
            }
        }

        return self.fabric.gateways.create(gateway_config)

    def configure_gateway_data_source(
        self,
        gateway_id: str,
        data_source_name: str,
        connection_string: str,
        credential_type: str = "Windows"
    ):
        """Configure a data source on the gateway."""
        return self.fabric.gateways.add_data_source(
            gateway_id=gateway_id,
            data_source={
                "name": data_source_name,
                "connectionString": connection_string,
                "credentialType": credential_type
            }
        )

    def test_gateway_connectivity(self, gateway_id: str) -> dict:
        """Test gateway connectivity."""
        return self.fabric.gateways.test_connection(gateway_id)

    def get_gateway_status(self, gateway_id: str) -> dict:
        """Get gateway health status."""
        gateway = self.fabric.gateways.get(gateway_id)

        return {
            "id": gateway.id,
            "name": gateway.name,
            "status": gateway.status,
            "version": gateway.version,
            "capacityUnits": gateway.capacity_units,
            "lastOnline": gateway.last_online
        }

# Usage
gw_mgr = VNetDataGatewayManager(fabric_client, network_client)

# Create VNet gateway
gateway = gw_mgr.create_vnet_gateway(
    name="vnet-gw-onprem",
    resource_group="rg-fabric-network",
    vnet_name="vnet-fabric",
    subnet_name="snet-gateway",
    region="eastus",
    capacity_units=4
)

# Configure on-premises SQL Server
gw_mgr.configure_gateway_data_source(
    gateway_id=gateway.id,
    data_source_name="OnPrem-SQL-Server",
    connection_string="Server=sql.corp.local;Database=Sales;",
    credential_type="Windows"
)

# Test connectivity
status = gw_mgr.test_gateway_connectivity(gateway.id)
print(f"Gateway status: {status}")
```

## Network Monitoring

```python
class NetworkMonitor:
    """Monitor network security and connectivity."""

    def __init__(self, log_analytics_client, network_client):
        self.logs = log_analytics_client
        self.network = network_client

    def get_blocked_connections(self, days: int = 7) -> List[dict]:
        """Get blocked network connections."""
        query = f"""
        AzureDiagnostics
        | where TimeGenerated > ago({days}d)
        | where Category == "NetworkSecurityGroupFlowEvent"
        | where FlowStatus_s == "D"  // Denied
        | where Resource contains "fabric"
        | project
            TimeGenerated,
            SourceIP = SrcIP_s,
            DestinationIP = DestIP_s,
            DestinationPort = DestPort_d,
            Protocol = Protocol_s,
            Rule = NSGRuleName_s
        | order by TimeGenerated desc
        """

        return self.logs.query(query)

    def get_private_endpoint_traffic(self, days: int = 7) -> dict:
        """Analyze private endpoint traffic."""
        query = f"""
        AzureNetworkAnalytics_CL
        | where TimeGenerated > ago({days}d)
        | where FlowType_s == "IntraVNet" or FlowType_s == "InterVNet"
        | where DestPublicIPs_s == ""  // Private traffic
        | summarize
            TotalFlows = count(),
            TotalBytes = sum(BytesSentFromSource_d + BytesSentFromDestination_d)
        by bin(TimeGenerated, 1h)
        | order by TimeGenerated asc
        """

        return self.logs.query(query)

    def check_endpoint_health(self) -> List[dict]:
        """Check health of all private endpoints."""
        endpoints = self.network.private_endpoints.list_all()

        health_report = []
        for endpoint in endpoints:
            if "fabric" in endpoint.name.lower():
                connection_state = endpoint.private_link_service_connections[0].private_link_service_connection_state

                health_report.append({
                    "name": endpoint.name,
                    "status": connection_state.status,
                    "description": connection_state.description,
                    "provisioning_state": endpoint.provisioning_state
                })

        return health_report

    def generate_network_security_report(self) -> dict:
        """Generate comprehensive network security report."""
        return {
            "blocked_connections": self.get_blocked_connections(days=7),
            "private_endpoint_health": self.check_endpoint_health(),
            "private_traffic_stats": self.get_private_endpoint_traffic(days=7),
            "recommendations": self._generate_recommendations()
        }

    def _generate_recommendations(self) -> List[str]:
        """Generate security recommendations."""
        recommendations = []

        # Check for blocked connections patterns
        blocked = self.get_blocked_connections(days=1)
        if len(blocked) > 100:
            recommendations.append("High number of blocked connections - review firewall rules")

        # Check endpoint health
        health = self.check_endpoint_health()
        unhealthy = [e for e in health if e["status"] != "Approved"]
        if unhealthy:
            recommendations.append(f"{len(unhealthy)} private endpoints need attention")

        return recommendations

# Usage
monitor = NetworkMonitor(log_analytics_client, network_client)

# Generate security report
report = monitor.generate_network_security_report()

# Review blocked connections
for conn in report["blocked_connections"][:10]:
    print(f"Blocked: {conn['SourceIP']} -> {conn['DestinationIP']}:{conn['DestinationPort']}")

# Check endpoint health
for endpoint in report["private_endpoint_health"]:
    print(f"{endpoint['name']}: {endpoint['status']}")
```

## Best Practices

1. **Defense in depth** - Multiple network security layers
2. **Private by default** - Use private endpoints when possible
3. **Least access** - Only allow necessary IP ranges
4. **Monitor continuously** - Track blocked and allowed traffic
5. **Regular reviews** - Audit network rules periodically

## What's Next

Tomorrow I'll cover private endpoints in depth for Microsoft Fabric.

## Resources

- [Fabric Network Security](https://learn.microsoft.com/fabric/security/security-network)
- [Private Endpoints](https://learn.microsoft.com/fabric/security/security-private-links)
- [VNet Data Gateway](https://learn.microsoft.com/data-integration/vnet/overview)
