---
title: "Azure Landing Zones: Enterprise-Scale Cloud Foundation"
author: Michael John Peña
draft: false
date: 2022-01-21
url: /blog/azure-landing-zones/
tags:
  - azure
  - landing-zones
  - enterprise
  - architecture

---

I wrote "Azure Landing Zones: Enterprise-Scale Cloud Foundation" to share practical, production-minded guidance on this topic.

## What Are Landing Zones?

A landing zone is a pre-configured Azure environment that includes:
- Identity and access management
- Network topology
- Security baseline
- Management and monitoring
- Governance framework

## Landing Zone Architecture

```
Management Groups
├── Root
│   ├── Platform
│   │   ├── Identity
│   │   ├── Management
│   │   └── Connectivity
│   ├── Landing Zones
│   │   ├── Corp (internal apps)
│   │   └── Online (internet-facing)
│   ├── Sandbox
│   └── Decommissioned
```

## Deploying with Bicep

```bicep
// management-groups.bicep
targetScope = 'tenant'

param rootManagementGroupId string = 'Contoso'

resource rootMG 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: rootManagementGroupId
  properties: {
    displayName: 'Contoso Root'
  }
}

resource platformMG 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: '${rootManagementGroupId}-Platform'
  properties: {
    displayName: 'Platform'
    details: {
      parent: {
        id: rootMG.id
      }
    }
  }
}

resource identityMG 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: '${rootManagementGroupId}-Identity'
  properties: {
    displayName: 'Identity'
    details: {
      parent: {
        id: platformMG.id
      }
    }
  }
}

resource connectivityMG 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: '${rootManagementGroupId}-Connectivity'
  properties: {
    displayName: 'Connectivity'
    details: {
      parent: {
        id: platformMG.id
      }
    }
  }
}

resource landingZonesMG 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: '${rootManagementGroupId}-LandingZones'
  properties: {
    displayName: 'Landing Zones'
    details: {
      parent: {
        id: rootMG.id
      }
    }
  }
}

resource corpMG 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: '${rootManagementGroupId}-Corp'
  properties: {
    displayName: 'Corp'
    details: {
      parent: {
        id: landingZonesMG.id
      }
    }
  }
}

resource onlineMG 'Microsoft.Management/managementGroups@2021-04-01' = {
  name: '${rootManagementGroupId}-Online'
  properties: {
    displayName: 'Online'
    details: {
      parent: {
        id: landingZonesMG.id
      }
    }
  }
}
```

## Hub-Spoke Network Topology

```bicep
// connectivity/hub-network.bicep
param location string = 'australiaeast'
param hubAddressPrefix string = '10.0.0.0/16'

resource hubVnet 'Microsoft.Network/virtualNetworks@2021-08-01' = {
  name: 'vnet-hub-${location}'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [hubAddressPrefix]
    }
    subnets: [
      {
        name: 'GatewaySubnet'
        properties: {
          addressPrefix: '10.0.0.0/24'
        }
      }
      {
        name: 'AzureFirewallSubnet'
        properties: {
          addressPrefix: '10.0.1.0/24'
        }
      }
      {
        name: 'AzureBastionSubnet'
        properties: {
          addressPrefix: '10.0.2.0/24'
        }
      }
    ]
  }
}

resource firewall 'Microsoft.Network/azureFirewalls@2021-08-01' = {
  name: 'fw-hub-${location}'
  location: location
  properties: {
    sku: {
      name: 'AZFW_VNet'
      tier: 'Standard'
    }
    ipConfigurations: [
      {
        name: 'fw-ipconfig'
        properties: {
          subnet: {
            id: '${hubVnet.id}/subnets/AzureFirewallSubnet'
          }
          publicIPAddress: {
            id: firewallPip.id
          }
        }
      }
    ]
    firewallPolicy: {
      id: firewallPolicy.id
    }
  }
}

resource firewallPolicy 'Microsoft.Network/firewallPolicies@2021-08-01' = {
  name: 'fw-policy-hub'
  location: location
  properties: {
    sku: {
      tier: 'Standard'
    }
    threatIntelMode: 'Alert'
  }
}

resource firewallPip 'Microsoft.Network/publicIPAddresses@2021-08-01' = {
  name: 'pip-fw-hub'
  location: location
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

output hubVnetId string = hubVnet.id
output firewallPrivateIp string = firewall.properties.ipConfigurations[0].properties.privateIPAddress
```

## Spoke Network with Peering

```bicep
// landing-zone/spoke-network.bicep
param location string
param spokeName string
param addressPrefix string
param hubVnetId string
param firewallPrivateIp string

resource spokeVnet 'Microsoft.Network/virtualNetworks@2021-08-01' = {
  name: 'vnet-${spokeName}'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [addressPrefix]
    }
    subnets: [
      {
        name: 'default'
        properties: {
          addressPrefix: addressPrefix
          routeTable: {
            id: routeTable.id
          }
        }
      }
    ]
  }
}

resource routeTable 'Microsoft.Network/routeTables@2021-08-01' = {
  name: 'rt-${spokeName}'
  location: location
  properties: {
    routes: [
      {
        name: 'default-via-firewall'
        properties: {
          addressPrefix: '0.0.0.0/0'
          nextHopType: 'VirtualAppliance'
          nextHopIpAddress: firewallPrivateIp
        }
      }
    ]
  }
}

resource peeringToHub 'Microsoft.Network/virtualNetworks/virtualNetworkPeerings@2021-08-01' = {
  parent: spokeVnet
  name: 'peer-to-hub'
  properties: {
    remoteVirtualNetwork: {
      id: hubVnetId
    }
    allowVirtualNetworkAccess: true
    allowForwardedTraffic: true
    useRemoteGateways: true
  }
}
```

## Policy Assignments for Landing Zones

```bicep
// governance/policy-assignments.bicep
targetScope = 'managementGroup'

param managementGroupId string

resource denyPublicIp 'Microsoft.Authorization/policyAssignments@2021-06-01' = {
  name: 'deny-public-ip'
  properties: {
    displayName: 'Deny Public IP Addresses'
    policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/83a86a26-fd1f-447c-b59d-e51f44264114'
    enforcementMode: 'Default'
  }
}

resource requireTags 'Microsoft.Authorization/policyAssignments@2021-06-01' = {
  name: 'require-tags'
  properties: {
    displayName: 'Require Tags on Resources'
    policyDefinitionId: '/providers/Microsoft.Authorization/policyDefinitions/871b6d14-10aa-478d-b590-94f262ecfa99'
    parameters: {
      tagName: {
        value: 'costCenter'
      }
    }
  }
}
```

Azure Landing Zones provide the foundation for a successful enterprise cloud journey, ensuring consistency, security, and governance from day one.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
