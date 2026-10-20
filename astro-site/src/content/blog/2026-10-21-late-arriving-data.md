---
title: "Late-Arriving Data: Deciding When a Day Is Actually Done"
author: Michael John Peña
draft: false
date: 2026-10-21T12:03:00Z
description: "Late data isn't an edge case. It's a distribution, and you can measure it. How to find out how late your data really is, pick a waiting policy from that, handle what arrives after the policy closes (in batch, in streaming, and in dimensions), and tell consumers when a number is final."
tags:
  - Data Engineering
  - Streaming
  - Spark
  - Data Modeling
  - Data Quality
---

The [previous post](/blog/2026-10-21-event-time-vs-processing-time) ended with Monday's order count still changing on Wednesday. The fix there was to group by event time and select by ingestion time, so that late events land on the right day. That leaves three questions it didn't answer: how late can events be, how long should you wait for them, and what happens to the ones that arrive after you stop waiting?

Most teams never answer those questions on purpose. The answers end up being whatever the pipeline happens to do: a lookback of one day because the first version had one, a streaming watermark of ten minutes copied from a tutorial, and a finance report that silently disagrees with the dashboard every month-end.

## Lateness is a distribution: measure it

"Late" means the gap between event time and ingestion time. Every source has its own distribution of that gap, with a long tail. You can't pick a sensible waiting policy without seeing that tail.

The most useful view is a **completeness curve**: for event days old enough that their stragglers have certainly landed, what fraction of each day's final rows had arrived by D+0, D+1, D+2, and so on?

<div class="code-title">analysis/completeness_curve.sql</div>

```sql
WITH settled AS (               -- only days old enough that the tail has landed
  SELECT datediff(to_date(_ingested_at), to_date(event_ts)) AS days_late
  FROM bronze.orders
  WHERE event_ts >= date_sub(current_date(), 120)
    AND event_ts <  date_sub(current_date(), 30)
)
SELECT days_late,
       count(*) AS rows,
       round(100 * sum(count(*)) OVER (ORDER BY days_late)
                 / sum(count(*)) OVER (), 3) AS pct_complete
FROM settled
GROUP BY days_late
ORDER BY days_late
```

The window that excludes the last 30 days matters. If you include recent days, their late rows haven't arrived yet, and the curve looks better than reality. An example of what comes back (your numbers will differ, which is the point of running it):

| Days late | Cumulative % of a day's rows |
|---|---|
| 0 (same day) | 91.8% |
| 1 | 98.9% |
| 2 | 99.6% |
| 3 | 99.93% |
| 7 | 99.99% |
| 30+ | 100% |

That table turns an argument into a decision. With a three-day lookback, a published day is 99.93% complete, and the 0.07% that misses it is the volume you need a separate plan for. Run the same query per source system. One mobile client with a bad offline queue can account for the whole tail.

Hours and minutes work the same way for streaming sources: `unix_timestamp(_ingested_at) - unix_timestamp(event_ts)` with `percentile_approx` at 0.5, 0.99, and 0.999.

## Three decisions, written down

<div class="cl cl-key">
<div class="cl-tag">Policy</div>
<div class="cl-body">

For every table people make decisions from, write down:

1. **The wait.** How long after an event period ends you keep correcting it (the lookback or watermark).
2. **The finality point.** When a period is published as final, and how consumers can see that.
3. **The after-policy path.** What happens to an event that arrives after the period is final: drop it, restate the period, or post it as an adjustment.

</div>
</div>

If the third answer is "we don't know", the actual answer is either *dropped silently* or *restated silently*, depending on how the code happens to be written. Neither is acceptable for a revenue number.

## Batch: rolling recompute

The simplest batch policy that works: on every run, rebuild the last *N* event days from scratch, where *N* comes from the completeness curve.

<div class="code-title">gold/daily_orders.py</div>

```python
from datetime import date, timedelta

LOOKBACK_DAYS = 3        # from the completeness curve: 99.93% at D+3

def run(spark, logical_date: str):
    end = date.fromisoformat(logical_date)
    start = end - timedelta(days=LOOKBACK_DAYS)
    window = f"order_date BETWEEN DATE'{start}' AND DATE'{end}'"

    daily = spark.sql(f"""
        SELECT order_date, store_id,
               count(*)    AS orders,
               sum(amount) AS revenue,
               max(_ingested_at) AS data_as_of
        FROM silver.orders
        WHERE {window}
        GROUP BY order_date, store_id
    """)

    (daily.write.format("delta").mode("overwrite")
        .option("replaceWhere", window)
        .saveAsTable("gold.daily_orders"))
```

This is idempotent because it replaces a fixed slice. It's also easy to reason about: any day within *N* of today is provisional, and anything older is final. The cost is recomputing *N* days on every run, which is cheap for daily aggregates and expensive for large fact tables. For those, use the "recompute only the touched days" variant from the previous post: find the event dates in newly ingested rows and rebuild only those, capped at the lookback so a stray 2019 event doesn't reopen 2019.

### Tell consumers what's final

A number that might still change needs a label saying so. Two columns are enough:

- `data_as_of`: the latest ingestion time included in the row (as computed above).
- `is_final`: `order_date < logical_date - LOOKBACK_DAYS`.

Dashboards can then show provisional days differently, such as a hatched bar or a footnote, and the "the numbers changed!" message becomes a known property of the report rather than an incident.

### After the books close

Some consumers, finance in particular, can't accept a closed period changing. For them, events that arrive after the finality point shouldn't modify the closed day at all. They go into an **adjustments** table dated by *arrival*, attributed to the original event date, and reported in the current open period. That's how accounting has handled late invoices for a few hundred years. The data platform doesn't need a better answer, only the same one implemented on purpose.

## Streaming: watermarks are the same policy, enforced by the engine

In Spark Structured Streaming, a watermark is the waiting policy expressed in code. Spark tracks the maximum event time it has seen, subtracts the delay you give it, and treats that as the point before which it no longer expects data.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 300" role="img" aria-label="An event-time axis from 11:00 to 16:00 with four one-hour windows. The maximum event time seen is 15:40 and the watermark, two hours behind it, is at 13:40. The 12:00 to 13:00 window ends before the watermark, so it has been finalised and its state dropped; a late event at 12:35 arriving now is discarded. The 13:00 to 14:00 window is still open because the watermark is inside it; a late event at 13:20 is still counted.">
<defs>
<marker id="ldD" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah-dash"/></marker>
</defs>
<rect x="220" y="70" width="160" height="124" rx="10" class="ff-zone ff-zone-neutral"/>
<rect x="380" y="70" width="160" height="124" rx="10" class="ff-zone ff-zone-read"/>
<rect x="540" y="70" width="160" height="124" rx="10" class="ff-zone ff-zone-read"/>
<rect x="700" y="70" width="160" height="124" rx="10" class="ff-zone ff-zone-read"/>
<text x="230" y="90" class="ff-zlabel">12:00–13:00</text>
<text x="230" y="107" class="ff-sub">finalised · state dropped</text>
<text x="390" y="90" class="ff-zlabel">13:00–14:00</text>
<text x="390" y="107" class="ff-sub">open</text>
<text x="550" y="90" class="ff-zlabel">14:00–15:00</text>
<text x="550" y="107" class="ff-sub">open</text>
<text x="710" y="90" class="ff-zlabel">15:00–16:00</text>
<text x="710" y="107" class="ff-sub">open</text>
<line x1="487" y1="50" x2="487" y2="210" class="ff-edge-write"/>
<text x="487" y="42" text-anchor="middle" class="ff-elabel ff-amt">watermark = 13:40</text>
<line x1="807" y1="50" x2="807" y2="210" class="ff-edge-read"/>
<text x="790" y="42" text-anchor="middle" class="ff-elabel ff-cyt">max(event_ts) = 15:40</text>
<line x1="803" y1="136" x2="493" y2="136" class="ff-edge-dash" marker-end="url(#ldD)"/>
<rect x="590" y="127" width="114" height="17" rx="4" class="ff-elabel-bg"/>
<text x="647" y="139" text-anchor="middle" class="ff-elabel">delay = 2 hours</text>
<circle cx="313" cy="156" r="6" fill="#e0554a"/>
<text x="313" y="182" text-anchor="middle" class="ff-elabel" style="fill:#e0554a">12:35 · dropped</text>
<circle cx="433" cy="156" r="6" fill="#e0a04a"/>
<text x="433" y="182" text-anchor="middle" class="ff-elabel ff-amt">13:20 · counted</text>
<line x1="60" y1="210" x2="860" y2="210" class="ff-edge"/>
<text x="60" y="228" text-anchor="middle" class="ff-sub">11:00</text>
<text x="220" y="228" text-anchor="middle" class="ff-sub">12:00</text>
<text x="380" y="228" text-anchor="middle" class="ff-sub">13:00</text>
<text x="540" y="228" text-anchor="middle" class="ff-sub">14:00</text>
<text x="700" y="228" text-anchor="middle" class="ff-sub">15:00</text>
<text x="845" y="228" text-anchor="middle" class="ff-sub">16:00</text>
<text x="60" y="88" class="ff-zlabel">EVENT TIME</text>
<text x="60" y="262" class="ff-sub">Both late events arrive after the stream has already seen 15:40. The one whose window ends before the watermark is discarded;</text>
<text x="60" y="280" class="ff-sub">the one whose window is still open is aggregated normally. Nothing in the output records the discarded row.</text>
</svg>
<figcaption><b>A watermark in one picture.</b> The watermark trails the latest event time by the configured delay. Windows that end before it are emitted (in append mode) and their state is released, so rows that arrive for them afterwards have nowhere to go.</figcaption>
</figure>

Four details matter in production:

- **The guarantee only goes one way.** Spark guarantees it won't drop data that's within the delay. It does *not* guarantee it will drop data beyond it, because rows are evaluated against the watermark as of the current batch. Don't build logic that depends on late rows definitely being excluded.
- **Output mode changes latency.** In `append` mode a window is emitted only once the watermark passes its end, so a one-hour window with a two-hour delay appears up to three hours after its first event. `update` mode emits partial results as they change, which suits sinks that can upsert.
- **Several inputs share one watermark.** When a query has more than one watermarked input (for example a stream-stream join), Spark uses the *minimum* by default (`spark.sql.streaming.multipleWatermarkPolicy = min`), so the slowest stream holds back state cleanup for all of them.
- **Dropped rows are counted, not kept.** Each stateful operator reports `numRowsDroppedByWatermark` in the query progress. There's no side output containing the rows. Monitor the count:

<div class="code-title">streaming/monitor.py</div>

```python
progress = query.lastProgress or {}
dropped = sum(op.get("numRowsDroppedByWatermark", 0)
              for op in progress.get("stateOperators", []))
if dropped:
    emit_metric("orders_per_hour.rows_dropped_by_watermark", dropped)
```

The design that keeps streaming honest is to **never apply the watermark to your only copy of the data**. Land every raw event in bronze unconditionally, with no watermark and no state. Run the watermarked aggregation as a fast, slightly approximate view for operational dashboards, and have the batch rolling recompute from bronze produce the numbers that are reported. The watermark controls how much state the stream keeps in memory. It shouldn't decide which events your business ever sees.

## Late-arriving dimensions (facts that arrive first)

The same problem appears in dimensional models in reverse. An order arrives for `customer_id = 88412`, but the customer record from the CRM hasn't been loaded yet because it's on a slower feed. The fact is on time and the dimension is late.

| Option | What happens | Problem |
|---|---|---|
| Inner join, drop the fact | The order disappears from revenue | Silent data loss |
| Map to an "Unknown" member (`-1`) | The order counts, but under Unknown | The link is lost forever unless you reprocess the fact |
| **Inferred member** | Create a placeholder dimension row for 88412 now, and fill it in when the real record arrives | A little more logic in the dimension load |

Inferred members keep the fact's surrogate key stable, so no fact reprocessing is needed. Before loading facts, insert any business keys the dimension hasn't seen:

<div class="code-title">gold/dim_customer_inferred.sql</div>

```sql
MERGE INTO gold.dim_customer AS d
USING (SELECT DISTINCT customer_id FROM silver.orders_batch) AS f
ON d.customer_id = f.customer_id
WHEN NOT MATCHED THEN INSERT
  (customer_sk, customer_id, name, segment, is_inferred, valid_from, valid_to, is_current)
VALUES
  (xxhash64(f.customer_id), f.customer_id, 'Unknown (pending)', 'Unknown',
   true, TIMESTAMP'1900-01-01', TIMESTAMP'9999-12-31', true)
```

When the real customer record arrives, the dimension load **updates the inferred row in place** (`WHEN MATCHED AND d.is_inferred THEN UPDATE ... is_inferred = false`) instead of creating a new version. The placeholder was never a true historical state, so it shouldn't appear in history. `valid_from = 1900-01-01` means facts from before the record existed still find it. Track a count of `is_inferred = true` rows older than a day. A growing count means the dimension feed is broken, not just slow.

And when a *fact* arrives late into a [Type 2 dimension](/blog/2026-10-21-slowly-changing-dimensions), look up the version that was valid at the fact's event time, not the current one. Otherwise a February order gets attributed to the segment the customer moved to in October.

## On Monday

- Run the completeness curve for your three most important sources and read the tail.
- Set each table's lookback from the curve, and add `data_as_of` and `is_final` columns.
- Write the after-policy rule for finance-facing tables: restate or adjust.
- Make sure no watermark sits between a source and your only stored copy of its data.
- Alert on `numRowsDroppedByWatermark` and on old inferred dimension members.

Data will always arrive late. What you control is whether you've decided what happens to it, or whether the code decides by accident.

<nav class="series" aria-label="Series">
<div class="series-k">Series · Part 4 of 10</div>
<div class="series-t">Ten data engineering concepts worth learning before the 2 AM page</div>
<ol>
<li><a href="/blog/2026-10-21-idempotent-writes-and-why-retries-duplicate-data">Idempotent writes, and why retries duplicate data</a></li>
<li><a href="/blog/2026-10-21-the-grain-of-a-table">The grain of a table</a></li>
<li><a href="/blog/2026-10-21-event-time-vs-processing-time">Event time vs processing time</a></li>
<li class="on">Late-arriving data</li>
<li><a href="/blog/2026-10-21-data-skew-in-spark">Data skew</a></li>
<li><a href="/blog/2026-10-21-reading-a-spark-query-plan">Reading a Spark query plan</a></li>
<li><a href="/blog/2026-10-21-partition-pruning">Partition pruning</a></li>
<li><a href="/blog/2026-10-21-the-small-files-problem">The small files problem</a></li>
<li><a href="/blog/2026-10-21-slowly-changing-dimensions">Slowly changing dimensions</a></li>
<li><a href="/blog/2026-10-21-schema-evolution">Schema evolution</a></li>
</ol>
</nav>
