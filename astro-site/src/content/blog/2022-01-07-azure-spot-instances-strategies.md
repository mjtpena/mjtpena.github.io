---
title: "Azure Spot Instances Strategies: Maximizing Savings with Smart Architecture"
description: "Smart Spot instance architecture lets you achieve massive cost savings while maintaining the reliability your applications need."
author: Michael John Peña
draft: false
date: 2022-01-07
url: /blog/azure-spot-instances-strategies/
tags:
  - Azure
  - spot-instances
  - Architecture
  - cost-optimization
---

## Multi-Region Spot Strategy

Distribute workloads across regions for higher availability:

```bicep
var regions = [
  'eastus'
  'westus2'
  'northeurope'
  'westeurope'
]

resource vmss 'Microsoft.Compute/virtualMachineScaleSets@2021-11-01' = [for region in regions: {
  name: 'spot-vmss-${region}'
  location: region
  sku: {
    name: 'Standard_D4s_v3'
    capacity: 5
  }
  properties: {
    virtualMachineProfile: {
      priority: 'Spot'
      evictionPolicy: 'Delete'
      billingProfile: {
        maxPrice: -1
      }
      // ... other config
    }
  }
}]
```

## Mixed Priority Architecture

Combine Spot and regular VMs for reliability:

```bicep
// Base capacity with regular VMs
resource regularVMSS 'Microsoft.Compute/virtualMachineScaleSets@2021-11-01' = {
  name: 'regular-vmss'
  location: location
  sku: {
    name: 'Standard_D4s_v3'
    capacity: 3  // Minimum guaranteed capacity
  }
  properties: {
    virtualMachineProfile: {
      priority: 'Regular'
      // ... config
    }
  }
}

// Burst capacity with Spot VMs
resource spotVMSS 'Microsoft.Compute/virtualMachineScaleSets@2021-11-01' = {
  name: 'spot-vmss'
  location: location
  sku: {
    name: 'Standard_D4s_v3'
    capacity: 10  // Extra capacity at lower cost
  }
  properties: {
    virtualMachineProfile: {
      priority: 'Spot'
      evictionPolicy: 'Delete'
      billingProfile: {
        maxPrice: -1
      }
      // ... config
    }
  }
}
```

## Queue-Based Worker Pattern

Design workers that process jobs from a queue:

```csharp
using Azure.Messaging.ServiceBus;

public class SpotFriendlyWorker
{
    private readonly ServiceBusClient _client;
    private readonly ServiceBusProcessor _processor;
    private CancellationTokenSource _cts;

    public SpotFriendlyWorker(string connectionString)
    {
        _client = new ServiceBusClient(connectionString);
        _processor = _client.CreateProcessor("work-queue", new ServiceBusProcessorOptions
        {
            MaxConcurrentCalls = 5,
            AutoCompleteMessages = false,
            MaxAutoLockRenewalDuration = TimeSpan.FromMinutes(30)
        });

        _processor.ProcessMessageAsync += ProcessMessageAsync;
        _processor.ProcessErrorAsync += ProcessErrorAsync;
    }

    private async Task ProcessMessageAsync(ProcessMessageEventArgs args)
    {
        var job = args.Message.Body.ToObjectFromJson<WorkItem>();

        try
        {
            // Process with checkpointing
            await ProcessWithCheckpoints(job, args.CancellationToken);

            // Complete only after successful processing
            await args.CompleteMessageAsync(args.Message);
        }
        catch (OperationCanceledException)
        {
            // Eviction happening - abandon message for retry
            await args.AbandonMessageAsync(args.Message);
            throw;
        }
    }

    private async Task ProcessWithCheckpoints(WorkItem job, CancellationToken ct)
    {
        var checkpoint = await LoadCheckpoint(job.Id);

        for (int i = checkpoint; i < job.TotalSteps; i++)
        {
            ct.ThrowIfCancellationRequested();

            await ProcessStep(job, i);
            await SaveCheckpoint(job.Id, i + 1);
        }
    }
}
```

## Scheduled Events Integration

Integrate Azure Scheduled Events for proactive eviction handling:

```python
import asyncio
import aiohttp
import signal
from datetime import datetime

class SpotInstanceMonitor:
    def __init__(self):
        self.running = True
        self.eviction_detected = False

    async def monitor_scheduled_events(self):
        url = "http://169.254.169.254/metadata/scheduledevents?api-version=2020-07-01"
        headers = {"Metadata": "true"}

        async with aiohttp.ClientSession() as session:
            while self.running:
                try:
                    async with session.get(url, headers=headers) as response:
                        data = await response.json()

                        for event in data.get("Events", []):
                            if event["EventType"] == "Preempt":
                                self.eviction_detected = True
                                await self.handle_eviction(event)
                                return

                except Exception as e:
                    print(f"Monitor error: {e}")

                await asyncio.sleep(5)

    async def handle_eviction(self, event):
        print(f"Eviction at {datetime.now()}: {event}")

        # Acknowledge the event to get maximum time
        await self.acknowledge_event(event["EventId"])

        # Trigger graceful shutdown
        await self.graceful_shutdown()

    async def acknowledge_event(self, event_id):
        url = "http://169.254.169.254/metadata/scheduledevents?api-version=2020-07-01"
        headers = {"Metadata": "true"}
        body = {"StartRequests": [{"EventId": event_id}]}

        async with aiohttp.ClientSession() as session:
            await session.post(url, headers=headers, json=body)
```

## Cost Comparison Dashboard

Track your Spot savings:

```kusto
// Log Analytics query for Spot savings tracking
AzureDiagnostics
| where ResourceType == "VIRTUALMACHINESCALESETS"
| where Category == "Autoscale"
| summarize
    SpotHours = sumif(Duration, Priority == "Spot"),
    RegularHours = sumif(Duration, Priority == "Regular")
| extend
    SpotCost = SpotHours * 0.05,  // Example Spot rate
    RegularCost = RegularHours * 0.20,  // Regular rate
    Savings = (RegularHours * 0.20) - (SpotHours * 0.05)
```

Smart Spot instance architecture lets you achieve massive cost savings while maintaining the reliability your applications need.
