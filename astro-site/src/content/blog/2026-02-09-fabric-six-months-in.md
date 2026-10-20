---
title: "Leaving ADF and Databricks for Fabric: What Held Up"
description: "What consolidating Azure Data Factory, Databricks, Azure SQL and Power BI onto Microsoft Fabric delivered in production, and where the seams still show."
author: Michael John Peña
draft: false
date: 2026-02-09
tags:
  - Microsoft Fabric
  - Databricks
  - Data Factory
  - Data Engineering
  - Migration
---

Our old data platform worked, but it was four services plus scattered storage accounts, each with its own billing and credentials, and every pipeline crossed most of them. We moved it onto Microsoft Fabric to cut that operational overhead, not to get new features. Having run it in production since, I'd make the same call, but the consolidation story is more uneven than the "one platform" pitch suggests, and most of the unevenness sits in the Databricks half of the move.

For the Synapse and Power BI Premium side of Fabric (throttling, capacity costs, the P-SKU retirement), see my [Fabric reality check](/blog/2026-01-05-microsoft-fabric-reality-check/). This post is about moving Azure Data Factory and Azure Databricks workloads.

## What we consolidated

The starting point was a familiar Azure stack:

- Azure Data Factory for orchestration
- Azure Databricks for processing
- Azure SQL for serving
- Power BI for reporting
- Blob Storage and ADLS accounts scattered across resource groups

The data path went from five components to four, on one platform:

```text
Before: ADF -> Blob Storage -> Databricks -> Azure SQL -> Power BI
After:  Fabric pipeline -> Spark notebooks -> Lakehouse -> Power BI (Direct Lake)
```

Fewer hops means fewer places to fail, fewer credentials to rotate and fewer copies of the same table drifting apart. That alone justified the move for us. Each of the three migrations behaved very differently.

| Old component | Fabric replacement | How close the fit is |
|---|---|---|
| Azure Data Factory pipelines | Fabric Data Factory pipelines | Close. Same activity model, different plumbing |
| Databricks notebooks and jobs | Fabric Spark notebooks (Runtime 1.3) | Same Spark, different everything around it |
| Azure SQL serving + Power BI datasets | Lakehouse Delta tables + Direct Lake semantic models | A redesign, not a port |

## ADF to Fabric pipelines: the easy one, mostly

Fabric pipelines are recognisably ADF. The canvas, the activities and the expression language carry over, which makes it tempting to treat this as a copy-paste job. It isn't, and Microsoft's own [ADF migration planning guide](https://learn.microsoft.com/en-us/fabric/data-factory/upgrade-planning-azure-data-factory) lists the differences that bite:

- **No separate datasets.** Dataset properties live inline in each activity. Metadata-driven frameworks built around shared datasets need restructuring.
- **Connections aren't parameterised the same way.** ADF linked services can take dynamic parameters; Fabric connections can't, so you parameterise the connection object in the activity instead.
- **Global parameters become a variable library.** Variable libraries went GA in September 2025, and the guide has a conversion path, but the types and patterns differ.
- **Managed identity becomes workspace identity.** Plan the permission changes on your sources before cut-over, not during it.
- **Schedules are per pipeline.** There's no shared trigger you can point at several pipelines, and no central schedule hub.
- **Key Vault integration is narrower.** Fabric's Key Vault references (still preview) cover fewer connectors and auth types than ADF linked services; check yours before cut-over.

You also don't have to migrate everything at once. Since May 2025 you can bring an existing data factory into a Fabric workspace as an Azure Data Factory item (GA), which lets you see and run ADF pipelines from Fabric while you rebuild them. Those pipelines still run on ADF's integration runtimes and bill to your Azure subscription, so the single bill only arrives once the bridge is gone.

For conversion, run the migration assessment in ADF Studio (preview, announced December 2025) first. It flags unsupported activities and exports a report, so you can sort pipelines before touching any of them. Then use the `Microsoft.FabricPipelineUpgrade` PowerShell module, which Microsoft Learn documents as a supported migration path rather than a preview, to convert the high-parity ones in bulk. My advice is to use the ADF item as a bridge for the long tail and hand-rebuild the pipelines that matter. A converted pipeline still carries ADF-era design decisions, and the migration is the cheapest moment you'll ever have to drop them.

## Databricks to Fabric Spark: same engine, different platform

Moving from Databricks to Fabric notebooks needed real refactoring: different Spark configuration, different libraries, different utilities. PySpark is PySpark, but almost everything around the DataFrame code changes.

### The utility layer

Every Databricks notebook leans on `dbutils`. Fabric's equivalent is [NotebookUtils](https://learn.microsoft.com/en-us/fabric/data-engineering/notebook-utilities) (formerly MSSparkUtils, which still works but is slated for retirement). The concepts map, the signatures don't:

| Databricks | Fabric |
|---|---|
| `dbutils.secrets.get(scope, key)` | `notebookutils.credentials.getSecret(vault_url, secret_name)` |
| `dbutils.notebook.run(path, timeout, args)` | `notebookutils.notebook.run(name, timeout, args)` |
| `dbutils.widgets` | A cell marked as the parameter cell |
| `dbutils.fs.ls(path)` | `notebookutils.fs.ls(path)` |

Secrets are the one to plan for. Databricks secret scopes become direct Azure Key Vault calls, and `getSecret` uses the credentials of whoever the notebook runs as. In an interactive run that's you. By default, a pipeline run uses the pipeline's last modified user and a scheduled run uses whoever created or last updated the schedule, so a routine edit can quietly change which identity reads the vault. Since December 2025 you can set a service principal or workspace identity connection on the pipeline's Notebook activity. Do that for production pipelines and grant that identity access to the vault, which is the closest match to Databricks scope ACLs. If the workspace identity option is missing from the activity, use a service principal connection instead. Keep a group grant for data engineers for interactive development, rather than granting individuals. A Fabric notebook cell looks like this (fragment; `notebookutils` is preloaded in Fabric notebooks):

```python
# Fabric Spark notebook, Runtime 1.3. No import needed for notebookutils.

# Was: dbutils.secrets.get(scope="kv-scope", key="source-api-key")
api_key = notebookutils.credentials.getSecret(
    "https://<your-key-vault-name>.vault.azure.net/", "source-api-key"
)

# Was: dbutils.notebook.run("./silver_orders", 600, {"load_date": "2026-02-01"})
exit_value = notebookutils.notebook.run("silver_orders", 600, {"load_date": "2026-02-01"})
print(f"silver_orders returned: {exit_value}")
```

For fan-out work that used to be a Databricks job with several tasks, `notebookutils.notebook.runMultiple()` accepts a dependency graph and runs the notebooks inside one Spark session. It's convenient, but they share that session's compute, so it isn't a like-for-like replacement for separate job clusters.

### Configuration and libraries

Databricks cluster policies, init scripts and per-cluster library installs don't exist in Fabric. You get starter pools, custom pools and environments, where an environment carries the runtime, Spark properties and libraries for the notebooks attached to it. Fabric Runtime 1.3 pins Spark 3.5, Delta Lake 3.2 and Python 3.11; Runtime 2.0 (Spark 4.0) is only an experimental preview. Pin your library versions in environments, test them against 1.3, and resist the urge to recreate every cluster flavour you had in Databricks. Two or three environments is usually enough.

On performance, the native execution engine (GA since May 2025 on Runtime 1.3) is Fabric's answer to Photon. It's worth switching on in your environments and checking whether your heavier jobs fall back for unsupported operators.

### What Fabric Spark is good at

Notebooks in Fabric are solid. They're not as feature-rich as Databricks, but they're good enough for about 80% of our workloads, and for straightforward medallion transformations the gap rarely matters. For small transformations, the non-Spark Python notebooks (GA since September 2025) are cheaper and start faster, which matters on a shared capacity.

## Azure SQL to Direct Lake: the part that paid off most

Dropping Azure SQL as a serving layer and pointing Power BI at lakehouse tables through Direct Lake was the biggest win. Reports query the Delta tables directly; there's no import refresh and no separate serving copy to keep in sync. The model reframes after each load (automatically by default; turn that off and trigger it from the pipeline if you need loads to land atomically). On Direct Lake on SQL endpoints, a table over your SKU's guardrails falls back to DirectQuery. On Direct Lake on OneLake (still in preview) there is no fallback, so the query fails. Size against the guardrails, not just the capacity. Direct Lake is fast, but it rewards tables designed for it. I covered the design side in [Direct Lake best practices](/blog/2024-01-17-direct-lake-best-practices/), and migration gotchas from a Synapse move are in [what I wish I'd known before migrating](/blog/2026-01-23-fabric-migration-lessons/).

The billing change also landed. One capacity, one bill. Finance stopped asking me to explain five different Azure meters.

## Where the seams still show

### Spark and Power BI share one pool

Fabric capacity is a single pool of capacity units shared by Spark, SQL, pipelines and Power BI. We've had a heavy Spark job starve Power BI reports, and it took time to learn the right sizing. The mechanism is worth understanding: Spark jobs are background operations, smoothed over 24 hours, so one oversized job can push the capacity into overage that then delays or rejects interactive report queries.

There are now two real fixes. Surge protection (GA June 2025) makes the capacity reject new background jobs before they drag interactive users down. [Autoscale Billing for Spark](https://learn.microsoft.com/en-us/fabric/data-engineering/autoscale-billing-for-spark-overview) (GA July 2025) goes further and moves Spark off the shared capacity onto pay-as-you-go serverless compute with a CU cap you set. For a team coming from Databricks, where Spark compute was always billed separately, autoscale billing is the closest thing to the old isolation. My sizing approach is in [three Fabric sizing mistakes](/blog/2026-01-20-fabric-capacity-planning/).

### Item sprawl

The old question was "Data Engineering or Data Science experience?". The current one is which item to use: Spark notebook, Python notebook, Spark job definition, Dataflow Gen2 or Copy job. Several overlap. Write down a default for each kind of work early, or every engineer picks differently. Mine is:

- **Spark notebook** for medallion transforms over large data.
- **Python notebook** for small API pulls and file wrangling.
- **Copy job** for straight source-to-lakehouse copies, and for CDC (still preview) where the source supports it.
- **Dataflow Gen2** only for analyst-owned Power Query logic.
- **Spark job definition** for packaged code you deploy from CI.

### Git integration is uneven by item type

[Git integration](https://learn.microsoft.com/en-us/fabric/cicd/git-integration/intro-to-git-integration) works well for notebooks, pipelines and environments, which are GA. Lakehouses, warehouses, Power BI reports and semantic models are still in preview. Check the supported items list before you promise the team that everything is in source control.

### Previews in the places you'd want stability

Copilot in Fabric is a mixed bag on status: Copilot for pipelines, Dataflow Gen2 and Power BI is GA, but [Copilot in notebooks and the warehouse](https://learn.microsoft.com/en-us/fabric/fundamentals/copilot-ai-feature-state) is still preview. OneLake security, the fine-grained access model Databricks users will compare to Unity Catalog, is also still preview. I don't build production access controls on preview features, and I wouldn't start with OneLake security until it's GA. Before relying on any documented behaviour at the edges, check the What's new page in the Fabric docs and the Fabric blog's monthly feature summary, because Learn pages sometimes trail what the product actually does.

## Should you make the same move?

Make it if you're a Microsoft shop already on Microsoft 365, Power BI and Azure, and your problem is operational sprawl rather than missing capability. Teams of three to ten data engineers get the most out of it, because they feel the cost of running several services most and need the advanced Databricks features least.

Stay on Databricks if you depend on Unity Catalog governance, Databricks-managed MLflow workflows, or fine-grained cluster control. Fabric has MLflow-based experiment tracking and can mirror Unity Catalog metadata into Fabric, reading the tables in place through OneLake shortcuts (GA since July 2025), so coexistence is easier than it was, but parity isn't there. I laid out that decision in [Databricks or Fabric in 2026](/blog/2026-01-14-databricks-vs-fabric/).

If you go ahead, sequence it the way the fit table suggests: redesign serving around Direct Lake first, rebuild the important pipelines while the ADF item bridges the rest, and budget the most time for the Databricks notebooks. And turn on surge protection, or autoscale billing for Spark, before your first heavy job meets your first busy reporting morning.
