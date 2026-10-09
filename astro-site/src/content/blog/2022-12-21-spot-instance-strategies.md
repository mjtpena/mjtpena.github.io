---
title: "Azure Spot Instance Strategies for Cost Savings"
author: Michael John Peña
draft: false
date: 2022-12-21
tags:
  - Azure
  - Spot Instances
  - Cost Optimization
  - Compute
  - Best Practices
---

## Understanding Spot VMs

Spot VMs use Azure's excess capacity at significant discounts. Key characteristics:
- Up to 90% discount
- Can be evicted anytime
- 30-second eviction notice
- Best for fault-tolerant, interruptible workloads

## Ideal Use Cases

```python
spot_vm_suitability = {
    "excellent": [
        "Batch processing jobs",
        "CI/CD build agents",
        "Development/testing environments",
        "Big data processing (Spark, Hadoop)",
        "Machine learning training",
        "Rendering workloads",
        "Simulation and modeling"
    ],
    "good_with_design": [
        "Web applications (with proper scaling)",
        "Stateless microservices",
        "Queue processors",
        "Scheduled tasks"
    ],
    "not_recommended": [
        "Production databases",
        "Stateful applications without checkpointing",
        "Real-time systems with SLA requirements",
        "Single-instance critical workloads"
    ]
}
```

## Basic Spot VM Deployment

```bicep
// Single Spot VM
resource spotVm 'Microsoft.Compute/virtualMachines@2022-03-01' = {
  name: 'spot-worker-01'
  location: location
  properties: {
    hardwareProfile: {
      vmSize: 'Standard_D4s_v3'
    }
    priority: 'Spot'
    evictionPolicy: 'Deallocate'  // or 'Delete'
    billingProfile: {
      maxPrice: -1  // Pay up to on-demand price
      // Or set specific max: maxPrice: 0.05
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: '0001-com-ubuntu-server-jammy'
        sku: '22_04-lts'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: {
          storageAccountType: 'Standard_LRS'
        }
      }
    }
    osProfile: {
      computerName: 'spot-worker-01'
      adminUsername: adminUsername
      adminPassword: adminPassword
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id
        }
      ]
    }
  }
}
```

## Spot VM Scale Sets

```bicep
// Spot VMSS for scalable workloads
resource spotVmss 'Microsoft.Compute/virtualMachineScaleSets@2022-03-01' = {
  name: 'spot-vmss'
  location: location
  sku: {
    name: 'Standard_D4s_v3'
    tier: 'Standard'
    capacity: 10
  }
  properties: {
    upgradePolicy: {
      mode: 'Rolling'
      rollingUpgradePolicy: {
        maxBatchInstancePercent: 20
        maxUnhealthyInstancePercent: 20
        pauseTimeBetweenBatches: 'PT5S'
      }
    }
    virtualMachineProfile: {
      priority: 'Spot'
      evictionPolicy: 'Delete'
      billingProfile: {
        maxPrice: -1
      }
      osProfile: {
        computerNamePrefix: 'spot'
        adminUsername: adminUsername
        adminPassword: adminPassword
      }
      storageProfile: {
        imageReference: {
          publisher: 'Canonical'
          offer: '0001-com-ubuntu-server-jammy'
          sku: '22_04-lts'
          version: 'latest'
        }
        osDisk: {
          createOption: 'FromImage'
          managedDisk: {
            storageAccountType: 'Standard_LRS'
          }
        }
      }
      networkProfile: {
        networkInterfaceConfigurations: [
          {
            name: 'nic'
            properties: {
              primary: true
              ipConfigurations: [
                {
                  name: 'ipconfig'
                  properties: {
                    subnet: {
                      id: subnet.id
                    }
                  }
                }
              ]
            }
          }
        ]
      }
    }
    automaticRepairsPolicy: {
      enabled: true
      gracePeriod: 'PT10M'
    }
  }
}
```

## Handling Evictions

### Metadata Service Polling

```python
import requests
import time
import signal
import sys

def check_eviction():
    """Check for scheduled eviction via Azure Metadata Service."""
    try:
        response = requests.get(
            "http://169.254.169.254/metadata/scheduledevents",
            params={"api-version": "2020-07-01"},
            headers={"Metadata": "true"},
            timeout=2
        )

        events = response.json().get("Events", [])

        for event in events:
            if event.get("EventType") == "Preempt":
                return True, event.get("NotBefore")

        return False, None

    except Exception as e:
        print(f"Error checking eviction: {e}")
        return False, None

def graceful_shutdown():
    """Handle graceful shutdown on eviction."""
    print("Eviction detected! Starting graceful shutdown...")

    # Save checkpoint
    save_checkpoint()

    # Notify orchestrator
    notify_controller("eviction")

    # Complete current task if possible
    complete_current_task()

    sys.exit(0)

def main():
    while True:
        is_evicting, eviction_time = check_eviction()

        if is_evicting:
            graceful_shutdown()

        # Do work
        process_next_job()

        time.sleep(5)
```

### Kubernetes Spot Node Handling

```yaml
# Spot node pool in AKS
apiVersion: v1
kind: NodePool
metadata:
  name: spot-pool
spec:
  scaleSetPriority: Spot
  scaleSetEvictionPolicy: Delete
  spotMaxPrice: -1
```
