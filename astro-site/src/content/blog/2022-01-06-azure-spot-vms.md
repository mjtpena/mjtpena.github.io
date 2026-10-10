---
title: "Azure Spot VMs: Eviction Policy, Max Price and the 30-Second Notice"
description: "Azure Spot VM eviction explained: capacity vs price eviction, Deallocate vs Delete, max price, and handling the Scheduled Events Preempt notice in Python."
author: Michael John Peña
draft: false
date: 2022-01-06
url: /blog/azure-spot-vms/
tags:
  - Azure
  - Virtual Machines
  - Cost Optimization
  - Spot Instances
  - Bicep
---

Azure Spot VMs sell unused compute capacity at a deep discount, but the discount comes with a contract most teams skim: Azure can take the VM back whenever it needs the capacity, with at most 30 seconds of warning, delivered on a best-effort basis, and there is no SLA. Whether Spot saves you money or costs you a weekend depends on three settings you choose at deployment time and one piece of code you run inside the VM.

## What you are actually buying

Spot has been generally available since [April 2020](https://azure.microsoft.com/updates/azure-spot-virtual-machines-are-now-generally-available/) for both single VMs and virtual machine scale sets. A Spot VM is the same hardware, image and disks as a pay-as-you-go VM. The only differences are price and eviction. Prices vary by region and size, move with supply and demand, and Microsoft quotes discounts of up to 90% against pay-as-you-go. The portal shows pricing history for a size when you tick the Spot option during creation, which is worth a look before you commit a workload to a region.

What you give up matters as much as what you save:

- **No SLA.** Spot VMs carry no availability guarantee, and Azure can evict them at any time once it needs the capacity.
- **Separate quota.** Spot capacity draws on its own regional Spot vCPU quota, not your standard VM family quota. Check it before a large deployment, because quota errors surface at deploy time, not eviction time.
- **Not every size or offer.** B-series burstable sizes and promo sizes aren't available as Spot, and Spot is available only on certain offer types (Enterprise Agreement, Pay-as-you-go, Sponsored and CSP), so free trial and benefit subscriptions such as MSDN can't use it. The [Spot VM documentation](https://learn.microsoft.com/azure/virtual-machines/spot-vms) has the current list.
- **Priority is fixed at creation.** You can't convert an existing regular VM to Spot, or back. You recreate it.

## The three settings that decide your eviction behaviour

### Priority

`priority: 'Spot'` is the switch. Everything else only applies when it's set.

### Max price and eviction type

`billingProfile.maxPrice` is the most you're willing to pay per hour, in US dollars. It determines which of the two eviction types applies:

| `maxPrice` | Eviction type | You are evicted when |
|---|---|---|
| `-1` | Capacity only | Azure needs the capacity back |
| A dollar amount | Price or capacity | Azure needs the capacity, **or** the current Spot price rises above your max |

With `-1` you pay the current Spot price, never more than the pay-as-you-go price for that size, and price alone never evicts you. My default is `-1`. Setting a cap feels prudent, but it adds a second eviction trigger for a few cents of protection, and the ceiling is already the pay-as-you-go rate you would have paid anyway. I only set a dollar cap when a workload has a hard unit-cost target and running slower is genuinely better than running at a higher price.

To change the max price on a running VM you have to deallocate it first.

### Eviction policy: Deallocate or Delete

This is the setting that bites people on the bill.

- **Deallocate** (the default) stops the VM and keeps its disks. You keep paying for the disks, and the deallocated VM still counts against your Spot vCPU quota. You can try to start it again later, but the start fails if there's still no capacity.
- **Delete** removes the VM and its disks. Nothing keeps billing, and the quota frees up immediately.

For a single VM that holds local state you want to come back to, Deallocate makes sense. For anything stateless, and for almost every scale set, I'd choose Delete. A scale set full of deallocated Spot instances is quota you can't use and disks you're paying for, with no compute running.

## A Spot VM in Bicep

The template below deploys one Spot VM with capacity-only eviction and the Deallocate policy, plus the network it needs. It uses SSH key authentication and the `2021-07-01` Compute API.

```bicep
param location string = resourceGroup().location
param vmName string = 'spot-vm'
param adminUsername string = 'azureuser'

@description('SSH public key, e.g. the contents of ~/.ssh/id_rsa.pub')
param sshPublicKey string

resource vnet 'Microsoft.Network/virtualNetworks@2021-05-01' = {
  name: '${vmName}-vnet'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
        '10.10.0.0/16'
      ]
    }
    subnets: [
      {
        name: 'default'
        properties: {
          addressPrefix: '10.10.1.0/24'
        }
      }
    ]
  }
}

resource nic 'Microsoft.Network/networkInterfaces@2021-05-01' = {
  name: '${vmName}-nic'
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Dynamic'
          subnet: {
            id: vnet.properties.subnets[0].id
          }
        }
      }
    ]
  }
}

resource vm 'Microsoft.Compute/virtualMachines@2021-07-01' = {
  name: vmName
  location: location
  properties: {
    priority: 'Spot'
    evictionPolicy: 'Deallocate'
    billingProfile: {
      maxPrice: -1
    }
    hardwareProfile: {
      vmSize: 'Standard_D4s_v3'
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
    osProfile: {
      computerName: vmName
      adminUsername: adminUsername
      linuxConfiguration: {
        disablePasswordAuthentication: true
        ssh: {
          publicKeys: [
            {
              path: '/home/${adminUsername}/.ssh/authorized_keys'
              keyData: sshPublicKey
            }
          ]
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
  }
}
```

For a scale set, the same three properties move into `virtualMachineProfile`, and I'd switch `evictionPolicy` to `'Delete'`. Spot scale sets also support [Try & restore](https://learn.microsoft.com/azure/virtual-machine-scale-sets/use-spot), which reached GA in October 2021: the platform tries to bring evicted instances back to your target count when capacity returns. It's on by default, but it's disabled when the scale set uses autoscale, because autoscale rules then decide the instance count.

## Handling the eviction notice

Azure tells a Spot VM it's about to be evicted through [Scheduled Events](https://learn.microsoft.com/azure/virtual-machines/linux/scheduled-events), part of the Instance Metadata Service at `169.254.169.254`. The event type is `Preempt`, and the minimum notice is 30 seconds. The `NotBefore` field gives the earliest time the eviction can happen. Delivery is best effort, so treat the event as a bonus, not a guarantee. Regular checkpointing is the real protection.

Thirty seconds is enough to finish writing a checkpoint, release a lease on a queue message, or deregister from a load balancer. It is not enough to upload a large working set or drain long-running requests. That constraint should shape the workload: if you can't get to a safe state in under 30 seconds, checkpoint more often rather than hoping to save everything at the end.

Two details from the docs are easy to miss. First, Scheduled Events is enabled the first time something inside the VM calls the endpoint, and that first call can take up to two minutes to respond. Start polling when the VM boots, not when you think an eviction is coming. Second, the event is delivered to every VM in the same availability set or scale set placement group, so check that your VM is listed in `Resources` before reacting.

The script below polls every few seconds, checks whether a `Preempt` event targets this VM, runs a checkpoint, and then acknowledges the event if this VM is the only one it covers.

```python
import time

import requests

IMDS = "http://169.254.169.254/metadata"
HEADERS = {"Metadata": "true"}
EVENTS_URL = f"{IMDS}/scheduledevents?api-version=2020-07-01"
NAME_URL = f"{IMDS}/instance/compute/name?api-version=2021-02-01&format=text"
# IMDS must be called directly, never through a proxy.
NO_PROXY = {"http": None, "https": None}


def get_vm_name() -> str:
    response = requests.get(NAME_URL, headers=HEADERS, proxies=NO_PROXY, timeout=10)
    response.raise_for_status()
    return response.text.strip()


def get_events() -> dict:
    # The first call enables Scheduled Events and can take up to two minutes.
    response = requests.get(EVENTS_URL, headers=HEADERS, proxies=NO_PROXY, timeout=150)
    response.raise_for_status()
    return response.json()


def acknowledge(event_id: str) -> None:
    body = {"StartRequests": [{"EventId": event_id}]}
    response = requests.post(EVENTS_URL, headers=HEADERS, json=body, proxies=NO_PROXY, timeout=10)
    response.raise_for_status()


def checkpoint() -> None:
    # Replace with your own logic: flush state, release queue leases, stop accepting work.
    print("Checkpointing work before eviction")


def main() -> None:
    vm_name = get_vm_name()
    print(f"Watching Scheduled Events for {vm_name}")
    while True:
        try:
            payload = get_events()
        except requests.RequestException as error:
            print(f"Scheduled Events call failed: {error}")
            time.sleep(5)
            continue

        for event in payload.get("Events", []):
            if event.get("EventType") == "Preempt" and vm_name in event.get("Resources", []):
                print(f"Preempt received, NotBefore={event.get('NotBefore')}")
                checkpoint()
                # Acknowledging releases the eviction for every VM in Resources,
                # so only do it when this VM is the sole target.
                if event.get("Resources") == [vm_name]:
                    acknowledge(event["EventId"])
                return

        time.sleep(5)


if __name__ == "__main__":
    main()
```

The acknowledgement guard matters more than it looks. The docs warn that acknowledging an event lets it proceed for all `Resources` listed, not just the VM that sent the acknowledgement, so a fast VM acknowledging a shared event would cut short the window for neighbours still checkpointing. When an event lists several VMs, the script simply lets it run to `NotBefore`; if you want early release, elect one coordinator (such as the first name in `Resources`) and have it acknowledge only once every listed VM reports it has finished.

Run it as a systemd service or a sidecar to your worker process, and have `checkpoint()` signal the worker rather than doing the heavy lifting itself. Acknowledging is optional: if you don't, the eviction proceeds at `NotBefore` anyway.

### Test the eviction path before production does

An eviction handler you've never seen fire is a guess. Azure has a simulate-eviction operation for Spot VMs, exposed in the CLI:

```bash
az vm simulate-eviction --resource-group <your-resource-group> --name <your-vm-name>
```

It raises a real `Preempt` event and then evicts the VM according to its eviction policy, so run it in a test environment and confirm your checkpoint lands where you expect.

## When Spot is the wrong choice

Spot fits work that is interruptible, restartable and not on a user's critical path: batch jobs, CI build agents, rendering, test environments, and model training that checkpoints regularly. The architecture patterns that make Spot safer for those workloads (mixed priority pools, queue-based workers, multi-region fallback) are in [Azure Spot Instances Strategies](/blog/2022-01-07-azure-spot-instances-strategies/). [Azure Batch](/blog/2021-02-18-azure-batch-processing/) and [AKS Spot node pools](/blog/2021-10-03-aks-spot-node-pools/) wrap the same capacity with scheduling that handles much of the retry logic for you.

I wouldn't put these on Spot:

- **Anything with an availability target.** No SLA means you can't build one on top of Spot alone. Keep a baseline on regular VMs and add Spot as burst capacity.
- **Stateful single instances.** A database or a VM holding the only copy of in-progress work loses everything not checkpointed in those 30 seconds.
- **Long jobs that can't checkpoint.** A 10-hour job that has to restart from zero after a late eviction can cost more in wasted compute than it saved.
- **Capacity you need at a specific time.** Spot is the first capacity Azure reclaims when a region gets busy, which is often exactly when you need it.

## The short version

Set `maxPrice` to `-1` unless you have a real reason to cap it, choose Delete for anything stateless (and nearly every scale set), start polling Scheduled Events at boot, and design the workload so 30 seconds is enough to reach a safe state. Then simulate an eviction before trusting it. If those four things are true, Spot is one of the easiest cost reductions on Azure. If they aren't, the savings are a loan you'll repay in lost work.
