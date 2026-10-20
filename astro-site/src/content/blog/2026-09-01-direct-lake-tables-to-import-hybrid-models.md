---
title: "Converting Direct Lake Tables to Import: Designing Hybrid Models"
description: "Power BI now converts single Direct Lake tables to Import in web modelling, making storage mode a per-table choice with real refresh and governance costs."
author: Michael John Peña
draft: false
date: 2026-09-01
tags:
  - Power BI
  - Direct Lake
  - Microsoft Fabric
  - Semantic Models
  - Governance
---

Until recently, picking Direct Lake was a decision about the whole semantic model. Every table read Delta files from OneLake, so a dimension needing a calculated column or a lookup table that changed twice a year was stuck with the same storage mode as a billion-row fact table. The [Power BI August 2026 feature summary](https://community.fabric.microsoft.com/blog/fbc_pbiupdatesblog/power-bi-august-2026-feature-summary/5348434) changes that. You can now convert individual Direct Lake tables to Import in web modelling (preview), and refresh in the service is split into schema, data and table-level options. Storage mode is now a per-table choice, and it should be a deliberate one.

## What actually shipped

**Per-table conversion to Import (preview).** In web modelling, you open a Direct Lake on OneLake semantic model, switch to editing, select one or more tables, and change their storage mode from Direct Lake to Import in the Properties pane. A warning dialog comes up before the change applies. After you confirm, Power Query Online asks you to configure the connection to the SQL analytics endpoint, then you save and refresh. That connection's identity is what the Import table will refresh as. Rollout is staged over several weeks. Microsoft's guidance has three details that should shape how you use it:

- **The conversion is one-way.** Once a table is Import, you can't set it back to Direct Lake.
- **The source changes.** The converted table's Power Query expression becomes a SQL connector that reads through the Fabric SQL analytics endpoint.
- **It's web only.** Power BI Desktop doesn't offer per-table conversion.

If you'd rather script it, [semantic link labs](https://github.com/microsoft/semantic-link-labs) has `convert_direct_lake_to_import` on its TOM wrapper, but it writes a Lakehouse or Warehouse connector rather than the SQL endpoint one, and you still have to bind the connection in the service afterwards. The [web modelling documentation](https://learn.microsoft.com/en-us/fabric/fundamentals/direct-lake-web-modeling) covers the rest of the editor.

The result is a composite model with Direct Lake and Import tables, which Microsoft introduced [in public preview](https://powerbi.microsoft.com/en-us/blog/deep-dive-into-composite-semantic-models-with-direct-lake-and-import-tables/). The key point in that post is that relationships between Direct Lake and Import tables are *regular* relationships, not the limited relationships you get when mixing Import and DirectQuery. You don't pay the cross-source join penalty that made older [composite models](/blog/2022-01-27-power-bi-composite-models/) so easy to get wrong.

**Refresh options in the service.** The Refresh button in the service now offers *Refresh schema and data*, *Sync schema only* and *Refresh data only*, and you can run each of them against a single table. Before this, a refresh synced the schema first, every time. Microsoft's example in the summary is a Lakehouse table that gained columns you don't want in the model yet, while you still want the latest rows. One catch: in viewing mode you only get *Refresh data*, and the full set appears in editing mode.

## Storage mode is now a modelling decision

My view is that a hybrid model should start as Direct Lake everywhere, with Import as the exception you have to argue for. The question for each table is not "which mode is faster?" It's "which costs does this table justify?"

| Table profile | Mode I'd choose | Why |
|---|---|---|
| Large fact tables (tens of millions of rows and up) | Direct Lake | No copy of the data, no import refresh window, and columns load into memory on demand. This is what Direct Lake is for. |
| Small, heavily filtered dimensions (date, product, org hierarchy) | Import is reasonable | Every slicer and visual hits them. Keeping them resident avoids cold-load latency after a reframe, and they cost little memory. |
| Tables carrying heavy calculation logic | Import, or push the logic upstream | Calculated columns, calculated tables and Power Query transforms are mature in Import. |
| Lookup and mapping tables maintained by business users | Import | They often come from sources that aren't in OneLake anyway. |
| Dimensions that change often and must match the fact table exactly | Direct Lake | Keeping both sides on the same framing avoids freshness skew (more on that below). |

The calculation-heavy row needs some nuance. Calculated columns (user-context only) and calculated tables on Direct Lake on OneLake are now in preview, according to the [Direct Lake overview](https://learn.microsoft.com/en-us/fabric/fundamentals/direct-lake-overview). User-context columns are evaluated at query time, so they don't replace a stored column you need for a relationship or a sort key. "I need a calculated column" is a weaker reason to convert than it was, but not a dead one. My rule of thumb still holds: if the logic is a business rule other tools need too, put it in the Lakehouse or Warehouse, where it can be tested and reused. If it's purely semantic, such as display sort keys, banding or a parent-child flattening that only the report needs, an Import table is a perfectly honest place for it.

When *not* to convert: don't move a table to Import just to work around a slow query. Check the Delta layout first, meaning V-Order, file sizes and row group counts. I covered that in [Direct Lake best practices](/blog/2024-01-17-direct-lake-best-practices/). Converting a poorly maintained table hides the problem, and you can't undo the conversion.

## Fallback behaviour is not what it used to be

Many teams still think about Direct Lake in terms of DirectQuery fallback. That depends on which flavour you're running. [How Direct Lake works](https://learn.microsoft.com/en-us/fabric/fundamentals/direct-lake-how-it-works#directquery-fallback) separates the two:

- **Direct Lake on SQL endpoints** can fall back to DirectQuery, for example when a table is based on a SQL view, the source enforces SQL-based security, or a table exceeds the capacity guardrails. The `DirectLakeBehavior` property (Automatic, DirectLakeOnly, DirectQueryOnly) controls this.
- **Direct Lake on OneLake** runs exclusively as DirectLakeOnly. There is no fallback. If a table breaches a guardrail, refresh (framing) fails and queries return an error until the Delta table is brought back under the limit. Nothing silently degrades.

Per-table conversion targets Direct Lake on OneLake models, so the hybrid you build has no silent DirectQuery escape route. I prefer that, because fallback was a performance cliff. Import tables aren't a fallback mechanism either: they're cached data with their own refresh, memory footprint and failure modes. If a fact table is close to your SKU's row guardrails, the answer is a bigger capacity or a better-aggregated table, not quietly converting it to Import and hoping refresh keeps up.

## Refresh orchestration in a mixed model

This is where hybrid models break. Direct Lake tables "refresh" by reframing, which means pointing at the latest Delta version, and that takes seconds. Import tables refresh by running queries, which takes as long as the source and data volume require. Once you mix them, a model can reach a state where the fact table shows today's data and the Import dimension still shows yesterday's. New product keys in the fact table then land on the blank member, totals look wrong, and nobody gets an error.

Three rules I'd apply:

1. **Refresh the tables that belong together in one transactional operation.** Don't schedule the Import dimension at 6:00 and let automatic Direct Lake updates reframe the fact table whenever the Lakehouse changes. Turn off **Keep your Direct Lake data up to date** in the semantic model's Refresh settings for models where consistency matters, and trigger one refresh that covers both when the upstream load finishes.
2. **Remember the Import tables now read through the SQL analytics endpoint.** The endpoint's metadata sync runs asynchronously after Lakehouse writes, so an Import refresh straight after a load can read stale rows. Put the endpoint metadata refresh in your pipeline before the semantic model refresh.
3. **Use the new schema and data split on purpose.** *Refresh data only* is the safe default for scheduled runs. Keep *Sync schema only* for deployment time, when someone has decided the new columns belong in the model.

From a Fabric notebook, semantic link labs can sync the endpoint and semantic link can then refresh named tables as one transaction. Run this after the Lakehouse load finishes:

```python
import time

import sempy.fabric as fabric
import sempy_labs as labs

workspace = "<your-workspace-name>"
lakehouse = "<your-lakehouse-name>"
model = "<your-semantic-model-name>"

# 1. Make the SQL analytics endpoint see the latest Delta versions
labs.refresh_sql_endpoint_metadata(item=lakehouse, type="Lakehouse", workspace=workspace)

# 2. Import dimensions plus the Direct Lake fact they join to, committed together
tables = ["DimProduct", "DimOrganisation", "FactSales"]
request_id = fabric.refresh_dataset(
    dataset=model,
    workspace=workspace,
    refresh_type="full",
    commit_mode="transactional",
    objects=[{"table": t} for t in tables],
)

# 3. Wait for a terminal state so a failed refresh is visible
while True:
    details = fabric.get_refresh_execution_details(model, request_id, workspace=workspace)
    if details.status in ("Completed", "Failed", "Cancelled", "Disabled"):
        break
    time.sleep(30)

print(f"Refresh {request_id}: {details.status}")
if details.status != "Completed":
    print(details.messages)
    raise RuntimeError("Semantic model refresh did not complete")
```

For a Direct Lake table, a full refresh is a reframe. For an Import table, it re-queries the source. Running both in one transactional request means report users see either the old state or the new state, never half of each. The scheduling patterns from [event-driven refresh for materialized lake views](/blog/2026-08-08-materialized-lake-views-event-driven-refresh/) apply here too: refresh after the producer finishes, not on a clock that hopes it has.

## The governance cost

Mixed-mode models are harder to reason about. Be clear on these costs before you approve the first conversion.

**Security identity changes per table.** A Direct Lake on OneLake table is read at query time and can respect OneLake security for the querying user. An Import table holds data that was read with the refresh connection's identity and then cached. Any row filtering that depended on source-side permissions no longer applies to that table. Semantic model RLS has to cover it explicitly, and you need to test that, not assume it.

**Data is copied again.** Every Import table is a second copy of Lakehouse data inside the model, with its own retention and lineage. For anything containing personal data, it's another place to account for in an access review or deletion request.

**Refresh failures come back, and they're invisible to readers.** A pure Direct Lake model has very little refresh to fail. A hybrid has endpoint connection credentials, refresh durations and query timeouts to monitor, and someone has to own those alerts. A report author sees one model, not two tables hours behind the rest, so put the storage mode and refresh expectation in the table description and add a "data as of" measure if the gap matters.

**The decision is permanent.** Since conversion is one-way, treat it like a schema migration. Write down the reason, get a second reviewer and commit it in source control, because the TMDL partition definition changes. With Git integration, check that a converted model deploys cleanly to the next stage before converting in production. I'd also tighten [tenant-level controls](/blog/2026-07-27-fabric-cicd-is-solved-your-tenant-isnt-tenant-as-code/) so web modelling edits on production models aren't something anyone with write access can do on a Friday afternoon.

## Where I'd draw the line

Small dimensions and semantic-only logic never needed to be Direct Lake, so I'm glad the option exists. But it's a preview feature, it's irreversible, and it brings back the refresh and security work that Direct Lake let us drop. My default for a new Fabric model is Direct Lake on OneLake everywhere. I'd convert a table to Import only when I can name the specific benefit, whether that's latency on a hot dimension, logic that belongs in the model or a source outside OneLake, and when someone owns refreshing it consistently with the facts it joins to. If you can't name the benefit and the owner, leave the table in Direct Lake.
