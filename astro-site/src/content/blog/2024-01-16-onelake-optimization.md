---
title: "Laying Out OneLake: Workspaces, Lakehouses and Shortcuts"
description: "How I decide OneLake layout in Fabric: workspaces as security boundaries, a lakehouse per layer, a flat Tables folder, and shortcuts where copies hurt."
author: Michael John Peña
draft: false
date: 2024-01-16
tags:
  - OneLake
  - Microsoft Fabric
  - Lakehouse
  - Data Architecture
  - Medallion Architecture
---

OneLake gives every Fabric tenant one logical data lake, which makes it easy to start and easy to make a mess. The layout decisions you make in the first month (which workspaces, how many lakehouses, what goes in `Tables` versus `Files`, when to shortcut instead of copy) decide who can see what, which semantic models you can build, and how much data you store twice. I've already seen OneLake layouts reorganised once projects grew, and the patterns below are what I'd now set up from the start.

This post is about that structure. File-level tuning (V-Order, `OPTIMIZE`, `VACUUM`, file counts) is covered in yesterday's [Tracing a Slow Fabric Report Back Through Every Layer](/blog/2024-01-15-fabric-performance-tuning/), and the general mechanics of shortcuts are in [OneLake Shortcuts: Connecting Data Without Copying](/blog/2023-06-03-onelake-shortcuts/).

## The hierarchy you are actually designing

Fabric went GA at Ignite in November 2023, OneLake included. Its hierarchy is fixed: tenant, then workspace, then item (lakehouse, warehouse, KQL database), then folders. Every item stores its data in OneLake, and Spark and other tools address it through an ADLS Gen2-compatible endpoint:

```text
abfss://<workspace>@onelake.dfs.fabric.microsoft.com/<lakehouse>.Lakehouse/Tables/<table>
abfss://<workspace-guid>@onelake.dfs.fabric.microsoft.com/<lakehouse-guid>/Files/<folder>
```

Both forms are documented in [OneLake access with APIs](https://learn.microsoft.com/fabric/onelake/onelake-access-api). I use the GUID form in anything scheduled. Rename a workspace and every name-based path in your notebooks and pipelines breaks. The GUIDs don't change.

The important thing about this hierarchy is where security lives. As of January 2024, OneLake access is governed by workspace roles (Admin, Member, Contributor, Viewer) and by item sharing, where you can grant "Read all Apache Spark" or "Read all SQL endpoint data" on a lakehouse. There are no folder-level or table-level permissions on OneLake itself. Object-level and row-level security exist in the SQL analytics endpoint and in semantic models, but anyone reading the files through Spark or the OneLake endpoint bypasses them.

That one fact drives most of my layout decisions.

## Rule 1: the workspace is your security boundary

If two sets of data need different people to read the raw files, they belong in different workspaces. Not different folders, not different lakehouses in the same workspace with a naming convention, but different workspaces. A Contributor in a workspace can read and write every lakehouse in it.

In practice this means I split workspaces along two lines:

- **Who builds versus who consumes.** Data engineers get Contributor on the engineering workspace. Analysts get Viewer on a consumption workspace, or item-level access to a specific lakehouse or semantic model.
- **Sensitivity.** HR, payroll or anything with health data goes in its own workspace with its own small group of Contributors, even if the pipelines look the same as everything else.

The trade-off is more workspaces to administer, assign to capacities and deploy. I accept that. Restructuring permissions later means moving data, and moving data means changing every path that points at it.

## Rule 2: one lakehouse per medallion layer, not one folder per layer

The most common layout I see in early Fabric projects puts bronze, silver and gold as subfolders under a single lakehouse's `Tables` folder. That doesn't work. The lakehouse treats `Tables` as a flat namespace: each table is a Delta folder directly under `Tables/`. Folders it can't recognise as a Delta table show up in the explorer under "Unidentified" and don't reach the SQL analytics endpoint or the default semantic model.

Microsoft's guidance on the [medallion lakehouse architecture in Fabric](https://learn.microsoft.com/fabric/onelake/onelake-medallion-lakehouse-architecture) lists a lakehouse per zone as its first pattern and recommends putting each lakehouse in its own workspace. I stop short of that: bronze and silver share an engineering workspace because the same people own and read both, and the workspace split goes where the audience changes. A lakehouse per layer is the part I agree with, for three reasons:

1. **Each lakehouse gets its own SQL analytics endpoint and default semantic model.** Gold tables don't sit next to raw ingestion tables in the list analysts browse.
2. **You can share gold without sharing bronze.** Item sharing works at the lakehouse level, so a separate gold lakehouse is the smallest unit you can hand to a consumer.
3. **A Direct Lake semantic model reads from a single lakehouse or warehouse.** If the model needs tables from several places, those tables have to appear in one lakehouse. Planning a gold lakehouse up front gives you that place.

Here is the layout I start with:

| Workspace | Item | Holds | Typical access |
|---|---|---|---|
| `sales-engineering` | `lh_bronze` | Raw Delta tables, landing files in `Files/` | Engineers only |
| `sales-engineering` | `lh_silver` | Cleaned, conformed tables | Engineers, data scientists via item share |
| `sales-consumption` | `lh_gold` | Shortcuts to curated tables, plus gold aggregates | Analysts, report builders |
| `sales-consumption` | Direct Lake semantic model | Model over `lh_gold` | Report consumers |

Within each lakehouse, `Tables` holds only Delta tables written with `saveAsTable` or as a correct Delta folder. `Files` holds everything that isn't a table yet: landing files by source and date, reference CSVs, exports. Don't treat `Files` as a second table area. If something is queried regularly it should be a Delta table.

When not to do this: a single analyst with one source and a couple of reports doesn't need three lakehouses in two workspaces. One lakehouse with clear table prefixes is fine until a second audience shows up. The split pays off when access differs, not before.

## Rule 3: shortcuts where a copy would create a second truth

A [OneLake shortcut](https://learn.microsoft.com/fabric/onelake/onelake-shortcuts) is a pointer to data in another OneLake location, in ADLS Gen2, or in Amazon S3, the three you create from a lakehouse. Shortcuts to OneLake, ADLS Gen2 and S3 were part of the GA release. A fourth kind, Dataverse, is in preview and is created from the Power Apps maker portal (Link to Fabric) rather than the Fabric UI. The data isn't copied, so you pay for storage once and there is nothing to keep in sync.

I use shortcuts in three places:

- **Gold lakehouse pulling curated tables from silver.** The table is written once by the engineering workspace and appears in the consumption workspace without a pipeline. This is also how a Direct Lake model gets tables from more than one source lakehouse.
- **Existing ADLS Gen2 data.** If a Synapse or Databricks estate already writes Delta to ADLS Gen2, a shortcut lets Fabric read it during migration without a second copy.
- **Shared reference data** such as calendars and organisation hierarchies, owned by one team and read by many.

Two behaviours catch people out. First, a shortcut placed in `Tables` must sit at the top level and point at a Delta table folder to appear as a table. Point it at a parent folder full of tables and you get one "Unidentified" entry. Shortcut to each table instead. Second, [shortcut security](https://learn.microsoft.com/fabric/onelake/onelake-shortcuts) depends on the target and on how the shortcut is read. Through Spark and the OneLake API, a OneLake-to-OneLake shortcut checks the caller's own permissions on the target, so a user without access to the source workspace sees nothing. Through the SQL analytics endpoint and Power BI semantic models it's different: the caller's identity isn't passed through, and the lakehouse owner's identity is used instead. That delegation is what lets analysts with no access to `sales-engineering` query `lh_gold`. It also means any shortcut, internal or external, effectively grants read access to whoever can query the lakehouse's SQL endpoint or model. A shortcut to ADLS Gen2 or S3 uses the credentials in the connection, so everyone who can read the lakehouse can read that external data. Treat creating any shortcut as granting access, because it is.

When not to shortcut: if the consuming side needs a different shape (filtered rows, masked columns, a different grain), write a real table. A shortcut exposes the source as it is, and since there is no table-level OneLake security, you can't hide a column behind it. Security defined on the source's SQL analytics endpoint doesn't travel with the shortcut either; define it again on the gold side or write a reshaped table.

## Checking a lakehouse for layout problems

Before I agree to build on an existing lakehouse, I run a quick audit in a Fabric notebook. It lists everything under `Tables` and flags folders that aren't Delta tables. The `mssparkutils` file system utilities are built into Fabric notebooks.

```python
# Fabric notebook. Replace the GUIDs with your workspace and lakehouse IDs
# (both are in the lakehouse URL in the Fabric portal).
workspace_id = "<your-workspace-guid>"
lakehouse_id = "<your-lakehouse-guid>"

tables_root = f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/{lakehouse_id}/Tables"

delta_tables, not_delta = [], []
for entry in mssparkutils.fs.ls(tables_root):
    if not entry.isDir:
        not_delta.append((entry.name, "loose file"))
    elif mssparkutils.fs.exists(f"{entry.path}/_delta_log"):
        delta_tables.append(entry.name)
    else:
        not_delta.append((entry.name, "folder without _delta_log"))

print(f"Delta tables: {len(delta_tables)}")
for name, reason in not_delta:
    print(f"Will show as Unidentified: {name} ({reason})")
```

Anything in the second list is either a medallion subfolder that should be its own lakehouse, a parent-folder shortcut that should be per-table shortcuts, or raw files that belong in `Files`.

The same GUID-based paths let one notebook write to a lakehouse other than the one attached to it, which is how I keep a silver notebook writing into `lh_silver` while it reads from `lh_bronze`:

```python
# Fragment: assumes `workspace_id` from above and a DataFrame `cleaned_df`.
silver_lakehouse_id = "<your-silver-lakehouse-guid>"
target = (
    f"abfss://{workspace_id}@onelake.dfs.fabric.microsoft.com/"
    f"{silver_lakehouse_id}/Tables/customer"
)
cleaned_df.write.format("delta").mode("overwrite").save(target)
```

Writing a Delta folder directly under the target lakehouse's `Tables` like this is registered as a table there. Writing it anywhere deeper is how "Unidentified" entries are born.

## Storage cost follows layout

OneLake storage is billed separately from capacity compute, so layout has a direct cost. The three habits that keep it down are all structural:

- **Shortcut instead of copy** between layers and workspaces whenever the shape doesn't change.
- **Keep landing files on a retention plan.** `Files/landing` grows forever unless something deletes old drops once they are in bronze.
- **Remember that Delta keeps old versions** until `VACUUM` removes them, so frequently overwritten tables can cost several times their visible size. The maintenance side is in the [performance tuning post](/blog/2024-01-15-fabric-performance-tuning/).

## What I'd decide in week one

If you are starting a Fabric build this month, settle three things before anyone writes a pipeline. Draw the workspaces around who may read raw files, because that is the only OneLake boundary you have today. Give each medallion layer its own lakehouse and keep `Tables` flat. Decide which tables the consumption side will see through shortcuts and which need their own reshaped copy. Get those right and the tuning work later is about files and queries, not about moving data between places you should have picked at the start. For the reporting side of that gold lakehouse, tomorrow's post covers [Direct Lake best practices](/blog/2024-01-17-direct-lake-best-practices/).
