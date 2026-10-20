---
title: "GPU-Accelerated Fabric Warehouse: How to Read the 7x Claim"
description: "Fabric Data Warehouse GPU query acceleration is in preview. Why the 7x benchmark won't predict your bill, and how to run a fair A/B test on your own queries."
author: Michael John Peña
draft: false
date: 2026-09-11
tags:
  - Microsoft Fabric
  - Data Warehouse
  - GPU
  - Performance
  - Cost Optimization
---

Microsoft says GPU-accelerated Fabric Data Warehouse is up to 7x faster, and turning it on, once your tenant is approved for the limited preview, is a single workspace toggle. Both statements are true, and neither tells you whether your workload will be faster or what it will cost per query. The feature is listed as a preview in the [Fabric August 2026 feature summary](https://community.fabric.microsoft.com/blog/fbc_fabricupdatesblogs/fabric-august-2026-feature-summary/5325824), and it's billed on its own meter at a much higher CU rate. So the decision to enable it should come from your query history and your Capacity Metrics app, not from a launch slide.

## What was actually announced

The engine behind this is CoddSpeed. It's described in a [SIGMOD 2026 industrial track paper from Microsoft Research](https://www.microsoft.com/en-us/research/publication/coddspeed-hardware-accelerated-query-processing-in-microsoft-fabric/) as a GPU-based execution engine derived from the team's Tensor Query Processor (TQP) research. Microsoft announced it for Fabric Data Warehouse at Build in June 2026 as an [early access preview](https://community.fabric.microsoft.com/t5/Fabric-Updates-Blog/A-new-analytics-frontier-GPU-accelerated-Fabric-Data-Warehouse/ba-p/5191598). As of this writing, the [query acceleration documentation](https://learn.microsoft.com/en-us/fabric/data-warehouse/query-acceleration) describes it like this:

- **Limited preview.** You request access through a registration form, Microsoft onboards tenants first come, first served, and you get an email once your tenant is enabled.
- **Workspace-level toggle.** It lives under Workspace settings > Fabric Warehouse > Query Acceleration, and it applies to every warehouse and SQL analytics endpoint in that workspace.
- **Toggling cancels running queries.** Turning it on *or* off cancels anything currently running in the workspace, so don't flip it mid-morning during month-end reporting.
- **Selective offload.** The optimiser picks the eligible parts of a plan (scans, joins and aggregations, per the docs) and runs them on a GPU co-processor alongside the CPUs on the same compute node. Anything that isn't eligible runs on CPU as usual. No query rewrites, no schema changes.
- **Region-limited.** The capacity has to be in one of a short list of supported regions, currently three US regions (East US, East US 2, South Central US) plus Southeast Asia and Germany West Central. There's nothing in Australia yet, which matters for anyone with data residency obligations.

## Three numbers, three different questions

Most confusion about "7x" comes from treating three benchmarks as if they answered one question.

| Claim | Compared against | What it answers |
|---|---|---|
| Up to 30x on TPC-H 1TB (research paper) | Fabric's own CPU engine | How fast can the engine go on a well-known benchmark? |
| Up to 7x (Build announcement) | Unnamed cloud warehouses, at high concurrency | Is Fabric competitive with other vendors? |
| Your number | Your workspace, toggle off vs on | Is it worth the CU rate for *my* queries? |

The 7x is a competitive claim. Microsoft measured it against cloud warehouses it doesn't name, and Microsoft's own wording is "up to 7x faster performance at high concurrency". I haven't seen it independently reproduced, and it doesn't answer the question you actually face. You've already chosen Fabric. What you need to know is whether accelerated Fabric beats non-accelerated Fabric on your queries, and by enough to pay for itself.

The 30x from the paper is closer to that question, because it compares GPU against CPU on the same platform. But TPC-H is a clean star-ish schema with well-behaved predicates. If your warehouse has wide text keys and views stacked four deep, TPC-H is not a proxy for it.

## The billing detail that changes the maths

Read this before you request access. The [Fabric operations page](https://learn.microsoft.com/en-us/fabric/enterprise/fabric-operations) lists the conversion rates:

- One Fabric Data Warehouse core = **0.538 CUs**
- One Fabric Data Warehouse core with query acceleration enabled = **3.446 CUs**

That's roughly 6.4 times the CU rate per core. Accelerated work shows up as separate operations, such as *Warehouse Query (Accelerated)* and *SQL Endpoint Query (Accelerated)*, so you can see it in the Capacity Metrics app.

More important, the docs say that once the toggle is on, **all** queries in the workspace are billed through the acceleration meter, including ones that weren't eligible and ran entirely on CPU. That meter also covers user-generated and system-generated T-SQL, not just your dashboard `SELECT`s. So a workspace that mixes heavy ingestion, `INSERT ... SELECT` transforms and interactive reporting will pay the higher rate on all of it, even though the docs are explicit that write operations don't benefit.

I don't know how accelerated core time compares to CPU core time for any given query, and the documentation doesn't promise a ratio. That's exactly why you test. A query that finishes 7x faster but burns similar core time at 6.4x the rate is a latency win and a cost loss. My planning notes in [Fabric Capacity Planning: Lessons from Production](/blog/2026-01-20-fabric-capacity-planning/) still apply: capacity is a budget, and this toggle changes the exchange rate.

## Which workloads are likely to benefit

The documentation is fairly candid about where the gains come from:

- **Large scans and joins.** Queries that process a lot of data, typically up to around 1 TB per the docs, with heavy joins and aggregations over large inputs.
- **High concurrency.** Many users, apps or agents hitting the warehouse at once. This is where Microsoft's own numbers look best, and it fits the design. A GPU co-processor adds throughput when the CPUs would otherwise queue.
- **Read-heavy analytics.** Dashboards running in DirectQuery against the warehouse, embedded analytics, and agents generating SQL.

It's less likely to help in these cases:

- **Small, selective lookups.** A query that reads a few thousand rows gives the GPU little to do.
- **ETL and DML.** Writes don't benefit, yet they're still billed on the higher meter if they run in the same workspace.
- **Direct Lake models that rarely fall back.** Direct Lake reads Delta directly into the semantic model's engine, so the warehouse SQL engine is only involved when queries fall back to DirectQuery. If you've tuned your models to avoid fallback (see [Converting Direct Lake Tables to Import](/blog/2026-09-01-direct-lake-tables-to-import-hybrid-models/) for the storage-mode trade-offs), the toggle has little to accelerate. For Direct Lake on OneLake models there's no DirectQuery fallback at all, so acceleration has nothing to do; for Direct Lake on SQL endpoints it only matters when queries fall back.

There are also two eligibility gotchas called out in the docs. Support for `nvarchar` is limited, and so is support for case-insensitive collations. Fabric Warehouse defaults to a case-sensitive collation, so most native warehouses are fine there. But check any warehouse created with a case-insensitive collation, and check client code that sends `nvarchar` parameters or `N'...'` literals. Many drivers do this by default for strings. The docs suggest `varchar(8000)` instead of `nvarchar` where you can.

## Hardware won't fix your model

A GPU makes a bad query fail faster, not succeed. If the fact table sits at transaction grain when every visual needs daily grain, the GPU scans those billions of rows quicker, and you pay the accelerated rate every time. If a many-to-many join fans out rows, acceleration returns the wrong number sooner.

Pick the right grain, pre-aggregate what every report asks for, and stop joining on wide text. I made the same argument in [choosing model grain before performance tuning](/blog/2026-03-06-fabric-warehouse-tradeoffs-choosing-model-grain-before-performance-tuning/). My rule of thumb: fix the model first, *then* measure acceleration on the cleaned-up workload.

## Running a fair A/B test

Because the toggle is per workspace and cancels running queries, you have two practical designs.

1. **Same workspace, alternating windows.** Run the workload with the toggle off, switch it on in a quiet period, and run it again. Same data and same items, but cache state and background load differ between windows.
2. **Twin workspaces on the same capacity.** Expose the same data to two workspaces, one accelerated, through the same item type on both sides. For example, a SQL analytics endpoint over the same OneLake shortcuts in each workspace, so the only variable is the toggle. Comparing a native warehouse on one side with a shortcut-backed endpoint on the other isn't like-for-like.

Either way, the accelerated side needs a capacity in a supported region. Put the baseline and a copy of the data in that same region too; a shortcut that reads across regions adds latency and egress and makes the comparison meaningless. Then apply a few rules:

- **Use your real query mix.** Pull the top queries by frequency and by total elapsed time from `queryinsights.frequently_run_queries` and `queryinsights.long_running_queries`. Don't hand-pick the slowest three.
- **Label every test query** with `OPTION (LABEL = ...)` so you can find each run in query insights.
- **Warm the caches on both sides first.** Fabric Warehouse caches data in memory and on local SSD, and you can't clear it manually. Discard the first run of each query on each side.
- **Disable result set caching per query.** It's currently disabled service-wide due to a known issue. The hint costs nothing, though, and keeps the test honest if it comes back on mid-test.
- **Test concurrency, not just single runs.** If Microsoft's best numbers are at high concurrency, run your workload at the concurrency you actually see at 9 am on a Monday.

A test query looks like this:

```sql
-- Fragment: one of the workload queries, tagged for the A/B run.
SELECT d.CalendarMonth, p.Category, SUM(f.SalesAmount) AS SalesAmount
FROM dbo.FactSales AS f
JOIN dbo.DimDate AS d ON f.DateKey = d.DateKey
JOIN dbo.DimProduct AS p ON f.ProductKey = p.ProductKey
WHERE d.CalendarYear = 2026
GROUP BY d.CalendarMonth, p.Category
OPTION (LABEL = 'ab-test:q07', USE HINT ('DISABLE_RESULT_SET_CACHE'));
```

Then compare the runs in `queryinsights.exec_requests_history` in each warehouse. The `is_accelerated` column tells you whether acceleration actually applied, and that matters, because "toggle on" doesn't mean "GPU used". To see which part of a plan ran accelerated, the actual execution plan in SSMS or the VS Code MSSQL extension shows a Query Acceleration operator, and the Monitor > Query history page has a Query Acceleration column:

```sql
-- Run in each warehouse after the test; completed queries can take up to 15 minutes to appear.
SELECT
    label,
    is_accelerated,
    COUNT(*)                              AS runs,
    AVG(CAST(total_elapsed_time_ms AS bigint)) AS avg_elapsed_ms,
    MAX(total_elapsed_time_ms)            AS max_elapsed_ms,
    AVG(allocated_cpu_time_ms)            AS avg_allocated_cpu_ms -- CPU allocation only; not GPU time and not billed CU
FROM queryinsights.exec_requests_history
WHERE label LIKE 'ab-test:%'
  AND status = 'Succeeded'
  AND submit_time >= DATEADD(day, -1, SYSUTCDATETIME())
GROUP BY label, is_accelerated
ORDER BY label, is_accelerated;
```

Query insights tells you about latency and eligibility. It doesn't tell you about cost, so pair it with the Capacity Metrics app. Filter to the test window and compare CU seconds for the regular warehouse operations against the *(Accelerated)* ones. The number you're after is cost per workload run at your real concurrency, alongside p50 and p95 latency. If a query never shows `is_accelerated = 1`, look for `nvarchar` and collation issues before you conclude the feature doesn't help.

## What I'd do with the result

Treat it as a placement decision, not a tenant-wide switch. If a high-concurrency, read-heavy reporting workload gets materially faster and the CU cost per run is acceptable, isolate it in its own accelerated workspace and keep ingestion and transformation work in a non-accelerated one, so writes don't pay the premium rate. If the gains only show up on queries that a better grain or a summary table would fix, fix those instead. If your capacity must stay in an unsupported region, test in a supported one anyway, so your numbers are ready when it arrives.

The 7x is Microsoft's number, from Microsoft's benchmark. The only number that should change your architecture is the one from your own query history.
