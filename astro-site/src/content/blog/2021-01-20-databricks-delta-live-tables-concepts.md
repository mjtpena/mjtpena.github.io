---
title: "Wiring a Medallion Pipeline on Azure Databricks with Auto Loader"
description: "How to connect Auto Loader, Structured Streaming and Delta MERGE into a bronze, silver and gold pipeline that restarts safely and doesn't run up the bill."
author: Michael John Pena
draft: false
date: 2021-01-20
url: /blog/delta-lake-data-pipelines/
tags:
  - Databricks
  - Delta Lake
  - Data Engineering
  - ETL
  - Streaming
---

Most teams I talk to can already write a Delta table. The hard part is joining three of them into a pipeline that picks up new files without rescanning the lake, survives a restart without duplicating rows, and doesn't keep a cluster running all night for data that lands once an hour. Bronze, silver and gold is the easy bit to draw. Getting the stages to hand data to each other properly is where pipelines go wrong.

Everything here targets Azure Databricks on Databricks Runtime 7.x (Spark 3.0): Auto Loader for ingestion, Structured Streaming between layers, and `MERGE` where duplicates matter. If you need the Delta basics first, start with [Getting Started with Delta Lake on Azure Databricks](/blog/2020-11-16-databricks-delta-lake-intro/).

## What each layer owes the next one

I find it more useful to define the layers by the promise each one makes than by how clean the data is.

| Layer | Promise to downstream | Write pattern | Typical trigger |
|---|---|---|---|
| Bronze | Every file that landed is here exactly once, unchanged, with lineage columns | Append only | Auto Loader stream |
| Silver | One row per business key, typed, deduplicated, with bad records filtered out | `MERGE` on the key | Stream from bronze with `foreachBatch` |
| Gold | Aggregates shaped for one consumer (a report, a model, an API) | Overwrite a bounded range | Batch after silver |

Two rules follow from this. Bronze never deduplicates, because it is your replay log, and once you drop a row there you can't get it back. Gold never reads bronze. If a gold table needs a column that silver doesn't have, add it to silver.

## Bronze: Auto Loader with an explicit schema

[Auto Loader](https://learn.microsoft.com/en-us/azure/databricks/ingestion/auto-loader/) (the `cloudFiles` source) became generally available in [Databricks Runtime 7.2](https://learn.microsoft.com/en-us/azure/databricks/archive/runtime-release-notes/7.2). It records which files it has processed in the stream checkpoint, so it never re-lists and re-reads files it has already loaded the way a plain `spark.read` over a folder does. It has two discovery modes:

- **Directory listing** (the default). Simple, with no extra Azure resources, and fine for folders that receive a modest number of files.
- **File notification** (`cloudFiles.useNotifications`). Auto Loader creates an Event Grid subscription and a storage queue and reads new file events from the queue. It scales better for high-volume folders, but it needs a service principal with rights to create those resources, and that is a conversation with your platform team.

I start with directory listing and only switch when listing time shows up in the stream metrics. Runtime 7.5 now reports [backlog file count and size](https://learn.microsoft.com/en-us/azure/databricks/archive/runtime-release-notes/7.5) for each batch, which makes that call easier.

On Runtime 7.x, Auto Loader does not infer or evolve the schema for you, so you supply one. I see that as a feature in bronze. An explicit schema means a renamed upstream field shows up as nulls you can alert on, not as a silently different table.

```python
from pyspark.sql.functions import current_timestamp, input_file_name, to_date
from pyspark.sql.types import StructType, StructField, StringType, TimestampType, DoubleType

lake = "abfss://lake@<your-storage-account>.dfs.core.windows.net"

event_schema = StructType([
    StructField("event_id", StringType(), True),
    StructField("user_id", StringType(), True),
    StructField("event_type", StringType(), True),
    StructField("event_time", TimestampType(), True),
    StructField("amount", DoubleType(), True),
])

bronze_query = (
    spark.readStream
    .format("cloudFiles")
    .option("cloudFiles.format", "json")
    .option("cloudFiles.maxFilesPerTrigger", 1000)
    .schema(event_schema)
    .load(f"{lake}/landing/events/")
    .withColumn("_ingested_at", current_timestamp())
    .withColumn("_ingest_date", to_date(current_timestamp()))
    .withColumn("_source_file", input_file_name())
    .writeStream
    .format("delta")
    .option("checkpointLocation", f"{lake}/_checkpoints/bronze_events")
    .partitionBy("_ingest_date")
    .trigger(once=True)
    .start(f"{lake}/bronze/events")
)

# In a scheduled job, let bronze finish before silver reads it
bronze_query.awaitTermination()
```

Bronze is partitioned by ingestion date, not event date. Late and replayed events then land in today's partition instead of rewriting old ones, and you can trace any row back to its file.

## Trigger once is the cost lever

A common first version streams every layer on a one-minute or five-minute `processingTime` trigger. That keeps a cluster running around the clock. If the business looks at the data hourly, you're paying for 23 hours of idle executors.

`trigger(once=True)` keeps everything good about streaming, including checkpoints, exactly-once file tracking, and Auto Loader's bookkeeping, but processes whatever is available and then stops. Schedule the notebook as a Databricks job on a job cluster every 15 or 60 minutes and you get incremental processing at batch prices. The catch is start-up time: a new job cluster takes several minutes to come up on every run, so at intervals much below 15 minutes you spend a large share of each run waiting for VMs, and an always-on cluster can end up costing about the same. Attaching the job cluster to an [instance pool](https://learn.microsoft.com/en-us/azure/databricks/compute/pool-index) of idle, pre-provisioned VMs cuts that start-up time. Moving to an always-on `processingTime` trigger later means changing one line, because the checkpoint carries over.

My rule of thumb: use an always-on `processingTime` trigger only when someone will act on the data within minutes. Otherwise, run trigger once on a schedule.

## Silver: MERGE inside foreachBatch

Delta's streaming sink can append or rewrite the whole table (complete mode), but it can't upsert. Silver needs upserts, because sources resend events and corrected records reuse the same key. The standard pattern is [`foreachBatch`](https://learn.microsoft.com/en-us/azure/databricks/structured-streaming/foreach), which hands you each micro-batch as an ordinary DataFrame so you can run a [Delta `MERGE`](https://learn.microsoft.com/en-us/azure/databricks/delta/merge) against it.

There are two details people miss. First, `MERGE` fails if more than one source row matches the same target row, so you must deduplicate inside the batch before merging. Second, `foreachBatch` is at-least-once. If the job dies after the merge commits but before the checkpoint does, the batch runs again. A keyed `MERGE` with an "only if newer" condition handles that safely, while a blind append would double-count.

```python
# Same notebook: reuses lake from the bronze cell and the notebook's spark session
from delta.tables import DeltaTable
from pyspark.sql import Window
from pyspark.sql.functions import col, lower, trim, row_number, to_date

silver_path = f"{lake}/silver/events"

spark.sql(f"""
    CREATE TABLE IF NOT EXISTS silver_events (
        event_id STRING,
        user_id STRING,
        event_type STRING,
        event_time TIMESTAMP,
        event_date DATE,
        amount DOUBLE
    )
    USING DELTA
    PARTITIONED BY (event_date)
    LOCATION '{silver_path}'
""")

def upsert_to_silver(batch_df, batch_id):
    latest_first = Window.partitionBy("event_id").orderBy(col("event_time").desc())
    cleaned = (
        batch_df
        .filter(col("event_id").isNotNull() & col("user_id").isNotNull())
        .withColumn("event_type", lower(trim(col("event_type"))))
        .withColumn("event_date", to_date(col("event_time")))
        .withColumn("rn", row_number().over(latest_first))
        .filter(col("rn") == 1)
        .select("event_id", "user_id", "event_type", "event_time", "event_date", "amount")
    )

    (
        DeltaTable.forPath(spark, silver_path).alias("t")
        .merge(cleaned.alias("s"), "t.event_id = s.event_id")
        .whenMatchedUpdateAll(condition="s.event_time > t.event_time")
        .whenNotMatchedInsertAll()
        .execute()
    )

silver_query = (
    spark.readStream
    .format("delta")
    .load(f"{lake}/bronze/events")
    .writeStream
    .foreachBatch(upsert_to_silver)
    .option("checkpointLocation", f"{lake}/_checkpoints/silver_events")
    .trigger(once=True)
    .start()
)

silver_query.awaitTermination()
```

Merge cost scales with how many target files the match touches. If your key is random (a GUID) and silver is large, every batch rewrites files across many partitions. Narrow the search with a literal predicate on the partition column, for example `t.event_date >= current_date() - 7 AND t.event_id = s.event_id`, so Delta can skip partitions it doesn't need. Size that bound to how late corrections arrive: a corrected record whose existing row sits outside the window won't match, and the merge inserts a second row with the same `event_id`. The same applies if you match on `t.event_date = s.event_date` and a correction moves an event to a different date, so only key on the date when event dates never change. Runtime 7.5 also makes `MERGE INTO` use Optimized Writes automatically, which helps with the small files that merges otherwise leave behind.

## Gold: rebuild a bounded window

Gold tables are usually aggregates. Merging aggregates incrementally is fiddly and easy to get wrong, so I don't. I recompute a recent window and replace just that slice with `replaceWhere`.

```python
# Same notebook: reuses lake and silver_path from the earlier cells
from datetime import date, timedelta
from pyspark.sql.functions import col, countDistinct, count, sum as sum_

window_start = (date.today() - timedelta(days=3)).isoformat()

daily = (
    spark.read.format("delta").load(silver_path)
    .filter(col("event_date") >= window_start)
    .groupBy("event_date", "event_type")
    .agg(
        countDistinct("user_id").alias("active_users"),
        count("*").alias("events"),
        sum_("amount").alias("total_amount"),
    )
)

(
    daily.write
    .format("delta")
    .mode("overwrite")
    .option("replaceWhere", f"event_date >= '{window_start}'")
    .partitionBy("event_date")
    .save(f"{lake}/gold/daily_event_summary")
)
```

The three-day window is your late-data tolerance. Choose it from how late events really arrive, not from a default. Anything older than that is frozen, and if a correction has to reach back further, run a one-off backfill with a wider window.

## Keeping the tables healthy

Streaming writes produce lots of small files. Three habits keep that under control:

- **Auto Optimize on the hot tables.** Set `delta.autoOptimize.optimizeWrite` and `delta.autoOptimize.autoCompact` to `true` as table properties on bronze and silver. You get fewer, larger files at the cost of slightly slower writes.
- **Scheduled `OPTIMIZE ... ZORDER BY`** on silver, using the columns people filter by that aren't the partition column (often `user_id`). Run it nightly as a separate job, not inside the pipeline.
- **`VACUUM` with the default seven-day retention.** Don't shorten it on a table a stream reads from. A reader or a time-travel query that needs a removed file will fail. If retention is shorter than the stream's lag, the stream will fail on files VACUUM already removed, and recovering means skipping that data or replaying from source.

## When not to build it this way

This design is meant for append-heavy event data with a reliable business key. It's the wrong tool when:

- **The source is a relational database with small dimension tables.** A nightly full copy with Azure Data Factory into a Delta table is simpler and easier to reason about than a streaming chain.
- **There is no stable key.** Without one, silver can't `MERGE`, and you're really building an append log with periodic rebuilds. Design it that way on purpose.
- **Consumers only need SQL over curated files.** If there are no upserts and no streaming, Synapse serverless SQL or [SQL Analytics](/blog/2021-01-08-azure-databricks-sql-analytics/) (in public preview) over a single well-partitioned table may be all you need.

## The short version

Treat each layer as a contract. Bronze appends everything once, silver merges by key, and gold rebuilds a bounded window. Use Auto Loader with an explicit schema at the edge and `foreachBatch` with `MERGE` in the middle, and run the whole chain with trigger once on a job schedule until someone shows you a business reason to pay for continuous. Most of the trouble I see in Delta pipelines comes from skipping one of those contracts, not from Delta itself.
