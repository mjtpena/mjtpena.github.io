---
title: "Fabric's December 2023 Update: What I'd Act On in January"
description: "A practitioner's triage of the Microsoft Fabric December 2023 update: %%configure, Git conflict resolution, KQL in OneLake and what to leave alone."
author: Michael John Peña
draft: false
date: 2024-01-13
tags:
  - Microsoft Fabric
  - Data Engineering
  - Power BI
  - Spark
  - CI/CD
---

Fabric's monthly update posts are long, and the two or three items that change how you work get buried. It's easy to skim them and miss exactly those. The December 2023 update, the first full monthly round since Fabric went GA at Ignite in November, is the latest one as I write this. Here is my triage: what I'd adopt now, what I'd test, and what I'd leave until it matures.

The full list is in Microsoft's [Fabric December 2023 update post](https://blog.fabric.microsoft.com/en-us/blog/microsoft-fabric-december-2023-update/). This post is about priorities, not a feature-by-feature recap.

## The short version

| Update | Area | My call |
|---|---|---|
| `%%configure` magic for Spark sessions | Data Engineering | Adopt now, with a team default |
| Resolve Git conflicts inside the workspace | Git integration (preview) | Adopt if you already use Git integration |
| Automatic log checkpointing | Data Warehouse | Nothing to do; know it exists |
| OneLake availability for KQL databases | Real-Time Analytics (preview) | Test before you design around it |
| Azure Databricks activity in pipelines | Data Factory | Useful for hybrid estates, not a migration path |
| Data Activator alerts from Power BI visuals | Power BI / Data Activator (preview) | Pilot only |
| Copilot in Fabric | Cross-workload (preview) | Don't plan capacity around it yet |

## Adopt now: `%%configure` for Spark sessions

Until this update, tuning a notebook's Spark session meant changing workspace-level Spark settings or reaching for an Environment item (also in preview). Both are blunt instruments: one heavy notebook shouldn't dictate the session shape for everyone in the workspace.

The `%%configure` magic lets a notebook declare its own session properties in its first cell. The body is JSON, but the cell as a whole is a magic command, so it only runs in a Fabric notebook. A typical cell looks like this:

```json
%%configure
{
    "driverMemory": "28g",
    "driverCores": 4,
    "executorMemory": "28g",
    "executorCores": 4,
    "conf": {
        "spark.sql.shuffle.partitions": "200"
    }
}
```

Two things matter in practice:

1. **Put it first.** If a session is already running, the cell errors unless you use `%%configure -f`, which restarts the session and loses any variables you've already set. Running it mid-notebook is a common source of "why did my state disappear" confusion.
2. **It also applies when the notebook runs from a pipeline.** That is the real value. The session a notebook needs travels with the notebook, rather than living in someone's head or a workspace setting nobody remembers changing.

The trade-off is sprawl. If every engineer sets their own memory and shuffle values, you end up with a hundred slightly different sessions and no way to reason about capacity consumption. My rule of thumb: agree on a small number of session "shapes" (say, a default and a heavy one), document them, and only use `%%configure` to select one of those. Treat a bespoke value as something to justify in code review.

When *not* to use it: if a workspace runs uniform workloads, a workspace default is simpler and easier to govern. `%%configure` earns its place when one workspace mixes light exploration with a few heavy transformation notebooks.

## Adopt if you're already on Git: in-workspace conflict resolution

[Fabric Git integration](https://learn.microsoft.com/en-us/fabric/cicd/git-integration/intro-to-git-integration) is still in preview, even though the platform itself is GA. Until now, a conflict between the workspace and the connected branch pushed you out to Azure DevOps to sort out. The December update lets you resolve conflicts and choose which version to keep from inside the workspace.

That sounds minor, but it removes the step where non-developer contributors (report authors, analysts working in notebooks) got stuck and asked someone else to fix their sync. Fewer hand-offs means people are more likely to keep using source control rather than quietly disconnecting.

My caution is the same one I'd give for any Git workflow: resolving conflicts in a UI makes it easy to click "keep mine" without understanding what you're overwriting. I'd still route anything heading to production through a pull request on a feature branch, and use workspace-level resolution for personal and development workspaces only.

If you aren't using Git integration yet, this update doesn't change whether you should. Check the supported item types in the docs first. Anything unsupported in a connected workspace is simply not tracked, and that gap is where teams get surprised.

## Know it exists: automatic log checkpointing in the Warehouse

The Synapse Data Warehouse in Fabric stores tables in Delta format. Every write adds a commit file to the Delta log, and a reader has to reconstruct table state from that log. Long chains of small commits make that slower.

The warehouse now creates log checkpoints automatically, so readers start from a checkpoint instead of replaying the whole history. There is no switch to flip. I mention it because it changes one piece of advice I've given before: you no longer need to worry as much about lots of small trickle inserts degrading read performance purely because of log length. You should still batch writes, because small files and many small transactions cost capacity in other ways.

## Test before you design around it: KQL data in OneLake

Real-Time Analytics now has a preview option to make a KQL database's data available in OneLake in Delta format. The appeal is obvious: streaming data lands once in a KQL database, and Spark notebooks, the SQL endpoint and Power BI can read it from OneLake without a separate export job.

Before building an architecture on it, I'd check three things in a test workspace:

- **Latency.** Data written to the KQL database isn't instantly mirrored to OneLake. Measure how far behind the Delta copy runs for your ingestion pattern, and decide whether downstream consumers can tolerate it.
- **Schema changes.** While OneLake availability is on, you can't rename a table or alter its schema. You have to turn availability off, make the change and turn it back on, and turning it off drops the existing OneLake copy. If your KQL tables evolve often, that alone may rule it out.
- **Cost.** Microsoft says storage is charged once (it's one logical copy), but the background write to Delta still consumes capacity compute. On a small F SKU, measure it before turning it on for every table. Watch the Capacity Metrics app before and after enabling it.

When *not* to use it: if the consumer is a real-time dashboard, query the KQL database directly. The OneLake copy is for analytical and batch consumers that want Delta, not for second-by-second views.

## Useful in hybrid estates: the Azure Databricks activity

Data Factory pipelines in Fabric gained an [Azure Databricks activity](https://learn.microsoft.com/en-us/fabric/data-factory/azure-databricks-activity) that runs work on an existing Databricks workspace. It runs a Databricks notebook, Jar or Python task through a connection to your Databricks workspace, on either an existing interactive cluster or a new job cluster. If you already have Databricks jobs that work, this lets a Fabric pipeline orchestrate them alongside Fabric notebooks and copy activities, rather than running two schedulers that don't know about each other.

I'd use it as a coexistence tool. It isn't a reason to keep transformation logic in two engines indefinitely: each extra engine adds identity, networking and cost tracking to manage. If the long-term plan is to consolidate on Fabric Spark, use the activity to sequence the transition, not to make the split permanent.

## Pilot only: Data Activator and Copilot

Two preview features get a lot of attention. I'd keep both in pilot for now.

**Data Activator** (preview) can now trigger alerts from Power BI visuals. It's a good fit for simple threshold alerts that business users currently get by refreshing a report. It isn't yet something I'd use for anything operationally critical, because preview features can change shape and there are no SLAs.

**Copilot in Fabric** is in public preview across Power BI, Data Factory and Data Engineering/Data Science. It needs an F64 or larger Fabric capacity, or a P1 or larger Power BI Premium capacity, and it doesn't work on trial capacities ([enablement requirements](https://learn.microsoft.com/en-us/fabric/get-started/copilot-enable-fabric)). For anyone on F2 to F32, that's the real constraint: don't size capacity up purely to try Copilot. Wait until you'd need F64 anyway, or until pricing and availability settle.

## A note on semantic link

Semantic link (preview) continues to get updates, and it's still the cleanest way to query Power BI semantic models from a Fabric notebook. One small, practical use is checking a measure before and after a model change, without opening the report:

```python
import sempy.fabric as fabric

# List semantic models in the current workspace
datasets = fabric.list_datasets()
print(datasets[["Dataset Name"]])

# Evaluate a measure by region with DAX
result = fabric.evaluate_dax(
    dataset="<your-semantic-model-name>",
    dax_string="""
    EVALUATE
    SUMMARIZECOLUMNS(
        'Region'[RegionName],
        "Total Sales", [Total Sales]
    )
    """,
)
display(result)
```

This runs in a Fabric notebook. Semantic link is preinstalled on Runtime 1.2; on Runtime 1.1, run `%pip install -U semantic-link` in the first cell. Swap in your own model, table and measure names. The [semantic link documentation](https://learn.microsoft.com/en-us/fabric/data-science/read-write-power-bi-python) covers reading tables and listing measures as well.

## Where I'd spend the next month

If your team has limited time this month, here is the order I'd go in:

1. Agree on two or three standard Spark session shapes and start using `%%configure` to select them. It's cheap and it makes pipeline behaviour predictable.
2. If you use Git integration, update your working agreement on when in-workspace conflict resolution is acceptable and when a pull request is required.
3. Stand up a throwaway workspace to measure OneLake availability for KQL databases against your real ingestion volumes.
4. Leave Copilot and Data Activator in pilot until they're out of preview.

Everything else in the December update is either automatic or niche. The value of a monthly update isn't in adopting everything, it's in spotting the few changes that remove friction your team already feels. For the broader context on what went GA in November, see my [Fabric GA post](/blog/2023-11-10-microsoft-fabric-ga/).
