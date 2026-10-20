---
title: "Failure Budgets for Data Products: SLOs for Fresh, Correct Tables"
description: "Measure data product reliability in good hours, catch bad data at the publish boundary, and let a failure budget decide when pipeline changes stop."
author: Michael John Peña
draft: false
date: 2026-04-14
tags:
  - Data Quality
  - Observability
  - Microsoft Fabric
  - DataOps
  - Data Engineering
---

Most data platform monitoring answers the wrong question. It tells you whether the pipeline succeeded, when the consumer of a data product wants to know whether the table they read at 9am was fresh and right. Without an agreed target for that, every data incident is either a fire drill or ignored, and nobody can say whether this month's problems are tolerable or whether the next pipeline change should wait.

My fix is the one SRE teams use for uptime and the one I applied to answer quality in [Quality SLOs for LLM Features](/blog/2026-03-20-llm-reliability-in-practice-treating-quality-as-a-product-metric/): an indicator, a target, and a failure budget with a policy attached. For data products the mechanics change in two places. You measure time rather than requests, and you decide where in the pipeline a bad row becomes a budget problem.

## Why "pipeline succeeded" is the wrong indicator

A green run proves the code executed. It doesn't prove the source sent yesterday's file, that the join didn't fan out, or that the table someone queried at 9am had finished loading. The reverse is also true: a pipeline can fail at 2am, retry at 3am and hurt nobody.

The consumer experiences a data product as a table they read at some point in time. So the indicator should describe that table at that point in time, not the job that produced it. That's the same shift [data observability](/blog/2021-12-26-data-observability/) made from "is the job running?" to "is the data healthy?". A budget adds the missing part: how unhealthy is acceptable, and who decides what happens when you go past it.

## Pick the unit: good hours

There are three reasonable units, and the choice matters more than it looks.

| Unit | Good when | Weakness |
|---|---|---|
| Per load | Loads are infrequent and each one is a release | A load that is late by six hours counts the same as one late by six minutes |
| Per row | You're measuring a cleansing step | Rows are not what consumers experience; 0.1% bad rows can still mean one wrong total on every report |
| Per hour | The table is read continuously | Needs a probe running on a schedule, and the probe can fail too |

For anything people read during the day, I use the hour. An hour is **good** when the published table met two conditions when the probe looked at it:

- **Fresh:** the newest data in the table was loaded within the lag the consumer agreed to (for a daily sales table loaded at 6am, maybe 26 hours since the last successful load).
- **Correct:** every blocking check passes. Keep this list short: rows removed by quality rules under an agreed threshold, volume within a sane band of the trailing average, required columns populated.

An hour with no probe result counts as bad. If you can't show the table was healthy, you don't get to claim it was.

Over a rolling 28-day window there are 672 hours, which makes the budget easy to explain to an owner:

| Target | Bad hours allowed per 28 days |
|---|---|
| 95% | 33.6 |
| 98% | 13.4 |
| 99% | 6.7 |
| 99.5% | 3.4 |

A daily table that loads at 6am and misses once has used about 22 bad hours by the time the next 6am load lands: the 26-hour lag runs out at 8am and nothing recovers until the following morning. That's most of a 95% budget and well past a 99% one, which is the point: it makes a single missed load visible as the expensive event it is for consumers. I'd agree the target with the product owner slightly below what the table achieves today, then tighten it.

## Move the checks to the publish boundary

Where a check runs decides who pays for a failure. A check that runs after the gold table is overwritten only tells you consumers already have bad data. A check that runs before publish lets you choose: keep the last good version and spend freshness budget, or publish and spend correctness budget.

My default is that stale but right beats fresh but wrong. Most consumers can work around yesterday's numbers if they know about it; very few can detect that today's numbers are quietly wrong. So the blocking checks go at the boundary into the published layer, and a failure stops the publish.

In Microsoft Fabric, materialized lake views make this declarative. They reached general availability at FabCon in March 2026, and a view can carry row-level constraints with `ON MISMATCH FAIL` (the default) or `ON MISMATCH DROP`, as described in [data quality in materialized lake views](https://learn.microsoft.com/fabric/data-engineering/materialized-lake-views/data-quality). A constraint is evaluated against each row the view outputs, so it has to reference a column the `SELECT` produces, and it acts at the grain of the view. That matters for aggregates: a `DROP` on a daily summary throws away a whole store-day, not the bad order. So I put order-level rules on a silver view and aggregate from that. These statements assume a schema-enabled lakehouse with a `silver.orders` table:

```sql
CREATE MATERIALIZED LAKE VIEW IF NOT EXISTS silver.orders_valid
(
    CONSTRAINT amount_not_negative CHECK (net_amount >= 0) ON MISMATCH DROP
)
AS
SELECT order_id, store_id, order_ts, net_amount, loaded_at
FROM silver.orders;

CREATE MATERIALIZED LAKE VIEW IF NOT EXISTS gold.sales_daily
(
    CONSTRAINT store_present CHECK (store_id IS NOT NULL) ON MISMATCH FAIL
)
AS
SELECT
    store_id,
    CAST(order_ts AS DATE) AS sales_date,
    SUM(net_amount) AS net_sales,
    COUNT(*) AS order_count,
    MAX(loaded_at) AS loaded_at
FROM silver.orders_valid
GROUP BY store_id, CAST(order_ts AS DATE);
```

The choice between the two actions is a budget decision, not a syntax one. `FAIL` stops the refresh, so the previous result stays in place and the failure turns into freshness burn, which the hourly probe will see. `DROP` keeps the table fresh but removes rows silently from the consumer's point of view. Fabric records the drops (the lineage view shows dropped counts, and there's a built-in [data quality report](https://learn.microsoft.com/fabric/data-engineering/materialized-lake-views/data-quality-reports) for violation trends), but nothing about a drop spends budget unless you make it. I use `DROP` only for rows the consumer has agreed don't belong in the product, and I make drops a blocking check in the probe: it reconciles `SUM(order_count)` in gold against the orders in `silver.orders` for the same date, so a spike in dropped orders shows up as a bad hour instead of a quietly smaller total.

The same principle applies if you're on notebooks or pipelines instead: write to a staging table, run the checks, and only then swap or merge into the published table.

## Measure it: an hourly probe

The probe is a scheduled Fabric notebook that runs a few minutes past each hour and appends one row per data product. Run one notebook that loops over every product, not one notebook per product: an hourly schedule is 672 Spark sessions per 28 days, and every one of them consumes capacity units on the same Fabric capacity your pipelines and reports use. That cost is the real argument for hourly granularity being reserved for tables people read throughout the day. Freshness comes from a load timestamp in the data, not from the Delta log. Maintenance operations such as `OPTIMIZE` also create commits, so the last commit time can look fresh when no new data has arrived.

```python
PRODUCT = "sales_daily"
TABLE = "gold.sales_daily"
SOURCE = "silver.orders"
MAX_LAG_HOURS = 26
MAX_DROP_RATIO = 0.01  # agreed with the product owner

lag_hours = spark.sql(f"""
    SELECT (unix_timestamp(current_timestamp()) - unix_timestamp(MAX(loaded_at))) / 3600.0
    FROM {TABLE}
""").first()[0]

checks = {
    # Orders removed by the DROP constraint, as a share of source orders for the latest date.
    # Only source rows loaded before the last refresh count, so late arrivals don't look like drops.
    "dropped_orders": f"""
        SELECT CASE WHEN src.n > 0 AND (src.n - COALESCE(pub.n, 0)) > {MAX_DROP_RATIO} * src.n
                    THEN 1 ELSE 0 END
        FROM (SELECT COUNT(*) AS n FROM {SOURCE}
              WHERE CAST(order_ts AS DATE) = (SELECT MAX(sales_date) FROM {TABLE})
                AND loaded_at <= (SELECT MAX(loaded_at) FROM {TABLE})) src
        CROSS JOIN (SELECT SUM(order_count) AS n FROM {TABLE}
              WHERE sales_date = (SELECT MAX(sales_date) FROM {TABLE})) pub""",
    # Orders for the latest date against the trailing seven-day average.
    "low_volume": f"""
        SELECT CASE WHEN COALESCE(latest.n, 0) < 0.5 * trailing.avg_n THEN 1 ELSE 0 END
        FROM (SELECT SUM(order_count) AS n FROM {TABLE}
              WHERE sales_date = (SELECT MAX(sales_date) FROM {TABLE})) latest
        CROSS JOIN (SELECT SUM(order_count) / 7.0 AS avg_n FROM {TABLE}
              WHERE sales_date >= date_sub((SELECT MAX(sales_date) FROM {TABLE}), 7)
                AND sales_date < (SELECT MAX(sales_date) FROM {TABLE})) trailing""",
    "null_sales": f"""
        SELECT COUNT(*) FROM {TABLE}
        WHERE net_sales IS NULL OR sales_date IS NULL""",
}

failed = [name for name, sql in checks.items() if (spark.sql(sql).first()[0] or 0) > 0]
fresh = lag_hours is not None and lag_hours <= MAX_LAG_HOURS

result = (
    PRODUCT,
    float(lag_hours) if lag_hours is not None else None,
    fresh,
    ",".join(failed),
    fresh and not failed,
)

(spark.createDataFrame(
        [result],
        "product string, lag_hours double, fresh boolean, failed_checks string, good boolean")
    .selectExpr("current_timestamp() AS probe_ts", "*")
    .write.mode("append")
    .saveAsTable("ops.data_product_sli"))
```

The budget calculation fills in missing hours as bad, then reports the 28-day indicator, remaining budget and a 7-day burn rate against a 99% target:

```sql
WITH hours AS (
    SELECT explode(sequence(
        date_trunc('HOUR', current_timestamp() - INTERVAL 28 DAYS),
        date_trunc('HOUR', current_timestamp() - INTERVAL 1 HOUR),
        INTERVAL 1 HOUR)) AS hour_start
),
probes AS (
    SELECT date_trunc('HOUR', probe_ts) AS hour_start,
           MIN(CAST(good AS INT)) AS good
    FROM ops.data_product_sli
    WHERE product = 'sales_daily'
      AND probe_ts >= current_timestamp() - INTERVAL 29 DAYS
    GROUP BY date_trunc('HOUR', probe_ts)
),
scored AS (
    SELECT h.hour_start, COALESCE(p.good, 0) AS good
    FROM hours h
    LEFT JOIN probes p ON h.hour_start = p.hour_start
)
SELECT
    COUNT(*) AS valid_hours,
    SUM(1 - good) AS bad_hours,
    ROUND(AVG(good), 4) AS sli_28d,
    ROUND(COUNT(*) * (1 - 0.99) - SUM(1 - good), 1) AS budget_hours_left,
    ROUND(SUM(CASE WHEN hour_start >= current_timestamp() - INTERVAL 7 DAYS THEN 1 - good ELSE 0 END)
          / (7 * 24 * (1 - 0.99)), 2) AS burn_rate_7d
FROM scored;
```

A burn rate of 1.0 means you're spending budget exactly as fast as the target allows. I alert above 2x over a week. Put the result on a Power BI page and [set an Activator alert on the visual](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-get-data-power-bi) if you want it in Teams or email without writing more code.

## Write the policy before the first breach

A budget without a policy is a dashboard. Mine fits on a page:

- **More than 50% left:** changes to the product's transformations and its upstream ingestion ship through the normal review and test gate.
- **Under 50%, or burn above 2x for a week:** changes need a run against a copy of production data with the probe checks passing before they're published, and the team reviews every bad hour in the weekly meeting with its cause written down.
- **Exhausted:** only reliability fixes and rollbacks ship for that product. The product owner can override this in writing.

Decide the exclusions now, too. I exclude maintenance windows announced to consumers in advance. I don't exclude upstream source outages, because consumers experienced them all the same. I tag them instead, so the review shows how much budget a source system is costing you and the conversation with that system's owner has numbers behind it.

## When a failure budget is the wrong tool

Don't do this for exploratory or sandbox datasets. If nobody has agreed what fresh and correct mean, the indicator will be redefined every fortnight.

Don't do it for a table with no named consumer and no named owner. The policy needs someone to hold the override pen; without one, the budget is just a number.

Don't use hourly measurement for monthly or weekly products. A month-end table measured hourly turns one late load into a budget catastrophe. Count per load instead, with an on-time deadline.

And start small. Three products with budgets people care about beat forty with dashboards nobody reads.

## What changes when data has a budget

The useful outcome isn't the percentage. It's that "the data feels unreliable lately" becomes "sales_daily has used 70% of its budget, mostly from late source files, so do we ship the new attribution logic or fix ingestion first?" That's a decision the product owner can make with numbers both sides agree on.

If you want a first step this week: pick the one table your executives read every morning, agree a lag and three blocking checks with its owner, schedule the probe, and set the target slightly below what it measures. The Well-Architected Framework's [recommendations for defining reliability targets](https://learn.microsoft.com/azure/well-architected/reliability/metrics) cover the same thinking for application workloads; a data product deserves the same discipline.
