---
title: "Materialized Lake Views as a Silver Flow: What to Hand Over"
description: "Now that Fabric materialized lake views are GA: which raw-to-silver steps I'd move onto them, how to keep rejected rows, and where notebooks still win."
author: Michael John Peña
draft: false
date: 2026-05-08
tags:
  - Microsoft Fabric
  - Data Engineering
  - Lakehouse
  - Data Quality
  - Delta Lake
---

Most Fabric lakehouse flows from raw to silver are three things glued together: a notebook that cleans the data, a pipeline that runs the notebooks in order, and a schedule trigger on the pipeline, and the glue is what breaks: a notebook added without updating the pipeline, a gold table rebuilt from a silver table that failed halfway, a retry that runs the whole chain twice. Materialized lake views move that glue into the platform, and since they went generally available in March 2026 the question is which parts of the flow they should own. My answer: hand over the deterministic, row-level, append-shaped part and keep notebooks for anything that needs history, merges or evidence.

## What you are actually handing over

A [materialized lake view](https://learn.microsoft.com/fabric/data-engineering/materialized-lake-views/overview-materialized-lake-view) is a Spark SQL `SELECT` that Fabric stores as a definition and materialises as a Delta table in the lakehouse. Fabric works out the dependency graph, refreshes views in order, and shows lineage, run history and data quality counts in one place. The [GA announcement](https://blog.fabric.microsoft.com/en-us/blog/materialized-lake-views-in-microsoft-fabric-generally-available/) in March 2026 added multiple named schedules, broader incremental refresh and in-place updates to view definitions, with PySpark authoring arriving as a preview.

Three things come with it that you'd otherwise build by hand:

- **Execution order.** Views that read other views refresh after them. No pipeline to keep in sync with the notebook list.
- **Skip-on-failure.** When a view fails, its downstream views are marked *Skipped* in the run, not refreshed from half-finished data. Gold keeps its last good state.
- **Change-aware refresh.** With optimal refresh on (the default), each run either skips a view whose sources haven't changed, processes only the new data, or rebuilds it in full.

Check the prerequisites before anyone gets attached: a lakehouse with schemas enabled, Fabric Runtime 1.3, and a region other than South Central US, where the feature wasn't available as of early May 2026. Cross-lakehouse lineage and execution aren't supported either, so a view and everything it depends on should live in one lakehouse. If your bronze and silver are split across workspaces, as in my [ingestion vs curation post](/blog/2026-04-16-fabric-architecture-notes-where-i-separate-ingestion-from-curation/), the views belong on the curation side, reading bronze through shortcuts.

## Shape bronze so silver can be incremental

The detail that decides whether MLVs are cheap or expensive is in the [optimal refresh documentation](https://learn.microsoft.com/fabric/data-engineering/materialized-lake-views/refresh-materialized-lake-view). Incremental refresh needs change data feed enabled on every source, and it only works for **append-only** sources. If a source table has updates or deletes, the view gets a full refresh. The view's own definition matters too: `DISTINCT`, window functions and non-deterministic functions such as `current_timestamp()` fall back to full refresh, while filters, projections, left outer and left semi joins (as long as the right-hand table didn't change in that cycle; any change to it triggers a full refresh), and CTEs can stay incremental.

That makes a messy raw zone a design constraint rather than a cleanup job: if ingestion upserts into bronze with `MERGE`, every silver refresh is a full rebuild, and on a large table that's where the capacity goes.

So bronze lands every batch as new rows with a batch identifier, never rewriting what came before:

```sql
-- Bronze is append-only: every landed batch adds rows, nothing is updated in place.
CREATE SCHEMA IF NOT EXISTS bronze;

CREATE TABLE IF NOT EXISTS bronze.orders_raw (
    order_id        STRING,
    customer_id     STRING,
    order_ts        STRING,
    quantity        STRING,
    unit_price      STRING,
    currency        STRING,
    _batch_id       STRING,
    _ingested_at    TIMESTAMP
)
TBLPROPERTIES (delta.enableChangeDataFeed = true);
```

Columns stay as strings in bronze because the source sends text and I'd rather cast in one visible place than lose a malformed value at landing. For an existing bronze table, `ALTER TABLE bronze.orders_raw SET TBLPROPERTIES (delta.enableChangeDataFeed = true)` does the same job. If bronze lives in a separate ingestion lakehouse, set it on the landing table in its own lakehouse, by whoever owns ingestion; don't rely on changing table properties through a shortcut.

One habit to drop: stamping a `_processed_at = current_timestamp()` column in silver. It's non-deterministic, so it quietly turns every refresh into a full one. The run history already records when each view was refreshed.

## Constraints: decide FAIL or DROP per rule, not per table

Each view can carry `CHECK` constraints with an `ON MISMATCH` action, as described in the [data quality documentation](https://learn.microsoft.com/fabric/data-engineering/materialized-lake-views/data-quality). The semantics are blunt, so it pays to be deliberate:

| Action | What happens | Use it for |
|---|---|---|
| `FAIL` (the default) | The refresh fails when any row violates it; downstream views are skipped | Rules that mean the batch itself is wrong |
| `DROP` | The row is removed and the count shows in lineage and the data quality report | Rules where a bad row is expected and the rest of the batch is still useful |

If a view has both, `FAIL` takes precedence. And because `FAIL` is the default, a constraint written without `ON MISMATCH` will block the whole chain the first time one row breaks it.

My rule of thumb: `DROP` for row-level problems that sources produce routinely (a missing customer ID, a zero quantity), `FAIL` for anything that suggests the source changed shape, such as a currency code outside the agreed list. I treat even one such row as a contract breach: a single stray `EUR` order will block silver and gold until someone looks, and I accept that cost because a new currency means the source changed something nobody told me about.

```sql
-- Silver: typed, filtered, and gated. Only deterministic built-ins, so it can refresh incrementally.
CREATE SCHEMA IF NOT EXISTS silver;

CREATE OR REPLACE MATERIALIZED LAKE VIEW silver.orders
(
    CONSTRAINT has_keys CHECK (order_id IS NOT NULL AND customer_id IS NOT NULL) ON MISMATCH DROP,
    CONSTRAINT valid_order_ts CHECK (order_ts IS NOT NULL) ON MISMATCH DROP,
    CONSTRAINT positive_quantity CHECK (quantity IS NOT NULL AND quantity > 0) ON MISMATCH DROP,
    CONSTRAINT valid_unit_price CHECK (unit_price IS NOT NULL AND unit_price >= 0) ON MISMATCH DROP,
    CONSTRAINT known_currency CHECK (currency IS NOT NULL AND currency IN ('AUD', 'NZD', 'USD')) ON MISMATCH FAIL
)
COMMENT "Typed orders from bronze.orders_raw. Rejected rows are in silver.orders_rejects."
TBLPROPERTIES (delta.enableChangeDataFeed = true)
AS
SELECT
    TRIM(order_id)                              AS order_id,
    TRIM(customer_id)                           AS customer_id,
    TRY_CAST(order_ts AS TIMESTAMP)             AS order_ts,
    -- Whole numbers only ("2" or "2.0"); '2.5' and '2.00001' become NULL rather than being rounded to 2.
    CASE WHEN TRIM(quantity) RLIKE '^-?[0-9]+([.]0+)?$'
         THEN TRY_CAST(TRY_CAST(TRIM(quantity) AS DECIMAL(38, 0)) AS INT)
    END                                         AS quantity,
    TRY_CAST(unit_price AS DECIMAL(18, 2))      AS unit_price,
    UPPER(TRIM(currency))                       AS currency,
    _batch_id,
    _ingested_at
FROM bronze.orders_raw;
```

Two details in that definition are deliberate. Every constraint is written so it can't evaluate to `NULL`, because I don't want correctness to depend on how a three-valued comparison is treated; for `known_currency` that means a missing currency fails the refresh just like an unknown one. And `TRY_CAST` turns unparseable text into `NULL`, so a quantity of `"two"` is caught by `positive_quantity`, a price of `"TBC"` by `valid_unit_price`, and a timestamp of `"yesterday"` by `valid_order_ts`, rather than failing the refresh with a cast error or slipping through as a silent `NULL`. Quantity is checked against a whole-number pattern on the raw text before any cast, because a plain `CAST(quantity AS INT)` with ANSI mode off truncates `"2.5"` to `2`, `TRY_CAST(quantity AS INT)` rejects `"2.0"` as well as `"2.5"`, and casting through a `DECIMAL` with a fixed scale on its own would round `"2.00001"` to `2`. The pattern accepts trailing zeros, and only then does the cast go through `DECIMAL(38, 0)`. Both are exactly the silent bad data this layer exists to stop. `CHECK` constraints are row-level only, so uniqueness, volume and freshness checks still need to live somewhere else, such as the audit step in a [write-audit-publish boundary](/blog/2026-05-06-data-quality-work-that-actually-sticks-separating-incident-response-from-root-cause-fixes/).

## Keep the rows DROP throws away

`DROP` records how many rows each constraint removed, not which rows. That's why I argued for quarantining rows with a reason in [table contracts and quarantine](/blog/2026-03-03-lakehouse-decisions-i-made-this-week-turning-messy-raw-zones-into-reliable-products/): a count tells you something went wrong but not what to send back to the source owner.

The fix is a sibling view that applies the same casts in a CTE and keeps exactly the rows the `DROP` constraints remove, with a reason column:

```sql
-- Rejects: the mirror image of the DROP constraints on silver.orders.
CREATE OR REPLACE MATERIALIZED LAKE VIEW silver.orders_rejects
COMMENT "Rows removed by the DROP constraints on silver.orders, with the reason."
AS
WITH typed AS (
    SELECT
        *,
        TRY_CAST(order_ts AS TIMESTAMP) AS order_ts_typed,
        CASE WHEN TRIM(quantity) RLIKE '^-?[0-9]+([.]0+)?$'
             THEN TRY_CAST(TRY_CAST(TRIM(quantity) AS DECIMAL(38, 0)) AS INT)
        END AS quantity_typed,
        TRY_CAST(unit_price AS DECIMAL(18, 2)) AS unit_price_typed
    FROM bronze.orders_raw
)
SELECT
    order_id,
    customer_id,
    order_ts,
    quantity,
    unit_price,
    currency,
    _batch_id,
    _ingested_at,
    CASE
        WHEN order_id IS NULL THEN 'missing_order_id'
        WHEN customer_id IS NULL THEN 'missing_customer_id'
        WHEN order_ts_typed IS NULL THEN 'invalid_order_ts'
        WHEN quantity_typed IS NULL OR quantity_typed <= 0 THEN 'invalid_quantity'
        ELSE 'invalid_unit_price'
    END AS reject_reason
FROM typed
WHERE order_id IS NULL
   OR customer_id IS NULL
   OR order_ts_typed IS NULL
   OR quantity_typed IS NULL
   OR quantity_typed <= 0
   OR unit_price_typed IS NULL
   OR unit_price_typed < 0;
```

It's a CTE, a filter and a projection over an append-only source, so it can refresh incrementally like silver does. The catch is that the two definitions must stay in step: if someone tightens a constraint on `silver.orders` and forgets the rejects view, rows vanish without a trace. Keep both definitions in the same notebook cell and change them in the same commit. Empty strings are a gap in both as written (`''` passes `IS NOT NULL`), so if your source sends them, add `<> ''` to both in the same change.

Then check that they really are mirrors. For any batch the last successful refresh has processed, bronze should equal silver plus rejects. The filter matters: a batch that landed in bronze after that refresh isn't in either view yet, and without the filter every reconciliation run between ingestion and refresh would report it as missing rows:

```sql
-- Reconciliation: any row returned is a processed batch where rows went missing or were double-counted.
SELECT b._batch_id, b.bronze_rows, COALESCE(s.silver_rows, 0) AS silver_rows, COALESCE(r.reject_rows, 0) AS reject_rows
FROM (SELECT _batch_id, COUNT(*) AS bronze_rows FROM bronze.orders_raw GROUP BY _batch_id) AS b
LEFT JOIN (SELECT _batch_id, COUNT(*) AS silver_rows FROM silver.orders GROUP BY _batch_id) AS s ON s._batch_id = b._batch_id
LEFT JOIN (SELECT _batch_id, COUNT(*) AS reject_rows FROM silver.orders_rejects GROUP BY _batch_id) AS r ON r._batch_id = b._batch_id
WHERE b._batch_id IN (SELECT _batch_id FROM silver.orders UNION SELECT _batch_id FROM silver.orders_rejects)
  AND b.bronze_rows <> COALESCE(s.silver_rows, 0) + COALESCE(r.reject_rows, 0);
```

The trade-off is that a batch that vanished from both views entirely won't show up here, so pair it with a freshness check in the audit step that flags bronze batches older than the last completed run that appear in neither. I'd run both as plain queries in the audit notebook, not as another view: they're checks, not products.

## Gold and the full-refresh trade-off

Gold views are usually aggregates, and that's where the documentation needs reading carefully. The GA release extended incremental refresh to aggregations with `GROUP BY` (the [overview](https://learn.microsoft.com/fabric/data-engineering/materialized-lake-views/overview-materialized-lake-view) lists them under optimal refresh), but at the time of writing the refresh reference still listed aggregates as full-refresh. So keep gold to the simplest shapes, and check the run history to confirm which strategy each gold view actually gets:

```sql
-- Gold: additive measures only, so the report can derive averages without forcing a rebuild.
CREATE SCHEMA IF NOT EXISTS gold;

CREATE OR REPLACE MATERIALIZED LAKE VIEW gold.daily_orders
COMMENT "Order count and revenue per day and currency, from silver.orders."
AS
SELECT
    CAST(order_ts AS DATE)          AS order_date,
    currency,
    COUNT(*)                        AS order_count,
    SUM(quantity)                   AS units,
    SUM(quantity * unit_price)      AS revenue
FROM silver.orders
GROUP BY CAST(order_ts AS DATE), currency;
```

That is also why `silver.orders` sets `delta.enableChangeDataFeed`: optimal refresh reads silver's change feed to refresh the gold views built on it. Without it, a gold view can only skip or rebuild in full; it can never refresh incrementally.

My expectation is that additive measures like these are the ones to bet on, and that `AVG`, `MIN`, `MAX`, distinct counts and window functions will rebuild in full. On a small gold table that's fine. On a large one, I'd restate the metric in additive terms (an average is a `SUM` and a `COUNT` the report can divide, which is what `units` and `order_count` are for), or move that view to a notebook with an explicit incremental `MERGE`. As of May 2026, `PARTITIONED BY` is documented as a read optimisation, not a refresh one.

For a clean rebuild after fixing a source problem, `REFRESH MATERIALIZED LAKE VIEW silver.orders FULL` forces it for one view without turning optimal refresh off for the lakehouse. The same cost also arrives uninvited: a single update or delete in bronze switches every downstream view to a full refresh for that cycle. A backfill that rewrites bronze, or a GDPR delete against it, is an expensive event to plan and schedule, not run ad hoc on a Tuesday afternoon.

## Scheduling: per graph, or on arrival

Since GA, a lakehouse can have several schedules, each covering all views or a selected set. I'd create one schedule per independent graph, set to the cadence its consumers need, not one global schedule at the speed of the most impatient report. Two scheduling behaviours to plan around: a run fails if it exceeds 24 hours, and a scheduled run that fires while the previous run is still going is skipped, not queued.

If bronze lands at irregular times, a fixed schedule either refreshes too early or wastes runs. The Fabric job scheduler API exposes an on-demand lakehouse job of type `RefreshMaterializedLakeViews`, so the ingestion pipeline can trigger the refresh once its copy has finished.

## Where I'd keep notebooks

MLVs are a `SELECT`. Anything that isn't one stays in a notebook:

- **History and slowly changing dimensions.** No DML runs against a view, and its definition can't use time travel, so SCD type 2 and "latest version wins across batches" logic need a notebook with `MERGE`. A window-function dedup inside a view works, but it means a full refresh every run.
- **Sources with updates or deletes at volume.** Every refresh becomes a full rebuild.
- **Non-SQL logic.** SQL-defined views can't use UDFs. PySpark authoring lifts that, but it was still in preview in early May 2026 and PySpark views always perform a full refresh.
- **Session-level Spark settings.** Properties set with `spark.conf.set` aren't applied during a scheduled refresh; set them at the lakehouse or workspace level.
- **Sub-second freshness.** That's Real-Time Intelligence territory, not a lakehouse refresh.

## The line I'd draw

Put the typed, filtered, constrained silver layer and simple additive gold aggregates on materialized lake views, over an append-only bronze with change data feed on. Pick `FAIL` or `DROP` per rule, write a rejects view for every `DROP`, reconcile them by batch, and schedule each graph at the cadence its consumers need. Keep merges, history, heavy Python and table-level quality checks in notebooks. If your bronze can't be made append-only, fix that first. Until you do, the views will work, but every run will rebuild everything.
