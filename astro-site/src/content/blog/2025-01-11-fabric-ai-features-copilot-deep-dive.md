---
title: "Reviewing Copilot Output in Fabric: A Workload-by-Workload Guide"
description: "Where Copilot in Microsoft Fabric stands in January 2025, what each workload's Copilot gets wrong, and how to review its output before it ships."
author: Michael John Peña
draft: false
date: 2025-01-11
tags:
  - Microsoft Fabric
  - Copilot
  - Power BI
  - Data Engineering
  - AI
---

Copilot in Microsoft Fabric now reaches most workloads, but the experiences are at different stages and fail in different ways. Teams that treat "Copilot generated it" as a quality signal end up shipping T-SQL with the wrong dialect, DAX measures that return text, and KQL that looks like anomaly detection but isn't. The useful question is no longer "should we turn Copilot on?" but "what does a reviewer need to check in each workload before Copilot's output reaches production?"

This post is that review guide, as things stand in January 2025. If you want the feature walkthroughs, I covered [Copilot for notebooks](/blog/2024-06-09-copilot-notebooks-fabric/) and [Copilot for SQL in the warehouse](/blog/2024-06-10-copilot-sql-fabric/) separately last year.

## Where each Copilot experience stands

At Build 2024 Microsoft announced that "Copilot in Microsoft Fabric is now generally available in the Power BI experience" (covered in the [Fabric May 2024 update](https://blog.fabric.microsoft.com/en-us/blog/microsoft-fabric-may-2024-update/)). That headline was easy to over-read. Only part of the Power BI experience went GA then, and several other experiences are still previews. Here's my summary of the status as of this month:

| Workload | What Copilot does | Status (Jan 2025) |
|---|---|---|
| Power BI | Report page creation, summaries, DAX help in DAX query view | Mixed: core report experience GA, several features in preview |
| Data Factory: Dataflow Gen2 | Natural-language transformations that generate Power Query steps | GA since September 2024 |
| Data Factory: data pipelines | Summarise a pipeline, explain failed activities, help build pipelines | [Preview](https://learn.microsoft.com/en-us/fabric/fundamentals/copilot-fabric-data-factory) (announced at Ignite, November 2024) |
| Data Engineering / Data Science | Chat pane and chat-magics (`%%chat`, `%%code`) in notebooks | Preview |
| Data Warehouse | Chat pane (natural language to T-SQL), inline code completions, Fix and Explain quick actions | [Preview](https://blog.fabric.microsoft.com/en-us/blog/announcing-the-public-preview-of-copilot-for-data-warehouse-in-microsoft-fabric/) (since Build 2024) |
| SQL database | Chat pane, code completion, Fix and Explain quick actions | Preview (since Ignite, November 2024) |
| Real-Time Intelligence | Natural language to KQL in a KQL queryset | GA (since Ignite, November 2024) |
| AI skill | Conversational Q&A over a lakehouse or warehouse that you configure | Preview |

The [Copilot for Data Factory GA announcement](https://blog.fabric.microsoft.com/en-us/blog/announcing-the-general-availability-of-copilot-for-data-factory-in-microsoft-fabric) (September 2024) covers Dataflow Gen2 only. That distinction matters for anyone writing an internal support policy. I'd only let GA experiences into a production change process without extra sign-off, and I'd label everything else as "assistive, unsupported" in team guidance.

## What you need before any of this works

Three prerequisites catch people out:

- **Capacity.** Copilot requires a paid F64 or higher Fabric capacity, or a P1 or higher Power BI Premium capacity. Trial capacities aren't supported. An F2 dev workspace won't show Copilot at all.
- **Tenant settings.** An admin has to allow Copilot in the [Copilot tenant settings](https://learn.microsoft.com/en-us/fabric/admin/service-admin-portal-copilot). For us in Sydney, there's also the cross-geo processing setting. If your capacity sits outside the US or the EU Data Boundary, Copilot is off unless the admin allows data to be processed outside your capacity's geographic region. That decision belongs to your privacy and data residency owners, not the platform team.
- **Budget.** Copilot isn't free once you have the capacity. It consumes capacity units as a background operation at [200 CU seconds per 1,000 input tokens and 600 CU seconds per 1,000 output tokens](https://learn.microsoft.com/en-us/fabric/fundamentals/copilot-fabric-consumption) (rates halved in November 2024). Those rates have changed more than once, so check the current page before you build a cost model on them. Background smoothing spreads that load over 24 hours, so a single prompt won't throttle you. But a team of analysts chatting with Copilot all day is a real, measurable load. Watch it in the Capacity Metrics app before you roll Copilot out widely.

## Data Engineering: right shape, wrong assumptions

Notebook Copilot is good at the shape of PySpark code: window functions, joins and Delta writes. Where it goes wrong is the assumptions it makes about your data, because it sees schemas and notebook state, not your business rules. Take the most common request, "deduplicate customers keeping the latest record". A reviewer should check three things that a generated answer often skips:

1. **Ties.** If two rows share the latest `updated_at`, `row_number()` keeps one of them arbitrarily, and which one can change between runs.
2. **Nulls in the ordering column.** With descending order, nulls sort last in Spark. That's usually what you want, but you should confirm it, not assume it.
3. **Write mode.** `overwrite` on a silver table can be fine for a full reload and a disaster for an incremental feed.

A reviewed version makes those decisions explicit:

```python
from pyspark.sql import functions as F
from pyspark.sql.window import Window

# Bronze/landing data: raw customer extracts, possibly with duplicates.
df = (
    spark.read.parquet("Files/landing/customers/")
    # Source file as a tie-breaker. This assumes extract files are named so
    # that later extracts sort higher (e.g. customers_20250110.parquet).
    # If your feed has a real ingestion id or load timestamp, use that instead.
    .withColumn("source_file", F.input_file_name())
)

# Deterministic tie-break: latest updated_at, then latest extract file.
latest_first = Window.partitionBy("customer_id").orderBy(
    F.col("updated_at").desc_nulls_last(),
    F.col("source_file").desc(),
)

deduped = (
    df.withColumn("rn", F.row_number().over(latest_first))
      .filter(F.col("rn") == 1)
      .drop("rn")
)

# Full reload of a small dimension, so overwrite is intentional here.
deduped.write.mode("overwrite").format("delta").saveAsTable("silver_customers")
```

My rule: when Copilot writes a window function, the reviewer's first question is "what happens on a tie?"

## Data Warehouse: check the dialect

Fabric Warehouse speaks T-SQL. General-purpose models have seen a lot of PostgreSQL and Snowflake SQL, so output that uses `LIMIT`, `DATE_TRUNC('month', ...)` or `INTERVAL '1 month'` is a giveaway that you're looking at the wrong dialect. The warehouse Copilot is grounded on your warehouse schema, which helps. But snippets that people paste from general chat tools into the query editor are where I see this most. The **Fix** quick action catches some of these errors. A reviewer who knows T-SQL catches them faster.

Here's a "top 10 products by revenue with month-over-month growth" query written properly for the Fabric Warehouse:

```sql
WITH monthly AS (
    SELECT
        p.product_name,
        DATEFROMPARTS(YEAR(f.order_date), MONTH(f.order_date), 1) AS month_start,
        SUM(f.quantity * f.unit_price) AS revenue
    FROM dbo.fact_sales AS f
    JOIN dbo.dim_product AS p ON f.product_id = p.product_id
    GROUP BY p.product_name, DATEFROMPARTS(YEAR(f.order_date), MONTH(f.order_date), 1)
),
with_growth AS (
    SELECT
        product_name,
        month_start,
        revenue,
        LAG(revenue) OVER (PARTITION BY product_name ORDER BY month_start) AS prev_revenue
    FROM monthly
)
SELECT TOP (10)
    product_name,
    revenue,
    prev_revenue,
    CAST(100.0 * (revenue - prev_revenue) / NULLIF(prev_revenue, 0) AS decimal(9, 2)) AS mom_growth_pct
FROM with_growth
WHERE month_start = DATEFROMPARTS(YEAR(DATEADD(MONTH, -1, GETDATE())), MONTH(DATEADD(MONTH, -1, GETDATE())), 1)
ORDER BY revenue DESC;
```

Also be sceptical of performance advice. A suggestion to "rewrite `EXISTS` as an `INNER JOIN` for speed" isn't automatically right. The two aren't equivalent when the join can produce duplicate rows, and the optimiser often treats them the same anyway. And index recommendations don't apply here: Fabric Warehouse doesn't let you create the nonclustered indexes that SQL Server habits suggest.

## Power BI: measures should return numbers

Copilot in Power BI is the most mature experience, and for report pages and narrative summaries it's genuinely useful. In DAX, the classic mistake (from Copilot and from people) is formatting inside the measure:

```dax
YoY Sales % =
VAR CurrentSales = [Total Sales]
VAR PriorSales =
    CALCULATE ( [Total Sales], SAMEPERIODLASTYEAR ( 'Date'[Date] ) )
RETURN
    DIVIDE ( CurrentSales - PriorSales, PriorSales )
```

If a generated measure wraps the result in `FORMAT(..., "0.0%")`, reject it. `FORMAT` returns text. Text breaks sorting and conditional formatting, and the visuals can no longer treat the value as a number. Set the percentage format on the measure's properties instead. Also check that `'Date'` is a proper, contiguous date table, marked as a date table; time intelligence can return wrong or blank results without one, and Copilot can't tell whether you've set that up properly.

## Real-Time Intelligence: statistically plausible isn't correct

[Copilot for Real-Time Intelligence](https://learn.microsoft.com/en-us/fabric/real-time-intelligence/copilot-real-time-intelligence) turns questions into KQL against a KQL database. It lost its preview label at Ignite in November 2024, which means the feature is supported. It doesn't mean the method it picks is right, so the output still needs review. Ask for "anomalies in traffic in the last hour" and you can get a query that computes averages and z-scores but compares each minute only to itself. It looks rigorous and detects nothing. KQL already has native time-series functions. A reviewer should push the output towards them:

```kusto
website_traffic
| where timestamp > ago(7d)
| make-series requests = sum(request_count) default = 0
    on timestamp from ago(7d) to now() step 1m
| extend (anomaly_flags, anomaly_score, baseline) =
    series_decompose_anomalies(requests, 3.0)
| mv-expand timestamp to typeof(datetime),
            requests to typeof(long),
            anomaly_flags to typeof(int),
            baseline to typeof(double)
| where timestamp > ago(1h) and anomaly_flags != 0
| project timestamp, requests, baseline, anomaly_flags
```

This builds a seven-day baseline that accounts for seasonality, then reports only the last hour. Copilot is a fine way to get a first draft of KQL. It's a poor way to choose an analytical method.

## Data Factory: lowest risk, highest return

Dataflow Gen2 Copilot is GA, and its output is Power Query steps you can inspect one by one in the applied steps pane. That makes it the easiest Copilot output to review in Fabric. Pipeline Copilot's "summarise this pipeline" and its explanations of failed activities are, in my view, the best value in the whole Copilot lineup, because they don't change anything. Reading an inherited pipeline or decoding a connector error is exactly where a language model saves time at no risk. I'd keep pipeline *generation* to prototypes until it leaves preview.

## When I wouldn't use Copilot

- **Row-level security, object-level security and anything else about access control.** Write and review these by hand.
- **Teams without a reviewer who knows the language.** Copilot speeds up people who can spot wrong output. For people who can't, it just produces wrong code faster.
- **Capacities already running hot.** Copilot load competes with refreshes and Spark jobs on the same CUs. Don't enable it on a capacity that's already being throttled.
- **Regions where cross-geo processing hasn't been approved.** Turning that setting on to unblock a demo is a data residency decision made by accident.

## Where to start

Turn Copilot on where you have F64 or larger capacity and someone who can review the output. Then make review specific to each workload rather than a general "check the AI's work":

- **PySpark:** tie-breaks and write mode.
- **T-SQL:** dialect, and performance advice that assumes SQL Server.
- **DAX:** data types and the date table.
- **KQL:** the analytical method, not just the syntax.

Start with the read-only, low-risk features: pipeline summaries, error explanations and code explanations. Keep generation features that are still in preview, such as pipeline and notebook generation, out of production paths until Microsoft supports them, and put even GA output like generated KQL through the same review. The [AI skill preview](https://blog.fabric.microsoft.com/en-us/blog/introducing-ai-skills-in-microsoft-fabric-now-in-public-preview/) and the rest of the [2025 roadmap](/blog/2025-01-10-microsoft-fabric-2025-roadmap/) suggest the scope will keep growing, so get the review habits in place now.
