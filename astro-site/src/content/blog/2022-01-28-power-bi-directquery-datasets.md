---
title: "DirectQuery for Power BI Datasets: Extending a Certified Model"
description: "How DirectQuery for Power BI datasets lets teams extend a certified model with their own data, what the preview limits are, and when not to chain."
author: Michael John Peña
draft: false
date: 2022-01-28
url: /blog/power-bi-directquery-datasets/
tags:
  - Power BI
  - Data Modeling
  - Governance
  - Analytics
---

Every organisation that invests in a certified enterprise dataset eventually hits the same request: "Can I just add our targets to the sales model?" Until recently the only answers were to get the change into the central model's backlog, or to let the analyst export the data and rebuild their own copy of the model, which is how you end up with five versions of revenue. DirectQuery for Power BI datasets and Azure Analysis Services gives a third option: connect to the published model, keep it as the source of truth, and layer local tables and measures on top. It's useful, it's still in preview, and the governance questions it raises matter more than the clicks.

## What the feature is, and where it stands in January 2022

Microsoft announced [DirectQuery for Power BI datasets and Azure Analysis Services](https://powerbi.microsoft.com/en-us/blog/directquery-for-power-bi-datasets-and-azure-analysis-services-preview/) as a preview in the December 2020 release of Power BI Desktop. It extends [composite models](/blog/2022-01-27-power-bi-composite-models/): a published dataset or an Azure Analysis Services model becomes just another DirectQuery source, alongside Import tables and other DirectQuery sources.

As of this post it is **still in public preview**. To use it you need:

- The preview switched on in Power BI Desktop under **File > Options and settings > Options > Preview features**.
- The tenant setting **Allow XMLA endpoints and Analyze in Excel with on-premises datasets** enabled by your Power BI admin. This is the same setting that governs Analyze in Excel. It's on by default, so check it hasn't been switched off.
- Build permission on the source dataset (viewers of the resulting reports also need Read on it). A Pro licence is enough; you don't need Premium or Premium Per User for the basic scenario.

The workflow starts from a normal live connection. Connect to a published dataset from **Get Data > Power BI datasets** (or to an Azure Analysis Services model), and Desktop shows the usual live-connected report. Choose **Make changes to this model** and Desktop converts the live connection into a local model in which every remote table is a DirectQuery table. From there you can add Import tables, other DirectQuery sources, relationships and measures. SQL Server Analysis Services isn't supported; on-premises tabular models remain live connection only.

## Why this is different from a live connection

A live connection report has no model of its own. You can write report-level measures, but you can't add a table, so any extra data means going back to the model owner. A composite model on a dataset is a real dataset with its own refresh schedule, its own permissions, and its own place in lineage. That's the point, and it's also the risk: you've created a second dataset whose correctness depends on someone else's.

The chain looks like this:

| Layer | Owner | Contains | Refreshes |
|---|---|---|---|
| Enterprise dataset (certified) | Central BI team | Facts, conformed dimensions, core measures, RLS | Its own schedule |
| Department composite model | Department analyst | DirectQuery to the enterprise dataset, plus local Import tables and measures | Local Import tables only |
| Reports | Department analyst | Visuals | n/a |

The remote tables are never copied. When a visual runs, the local model sends DAX queries to the remote dataset, which answers from its own storage, and the local engine combines the result with anything imported locally. That's why the enterprise team can change a measure definition and every downstream composite model sees it immediately, for better or worse.

## Extending the model with local measures

The use I'd prioritise is adding measures that only matter to one team, without polluting the enterprise model. Measures in the local model can reference remote measures and columns as if they were local. Assume the enterprise dataset exposes `[Total Sales]` and a marked date table called `Dates`, and the marketing team has imported a `Campaigns` table from SharePoint with one row per campaign and a `Cost` column:

```dax
-- Three separate measures; create each with New measure in the composite model

Campaign Cost = SUM ( Campaigns[Cost] )

Sales Growth YoY =
VAR CurrentSales = [Total Sales]
VAR PriorSales =
    CALCULATE ( [Total Sales], SAMEPERIODLASTYEAR ( Dates[Date] ) )
RETURN
    DIVIDE ( CurrentSales - PriorSales, PriorSales )

Campaign ROI =
VAR Revenue = [Total Sales]
VAR Cost = [Campaign Cost]
RETURN
    DIVIDE ( Revenue - Cost, Cost )
```

`Sales Growth YoY` is the easy case: it only touches remote objects, so the time intelligence runs against the enterprise `Dates` table and the local model just wraps it. `Campaign ROI` only makes sense if `Campaigns` is related to the remote `Sales` table, for example on a `CampaignID` column that the enterprise model already carries. That relationship crosses from an Import table to a DirectQuery source, so it's a *limited* relationship: the engine can't join inside one query and instead sends the filter values from the local table into the DAX it generates for the remote model. With a few hundred campaigns that's fine. With a local table of a million customer IDs, every visual sends a very large filter to the remote dataset, and performance falls off sharply.

My rule: **local tables in a composite model on a dataset should be small and low-cardinality.** Budgets, targets, campaign lists, mapping tables. If the team needs to bring in something large, it probably belongs in the enterprise model.

## Security: what flows through and what doesn't

This is the part I'd want every author to get exactly right, so it's worth being precise.

- **Row-level security on the remote dataset is enforced.** The composite model queries the remote dataset as the current user, so the enterprise dataset's RLS roles apply to the remote tables. The department can't widen what a user sees.
- **RLS defined in the composite model doesn't apply to remote tables.** You can define roles for the local Import tables, but those roles are only enforced on the local data, not pushed to the remote dataset. If you need to restrict enterprise data further, that's a change to the enterprise model.
- **Every user needs access to every dataset in the chain.** Sharing a report built on the composite model isn't enough; viewers also need at least Read permission on the source dataset. Expect "the visuals show errors for some users" tickets if you forget.
- **The source dataset sees the viewer, not the composite model.** Because queries run as the current user, the enterprise dataset's logs record the person viewing the department report, not a model or service identity.
- **Data can move between sources.** When a query combines sources, values from one can be sent to another inside a query. Desktop shows a security warning when you add a second source for this reason. For a certified dataset and a local spreadsheet in the same tenant that's usually acceptable; for a dataset combined with an external database, read the warning properly.

The [documentation for the feature](https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-directquery-datasets-azure-analysis-services) covers these considerations and the current limitations list, which changes from release to release while it's in preview.

## Preview limits worth planning around

A few constraints shape the architecture, not just the report. The [considerations and limitations list](https://learn.microsoft.com/en-us/power-bi/connect-data/desktop-directquery-datasets-azure-analysis-services#considerations-and-limitations) is the authority here, and it changes between releases:

- **Chain length is capped at three.** That's the source dataset, a composite model on it, and one more composite model on top of that. In my view one hop off the certified dataset is the sensible design; the second hop, the maximum allowed, is where the sprawl comes back.
- **Some modelling isn't available on remote tables.** You can add measures, and you can add calculated columns to local Import tables, but don't plan on reshaping remote tables in Power Query or adding calculated columns to them. If the logic needs to be row-level on enterprise data, it belongs upstream.
- **Power BI Embedded is excluded.** The limitations list at the time of writing excludes Power BI Embedded for datasets that use this feature, so don't plan customer-facing embedded analytics on it yet.
- **Preview means behaviour can change.** Features, limits and performance characteristics have shifted across the 2021 Desktop releases. The Microsoft Store build auto-updates, so standardise on the downloadable (MSI) Desktop build so you control when it updates, and retest after each monthly release.

## Governing the chain

The technical feature is the easy part. The organisational part decides whether this reduces sprawl or adds another layer of it.

**Only chain off endorsed datasets.** Use [promotion and certification](https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-endorse-content) to make it obvious which datasets are fit to build on. A composite model built on an uncertified department dataset just moves the problem.

**Treat the enterprise model's measures and column names as a contract.** Renaming `[Total Sales]` or removing a column breaks every downstream composite model without a warning at publish time. Before publishing a breaking change, open the [lineage view](https://learn.microsoft.com/en-us/power-bi/collaborate-share/service-data-lineage) on the enterprise dataset to see which downstream datasets and reports depend on it, and tell those owners.

**Watch the query load on the source.** Every visual in every downstream report now queries the enterprise dataset. If the enterprise dataset sits on Premium and you've enabled the [Azure Log Analytics integration](https://learn.microsoft.com/en-us/power-bi/transform-model/log-analytics/desktop-log-analytics-overview) (itself in preview), query events land in the `PowerBIDatasetsWorkspace` table and you can see who is driving load:

```kusto
PowerBIDatasetsWorkspace
| where TimeGenerated > ago(7d)
| where OperationName == "QueryEnd"
| where ArtifactName == "<your-enterprise-dataset>"
| summarize
    Queries = count(),
    AvgDurationMs = avg(DurationMs),
    P95DurationMs = percentile(DurationMs, 95)
    by ExecutingUser, bin(TimeGenerated, 1d)
| order by Queries desc
```

`ExecutingUser` is the person viewing the report, not the composite model, so you identify a department's load by its report users. A spike in long queries from that group after a department composite model goes live is a strong hint that a large local table is pushing big filters through a limited relationship.

**Harvest the extensions.** Local measures and tables are a free backlog for the central model. If three departments have each imported the same target table, that table belongs in the certified dataset.

## When not to use it

- **When the extension is really a missing piece of the enterprise model.** If the request is reusable across teams, fix it upstream. A composite model is the right home for data only one team cares about.
- **When the local data is large or high-cardinality.** Limited relationships across sources don't scale to big filter lists.
- **When the report is business-critical.** I wouldn't put a board pack or a regulatory report on a preview feature with a changing limitations list. Pilot it with a handful of analysts first, as I suggested in [my January 2022 status check on Power BI](/blog/2022-01-26-power-bi-2022-features/).
- **When an Import copy is simpler.** For a small, stable dataset, a team-owned Import model may be easier to support than a chain that depends on two refresh schedules and two owners.

## The short version

DirectQuery for Power BI datasets answers the oldest self-service request in enterprise BI without copying the model, and that alone makes it worth piloting now. Keep it to one hop off a certified dataset, keep local tables small, rely on the enterprise model's RLS rather than local roles, and give the central team visibility through lineage and query logs. Hold back on anything critical until it reaches general availability. For choosing storage modes in the rest of a composite model, see [Power BI Composite Models](/blog/2022-01-27-power-bi-composite-models/).
