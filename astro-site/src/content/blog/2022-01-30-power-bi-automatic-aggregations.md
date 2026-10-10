---
title: "Power BI Automatic Aggregations (Preview): When to Let the Service Decide"
description: "How Power BI automatic aggregations train on a DirectQuery dataset's query log, what the preview requires, and when hand-built aggregations still win."
author: Michael John Peña
draft: false
date: 2022-01-30
url: /blog/power-bi-automatic-aggregations/
tags:
  - Power BI
  - Performance
  - Data Modeling
  - Analytics
---

Large DirectQuery datasets have a predictable problem. Every visual becomes a query against the warehouse, report pages get slower as more people use them, and the usual fix, hand-built aggregation tables, takes modelling effort that most teams never get around to. Automatic aggregations, in public preview for Power BI Premium since late 2021, offer to build that layer for you from what users actually query. The promise is real, but the trade-off it hides is freshness, and that is the reason most teams chose DirectQuery in the first place.

## What the feature actually does

Microsoft's [preview announcement](https://powerbi.microsoft.com/en-us/blog/announcing-public-preview-of-automatic-aggregations/) describes it as an AI-driven system that analyses query logs and creates and manages aggregations automatically. Under the hood there are four steps:

1. **The service records queries.** For each dataset with the feature enabled, Power BI keeps a rolling query log of about seven days of report queries. You can't see this log, and you can't reach it through the XMLA endpoint.
2. **Training reads the log.** On the first scheduled refresh in each training period (daily or weekly, your choice), Power BI runs a training operation. It looks at which groupings and summaries users requested and decides which aggregations would answer the most queries for the memory they'd use.
3. **Refresh loads the aggregations.** The chosen aggregations become system-managed, in-memory tables in the dataset. Later refreshes in the same period reload them without retraining.
4. **The engine routes queries.** When a visual's query can be answered from an aggregation, it is served from memory. Anything more detailed still goes to the source through DirectQuery.

Report authors don't see the aggregation tables and don't change their measures. That's the same transparency you get with [user-defined aggregations](https://learn.microsoft.com/en-us/power-bi/transform-model/aggregations-advanced), with one difference: you aren't choosing the grain.

One point gets lost in the "AI-powered" marketing. Nothing is predicting future queries in a clever way. Training is an optimisation over *past* queries. If last week's usage is a good guide to next week's, it works well. If your usage is seasonal, ad hoc, or concentrated around month-end, the model will optimise for whichever period happened to be in the log.

## Requirements during the preview

Before you plan a pilot, check these constraints:

| Requirement | What it means |
|---|---|
| Licensing | Premium capacity or Premium Per User. Not available on Pro or shared capacity. |
| Storage mode | Only DirectQuery tables benefit. In a composite model, imported tables are left alone. |
| Data source | A limited set of DirectQuery sources. The launch material highlighted Azure Synapse Analytics, Snowflake and Google BigQuery. Check the [supported sources list](https://learn.microsoft.com/en-us/power-bi/enterprise/aggregations-auto) before you commit. |
| Refresh | Required. Training runs as part of a scheduled refresh (or a refresh you trigger over the XMLA endpoint), so a DirectQuery dataset that is never refreshed never gets aggregations. |
| Query history | Training needs queries in the log. A newly published dataset that nobody has used has nothing to train on. |

The refresh requirement catches people out. DirectQuery-only datasets often have no refresh schedule because "there's nothing to refresh". With automatic aggregations, there is: the aggregation cache is import-mode data and needs to be loaded.

## Turning it on

You configure the feature in the Power BI service, not in Desktop. On the dataset's **Settings** page, the automatic aggregations section lets you:

- switch training on,
- choose the training frequency (**Day** or **Week**), and
- set **query coverage**, the share of logged queries that training tries to serve from aggregations.

If you're rolling this out across many datasets, you don't have to click through each one: for Premium and PPU datasets, the same settings and the training operation can be scripted over the XMLA endpoint with the Tabular Object Model, as the [automatic aggregations documentation](https://learn.microsoft.com/en-us/power-bi/enterprise/aggregations-auto) describes.

Query coverage is the setting to think about. Higher coverage means more queries can be answered from memory, but it also means more and larger aggregation tables, more capacity memory, and longer training and refresh. Lower coverage keeps the cache small and focused on the most common summary queries. I'd start at the default, check the effect on report performance and dataset size after a training cycle, and only then adjust. Raising coverage to the maximum on the first day just makes refreshes longer without telling you whether it helped.

Training also has a time limit, which Microsoft documents as one hour. On a slow source or a busy log, training may not finish in one refresh, so the first few days of a pilot may look less impressive than steady state.

## Trade-offs to understand first

### Freshness

This is the one I'd raise in any design review. The reason most teams choose DirectQuery is data freshness. An aggregation answers a query from data as of the last refresh. If a summary visual is served from the cache, it shows data as of the last refresh, even though the dataset is "live". Visuals that drop below the aggregation grain still query the source and show current data, so totals and details can disagree for a while after the source changes.

If your users genuinely need current totals, such as an operational dashboard watching today's orders, automatic aggregations work against that requirement. If "live" really means "doesn't need a large import refresh", and day-old summaries are fine, the trade-off is acceptable.

### Capacity memory and refresh load

The aggregations live in memory on your Premium capacity and count towards the dataset's size. Training and refresh also send queries to the source. On a shared P1 that's already busy, you are moving load from report time to refresh time. That's usually a good trade, but it isn't free, so watch the [Premium Capacity Metrics app](https://learn.microsoft.com/en-us/power-bi/enterprise/service-premium-metrics-app) during the pilot.

### Control and explainability

With user-defined aggregations, you choose the grain, see the table, and can explain why a query did or didn't hit it. With automatic aggregations, the service decides, and the decisions can change at the next training cycle. A report that was fast last week can slow down this week because usage patterns changed. For a team that has to explain performance to stakeholders, that matters.

## Automatic vs user-defined aggregations

| | Automatic (preview) | User-defined |
|---|---|---|
| Who chooses the grain | Training on the query log | You, in Manage aggregations |
| Setup effort | Settings toggle plus a refresh schedule | Design, build and map an aggregation table |
| Adapts to usage | Yes, each training cycle | Only when you change it |
| Predictability | Can change between cycles | Stable until you change the model |
| Licensing | Premium or PPU | Any licence that supports composite models |
| Release status (January 2022) | Public preview | Generally available |

Can one dataset have both? I wouldn't design for it during the preview. Keep them apart: use user-defined aggregations for the handful of summaries you know matter, such as the executive page and the monthly trend by category. I cover how to build those in [Power BI Composite Models: Choosing Import, DirectQuery or Dual](/blog/2022-01-27-power-bi-composite-models/). Treat automatic aggregations as a separate experiment, on a different dataset, for the long tail of slicing you can't predict. That way, when performance changes, you know which mechanism caused it.

## How to tell whether it's working

Don't judge it by how the reports feel. Check it with tools:

- **Performance Analyzer in Desktop** won't show the service's automatic aggregations, but it gives you a baseline of DirectQuery durations per visual before you start.
- **SQL Server Profiler or DAX Studio over the XMLA endpoint** let you trace queries against the published dataset. The *Aggregate Table Rewrite Query* event shows whether a query matched an aggregation and, if it didn't, why.
- **The source system's query history**, such as Synapse's request DMVs or Snowflake's query history, is the simplest check of all. If summary queries from the Power BI gateway or service drop after a training cycle, the cache is answering them.

Compare a full week before and after. With weekly training, one cycle takes a full week, and usage varies by day, so one day of measurement tells you very little.

## When not to use it

- **Your data fits in Import.** Import with incremental refresh is still faster and simpler than any DirectQuery optimisation. Automatic aggregations are for models that have outgrown it.
- **You need real-time totals.** As explained above, cached summaries undermine the reason you chose DirectQuery.
- **Usage is sparse or irregular.** A dataset queried a few times a month doesn't generate a log worth training on.
- **The model is production-critical and must behave predictably.** Preview features can change, and this one rewrites query paths. I'd pilot it on a dataset where a slow week is an inconvenience, not an incident.
- **You're not on Premium or PPU.** It isn't available, and it's not a reason to buy Premium by itself.

## My take

Automatic aggregations are the right idea: most organisations with large DirectQuery models never build aggregations because it takes modelling time, and this removes that barrier. But in January 2022 it's a preview with a narrow set of supported sources, a mandatory refresh schedule that many DirectQuery datasets don't have, and a freshness trade-off that has to be explained to business owners.

If you run a large DirectQuery dataset on Premium with steady, repeated usage and no aggregations at all, turn it on for one dataset, add a refresh schedule, and measure for two weeks. If you already have hand-built aggregations that work, keep them and watch the feature move towards general availability. For where it sits among the other Power BI features I'd adopt now or later, see [Power BI in Early 2022: What's GA, What's Preview, What to Adopt](/blog/2022-01-26-power-bi-2022-features/).
