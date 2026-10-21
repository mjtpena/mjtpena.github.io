---
title: "Event Time vs Processing Time: Know Which Clock Your Numbers Are On"
author: Michael John Peña
draft: false
date: 2026-09-02
url: "/blog/2026-10-21-event-time-vs-processing-time/"
description: "Every record has three timestamps: when it happened, when it arrived, and when it was processed. Group by the wrong one and past days keep changing."
tags:
  - Data Engineering
  - Streaming
  - Spark
  - Time
  - Data Quality
---

On Tuesday morning the dashboard says Monday had 48,210 orders. On Wednesday morning it says Monday had 49,877. Nobody backfilled anything and no job failed. Each day someone asks whether the numbers are "still settling", and nobody can say what that means or when it stops.

When a past day's total keeps moving and nobody can explain why, the usual cause is that the pipeline is using one clock while the report is labelled with another.

## Every record has at least three times

| Clock | Meaning | Who sets it | Can you trust it? |
|---|---|---|---|
| **Event time** | When the thing happened in the real world | The producer: a device, app, or source database | Mostly. Device clocks drift, and some events arrive dated 1970 or next year |
| **Ingestion time** | When it reached your platform (broker, landing zone, bronze) | Your platform | Yes. It's your clock, and it only goes forward |
| **Processing time** | When a particular job run read it | Whatever machine runs the job | It's accurate, but it's a property of the *run*, not the data |

Batch pipelines add a fourth clock: the **logical date** of the run, meaning the slice of time the orchestrator asked the job to handle. A rerun of "the 1st of October" on the 9th has a logical date of the 1st and a processing time of the 9th.

These would all match in a perfect system. In practice they drift apart for ordinary reasons: mobile apps buffer events while offline, SaaS sources export in hourly batches, upstream systems have outages and then flush their backlog, and retries delay delivery. The gap is normally seconds. Sometimes it's days.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 340" role="img" aria-label="Two timelines from 20:00 on October 1 to 08:00 on October 2. Five events are plotted at their event time on the top axis and connected to their processing time on the bottom axis. Most lines are nearly vertical. One event at 23:58 is processed at 00:04 and crosses midnight. An event from an offline phone at 21:10 is processed at 07:30 the next morning. Counting by event date gives four events on October 1 and one on October 2; counting by processing date gives two and three.">
<rect x="20" y="20" width="860" height="262" rx="16" class="ff-zone ff-zone-neutral"/>
<line x1="327" y1="56" x2="327" y2="252" class="ff-edge-dash"/>
<text x="335" y="52" class="ff-zlabel">00:00 · OCT 2</text>
<text x="60" y="52" class="ff-zlabel">OCT 1</text>
<text x="44" y="80" class="ff-zlabel ff-cyt">EVENT TIME · WHEN IT HAPPENED</text>
<line x1="60" y1="110" x2="860" y2="110" class="ff-edge"/>
<text x="44" y="272" class="ff-zlabel ff-amt">PROCESSING TIME · WHEN THE JOB SAW IT</text>
<line x1="60" y1="230" x2="860" y2="230" class="ff-edge"/>
<text x="60" y="100" text-anchor="middle" class="ff-sub">20:00</text>
<text x="193" y="100" text-anchor="middle" class="ff-sub">22:00</text>
<text x="460" y="100" text-anchor="middle" class="ff-sub">02:00</text>
<text x="593" y="100" text-anchor="middle" class="ff-sub">04:00</text>
<text x="727" y="100" text-anchor="middle" class="ff-sub">06:00</text>
<text x="845" y="100" text-anchor="middle" class="ff-sub">08:00</text>
<text x="60" y="250" text-anchor="middle" class="ff-sub">20:00</text>
<text x="193" y="250" text-anchor="middle" class="ff-sub">22:00</text>
<text x="460" y="250" text-anchor="middle" class="ff-sub">02:00</text>
<text x="593" y="250" text-anchor="middle" class="ff-sub">04:00</text>
<text x="727" y="250" text-anchor="middle" class="ff-sub">06:00</text>
<line x1="127" y1="110" x2="129" y2="230" class="ff-edge-read"/>
<line x1="227" y1="110" x2="228" y2="230" class="ff-edge-read"/>
<line x1="393" y1="110" x2="394" y2="230" class="ff-edge-read"/>
<line x1="320" y1="110" x2="334" y2="230" class="ff-edge-write"/>
<line x1="138" y1="110" x2="827" y2="230" class="ff-edge-dash" style="stroke:#e0554a"/>
<circle cx="127" cy="110" r="4.5" fill="#00B7C3"/><circle cx="129" cy="230" r="4.5" fill="#00B7C3"/>
<circle cx="227" cy="110" r="4.5" fill="#00B7C3"/><circle cx="228" cy="230" r="4.5" fill="#00B7C3"/>
<circle cx="393" cy="110" r="4.5" fill="#00B7C3"/><circle cx="394" cy="230" r="4.5" fill="#00B7C3"/>
<circle cx="320" cy="110" r="4.5" fill="#e0a04a"/><circle cx="334" cy="230" r="4.5" fill="#e0a04a"/>
<circle cx="138" cy="110" r="4.5" fill="#e0554a"/><circle cx="827" cy="230" r="4.5" fill="#e0554a"/>
<text x="236" y="168" class="ff-elabel ff-amt">23:58 → 00:04</text>
<text x="510" y="160" class="ff-elabel" style="fill:#e0554a">offline phone · 21:10 → 07:30</text>
<text x="44" y="308" class="ff-tok">by event date: Oct 1 = 4 · Oct 2 = 1</text>
<text x="44" y="326" class="ff-tok ff-amt">by processing date: Oct 1 = 2 · Oct 2 = 3</text>
<text x="860" y="317" text-anchor="end" class="ff-sub">same five events, two different days</text>
</svg>
<figcaption><b>Same events, two clocks.</b> Most events are processed within seconds (vertical lines). The 23:58 event crosses midnight on the way in, and an offline device delivers ten hours late. Whichever clock you group by decides which day these events count towards.</figcaption>
</figure>

## The bugs, one clock at a time

### Reporting processing time as if it were event time

This query looks like "orders per day":

<div class="code-title">the_bug.sql</div>

```sql
SELECT to_date(_ingested_at) AS order_date, count(*) AS orders
FROM bronze.orders
GROUP BY 1
```

It actually counts orders *received* per day, and the label is wrong. On a normal day the two are close enough that nobody notices. After an upstream outage that flushes 30,000 orders the next morning, Monday looks like a disaster and Tuesday looks like a record, and both days get an incident review.

### Selecting new data by event time

The opposite mistake happens in incremental loads:

```sql
SELECT * FROM bronze.orders
WHERE event_ts > '${last_run_max_event_ts}'
```

Any event that arrives after a later event has already been processed will never be picked up, because its event time is behind the cursor. The offline phone in the figure is one example. Nothing errors and the data simply never arrives. That's the main subject of [late-arriving data](/blog/2026-09-09-late-arriving-data/).

### Deriving "yesterday" from the processing clock

`WHERE event_date = current_date() - 1` lets *when the job ran* decide *which data it processes*. A retry that lands after midnight processes the wrong day, and a backfill run on the 9th processes the 8th, however many times you click rerun. The logical date has to come from the orchestrator as a parameter. This is also the most common way jobs lose [idempotence](/blog/2026-08-19-idempotent-writes-and-why-retries-duplicate-data/).

### Time zones

Event time is only meaningful together with a zone, and "day" is a business definition, not a property of the timestamp. Three things go wrong regularly:

- `to_date(ts)` in Spark uses [`spark.sql.session.timeZone`](https://spark.apache.org/docs/latest/configuration.html). Two clusters with different session time zones produce different daily totals from the same table and the same SQL.
- Sources send local time without an offset. Twice a year, daylight saving creates an hour that happens twice and an hour that never happens.
- The business day is in local time (Sydney trading, or a US retail calendar) while storage is in UTC. Midnight UTC is 10 or 11 in the morning in Sydney, so a "daily" UTC partition splits a Sydney trading day in two.

Normalise to UTC at ingestion, keep the original offset, and derive business dates explicitly:

<div class="code-title">silver/time_columns.py</div>

```python
from pyspark.sql import functions as F

spark.conf.set("spark.sql.session.timeZone", "UTC")   # pin it; never inherit it

events = (
    raw
    .withColumn("event_ts", F.to_utc_timestamp("event_local_ts", F.col("source_tz")))
    .withColumn("event_date_utc", F.to_date("event_ts"))
    .withColumn("business_date",
                F.to_date(F.from_utc_timestamp("event_ts", "Australia/Sydney")))
)
```

### Device clocks

Event time comes from a clock you don't own. Phones with the wrong date, embedded devices that reset to the epoch, and servers whose NTP has drifted all produce events "from the future" or from 1970. Check event time against ingestion time, which you do control:

```python
skew = F.col("event_ts").cast("long") - F.col("_ingested_at").cast("long")

events = events.withColumn(
    "event_time_quality",
    F.when(skew > 300, "future")                                   # > 5 min ahead of arrival
     .when(F.col("event_ts") < F.lit("2015-01-01"), "implausible")
     .otherwise("ok"))
```

Decide per source what happens to `future` and `implausible` rows: substitute ingestion time, quarantine them, or keep them and exclude them from reporting. Write the decision down. Silently converting them is how a device fleet with a bad firmware update ends up all counting on the same day in 2036.

## The rule: select by arrival, report by occurrence

Most of this comes down to one rule that you can enforce in code review:

<div class="cl cl-key">
<div class="cl-tag">Rule</div>
<div class="cl-body">

**Use ingestion time to decide what's new. Use event time to decide what it's about.** Incremental filters, cursors, and replay boundaries go on the clock you control. Grouping, windows, and the dates on reports go on the clock the business means.

</div>
</div>

In a batch pipeline that looks like this. Find what arrived since the last run, work out which *event dates* those arrivals affect, and recompute exactly those dates:

<div class="code-title">silver/daily_orders_incremental.py</div>

```python
from pyspark.sql import functions as F

def run(spark, prev_hw: str, hw: str):
    arrived = (spark.read.table("bronze.orders")
               .where((F.col("_ingested_at") > prev_hw) &
                      (F.col("_ingested_at") <= hw)))

    touched = [r.d for r in
               arrived.select(F.to_date("event_ts").alias("d")).distinct().collect()]
    if not touched:
        return

    in_list = ", ".join(f"DATE'{d}'" for d in touched)

    daily = (spark.read.table("silver.orders")
             .where(f"order_date IN ({in_list})")
             .groupBy("order_date")
             .agg(F.count("*").alias("orders"), F.sum("amount").alias("revenue")))

    (daily.write.format("delta").mode("overwrite")
        .option("replaceWhere", f"order_date IN ({in_list})")
        .saveAsTable("gold.daily_orders"))
```

A record that arrives ten hours (or ten days) late adds its event date to `touched`, and that day is rebuilt from scratch. Rebuilding a day is idempotent, and the cursor is on ingestion time, so nothing is skipped. In practice you'd also cap `touched` (if a backfill touches 900 dates, you want an alert rather than a silent 900-day rebuild) and record which days were restated so that consumers know.

The same split applies to storage layout:

- **Bronze**: partition or cluster by ingestion date. It's append-only, you can replay "everything we received on the 3rd", and late events never land in an old partition.
- **Silver and gold**: partition or cluster by event or business date, which is how people [filter their queries](/blog/2026-09-30-partition-pruning/).

## In streaming, the engine needs to be told

Streaming engines expose the same choice directly. In [Spark Structured Streaming](https://spark.apache.org/docs/latest/structured-streaming-programming-guide.html), a window on a timestamp column from the data is an event-time window:

<div class="code-title">streaming/orders_per_hour.py</div>

```python
from pyspark.sql import functions as F

per_hour = (
    orders_stream
    .withWatermark("event_ts", "2 hours")
    .groupBy(F.window("event_ts", "1 hour"), "store_id")
    .agg(F.count("*").alias("orders"))
)
```

The window belongs to the event. The watermark is the part that admits processing time exists: it tells Spark how long to wait for stragglers before it finalises a window and discards the state. Choosing that value and dealing with events beyond it is the subject of the next post in the series.

## A column convention that prevents arguments

Name every clock explicitly and in the same way across tables, so a reader never has to guess what `timestamp` or `date` means:

| Column | Meaning |
|---|---|
| `event_ts` | When it happened, in UTC |
| `event_tz` / `event_offset` | The source's original zone or offset |
| `business_date` | The reporting day, derived with the business's zone and calendar |
| `_ingested_at` | When the platform received it |
| `_processed_at` | When this row was last written by a job |
| `_run_date` | The logical date of the run that wrote it |

The underscore prefix marks platform metadata as opposed to business data. Consumers learn quickly that `_` columns are for lineage and debugging and shouldn't appear in a report axis.

## On Monday

- Pin `spark.sql.session.timeZone` explicitly in every job and notebook.
- Search for `to_date(_ingested_at` and `current_date()` in transformation code. Each hit is a clock mix-up waiting for an outage to expose it.
- Move incremental cursors from event time to ingestion time.
- Add an event-time quality flag comparing event time with ingestion time.
- Write a one-line definition of `business_date` and the zone it uses, and put it in the table comment.

Monday's number will keep changing for a while, because events about Monday keep arriving after Monday. The goal is to make that predictable: you know why it changes, by how much, and when it stops. That's where late-arriving data comes in.

<nav class="series" aria-label="Series">
<div class="series-k">Series · Part 3 of 10</div>
<div class="series-t">Ten data engineering concepts worth learning before the 2 AM page</div>
<ol>
<li><a href="/blog/2026-08-19-idempotent-writes-and-why-retries-duplicate-data/">Idempotent writes, and why retries duplicate data</a></li>
<li><a href="/blog/2026-08-26-the-grain-of-a-table/">The grain of a table</a></li>
<li class="on">Event time vs processing time</li>
<li><a href="/blog/2026-09-09-late-arriving-data/">Late-arriving data</a></li>
<li><a href="/blog/2026-09-16-data-skew-in-spark/">Data skew</a></li>
<li><a href="/blog/2026-09-23-reading-a-spark-query-plan/">Reading a Spark query plan</a></li>
<li><a href="/blog/2026-09-30-partition-pruning/">Partition pruning</a></li>
<li><a href="/blog/2026-10-07-the-small-files-problem/">The small files problem</a></li>
<li><a href="/blog/2026-10-14-slowly-changing-dimensions/">Slowly changing dimensions</a></li>
<li><a href="/blog/2026-10-21-schema-evolution/">Schema evolution</a></li>
</ol>
</nav>
