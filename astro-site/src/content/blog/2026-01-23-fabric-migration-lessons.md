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

We migrated our analytics platform from Azure Synapse to Microsoft Fabric, and it took twice as long as we estimated. Nothing went catastrophically wrong. The time went into a long list of small differences that each looked trivial on a slide and each cost days in practice. If you are planning the same move, these are the five things I would tell myself before the first sprint.

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

**Runtimes differ.** Fabric's current GA runtime is Runtime 1.3 (Apache Spark 3.5, Python 3.11, Delta Lake 3.2). If your Synapse pools were on an older Spark version, library versions move under you, and anything pinned to an old version of a package needs testing again.

**Linked services don't exist.** Synapse notebooks often read credentials or connection details through linked services. Fabric has no equivalent object. External sources move to Fabric connections, and storage you used to mount is usually better exposed as OneLake shortcuts (mounting via `notebookutils.fs.mount` still works). Every notebook that called a linked service needs a code change.

**The utilities namespace changed.** `mssparkutils` is renamed to `notebookutils` in Fabric. Existing calls still run, but Microsoft's notebook utilities documentation says new features land only in `notebookutils` and the old namespace will be retired. If you are touching the code anyway, rename it now.

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

### Pipelines, data flows and T-SQL need rework too

Notebooks aren't the only thing that has to move. Synapse pipelines don't import into Fabric as they are; you rebuild them as Fabric Data Factory pipelines. That includes any pipeline that orchestrates notebooks or Spark job definitions, as the [Synapse data and pipelines migration guidance](https://learn.microsoft.com/fabric/data-engineering/migrate-synapse-data-pipelines) notes. Mapping data flows have no direct equivalent, so plan to rewrite them as Dataflow Gen2 (Power Query) or as notebook code; Microsoft's [guide for mapping data flow users](https://learn.microsoft.com/fabric/data-factory/guide-to-dataflows-for-mapping-data-flow-users) maps the transformations across. If you have a dedicated SQL pool, expect T-SQL surface differences in Fabric Warehouse too: distribution and index options don't carry over, and some DDL and data types need changing. Scope each of these as its own line item, not as part of "the notebooks".

### Test against real data

Budget explicit time for updating package versions, fixing path references, reworking authentication, and then testing every notebook against real data. "It ran without errors" is not a test; compare row counts and aggregates between the Synapse output and the Fabric output before you switch anything off.

## 3. Direct Lake has requirements, and they aren't the ones you expect

Direct Lake is usually the feature stakeholders are buying, and it delivers: Power BI reads Delta tables from OneLake without an import refresh copying the data. But it has hard prerequisites, and we had to restructure data to meet them.

What actually matters, per the [Direct Lake overview](https://learn.microsoft.com/fabric/fundamentals/direct-lake-overview):

| Requirement | What it means in practice |
|---|---|
| Delta tables in OneLake | Data must be a Delta table in a lakehouse or warehouse Raw Parquet or CSV folders don't. Shortcuts are supported with Direct Lake on SQL endpoints, not yet with Direct Lake on OneLake. |
| Guardrails per capacity SKU | Each table has limits on Parquet files, row groups and rows. Exceeding a per-table limit makes queries touching that table fall back to DirectQuery (Direct Lake on SQL) or fail (Direct Lake on OneLake), and can break framing; exceeding the model-size limit sends every query to DirectQuery. |
| Supported data types | Columns have to map to types the semantic model supports. Check your schema before you build the model. |
| Healthy file layout | Lots of small files and row groups hurt both guardrails and query speed. |

Teams coming from Synapse often assume partitioning is the main lever. It isn't. Over-partitioning a modest table creates exactly the small-file problem that pushes you towards the guardrails. Compaction (`OPTIMIZE`) and file layout matter more.

Two details worth knowing before you design gold tables:

- **V-Order is not on by default in new workspaces.** New Fabric workspaces default to the `writeHeavy` Spark resource profile, which disables V-Order to speed up writes. For tables that Direct Lake reads heavily, [turn V-Order back on](https://learn.microsoft.com/fabric/data-engineering/delta-optimization-and-v-order) for those writes or use a read-optimised profile.
- **Fallback behaves differently by mode.** Direct Lake on SQL endpoints can fall back to DirectQuery when a guardrail is exceeded, which hides the problem behind slower queries. The newer Direct Lake on OneLake mode (public preview, enabled through the tenant setting "User can create Direct Lake on OneLake semantic models (preview)") doesn't fall back at all. Either way, you want to find out during the pilot, not from a user.

A quick check I run on candidate tables in a notebook:

```sql
-- Spark SQL in a Fabric notebook; replace with your table name.
-- Assumes a schema-enabled lakehouse; otherwise use the table name alone (fact_sales).
DESCRIBE DETAIL gold.fact_sales;

-- Row count, to compare against the rows-per-table guardrail for your SKU
SELECT COUNT(*) FROM gold.fact_sales;

-- Compact small files and apply V-Order for read-heavy tables
OPTIMIZE gold.fact_sales VORDER;
```

`DESCRIBE DETAIL` returns `numFiles` and `sizeInBytes`, which is enough to spot a table with a small-file problem. It doesn't show row groups, so pair it with the row count and compare both against the guardrails for your SKU.

## 4. Monitor capacity from day one

In Synapse, a slow dedicated pool or a busy Spark pool is mostly a local problem. In Fabric, every workspace assigned to the same capacity draws from one shared pool of CUs, so a badly written notebook can slow down the CEO's report. Without monitoring, you will hit limits and not know why.

The behaviour you need to understand is [throttling](https://learn.microsoft.com/fabric/enterprise/throttling). Fabric smooths usage over time and lets you borrow against future capacity, then escalates in stages:

| Future capacity consumed | What happens |
|---|---|
| Up to 10 minutes | Overage protection, no throttling |
| 10 to 60 minutes | Interactive requests delayed 20 seconds |
| 60 minutes to 24 hours | Interactive requests rejected, background jobs still run |
| Over 24 hours | All requests rejected |

The trap is that background smoothing lets a migration-week backfill quietly build up carry-forward that bites interactive users later in the day.

Set up from day one:

- **The Fabric Capacity Metrics app**, installed before the first workload moves, so you have a baseline.
- **Capacity notifications** in the admin settings, so admins get an email when utilisation crosses a threshold.
- **A look at throttling and failed operations** each week during migration, not after go-live.
- **Cost tracking** that maps capacity usage back to workspaces and teams.

Monitoring tells you about contention; two design choices prevent most of it:

- **Separate capacities for dev/test and production.** Experiments and backfills then burn their own CUs, not the ones your production reports depend on.
- **[Autoscale Billing for Spark](https://learn.microsoft.com/fabric/data-engineering/autoscale-billing-for-spark-overview)**, generally available since mid-2025. It runs Spark jobs pay-as-you-go, outside the shared capacity, up to a CU limit you set. Heavy notebooks stop competing with Power BI, at the cost of a less predictable bill.

I wrote more about sizing and what the metrics told us in [From F64 to F32: Three Fabric Sizing Mistakes and the Fixes](/blog/2026-01-20-fabric-capacity-planning/).

## 5. Train your team, with their hands on the keyboard

Fabric is different enough from Synapse that your team needs real training: not a link to the docs, but hands-on practice in a workspace with their own data. Workspaces and roles, lakehouse versus warehouse, shortcuts, environments, Git integration, and how capacity consumption works are all new concepts, even for experienced Synapse engineers.

We underestimated this, and it cost us two weeks of confusion: people building things the Synapse way, then rebuilding them once the Fabric pattern became clear. Training before the pilot would have been cheaper than training after it.

My rule of thumb: run the pilot workload as the training exercise. The people who will own the migrated workloads should build the first one themselves, with someone who has already read the migration guidance sitting next to them.

## What I'd tell you before you start

Fabric is a good platform, and I'd make the move again. But migration is real engineering work, not a configuration change. Start with one workload, treat notebook refactoring as its own workstream, design gold tables around Direct Lake's rules, watch capacity from the first day, and train people before they build.

If your warehouse is a Synapse dedicated SQL pool, look at the [Fabric Data Warehouse migration assistant](https://learn.microsoft.com/fabric/data-warehouse/migration-assistant) (generally available since September 2025), which converts the schema from a DACPAC or a direct connection, uses Copy job to move data, and helps fix incompatibilities. It reduces the effort; it doesn't remove the testing.

And whatever your first estimate is, double it. Ours ran twice as long as planned. For a wider set of migration patterns, see [Fabric Migration Stories: Real-World Experiences](/blog/2023-12-15-fabric-migration-stories/).
