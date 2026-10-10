---
title: "Measure Your Azure Carbon Footprint Before You Try to Shrink It"
description: "How to use the Emissions Impact Dashboard for Azure to baseline cloud emissions, find the workloads that matter, and cut waste with tools you already have."
author: Michael John Peña
draft: false
date: 2022-01-25
url: /blog/azure-sustainability/
tags:
  - Azure
  - Sustainability
  - Power BI
  - Cost Optimization
  - Cloud
---

Conversations about "green cloud" tend to start with region choice and ARM chips and end without a single number, which gets things the wrong way round. If you can't say what your Azure estate emits this month, by service and by region, you can't tell whether a change helped, and you can't defend the effort to a CFO or a sustainability team asking for Scope 3 data. Microsoft has offered Azure customers a tool for that since 2020 (generally available as the Emissions Impact Dashboard since October 2021), and in my experience it's still rarely switched on.

## What Microsoft has actually committed to

Context matters because your cloud emissions show up in Microsoft's reporting as well as yours. In January 2020 Microsoft [committed to being carbon negative by 2030](https://blogs.microsoft.com/blog/2020/01/16/microsoft-will-be-carbon-negative-by-2030/). It also committed to removing all the carbon it has emitted since its founding by 2050, shifting to a 100% renewable energy supply by 2025, and setting up a US$1 billion Climate Innovation Fund.

These are targets, not current state. A region running on a grid with plenty of fossil fuel still has a real footprint today, whatever is promised for 2030. Treat the commitments as the reason Microsoft now publishes per-customer emissions data, not as permission to stop thinking about your own usage.

## The Emissions Impact Dashboard for Azure

The tool started out in January 2020 as the [Microsoft Sustainability Calculator](https://azure.microsoft.com/en-us/blog/microsoft-sustainability-calculator-helps-enterprises-analyze-the-carbon-emissions-of-their-it-infrastructure/), launched alongside the carbon negative commitment. In October 2021 Microsoft renamed it and made it generally available as the Emissions Impact Dashboard for Azure. It's a Power BI template app that you [install from AppSource and connect to your billing data](https://learn.microsoft.com/en-us/power-bi/connect-data/service-connect-to-emissions-impact-dashboard). What it gives you:

- **Emissions by scope.** Scope 1 and 2 (datacenter operations and purchased electricity) and Scope 3 (the embodied carbon from manufacturing, shipping, and end-of-life of the hardware your workloads run on). For most customers Microsoft's methodology attributes a large share to Scope 3, and it's the part you'd struggle most to estimate yourself.
- **Drill-down by month, Azure service, and datacenter region.** This is where the value is, because it ties emissions to decisions you can actually change.
- **An estimate of emissions avoided** compared with running the same workloads in an on-premises datacenter.

The prerequisites are narrow. The app supports Direct Enterprise Agreement customers: you connect it with your EA enrollment number, the person connecting needs enterprise administrator rights on that enrollment, and they need a Power BI Pro licence to install and share the app. CSP isn't covered, so if you buy Azure through a partner, don't promise anyone this report until you've confirmed a route to the data.

It also helps to know what the data can't do. Emissions are reported monthly, broken down by Azure service and datacenter region, so the dashboard can't attribute emissions to an individual VM, database, or application. Getting from "Virtual Machines in Australia East" to "the claims platform" is your job, using resource tags and the cost reports that already map spend to owners.

### How I'd read it

The headline total is the least useful number on the dashboard. My rule of thumb: look at the service and region breakdowns first, and line them up against your cost report for the same month. In most estates a handful of services (usually compute, storage, and whichever database tier someone over-provisioned two years ago) account for most of both the spend and the emissions. That overlap is your shortlist.

Two cautions. First, these figures are allocations based on Microsoft's methodology, not readings from a meter attached to your VMs. They're good for trends and comparisons, but they won't tell you that refactoring one API saved 3 kg of CO2e. Second, the "avoided emissions" view compares you against an on-premises baseline. It's useful for a migration business case and a weak argument once you're already in the cloud. Don't let it become the slide that ends the conversation.

### Where it fits next to Microsoft Cloud for Sustainability

Microsoft [announced Microsoft Cloud for Sustainability](https://blogs.microsoft.com/blog/2021/07/14/microsoft-cloud-for-sustainability-empowering-organizations-on-their-path-to-net-zero/) in July 2021, and it's still in preview. It aims at organisation-wide carbon accounting across all your operations, not only Azure. If your sustainability team is evaluating it, the Azure dashboard is the cloud slice of that picture. For an engineering team that just needs a baseline, the Power BI app is enough, and it's GA, which the broader platform isn't yet.

## Turning the numbers into changes

Once you know where the emissions sit, most of the reduction work is the same work as cost optimisation. Idle compute still draws power and still carries embodied carbon. Data you never read still sits on spinning disks. The tools below are all GA and most teams already pay for them.

### Find compute that's doing nothing

Azure Advisor's cost recommendations flag VMs with low CPU utilisation and recommend resizing or shutting them down. Advisor looks at a fixed window. If you already send VM performance counters to Log Analytics, a query gives you a view you control:

```kusto
// VMs averaging under 10% CPU over the last 14 days.
// Requires the Log Analytics agent or Azure Monitor Agent sending the Processor counter to the Perf table.
Perf
| where TimeGenerated > ago(14d)
| where ObjectName == "Processor" and CounterName == "% Processor Time" and InstanceName == "_Total"
| summarize AvgCpu = avg(CounterValue), P95Cpu = percentile(CounterValue, 95) by Computer
| where AvgCpu < 10
| order by AvgCpu asc
```

I look at the 95th percentile alongside the average. A VM averaging 4% with a P95 of 80% is a bursty workload that might suit a B-series size or a scale set. A VM with a P95 of 6% is a candidate for deletion, and the conversation to have is with its owner, not with a sizing calculator.

### Switch off what only runs in business hours

Dev and test VMs that run all weekend are the easiest win in most subscriptions. Auto-shutdown is a small resource next to the VM:

```bicep
param vmName string

resource vm 'Microsoft.Compute/virtualMachines@2021-07-01' existing = {
  name: vmName
}

resource autoShutdown 'Microsoft.DevTestLab/schedules@2018-09-15' = {
  name: 'shutdown-computevm-${vmName}'
  location: vm.location
  properties: {
    status: 'Enabled'
    taskType: 'ComputeVmShutdownTask'
    dailyRecurrence: {
      time: '1900'
    }
    timeZoneId: 'AUS Eastern Standard Time'
    targetResourceId: vm.id
    notificationSettings: {
      status: 'Disabled'
    }
  }
}
```

The schedule name has to follow the `shutdown-computevm-<vm name>` pattern for the portal to show it on the VM's auto-shutdown blade. Shutdown doesn't start anything back up, so pair it with an Automation runbook or a pipeline if people expect their VMs to be ready at 8am.

### Stop paying (and emitting) for cold data

Storage is rarely the top emitter, but it grows quietly and nobody owns it. [Blob lifecycle management](https://learn.microsoft.com/en-us/azure/storage/blobs/lifecycle-management-overview) moves data to cooler tiers and deletes it on a schedule:

```bicep
param storageAccountName string

resource storageAccount 'Microsoft.Storage/storageAccounts@2021-08-01' existing = {
  name: storageAccountName
}

resource lifecyclePolicy 'Microsoft.Storage/storageAccounts/managementPolicies@2021-08-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    policy: {
      rules: [
        {
          name: 'tier-and-expire-logs'
          enabled: true
          type: 'Lifecycle'
          definition: {
            filters: {
              blobTypes: [
                'blockBlob'
              ]
              prefixMatch: [
                'logs/'
              ]
            }
            actions: {
              baseBlob: {
                tierToCool: {
                  daysAfterModificationGreaterThan: 30
                }
                tierToArchive: {
                  daysAfterModificationGreaterThan: 90
                }
                delete: {
                  daysAfterModificationGreaterThan: 365
                }
              }
            }
          }
        }
      ]
    }
  }
}
```

The `tierToArchive` action needs an LRS, GRS, or RA-GRS account, because ZRS, GZRS, and RA-GZRS accounts don't support the Archive tier. On those, drop that action and let the rule go straight from Cool to delete. Scope rules with `prefixMatch`, as above. A policy that archives everything in an account after 90 days will eventually archive something an application reads, and rehydrating from Archive takes hours. Also check retention obligations before you add a `delete` action, because "we saved some carbon" is a poor defence in an audit.

## Where I'd be careful

**Region hopping for carbon.** Moving workloads to a region with a cleaner grid can cut Scope 2 emissions, and it's worth considering for new, latency-tolerant batch work. For existing production systems, data residency, latency to users, and egress costs usually outweigh it. For Australian organisations with sovereignty requirements it's rarely on the table. Measure first and you'll know whether region is even your biggest lever.

**Carbon-aware scheduling everywhere.** Shifting flexible jobs to times when the grid is cleaner is a real technique. I covered it in [carbon-aware computing](/blog/2021-12-20-carbon-aware-computing/). It suits batch and training workloads, not request-driven services, and it needs a reliable grid-intensity signal for your region. Don't build a scheduler before you know which jobs are big enough to matter.

**Treating sustainability as a separate workstream.** The Principles of Sustainable Software Engineering module on Microsoft Learn is a good shared vocabulary for a team. The practical changes still go through the same backlog, reviews, and FinOps cadence as everything else. If sustainability becomes its own parallel process, it gets deprioritised the first time a deadline slips.

For broader architecture patterns, including serverless and right-sizing as design principles, see [green computing in the cloud](/blog/2021-12-19-green-computing-cloud/).

## What I'd do this quarter

Install the Emissions Impact Dashboard and pull three months of history. Put the service and region breakdown next to your cost report and pick the top three line items that are high on both. Then fix those with Advisor, auto-shutdown, and lifecycle policies, and check next month whether the numbers moved.

That's an unglamorous plan, and that's the point. Cost and carbon line up closely enough for most Azure estates that the work pays for itself. Having a baseline means you can report progress honestly instead of quoting Microsoft's 2030 targets as if they were yours.
