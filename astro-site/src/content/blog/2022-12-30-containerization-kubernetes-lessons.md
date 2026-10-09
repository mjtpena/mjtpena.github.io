---
title: "Containerization and Kubernetes: Lessons Learned in 2022"
author: Michael John Peña
draft: false
date: 2022-12-30
tags:
  - Azure
  - Kubernetes
  - Containers
  - AKS
  - DevOps
---

## When to Use Kubernetes (and When Not To)

```python
# Decision framework for container orchestration
def recommend_platform(workload_characteristics: dict) -> str:
    """
    Recommend container platform based on workload characteristics.
    """

    score = {
        "kubernetes": 0,
        "container_apps": 0,
        "app_service": 0,
        "functions": 0
    }

    # Scale requirements
    if workload_characteristics.get("scale_to_thousands"):
        score["kubernetes"] += 3
        score["container_apps"] += 2
    elif workload_characteristics.get("scale_to_hundreds"):
        score["kubernetes"] += 2
        score["container_apps"] += 3
    else:
        score["app_service"] += 2
        score["functions"] += 2

    # Complexity
    if workload_characteristics.get("complex_networking"):
        score["kubernetes"] += 3
    if workload_characteristics.get("service_mesh_needed"):
        score["kubernetes"] += 3
    if workload_characteristics.get("custom_operators"):
        score["kubernetes"] += 3

    # Team expertise
    if workload_characteristics.get("kubernetes_expertise"):
        score["kubernetes"] += 2
    else:
        score["container_apps"] += 2
        score["app_service"] += 2

    # Workload type
    if workload_characteristics.get("event_driven"):
        score["functions"] += 3
        score["container_apps"] += 2
    if workload_characteristics.get("long_running"):
        score["kubernetes"] += 2
        score["container_apps"] += 2
        score["app_service"] += 2

    # Cost sensitivity
    if workload_characteristics.get("cost_sensitive"):
        score["container_apps"] += 2
        score["app_service"] += 2
        score["functions"] += 3

    # Multi-cloud requirement
    if workload_characteristics.get("multi_cloud"):
        score["kubernetes"] += 3

    best_option = max(score, key=score.get)
    return best_option, score

# Example usage
workload = {
    "scale_to_hundreds": True,
    "complex_networking": False,
    "kubernetes_expertise": False,
    "event_driven": True,
    "cost_sensitive": True
}

recommendation, scores = recommend_platform(workload)
# Returns: ("container_apps", {...})
```

## AKS Best Practices from 2022

```bicep
// Production-ready AKS cluster
resource aks 'Microsoft.ContainerService/managedClusters@2022-11-01' = {
  name: 'aks-${environment}'
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentity.id}': {}
    }
  }
  properties: {
    dnsPrefix: 'aks-${environment}'
    kubernetesVersion: '1.25.5'

    // Enable Azure AD integration
    aadProfile: {
      managed: true
      enableAzureRBAC: true
      adminGroupObjectIDs: [adminGroupId]
    }

    // Network configuration
    networkProfile: {
      networkPlugin: 'azure'
      networkPolicy: 'calico'
      loadBalancerSku: 'standard'
      outboundType: 'userDefinedRouting'
      serviceCidr: '10.0.0.0/16'
      dnsServiceIP: '10.0.0.10'
    }

    // System node pool
    agentPoolProfiles: [
      {
        name: 'system'
        count: 3
        vmSize: 'Standard_D4s_v3'
        mode: 'System'
        osType: 'Linux'
        osDiskType: 'Ephemeral'
        osDiskSizeGB: 100
        availabilityZones: ['1', '2', '3']
        enableAutoScaling: true
        minCount: 3
        maxCount: 5
        vnetSubnetID: aksSubnet.id
        nodeTaints: ['CriticalAddonsOnly=true:NoSchedule']
        nodeLabels: {
          'node-type': 'system'
        }
      }
    ]

    // Security settings
    apiServerAccessProfile: {
      enablePrivateCluster: true
      privateDNSZone: privateDnsZone.id
    }

    autoUpgradeProfile: {
      upgradeChannel: 'stable'
    }

    disableLocalAccounts: true

    securityProfile: {
      defender: {
        securityMonitoring: {
          enabled: true
        }
        logAnalyticsWorkspaceResourceId: logAnalyticsWorkspace.id
      }
      workloadIdentity: {
        enabled: true
      }
    }

    // Monitoring
    addonProfiles: {
      omsagent: {
        enabled: true
        config: {
          logAnalyticsWorkspaceResourceId: logAnalyticsWorkspace.id
        }
      }
      azureKeyvaultSecretsProvider: {
        enabled: true
        config: {
          enableSecretRotation: 'true'
          rotationPollInterval: '2m'
        }
      }
    }

    oidcIssuerProfile: {
      enabled: true
    }
  }
}

// Workload node pool
resource workloadPool 'Microsoft.ContainerService/managedClusters/agentPools@2022-11-01' = {
  parent: aks
  name: 'workload'
  properties: {
    count: 5
    vmSize: 'Standard_D8s_v3'
    mode: 'User'
    osType: 'Linux'
    osDiskType: 'Ephemeral'
    osDiskSizeGB: 128
    availabilityZones: ['1', '2', '3']
    enableAutoScaling: true
    minCount: 3
    maxCount: 20
    vnetSubnetID: aksSubnet.id
    nodeLabels: {
      'node-type': 'workload'
    }
  }
}
```

## Container Security Lessons

```yaml
# Pod Security Standards (PSS) - Restricted
apiVersion: v1
kind: Namespace
metadata:
  name: production
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```
