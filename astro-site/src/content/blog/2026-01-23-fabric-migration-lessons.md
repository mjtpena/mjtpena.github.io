---
title: "Synapse to Fabric Migration: 5 Things I Wish I'd Known"
description: "Our Synapse to Fabric migration took twice as long as planned. Five lessons on scope, notebook refactoring, Direct Lake, capacity monitoring and training."
author: Michael John Peña
draft: false
date: 2026-01-23
tags:
  - Microsoft Fabric
  - Synapse
  - Migration
  - Azure
  - Data
---

We migrated our analytics platform from Azure Synapse to Microsoft Fabric, and it took twice as long as we estimated. Most of the extra time went into differences that looked trivial on paper. If you are planning the same move, these are the five things I would tell myself before the first sprint.

Fabric reuses most of Synapse's building blocks: Spark, T-SQL, pipelines, Power BI. That familiarity is exactly what makes estimates go wrong. Teams assume "same engine, new home" and size the work like a lift-and-shift. It isn't one.

## 1. Start smaller than you think

We tried to migrate everything at once. I wouldn't do that again.

When you move every workload together, every problem shows up at the same time and you can't tell which ones are platform learning and which ones are genuine design issues. You also have no patterns yet, so each team invents its own way of handling connections, folder layout, workspace boundaries and deployment, and you end up standardising after the fact.

The approach I'd use now:

- **Pick one non-critical workload** that still touches the important pieces: ingestion, a Spark transformation, a warehouse or lakehouse table, and a Power BI report on top.
- **Use it to learn the platform**, not to hit a deadline. Expect to throw some of it away.
- **Write down the patterns** that come out of it: workspace layout, how you authenticate to sources, naming, how notebooks reference lakehouses, how you deploy.
- **Then scale**, workload by workload, reusing those patterns.

Microsoft's [Synapse Spark to Fabric migration guidance](https://learn.microsoft.com/fabric/data-engineering/migrate-synapse-overview) starts with an assessment and a migration plan, and treats items, data and pipelines, and metadata as separate scenarios and phases. The wave approach feels slower in week two and is much faster by month three.

When not to do this: if your Synapse footprint is genuinely small (a handful of notebooks and one dedicated pool) a pilot can be overhead. Even then, migrate one item end to end before you touch the rest.

## 2. Your Synapse notebooks won't "just work"

Notebooks are where I'd budget the most contingency. Fabric Spark looks familiar, but the surrounding contracts are different.

**Runtimes differ.** Fabric's current GA runtime is Runtime 1.3 (Apache Spark 3.5, Python 3.11, Delta Lake 3.2). Runtime 2.0 (Spark 4.0) is an experimental preview; don't target it for a production migration, and Runtime 1.2 is in end-of-support-announced (EOSA) status, so don't land there either. If your Synapse pools were on an older Spark version, library versions move under you, and anything pinned to an old version of a package needs testing again.

**Linked services don't exist.** Synapse notebooks often read credentials or connection details through linked services. Fabric has no equivalent object. External sources move to Fabric connections, and storage you used to mount is usually better exposed as OneLake shortcuts (mounting via `notebookutils.fs.mount` still works). Every notebook that called a linked service needs a code change.

**The utilities namespace changed.** `mssparkutils` is renamed to `notebookutils` in Fabric. Existing calls still run, but Microsoft's [NotebookUtils documentation](https://learn.microsoft.com/fabric/data-engineering/notebook-utilities) recommends `notebookutils` for continued support and new features, and says the `mssparkutils` namespace will be retired. If you are touching the code anyway, rename it now.

**Paths change.** Hard-coded `abfss://` paths to your Synapse storage account either become OneLake paths or relative paths against the lakehouse attached to the notebook.

**Pool configuration doesn't travel.** Spark configs, custom libraries and executor settings from Synapse pools have to be recreated in Fabric environments. That is easy to forget because it isn't in the notebook.

A typical change looks like this (a fragment from a PySpark notebook cell, with placeholder names):

```python
# Synapse version
# key = mssparkutils.credentials.getSecret("<key-vault-name>", "<secret-name>", "<linked-service-name>")
# df = spark.read.parquet("abfss://raw@<storage-account>.dfs.core.windows.net/sales/")

# Fabric version
key = notebookutils.credentials.getSecret(
    "https://<key-vault-name>.vault.azure.net/", "<secret-name>"
)

# "Files/raw/sales" is a shortcut in the default lakehouse pointing at the same ADLS Gen2 folder
df = spark.read.parquet("Files/raw/sales/")
```

The identity change is the real gotcha. In Synapse, `getSecret` through a linked service used the workspace managed identity. In Fabric, it runs as whoever runs the notebook: the calling user, or the identity a scheduled or pipeline run executes under. Re-grant Key Vault access to those identities before cutover.

### Pipelines, data flows and T-SQL need rework too

**Pipelines.** Synapse pipelines don't import into Fabric as they are. The Fabric pipeline upgrade PowerShell module targets Azure Data Factory, not Synapse, so Synapse pipelines are rebuilt by hand as Fabric Data Factory pipelines, including any pipeline that orchestrates notebooks or Spark job definitions. During the transition, the Invoke Pipeline activity (remote invocation GA since September 2025) can call your existing Synapse pipelines from Fabric, so you can migrate orchestration last.

**Mapping data flows.** These have no direct equivalent. Plan to rewrite them as Dataflow Gen2 (Power Query) or as notebook code.

**Dedicated SQL pools.** Expect T-SQL surface differences in Fabric Warehouse: distribution and index options don't carry over, and some DDL and data types need changing. The [Fabric Data Warehouse migration assistant](https://learn.microsoft.com/fabric/data-warehouse/migration-assistant) (generally available since September 2025) helps here: it converts the schema from an uploaded DACPAC, uses Copy job to move data, and uses Copilot to help fix incompatibilities. It reduces the effort; it doesn't remove the testing.

Scope each of these as its own line item, not as part of "the notebooks".

### Test against real data

Budget time to test every notebook against real data. "It ran without errors" is not a test; compare row counts and aggregates between the Synapse output and the Fabric output before you switch anything off.

## 3. Direct Lake has requirements, and they aren't the ones you expect

Direct Lake is usually the feature stakeholders are buying, and it delivers: Power BI reads Delta tables from OneLake without an import refresh copying the data. But it has hard prerequisites, and we had to restructure data to meet them.

What actually matters, per the [Direct Lake overview](https://learn.microsoft.com/fabric/fundamentals/direct-lake-overview):

| Requirement | What it means in practice |
|---|---|
| Delta tables in OneLake | Data must be a Delta table in a lakehouse or warehouse. Raw Parquet or CSV folders don't qualify. Shortcut tables work with Direct Lake on SQL endpoints; Direct Lake on OneLake doesn't support them while it's in preview. |
| Guardrails per capacity SKU | Each table has limits on Parquet files, row groups and rows. Exceeding a per-table limit makes queries on that table fall back to DirectQuery (Direct Lake on SQL endpoints) or fail (Direct Lake on OneLake, which has no fallback), and framing can fail when a table exceeds the guardrails. On SQL endpoints, exceeding the max model size sends every query to DirectQuery. |
| Supported data types | Complex column types (struct, array, map) and binary columns aren't supported. Convert them to strings or other supported types in the gold layer, and check the known issues and limitations before modelling. |
| Healthy file layout | Lots of small files and row groups hurt both guardrails and query speed. |

Teams coming from Synapse often assume partitioning is the main lever. It isn't. Over-partitioning a modest table creates exactly the small-file problem that pushes you towards the guardrails. Compaction (`OPTIMIZE`) and file layout matter more.

Direct Lake isn't always the right answer, either. I'd stay on Import mode for small, heavily modelled models or ones that lean on calculated columns, and for gold data that can't meet the guardrails on your current SKU.

Two details worth knowing before you design gold tables:

- **V-Order is not on by default in new workspaces.** New Fabric workspaces default to the `writeHeavy` Spark resource profile, which disables V-Order to speed up writes. For tables that Direct Lake reads heavily, turn V-Order back on for those writes or use a read-optimised profile.
- **Fallback behaves differently by mode.** Direct Lake on SQL endpoints can fall back to DirectQuery when a guardrail is exceeded, which hides the problem behind slower queries. The newer Direct Lake on OneLake mode (public preview, enabled through the tenant setting "User can create Direct Lake on OneLake semantic models (preview)") doesn't fall back at all. Either way, you want to find out during the pilot, not from a user.

A quick, read-only check to run on candidate tables. Run these in a Spark SQL cell (`%%sql`) in a Fabric notebook:

```sql
-- Replace <table-name> with your table,
-- schema-qualified (<schema>.<table-name>) if the lakehouse has schemas enabled.
DESCRIBE DETAIL <table-name>;
```

```sql
-- Row count, to compare against the rows-per-table guardrail for your SKU
SELECT COUNT(*) AS row_count FROM <table-name>;
```

`DESCRIBE DETAIL` returns `numFiles` and `sizeInBytes`, which is enough to spot a table with a small-file problem. It doesn't show row groups, so pair it with the row count and compare both against the guardrails for your SKU.

Compaction is a separate maintenance step. `OPTIMIZE` rewrites the table's files and consumes CUs, so schedule it rather than running it ad hoc on a busy capacity:

```sql
-- Maintenance: compact small files and apply V-Order for read-heavy tables
OPTIMIZE <table-name> VORDER;
```

## 4. Monitor capacity from day one

In Synapse, a slow dedicated pool or a busy Spark pool is mostly a local problem. In Fabric, every workspace assigned to the same capacity draws from one shared pool of CUs, so a badly written notebook can throttle the executive dashboards running on the same capacity. Without monitoring, you will hit limits and not know why.

The behaviour you need to understand is [throttling](https://learn.microsoft.com/fabric/enterprise/throttling). Fabric smooths usage over time and lets you borrow against future capacity, then escalates in stages:

| Future capacity consumed | What happens |
|---|---|
| Up to 10 minutes | Overage protection, no throttling |
| 10 to 60 minutes | Interactive requests delayed 20 seconds |
| 60 minutes to 24 hours | Interactive requests rejected, background jobs still run |
| Over 24 hours | All requests rejected |

The trap: smoothing lets a migration-week backfill quietly build up carry-forward that bites interactive users later.

Set up from day one:

- **The Fabric Capacity Metrics app**, installed before the first workload moves, so you have a baseline.
- **Capacity notifications** in the admin settings, so admins get an email when utilisation crosses a threshold.
- **A look at throttling and failed operations** each week during migration, not after go-live.
- **Cost tracking** that maps capacity usage back to workspaces and teams.

Three design choices prevent most contention:

- **Separate capacities for dev/test and production.** Experiments and backfills then burn their own CUs, not the ones your production reports depend on.
- **Surge protection** (GA since June 2025) on the production capacity, which rejects new background jobs once 24-hour background utilisation crosses a threshold you set, so a backfill can't push interactive users into throttling.
- **Autoscale Billing for Spark**, generally available since mid-2025. It runs Spark jobs pay-as-you-go, outside the shared capacity, up to a CU limit you set. Heavy notebooks stop competing with Power BI, at the cost of a less predictable bill.

I wrote more about sizing and what the metrics told us in [From F64 to F32: Three Fabric Sizing Mistakes and the Fixes](/blog/2026-01-20-fabric-capacity-planning/).

## 5. Train your team, with their hands on the keyboard

Your team needs hands-on practice in a workspace with their own data, not a link to the docs. Workspaces and roles, lakehouse versus warehouse, shortcuts, environments, Git integration and capacity consumption are new concepts, even for experienced Synapse engineers.

We underestimated this, and it cost us two weeks of confusion. The usual failure mode is building things the Synapse way and rebuilding them later, once the Fabric pattern is clear. Training at the start of the pilot is cheaper than training after it.

My rule of thumb: run the pilot workload as the training exercise, built by the people who will own the migrated workloads. Before the pilot ends, each engineer should have done four things themselves:

- Built one lakehouse table fed through a OneLake shortcut.
- Attached a Fabric environment with the libraries and Spark settings their notebooks need.
- Committed the workspace to Git and deployed a change through it.
- Found their own jobs' CU usage in the Capacity Metrics app.

## What I'd tell you before you start

Fabric is a good platform, and I'd make the move again, but migration is engineering work, not a configuration change. Start with one workload, treat notebook refactoring as its own workstream, design gold tables around Direct Lake's rules, watch capacity from the first day, and train people on the pilot before they build the rest.

And whatever your first estimate is, double it. Ours ran twice as long as planned. For a wider set of migration patterns, see [Fabric Migration Stories: Real-World Experiences](/blog/2023-12-15-fabric-migration-stories/).
