---
title: "Azure Spot VMs: Massive Savings for Interruptible Workloads"
description: "Spot VMs use Azure's spare capacity. When Azure needs the capacity for pay-as-you-go customers, Spot VMs receive a 30-second notice before eviction."
author: Michael John Peña
draft: false
date: 2022-01-06
url: /blog/azure-spot-vms/
tags:
  - Azure
  - virtual-machines
  - cost-optimization
  - spot-instances
---

## Understanding Spot VMs

Spot VMs use Azure's spare capacity. When Azure needs the capacity for pay-as-you-go customers, Spot VMs receive a 30-second notice before eviction.

## Creating a Spot VM

```bicep
resource spotVM 'Microsoft.Compute/virtualMachines@2021-11-01' = {
  name: 'spot-vm'
  location: location
  properties: {
    hardwareProfile: {
      vmSize: 'Standard_D4s_v3'
    }
    priority: 'Spot'
    evictionPolicy: 'Deallocate'  // or 'Delete'
    billingProfile: {
      maxPrice: -1  // Current spot price, or set specific max
    }
    storageProfile: {
      imageReference: {
        publisher: 'Canonical'
        offer: '0001-com-ubuntu-server-focal'
        sku: '20_04-lts-gen2'
        version: 'latest'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: {
          storageAccountType: 'StandardSSD_LRS'
        }
      }
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: nic.id
        }
      ]
    }
    osProfile: {
      computerName: 'spot-vm'
      adminUsername: adminUsername
      adminPassword: adminPassword
    }
  }
}
```

## Spot VM Scale Sets

For higher availability, use Spot VM Scale Sets with multiple zones:

```bicep
resource spotVMSS 'Microsoft.Compute/virtualMachineScaleSets@2021-11-01' = {
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
    }
    virtualMachineProfile: {
      priority: 'Spot'
      evictionPolicy: 'Delete'
      billingProfile: {
        maxPrice: 0.5  // Maximum price per hour
      }
      storageProfile: {
        imageReference: {
          publisher: 'Canonical'
          offer: '0001-com-ubuntu-server-focal'
          sku: '20_04-lts-gen2'
          version: 'latest'
        }
        osDisk: {
          createOption: 'FromImage'
          managedDisk: {
            storageAccountType: 'StandardSSD_LRS'
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
    platformFaultDomainCount: 1
  }
  zones: ['1', '2', '3']
}
```

## Handling Eviction Events

Set up eviction monitoring in your application:

```python
import requests
import time
import signal
import sys

METADATA_URL = "http://169.254.169.254/metadata/scheduledevents?api-version=2020-07-01"
HEADERS = {"Metadata": "true"}

def check_for_eviction():
    try:
        response = requests.get(METADATA_URL, headers=HEADERS, timeout=5)
        events = response.json().get("Events", [])
        for event in events:
            if event.get("EventType") == "Preempt":
                return True, event
    except Exception as e:
        print(f"Error checking events: {e}")
    return False, None

def graceful_shutdown(signum, frame):
    print("Received shutdown signal, cleaning up...")
    # Save state, checkpoint, etc.
    sys.exit(0)

signal.signal(signal.SIGTERM, graceful_shutdown)

def main():
    while True:
        eviction, event = check_for_eviction()
        if eviction:
            print(f"Eviction notice received: {event}")
            # Start graceful shutdown
            graceful_shutdown(None, None)

        # Do actual work here
        do_work()
        time.sleep(5)

if __name__ == "__main__":
    main()
```

## Best Practices

1. **Checkpoint frequently** - Save state so work isn't lost
2. **Use multiple regions** - Spread workloads for availability
3. **Set max price thoughtfully** - Don't set too high or you lose savings
4. **Mix with regular VMs** - Ensure critical capacity is always available
5. **Use for stateless workloads** - Batch processing, CI/CD agents, rendering

## Ideal Use Cases

- Machine learning training
- Batch processing
- Dev/test environments
- CI/CD build agents
- Video rendering
- Big data analytics

Spot VMs are a powerful tool for cost optimization when you design your applications to handle interruptions gracefully.
