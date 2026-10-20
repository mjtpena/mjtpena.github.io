---
title: "Designing a Gold Layer and Semantic Model That Stay in Direct Lake"
description: "Design-time rules for Direct Lake in Fabric: size tables to your SKU's guardrails, move logic into Delta, avoid views, and control when models reframe."
author: Michael John Peña
draft: false
date: 2024-01-17
tags:
  - Direct Lake
  - Microsoft Fabric
  - Power BI
  - Semantic Models
  - Performance
---

Direct Lake gives you Import-like query speed over Delta tables in OneLake without a scheduled import, but only while the model stays inside the rules. Step outside them and the model quietly falls back to DirectQuery, or refuses to let you build what you planned. Most of those rules are decided long before anyone opens a report: by how the gold layer is shaped, which capacity it runs on, and who controls when the model sees new data.

If you already have a slow report and need to find out why, start with [Tracing a Slow Fabric Report Back Through Every Layer](/blog/2024-01-15-fabric-performance-tuning/), which covers detecting fallback and compacting small files. For the basics of how the storage mode works, see [Direct Lake Mode: Power BI Performance Without Import Overhead](/blog/2023-06-04-direct-lake-mode/).

## Where Direct Lake stands in January 2024

Direct Lake was announced in preview at Build in May 2023. Microsoft declared it [generally available alongside Fabric GA at Ignite in November 2023](https://www.microsoft.com/en-us/microsoft-fabric/blog/2023/11/15/prepare-your-data-for-ai-innovation-with-microsoft-fabric-now-generally-available/), and extended it to semantic models on Fabric warehouses as well as lakehouses. The same announcement put stored credentials for Direct Lake models, which is what lets you apply row-level security in the model, into public preview. Ignite also renamed Power BI datasets to semantic models, so I use that name here. The REST API paths still say `datasets`.

Some practical constraints shape everything below:

- Direct Lake needs a Fabric (F) capacity or a Power BI Premium (P) capacity. Pro and Premium Per User workspaces can't host a Direct Lake model.
- Tables are read from Delta tables in a lakehouse or warehouse. If a table in the model maps to a SQL view in the SQL analytics endpoint, queries against it run in DirectQuery.
- Calculated columns and calculated tables aren't supported on Direct Lake tables yet.
- You can't mix Direct Lake tables with Import or DirectQuery tables in the same model. There is no composite-model escape hatch yet.
- You build and edit these models in the Fabric web modelling experience, or through the XMLA endpoint with tools like Tabular Editor. Power BI Desktop can connect to a published Direct Lake model for report authoring, but it doesn't edit one.

Each of those is a design input. If your current Import model leans heavily on calculated columns or mixes sources, it isn't a lift-and-shift candidate.

## Size the gold layer to the capacity guardrails

The [Direct Lake overview](https://learn.microsoft.com/fabric/fundamentals/direct-lake-overview) publishes guardrails per capacity SKU. When a table exceeds the Parquet file, row group or row limit, queries fall back to DirectQuery. Max memory is different: when the model needs more than that, columns get evicted and paged back in, so performance degrades rather than switches mode. Max model size on disk works at model level: exceed it and every query against the model falls back to DirectQuery, not just queries on one table. These are the published figures at the time of writing:

| SKU | Parquet files per table | Row groups per table | Rows per table (millions) | Max model size on disk (GB) | Max memory (GB) |
|---|---|---|---|---|---|
| F2 to F8 | 1,000 | 1,000 | 300 | 10 | 3 |
| F16 | 1,000 | 1,000 | 300 | 20 | 5 |
| F32 | 1,000 | 1,000 | 300 | 40 | 10 |
| F64 / P1 | 5,000 | 5,000 | 1,500 | Unlimited | 25 |
| F128 / P2 | 5,000 | 5,000 | 3,000 | Unlimited | 50 |
| F256 / P3 | 5,000 | 5,000 | 6,000 | Unlimited | 100 |
| F512 / P4 | 10,000 | 10,000 | 12,000 | Unlimited | 200 |

Microsoft has changed these numbers before, so treat the table as a snapshot and check the live page before you size a capacity.

Two things follow from the table that people miss.

First, the row limit is per table, not per model. A 2-billion-row fact table on F64 falls back no matter how lean the rest of the model is. The fix is a design decision, not a tuning knob: aggregate the fact to the grain reports actually use, split history from current data into separate tables, or buy a bigger capacity. I'd try the first two before the third. A daily-grain fact table that reports query is a better model than a transaction-grain one they don't.

Second, the small SKUs are much tighter than they look. 300 million rows and 1,000 files per table on F2 to F32 means a modest table that's appended to every 15 minutes can blow through the file limit in under two weeks (about 96 files a day) unless you run `OPTIMIZE` on a schedule (see the [tuning post](/blog/2024-01-15-fabric-performance-tuning/)). If you develop on F8 and deploy to F64, expect dev to fall back on tables production handles fine; load a sampled gold layer in dev or set the model's fallback behaviour so you know when it happens.

The check below runs in a Fabric notebook with the gold lakehouse attached and compares each table to the limits for your SKU. It doesn't count row groups; files are a lower bound, so treat a near-limit file count as a near-limit row-group count, and check row groups directly on large tables. It also skips anything that isn't a Delta table. SQL views live in the SQL analytics endpoint, not the Spark catalog, so list them with `SELECT name FROM sys.views` on the endpoint.

```python
# Fabric notebook, gold lakehouse attached as default; `spark` is predefined.
# Set the limits to match your capacity SKU (these are F64 / P1).
MAX_FILES = 5_000
MAX_ROWS = 1_500_000_000
WARN_AT = 0.7  # flag tables at 70% of a limit

for t in spark.catalog.listTables():
    if t.tableType == "VIEW":
        continue  # Spark views aren't visible to the semantic model
    detail = spark.sql(f"DESCRIBE DETAIL `{t.name}`").collect()[0]
    if detail["format"] != "delta":
        continue
    files = detail["numFiles"] or 0
    rows = spark.table(t.name).count()
    flags = []
    if files >= MAX_FILES * WARN_AT:
        flags.append(f"files {files}/{MAX_FILES}")
    if rows >= MAX_ROWS * WARN_AT:
        flags.append(f"rows {rows:,}/{MAX_ROWS:,}")
    status = "; ".join(flags) if flags else "ok"
    print(f"{t.name:40} files={files:>6} rows={rows:>15,}  {status}")
```

Run it on a schedule after your loads and alert on anything that isn't `ok`.

## Move model logic into Delta

With no calculated columns, any column you used to derive in DAX has to exist in the Delta table. I think that's an improvement: logic in the lakehouse is versioned, reusable from SQL and Spark, and computed once at load.

The usual candidates are line totals, banding, flags, and surrogate keys. A typical gold-layer fragment looks like this:

```python
# Fragment: build the fact table with derived columns in Spark, not DAX.
from pyspark.sql import functions as F

fact_sales = (
    spark.table("silver_sales").alias("s")
    .join(spark.table("gold_dim_product").alias("p"), F.col("s.product_id") == F.col("p.ProductID"))
    .join(spark.table("gold_dim_customer").alias("c"), F.col("s.customer_id") == F.col("c.CustomerID"))
    .select(
        F.col("s.sale_id").alias("SaleID"),
        F.col("c.CustomerKey"),
        F.col("p.ProductKey"),
        F.date_format("s.sale_date", "yyyyMMdd").cast("int").alias("DateKey"),
        F.col("s.quantity").alias("Quantity"),
        (F.col("s.quantity") * F.col("p.UnitPrice")).cast("decimal(18,2)").alias("LineTotal"),
        F.when(F.col("s.quantity") >= 100, "Bulk").otherwise("Standard").alias("OrderBand"),
    )
)

fact_sales.write.format("delta").mode("overwrite").saveAsTable("gold_fact_sales")
```

`LineTotal` replaces a `SUMX` over the fact table with `RELATED` to the product price. The measure becomes `SUM(gold_fact_sales[LineTotal])`, which the storage engine handles without row-by-row work.

Keep column types simple and narrow while you're there. Integer surrogate keys compress better and make cheaper relationships than string natural keys. Drop columns no report uses: Direct Lake pages columns into memory on demand, so an unused column costs little at query time, but it still counts toward model size on disk and clutters the field list. Flatten any nested structs or arrays in Spark, because the model has nowhere to put them.

## Don't model on views

Views are the most common reason I'd expect a Direct Lake model to fall back on day one. The pattern is familiar from warehouse work: expose clean views over base tables and point the model at those. In Direct Lake, a table backed by a SQL view in the SQL analytics endpoint can't be read from Delta files, so it runs in DirectQuery.

If the view exists to rename columns, filter rows, or join a lookup, materialise it as a Delta table in the gold layer instead. If it exists for security, that's a harder trade-off. Row-level security defined in the SQL analytics endpoint also forces DirectQuery, so the alternative is to define RLS roles in the semantic model, which relies on stored credentials for Direct Lake, in public preview since Ignite.

## Decide who controls framing

A Direct Lake "refresh" doesn't copy data. It's a framing operation: the model records which version of each Delta table it should read, and drops cached columns so the next query loads the current data. It's cheap, usually seconds.

By default, the semantic model setting **Keep your Direct Lake data up to date** is on, and the model reframes automatically when the underlying Delta tables change. That's convenient, and fine for a single table loaded in one write. It's wrong for a gold layer where several tables load in sequence. If the fact table lands before the new dimension rows, a report can frame in the middle and show orphaned keys or totals that don't reconcile for a few minutes.

My rule: turn automatic updates off for any model fed by a multi-table load, and reframe explicitly as the last step of the pipeline. The [enhanced refresh REST API](https://learn.microsoft.com/power-bi/connect-data/asynchronous-refresh) works for Direct Lake models, and a final notebook activity can call it:

```python
# Last notebook in the load pipeline. Requires Fabric notebook utilities and
# runs under the identity that executes the notebook (for a pipeline activity,
# the pipeline's owner), which needs write permission on the semantic model.
import requests
from notebookutils import mssparkutils

WORKSPACE_ID = "<your-workspace-id>"
DATASET_ID = "<your-semantic-model-id>"

token = mssparkutils.credentials.getToken("pbi")
url = (
    f"https://api.powerbi.com/v1.0/myorg/groups/{WORKSPACE_ID}"
    f"/datasets/{DATASET_ID}/refreshes"
)
response = requests.post(
    url,
    headers={"Authorization": f"Bearer {token}"},
    json={"type": "full", "commitMode": "transactional"},
    timeout=30,
)
response.raise_for_status()
print(f"Reframe requested: {response.status_code}, request id {response.headers.get('x-ms-request-id')}")
```

The call returns `202 Accepted` and the refresh runs asynchronously. If downstream steps depend on it, poll the refresh history on the same endpoint until the status is no longer `Unknown`.

One side effect to plan for: framing evicts cached columns, so the first queries afterwards are cold. Reframing once at the end of a nightly load means one cold start in the morning. Automatic updates on a table loaded every five minutes means users hit cold queries all day.

Framing also interacts with `VACUUM`. A framed model reads a specific set of Parquet files, so vacuuming with a short retention can remove files a model still points to. Keep the default seven-day retention unless you have a reason not to, and always reframe after a vacuum.

## Know what's resident

Once the model is live, it helps to see which columns are actually in memory. Connect to the workspace's XMLA endpoint with DAX Studio or SQL Server Management Studio and query the segment DMV:

```sql
-- DMV query against the semantic model over the XMLA endpoint (DAX Studio or SSMS).
SELECT DIMENSION_NAME, COLUMN_ID, SEGMENT_NUMBER, ISRESIDENT, TEMPERATURE, LAST_ACCESSED
FROM $SYSTEM.DISCOVER_STORAGE_TABLE_COLUMN_SEGMENTS
```

Every column is non-resident right after a reframe, and columns can be evicted under memory pressure, so one snapshot proves little. Columns that stay non-resident over a representative period of report use since the last reframe are candidates to drop. Columns with high temperature are the ones your users depend on, so they deserve the type and cardinality attention. For checking whether individual queries fell back, use Performance Analyzer and the steps in [Analyse query processing for Direct Lake semantic models](https://learn.microsoft.com/fabric/fundamentals/direct-lake-analyze-query-processing).

## When Direct Lake is the wrong choice

Direct Lake is the right default for new models over a Fabric lakehouse, but not for everything:

- **Your model depends on calculated columns, calculated tables over facts, or composite models.** Rework the logic into Delta first, or keep it in Import until the feature gaps close.
- **Your security lives in SQL views or SQL endpoint RLS.** You'll be in DirectQuery much of the time anyway, so measure that honestly before you migrate.
- **A fact table exceeds the row guardrail for the capacity you can afford.** Aggregating is usually better than paying for a bigger SKU just to avoid fallback.
- **The data is small and changes once a day.** An Import model on a Pro workspace is simpler, cheaper, and just as fast. Direct Lake shines when the data is already in OneLake and duplicating it into an import refresh is the cost you're trying to avoid.

## What I'd do first

Before building the model, run the guardrail check against your target SKU, materialise any views and DAX-derived columns as Delta tables, and decide whether the pipeline or the model controls framing. Those three decisions keep a Direct Lake model in Direct Lake. Tuning DAX and compacting files help, but they can't save a model whose tables were never going to fit.
