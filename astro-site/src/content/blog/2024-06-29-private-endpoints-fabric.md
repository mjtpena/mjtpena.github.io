---
title: "Private Endpoints Deep Dive for Microsoft Fabric"
description: "Private Endpoints enable secure, private connectivity to Microsoft Fabric. Today I'm taking a deep dive into implementing private endpoints."
author: Michael John Peña
draft: false
date: 2024-06-29
tags:
  - Microsoft Fabric
  - Private Endpoints
  - Private Link
  - Network Security
  - Enterprise
---

Private Endpoints enable secure, private connectivity to Microsoft Fabric. Today I'm taking a deep dive into implementing private endpoints.

## Private Endpoint Architecture

```
Private Endpoint Architecture:
├── OneLake Private Endpoint
│   ├── DFS endpoint (Data Lake)
│   ├── Blob endpoint (compatibility)
│   └── DNS: *.dfs.fabric.microsoft.com
├── SQL Analytics Endpoint
│   ├── TDS endpoint
│   └── DNS: *.pbidedicated.windows.net
├── Semantic Model Endpoint
│   ├── XMLA endpoint
│   └── DNS: *.analysis.windows.net
└── Power BI Service
    ├── Web interface
    └── DNS: *.powerbi.com
```

## Complete Private Endpoint Setup

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum
import json

class FabricEndpointType(Enum):
    ONELAKE = "onelake"
    SQL_ANALYTICS = "sqlanalytics"
    SEMANTIC_MODEL = "semanticmodel"
    POWERBI_SERVICE = "powerbi"

@dataclass
class PrivateEndpointConfig:
    name: str
    endpoint_type: FabricEndpointType
    resource_group: str
    vnet_name: str
    subnet_name: str
    region: str
    private_dns_zone_group: str = None

class FabricPrivateEndpointManager:
    """Complete private endpoint management for Fabric."""

    DNS_ZONES = {
        FabricEndpointType.ONELAKE: "privatelink.dfs.fabric.microsoft.com",
        FabricEndpointType.SQL_ANALYTICS: "privatelink.pbidedicated.windows.net",
        FabricEndpointType.SEMANTIC_MODEL: "privatelink.analysis.windows.net",
        FabricEndpointType.POWERBI_SERVICE: "privatelink.powerbi.com"
    }

    GROUP_IDS = {
        FabricEndpointType.ONELAKE: "onelake",
        FabricEndpointType.SQL_ANALYTICS: "sqlEndpoint",
        FabricEndpointType.SEMANTIC_MODEL: "analysisServicesEndpoint",
        FabricEndpointType.POWERBI_SERVICE: "tenant"
    }

    def __init__(self, network_client, dns_client, fabric_admin_client):
        self.network = network_client
        self.dns = dns_client
        self.fabric_admin = fabric_admin_client
        self.subscription_id = network_client.subscription_id

    def create_private_endpoint(self, config: PrivateEndpointConfig) -> dict:
        """Create a private endpoint for Fabric."""
        # Get the Fabric resource ID
        fabric_resource_id = self._get_fabric_resource_id(config.endpoint_type)

        # Get subnet ID
        subnet_id = self._get_subnet_id(
            config.resource_group,
            config.vnet_name,
            config.subnet_name
        )

        # Create private endpoint
        endpoint_config = {
            "location": config.region,
            "properties": {
                "privateLinkServiceConnections": [{
                    "name": f"{config.name}-plsc",
                    "properties": {
                        "privateLinkServiceId": fabric_resource_id,
                        "groupIds": [self.GROUP_IDS[config.endpoint_type]]
                    }
                }],
                "subnet": {
                    "id": subnet_id
                }
            }
        }

        # Add private DNS zone group if specified
        if config.private_dns_zone_group:
            endpoint_config["properties"]["privateDnsZoneGroups"] = [{
                "name": config.private_dns_zone_group,
                "properties": {
                    "privateDnsZoneConfigs": [{
                        "name": "config1",
                        "properties": {
                            "privateDnsZoneId": self._get_dns_zone_id(
                                config.resource_group,
                                self.DNS_ZONES[config.endpoint_type]
                            )
                        }
                    }]
                }
            }]

        result = self.network.private_endpoints.begin_create_or_update(
            config.resource_group,
            config.name,
            endpoint_config
        ).result()

        return {
            "id": result.id,
            "name": result.name,
            "private_ip": result.custom_dns_configs[0].ip_addresses[0] if result.custom_dns_configs else None,
            "status": result.provisioning_state
        }

    def create_all_fabric_endpoints(
        self,
        resource_group: str,
        vnet_name: str,
        subnet_name: str,
        region: str,
        name_prefix: str = "pe-fabric"
    ) -> List[dict]:
        """Create all required private endpoints for Fabric."""
        endpoints = []

        for endpoint_type in FabricEndpointType:
            config = PrivateEndpointConfig(
                name=f"{name_prefix}-{endpoint_type.value}",
                endpoint_type=endpoint_type,
                resource_group=resource_group,
                vnet_name=vnet_name,
                subnet_name=subnet_name,
                region=region,
                private_dns_zone_group=f"dns-{endpoint_type.value}"
            )

            # Create DNS zone first
            self.create_private_dns_zone(
                resource_group=resource_group,
                zone_name=self.DNS_ZONES[endpoint_type],
                vnet_name=vnet_name
            )

            # Create endpoint
            endpoint = self.create_private_endpoint(config)
            endpoints.append(endpoint)

        return endpoints

    def create_private_dns_zone(
        self,
        resource_group: str,
        zone_name: str,
        vnet_name: str
    ) -> dict:
        """Create private DNS zone and link to VNet."""
        # Create DNS zone
        zone = self.dns.private_zones.begin_create_or_update(
            resource_group,
            zone_name,
            {"location": "global"}
        ).result()

        # Link to VNet
        vnet_link = self.dns.virtual_network_links.begin_create_or_update(
            resource_group,
            zone_name,
            f"{vnet_name}-link",
            {
                "location": "global",
                "properties": {
                    "virtualNetwork": {
                        "id": f"/subscriptions/{self.subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/virtualNetworks/{vnet_name}"
                    },
                    "registrationEnabled": False
                }
            }
        ).result()

        return {
            "zone_id": zone.id,
            "zone_name": zone.name,
            "vnet_link_id": vnet_link.id
        }

    def _get_fabric_resource_id(self, endpoint_type: FabricEndpointType) -> str:
        """Get the Fabric resource ID for private endpoint."""
        tenant_info = self.fabric_admin.get_tenant_info()

        # Map endpoint types to resource paths
        resource_paths = {
            FabricEndpointType.ONELAKE: f"/subscriptions/{self.subscription_id}/resourceGroups/fabric/providers/Microsoft.Fabric/capacities/{tenant_info['capacityId']}",
            FabricEndpointType.SQL_ANALYTICS: tenant_info.get("sqlAnalyticsResourceId"),
            FabricEndpointType.SEMANTIC_MODEL: tenant_info.get("analysisServicesResourceId"),
            FabricEndpointType.POWERBI_SERVICE: tenant_info.get("powerBiResourceId")
        }

        return resource_paths.get(endpoint_type)

    def _get_subnet_id(self, resource_group: str, vnet_name: str, subnet_name: str) -> str:
        """Get subnet resource ID."""
        return f"/subscriptions/{self.subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/virtualNetworks/{vnet_name}/subnets/{subnet_name}"

    def _get_dns_zone_id(self, resource_group: str, zone_name: str) -> str:
        """Get DNS zone resource ID."""
        return f"/subscriptions/{self.subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/privateDnsZones/{zone_name}"

# Usage
pe_mgr = FabricPrivateEndpointManager(network_client, dns_client, fabric_admin_client)

# Create all Fabric private endpoints
endpoints = pe_mgr.create_all_fabric_endpoints(
    resource_group="rg-fabric-network",
    vnet_name="vnet-enterprise",
    subnet_name="snet-private-endpoints",
    region="eastus",
    name_prefix="pe-fabric-prod"
)

for ep in endpoints:
    print(f"{ep['name']}: {ep['private_ip']} ({ep['status']})")
```

## DNS Configuration

```python
class PrivateDNSManager:
    """Manage private DNS for Fabric endpoints."""

    FABRIC_DNS_ZONES = [
        "privatelink.dfs.fabric.microsoft.com",
        "privatelink.blob.core.windows.net",  # For legacy blob access
        "privatelink.pbidedicated.windows.net",
        "privatelink.analysis.windows.net",
        "privatelink.powerbi.com"
    ]

    def __init__(self, dns_client, network_client):
        self.dns = dns_client
        self.network = network_client

    def create_all_dns_zones(
        self,
        resource_group: str,
        vnets: List[dict]
    ) -> List[dict]:
        """Create all required DNS zones for Fabric."""
        zones = []

        for zone_name in self.FABRIC_DNS_ZONES:
            # Create zone
            zone = self.dns.private_zones.begin_create_or_update(
                resource_group,
                zone_name,
                {"location": "global"}
            ).result()

            # Link to all VNets
            for vnet in vnets:
                self.dns.virtual_network_links.begin_create_or_update(
                    resource_group,
                    zone_name,
                    f"{vnet['name']}-link",
                    {
                        "location": "global",
                        "properties": {
                            "virtualNetwork": {"id": vnet["id"]},
                            "registrationEnabled": False
                        }
                    }
                ).result()

            zones.append({
                "name": zone_name,
                "id": zone.id,
                "linked_vnets": [v["name"] for v in vnets]
            })

        return zones

    def add_dns_records(
        self,
        resource_group: str,
        zone_name: str,
        records: List[dict]
    ):
        """Add DNS records manually if needed."""
        for record in records:
            self.dns.record_sets.begin_create_or_update(
                resource_group,
                zone_name,
                record["name"],
                "A",
                {
                    "ttl": 3600,
                    "a_records": [{"ipv4_address": record["ip"]}]
                }
            ).result()

    def configure_conditional_forwarders(
        self,
        dns_server_ip: str,
        zones: List[str] = None
    ) -> dict:
        """Generate configuration for on-premises DNS conditional forwarders."""
        zones_to_forward = zones or self.FABRIC_DNS_ZONES

        config = {
            "forwarders": [],
            "powershell_commands": []
        }

        for zone in zones_to_forward:
            config["forwarders"].append({
                "zone": zone,
                "forward_to": dns_server_ip
            })

            config["powershell_commands"].append(
                f"Add-DnsServerConditionalForwarderZone -Name '{zone}' -MasterServers {dns_server_ip}"
            )

        return config

    def verify_dns_resolution(
        self,
        test_endpoints: List[str]
    ) -> List[dict]:
        """Verify DNS resolution for Fabric endpoints."""
        import socket
        results = []

        for endpoint in test_endpoints:
            try:
                ip = socket.gethostbyname(endpoint)
                is_private = ip.startswith("10.") or ip.startswith("192.168.") or ip.startswith("172.")

                results.append({
                    "endpoint": endpoint,
                    "resolved_ip": ip,
                    "is_private": is_private,
                    "status": "success"
                })
            except socket.gaierror as e:
                results.append({
                    "endpoint": endpoint,
                    "error": str(e),
                    "status": "failed"
                })

        return results

# Usage
dns_mgr = PrivateDNSManager(dns_client, network_client)

# Create all DNS zones and link to hub VNet
zones = dns_mgr.create_all_dns_zones(
    resource_group="rg-fabric-network",
    vnets=[
        {"name": "vnet-hub", "id": "/subscriptions/.../vnet-hub"},
        {"name": "vnet-spoke1", "id": "/subscriptions/.../vnet-spoke1"}
    ]
)

# Get on-premises forwarder configuration
forwarder_config = dns_mgr.configure_conditional_forwarders(
    dns_server_ip="10.0.0.4"
)

print("PowerShell commands for on-premises DNS:")
for cmd in forwarder_config["powershell_commands"]:
    print(cmd)
```

## Hub-Spoke Topology

```python
class HubSpokePrivateEndpointSetup:
    """Set up private endpoints in hub-spoke topology."""

    def __init__(self, network_client, dns_client, fabric_client):
        self.network = network_client
        self.dns = dns_client
        self.fabric = fabric_client
        self.pe_mgr = FabricPrivateEndpointManager(network_client, dns_client, fabric_client)

    def setup_hub_spoke_connectivity(
        self,
        hub_config: dict,
        spoke_configs: List[dict]
    ) -> dict:
        """Set up complete hub-spoke connectivity for Fabric."""
        results = {
            "hub": {},
            "spokes": [],
            "dns_zones": [],
            "peerings": []
        }

        # Create private endpoints in hub
        results["hub"]["endpoints"] = self.pe_mgr.create_all_fabric_endpoints(
            resource_group=hub_config["resource_group"],
            vnet_name=hub_config["vnet_name"],
            subnet_name=hub_config["pe_subnet_name"],
            region=hub_config["region"],
            name_prefix="pe-fabric-hub"
        )

        # Create DNS zones in hub and link to all VNets
        all_vnets = [
            {
                "name": hub_config["vnet_name"],
                "id": self._get_vnet_id(hub_config["resource_group"], hub_config["vnet_name"])
            }
        ]

        for spoke in spoke_configs:
            all_vnets.append({
                "name": spoke["vnet_name"],
                "id": self._get_vnet_id(spoke["resource_group"], spoke["vnet_name"])
            })

        dns_mgr = PrivateDNSManager(self.dns, self.network)
        results["dns_zones"] = dns_mgr.create_all_dns_zones(
            resource_group=hub_config["resource_group"],
            vnets=all_vnets
        )

        # Create VNet peerings
        for spoke in spoke_configs:
            # Hub to spoke peering
            hub_to_spoke = self._create_peering(
                source_rg=hub_config["resource_group"],
                source_vnet=hub_config["vnet_name"],
                target_rg=spoke["resource_group"],
                target_vnet=spoke["vnet_name"],
                peering_name=f"hub-to-{spoke['vnet_name']}"
            )

            # Spoke to hub peering
            spoke_to_hub = self._create_peering(
                source_rg=spoke["resource_group"],
                source_vnet=spoke["vnet_name"],
                target_rg=hub_config["resource_group"],
                target_vnet=hub_config["vnet_name"],
                peering_name=f"{spoke['vnet_name']}-to-hub"
            )

            results["peerings"].append({
                "spoke": spoke["vnet_name"],
                "hub_to_spoke": hub_to_spoke,
                "spoke_to_hub": spoke_to_hub
            })

            results["spokes"].append({
                "name": spoke["vnet_name"],
                "status": "connected"
            })

        return results

    def _create_peering(
        self,
        source_rg: str,
        source_vnet: str,
        target_rg: str,
        target_vnet: str,
        peering_name: str
    ) -> dict:
        """Create VNet peering."""
        target_vnet_id = self._get_vnet_id(target_rg, target_vnet)

        peering = self.network.virtual_network_peerings.begin_create_or_update(
            source_rg,
            source_vnet,
            peering_name,
            {
                "properties": {
                    "remoteVirtualNetwork": {"id": target_vnet_id},
                    "allowVirtualNetworkAccess": True,
                    "allowForwardedTraffic": True,
                    "allowGatewayTransit": source_vnet == "hub",
                    "useRemoteGateways": source_vnet != "hub"
                }
            }
        ).result()

        return {
            "name": peering.name,
            "status": peering.peering_state
        }

    def _get_vnet_id(self, resource_group: str, vnet_name: str) -> str:
        """Get VNet resource ID."""
        return f"/subscriptions/{self.network.subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Network/virtualNetworks/{vnet_name}"

# Usage
hub_spoke_setup = HubSpokePrivateEndpointSetup(network_client, dns_client, fabric_client)

# Configure hub-spoke topology
result = hub_spoke_setup.setup_hub_spoke_connectivity(
    hub_config={
        "resource_group": "rg-hub-network",
        "vnet_name": "vnet-hub",
        "pe_subnet_name": "snet-private-endpoints",
        "region": "eastus"
    },
    spoke_configs=[
        {
            "resource_group": "rg-spoke1",
            "vnet_name": "vnet-spoke-analytics"
        },
        {
            "resource_group": "rg-spoke2",
            "vnet_name": "vnet-spoke-engineering"
        }
    ]
)

print(f"Created {len(result['hub']['endpoints'])} endpoints in hub")
print(f"Connected {len(result['spokes'])} spokes")
```

## Validation and Testing

```python
class PrivateEndpointValidator:
    """Validate private endpoint configuration."""

    def __init__(self, network_client, fabric_client):
        self.network = network_client
        self.fabric = fabric_client

    def validate_endpoint_connectivity(
        self,
        endpoint_name: str,
        resource_group: str
    ) -> dict:
        """Validate private endpoint connectivity."""
        endpoint = self.network.private_endpoints.get(resource_group, endpoint_name)

        validation = {
            "endpoint_name": endpoint_name,
            "provisioning_state": endpoint.provisioning_state,
            "connection_state": None,
            "private_ip": None,
            "dns_configured": False,
            "issues": []
        }

        # Check connection state
        if endpoint.private_link_service_connections:
            conn = endpoint.private_link_service_connections[0]
            validation["connection_state"] = conn.private_link_service_connection_state.status

            if validation["connection_state"] != "Approved":
                validation["issues"].append(f"Connection not approved: {validation['connection_state']}")

        # Get private IP
        if endpoint.custom_dns_configs:
            validation["private_ip"] = endpoint.custom_dns_configs[0].ip_addresses[0]

        # Check DNS configuration
        if endpoint.private_dns_zone_groups:
            validation["dns_configured"] = True
        else:
            validation["issues"].append("No private DNS zone group configured")

        return validation

    def run_connectivity_test(
        self,
        test_vm_ip: str,
        fabric_endpoints: List[str]
    ) -> List[dict]:
        """Run connectivity tests from a VM."""
        # This would typically be run from a VM in the VNet
        test_script = """
import socket
import ssl

def test_endpoint(host, port=443):
    try:
        # DNS resolution
        ip = socket.gethostbyname(host)

        # TCP connection
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(10)
        sock.connect((ip, port))

        # TLS handshake
        context = ssl.create_default_context()
        with context.wrap_socket(sock, server_hostname=host) as ssock:
            cert = ssock.getpeercert()

        return {
            "host": host,
            "resolved_ip": ip,
            "tcp_connected": True,
            "tls_verified": True,
            "status": "success"
        }
    except Exception as e:
        return {
            "host": host,
            "error": str(e),
            "status": "failed"
        }
"""
        # Return expected structure for documentation
        return [
            {"host": ep, "status": "pending"} for ep in fabric_endpoints
        ]

    def generate_validation_report(
        self,
        resource_group: str
    ) -> dict:
        """Generate comprehensive validation report."""
        endpoints = self.network.private_endpoints.list(resource_group)

        report = {
            "timestamp": datetime.utcnow().isoformat(),
            "resource_group": resource_group,
            "endpoints": [],
            "dns_zones": [],
            "overall_status": "healthy",
            "issues": []
        }

        for endpoint in endpoints:
            if "fabric" in endpoint.name.lower():
                validation = self.validate_endpoint_connectivity(
                    endpoint.name,
                    resource_group
                )
                report["endpoints"].append(validation)

                if validation["issues"]:
                    report["overall_status"] = "unhealthy"
                    report["issues"].extend(validation["issues"])

        return report

# Usage
validator = PrivateEndpointValidator(network_client, fabric_client)

# Validate all endpoints
report = validator.generate_validation_report("rg-fabric-network")

print(f"Overall status: {report['overall_status']}")
for endpoint in report["endpoints"]:
    status = "OK" if not endpoint["issues"] else "ISSUES"
    print(f"  {endpoint['endpoint_name']}: {status}")
```

## Best Practices

1. **Hub-spoke topology** - Centralize private endpoints
2. **Automated DNS** - Use private DNS zone groups
3. **Validate connectivity** - Test from workloads
4. **Monitor health** - Track endpoint status
5. **Document IPs** - For firewall rules

## What's Next

Tomorrow I'll wrap up the Fabric series with a summary of key learnings.

## Resources

- [Private Endpoints for Fabric](https://learn.microsoft.com/fabric/security/security-private-links)
- [Private Link DNS](https://learn.microsoft.com/azure/private-link/private-endpoint-dns)
- [Hub-Spoke Network](https://learn.microsoft.com/azure/architecture/reference-architectures/hybrid-networking/hub-spoke)
