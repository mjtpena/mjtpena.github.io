---
title: "Designing for Eviction: Architecture Patterns for Azure Spot VMs"
description: "Spot VMs only save money if the design expects eviction: a regular base tier, diversified Spot pools, queue-driven workers and a Scheduled Events handler."
author: Michael John Peña
draft: false
date: 2022-01-07
url: /blog/azure-spot-instances-strategies/
tags:
  - Azure
  - Spot Instances
  - Cost Optimization
  - Architecture
  - Virtual Machine Scale Sets
---

Azure Spot VMs are cheap because Azure can take them back, at any time, with about 30 seconds of warning. Most teams treat that as an operational nuisance to monitor. I treat it as a design input. If eviction is a normal event in your architecture, Spot is one of the biggest compute discounts on the platform. If it's an exception, Spot will eventually cause an outage.

[Yesterday's post](/blog/2022-01-06-azure-spot-vms/) covered the mechanics; this is the architecture that makes eviction boring.

## Start from what eviction actually does

[Spot VMs went GA in 2020](https://learn.microsoft.com/en-us/azure/virtual-machines/spot-vms) and behave like pay-as-you-go VMs apart from price, eviction and the lack of an SLA (and not every size or offer supports Spot). There are two eviction triggers:

- **Capacity:** Azure needs the hardware back. You can't prevent this.
- **Price:** the current Spot price rises above the `maxPrice` you set. Setting `maxPrice` to `-1` removes this trigger; you pay the current Spot price, never more than the pay-as-you-go price.

My default is `-1`. A price cap sounds prudent, but it adds a second way to lose capacity in exchange for saving a few cents in the rare hours when Spot is nearly as expensive as on-demand. If you're in that situation for long, Spot is the wrong tool for that size and region anyway.

The eviction policy matters more than people expect. With `Deallocate`, the VM stops but its disks remain, you keep paying for the disks, and on a scale set the deallocated instances still count against your Spot vCPU quota. With `Delete`, the VM and its disks go away. For scale sets running stateless workers I use `Delete` every time. Deallocate only makes sense if you're keeping state on the disk, and if you're doing that, you should be asking why it's on Spot.

Spot also has its own regional vCPU quota, separate from your regular quota. Request it before you need it; finding out during a scale-out event is not fun.

## Pattern 1: a regular base, a Spot burst

The single most useful pattern is two pools: a small set of regular-priority instances sized for the minimum you must deliver, and a Spot pool for everything above that. When Spot capacity disappears, throughput drops but the service doesn't.

The question to ask is "what is the smallest capacity I can live with for an hour?" That number goes on regular VMs, ideally covered by a reservation. Everything else is a candidate for Spot.

In January 2022 there is no single scale set setting that mixes priorities for you, so this is two scale sets doing the same job. Here's a complete Bicep file that deploys both from one shared VM profile:

```bicep
param location string = resourceGroup().location
param subnetId string
param adminUsername string = 'azureuser'
@secure()
param sshPublicKey string

param vmSize string = 'Standard_D4s_v3'
param baseCapacity int = 3
param spotCapacity int = 10

// Shared OS settings. Each tier sets its own computerNamePrefix, because
// Uniform scale sets name hosts prefix + instance ID and two tiers sharing
// a prefix would produce duplicate hostnames in the same VNet.
var linuxConfiguration = {
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

var baseProfile = {
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
                  id: subnetId
                }
              }
            }
          ]
        }
      }
    ]
  }
}

resource baseTier 'Microsoft.Compute/virtualMachineScaleSets@2021-07-01' = {
  name: 'vmss-worker-base'
  location: location
  sku: {
    name: vmSize
    capacity: baseCapacity
  }
  properties: {
    upgradePolicy: {
      mode: 'Manual'
    }
    virtualMachineProfile: union(baseProfile, {
      osProfile: {
        computerNamePrefix: 'wbase'
        adminUsername: adminUsername
        linuxConfiguration: linuxConfiguration
      }
      priority: 'Regular'
    })
  }
}

resource spotTier 'Microsoft.Compute/virtualMachineScaleSets@2021-07-01' = {
  name: 'vmss-worker-spot'
  location: location
  sku: {
    name: vmSize
    capacity: spotCapacity
  }
  properties: {
    upgradePolicy: {
      mode: 'Manual'
    }
    spotRestorePolicy: {
      enabled: true
      restoreTimeout: 'PT1H'
    }
    virtualMachineProfile: union(baseProfile, {
      osProfile: {
        computerNamePrefix: 'wspot'
        adminUsername: adminUsername
        linuxConfiguration: linuxConfiguration
      }
      priority: 'Spot'
      evictionPolicy: 'Delete'
      billingProfile: {
        maxPrice: -1
      }
    })
  }
}
```

The `spotRestorePolicy` block turns on **Try to restore**, which [went GA in October 2021](https://learn.microsoft.com/en-us/azure/virtual-machine-scale-sets/use-spot). After a capacity eviction, the platform keeps trying to bring the scale set back to its target count for up to the timeout you set. There's one catch: it's disabled on scale sets that use autoscale, because autoscale owns the instance count. So you choose. A fixed-size Spot pool with Try to restore suits a steady backlog. An autoscaled Spot pool driven by queue length suits bursty work. I lean towards autoscale for queue workers, because the queue length is a better signal than any target count I'd pick by hand.

## Pattern 2: don't put all your Spot in one bucket

Evictions are correlated. When Azure needs D4s_v3 capacity in one region, every D4s_v3 Spot instance you have there is at risk at the same moment. Diversification is how you turn "all my Spot capacity vanished" into "a third of it did":

| Lever | What it buys you | Cost |
|---|---|---|
| Multiple VM sizes | Different capacity pools; a D-series eviction wave may not touch E- or F-series | Workers must tolerate different core and memory counts |
| Availability zones | Separate physical capacity within a region | Workers and their dependencies must be zone-aware; inter-zone latency if workers chat a lot |
| Multiple regions | The strongest isolation | Data locality, latency to the queue, more to deploy and monitor |

A Uniform-orchestration scale set runs one VM size, so diversifying by size means more scale sets. In practice I deploy the Spot tier above two or three times with different `vmSize` values, all pulling from the same queue. That's cheap to do in Bicep (a `for` loop over an array of sizes) and gives you far more than a single large pool.

Multiple regions is where I'd be careful. It sounds resilient, but if your queue, storage and database live in Australia East, a fleet of Spot workers in West US 2 pays latency and egress on every job. Only go multi-region if the work is compute-heavy and data-light, like rendering or simulation. For most data processing, zones and sizes are enough.

## Pattern 3: make every worker safe to kill

Infrastructure patterns only work if the application can lose any instance mid-task without losing work. The cleanest way I know to get there is a queue with peek-lock semantics, such as an Azure Service Bus queue.

A worker receives a message, which locks it rather than removing it. The message is only completed once the work is done. If the VM is evicted mid-job, the lock expires and the message becomes visible to another worker. Nothing has to detect the eviction for the work to be retried.

Three details decide whether this is reliable or merely hopeful:

- **Lock duration versus job length.** A Service Bus lock lasts at most five minutes. Longer jobs need lock renewal. The `ServiceBusProcessor` in the `Azure.Messaging.ServiceBus` SDK renews automatically, but only up to `MaxAutoLockRenewalDuration`, so set it above your longest expected job (the default is five minutes). When the VM dies, renewal stops and the lock lapses. That's the behaviour you want.
- **Delivery count.** Every lock that expires counts as a delivery attempt. The default `MaxDeliveryCount` is 10, after which the message goes to the dead-letter queue. On a bad eviction day, a long job can burn through attempts without ever failing on its own. Raise the limit for long jobs, and alert on the dead-letter queue instead of assuming everything in it is a bug.
- **Idempotency and checkpoints.** A job that's retried must produce the same result. For anything longer than a few minutes, write progress to durable storage (a blob, a table row) keyed by the job ID, so a retry resumes from the last checkpoint rather than from zero.

I covered dead-lettering and sessions in more depth in [Service Bus advanced patterns](/blog/2021-01-12-azure-service-bus-advanced/). The same design works for [AKS Spot node pools](/blog/2021-10-03-aks-spot-node-pools/): the pod is disposable, the queue holds the truth.

## Pattern 4: use the 30 seconds, but don't depend on them

Every Spot VM can see an upcoming eviction through [Scheduled Events](https://learn.microsoft.com/en-us/azure/virtual-machines/linux/scheduled-events), the endpoint on the Instance Metadata Service at `169.254.169.254`. An eviction appears as a `Preempt` event with a minimum notice of 30 seconds.

Thirty seconds is enough to stop taking new work, flush a checkpoint, and let in-flight messages go back to the queue. It isn't enough to finish a job, and it's delivered on a best-effort basis. Design so that the notice makes eviction tidier, not so that it makes eviction safe. Pattern 3 is what makes it safe.

A small watcher running alongside the worker is enough. This one uses only the Python standard library, so there's nothing to install on the image:

```python
#!/usr/bin/env python3
"""Watch Azure Scheduled Events and stop the worker before a Spot eviction."""
import json
import subprocess
import time
import urllib.request

IMDS = "http://169.254.169.254/metadata"
EVENTS_URL = f"{IMDS}/scheduledevents?api-version=2020-07-01"
NAME_URL = f"{IMDS}/instance/compute/name?api-version=2021-02-01&format=text"
HEADERS = {"Metadata": "true"}
WORKER_SERVICE = "worker.service"  # systemd unit that runs your queue worker


def imds_get(url):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.read().decode("utf-8")


def approve(event_id):
    """Tell Azure we're ready. Best effort: if it fails, NotBefore still applies."""
    body = json.dumps({"StartRequests": [{"EventId": event_id}]}).encode("utf-8")
    req = urllib.request.Request(
        EVENTS_URL,
        data=body,
        headers={**HEADERS, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5).close()
    except Exception as exc:  # URLError, timeout: log and let NotBefore arrive
        print(f"approval failed for {event_id}: {exc}", flush=True)


def main():
    vm_name = imds_get(NAME_URL).strip()
    while True:
        try:
            events = json.loads(imds_get(EVENTS_URL)).get("Events", [])
        except Exception as exc:  # IMDS can be briefly unavailable; keep polling
            print(f"scheduled events poll failed: {exc}", flush=True)
            time.sleep(1)
            continue

        for event in events:
            if event["EventType"] == "Preempt" and vm_name in event["Resources"]:
                print(f"eviction notice, not before {event['NotBefore']}", flush=True)
                # Ask the worker to stop taking messages and exit cleanly.
                # Unfinished messages return to the queue when their locks lapse.
                try:
                    subprocess.run(
                        ["systemctl", "stop", WORKER_SERVICE],
                        timeout=20,
                        check=False,
                    )
                except subprocess.TimeoutExpired:
                    print("worker did not stop within 20s; approving anyway", flush=True)
                approve(event["EventId"])
                return
        time.sleep(1)


if __name__ == "__main__":
    main()
```

Run it as a root systemd unit started at boot. `systemctl stop` needs root (or polkit rights), and the first call to the Scheduled Events endpoint is what enables the service for the VM, which can take up to two minutes. A watcher that only starts when the worker is busy may not be listening yet when the notice arrives.

Two things about this script are easy to get wrong. First, it filters on `Resources`, because on a scale set the endpoint can list events for other instances too; you only act on your own. Second, approving the event doesn't buy you more time. It tells Azure you're ready, which can only bring the eviction forward. I approve after cleanup so the instance doesn't sit idle until `NotBefore`, but if your cleanup is slow, skip the approval and let `NotBefore` arrive on its own.

Test this before you trust it. Azure added an API to [simulate a Spot eviction](https://learn.microsoft.com/en-us/rest/api/compute/virtual-machines/simulate-eviction) (announced in public preview in March 2021), which fires a real `Preempt` event at a VM. I'd run it against a test instance in every image release, the same way you'd test a backup restore.

## Measuring whether it's worth it

Spot savings are easy to overstate. The headline discount (up to 90%) is the price difference per hour, not the saving on your bill. Retried work, longer job runtimes, the regular base tier and the engineering effort all come off the top.

Azure Cost Management can split the two tiers for you: group actual cost by meter, and Spot usage appears under meters with "Spot" in the name. Divide each tier's cost by the jobs it completed (your queue metrics give you that count) and compare cost per completed job, not cost per hour. If the Spot tier is evicted so often that retries eat the discount, the numbers will say so.

## When I wouldn't use Spot

- **Anything with a single instance.** Without a second instance to pick up the work, eviction is downtime.
- **Stateful services** such as databases, brokers or anything holding a quorum. Losing one member at a time is survivable; losing several in the same capacity reclaim is not.
- **Latency-sensitive user traffic**, unless a regular base tier alone can carry the minimum acceptable load.
- **Long jobs that can't checkpoint.** Each eviction restarts them from zero, and retries can cost more than on-demand.

## The decision in one line

Put the capacity you can't lose on regular VMs (and reserve it), put everything above it on diversified Spot scale sets, and make the queue, not the VM, the owner of the work. If you can't make a workload safe to kill, the discount isn't worth the outage it will eventually cause.
