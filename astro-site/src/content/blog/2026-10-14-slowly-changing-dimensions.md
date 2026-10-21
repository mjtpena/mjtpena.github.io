---
title: "Slowly Changing Dimensions Without Corrupting Your Facts"
author: Michael John Peña
draft: false
date: 2026-10-14
url: "/blog/2026-10-21-slowly-changing-dimensions/"
description: "Should last year's revenue move when a customer changes segment? Pick an SCD type per column, write a replay-safe Type 2 MERGE, and join facts correctly."
tags:
  - Data Engineering
  - Data Modeling
  - Delta Lake
  - SQL
  - Analytics
---

In July, the Q2 revenue-by-segment report shows Enterprise at $4.1M. In October, someone reruns the same report for the same quarter and Enterprise shows $5.3M. No Q2 orders were added, removed, or changed. What changed is that forty customers were reclassified from Mid-Market to Enterprise in August, and the customer dimension overwrote their segment. All of their Q2 revenue moved with them.

The team then switches to keeping history, and the next month total revenue comes out three times too high, because the fact table now joins to every historical version of each customer.

Both are **slowly changing dimension** bugs. The first loses history, the second mishandles it, and both are common.

## The question an SCD answers

A dimension attribute changes: a customer's segment, a product's category, a store's region. **Which value should facts from before the change see?**

That's a business question ([Microsoft's star schema guidance](https://learn.microsoft.com/en-us/power-bi/guidance/star-schema) frames it the same way), and the answer can differ between columns of the same table. Finance probably wants Q2 revenue reported under the segment customers had *in Q2*. Account management probably wants it under the segment they have *now*, to see how their current book has grown. Both are valid. Problems start when nobody decides and the dimension load chooses implicitly.

| Type | On change | History | Typical use |
|---|---|---|---|
| **0** | Never change | Original value only | Date of birth, original signup channel |
| **1** | Overwrite | None. Facts see the current value | Corrections, typos, contact details |
| **2** | Close the old row, insert a new version | Full. Facts see the value as of their own time | Segment, region, territory, price tier |
| **3** | Move the old value to a `previous_` column | One step back | Before/after comparisons for a single reorganisation |
| **4** | Current values in the dimension, history in a separate table | Full, stored separately | Fast-changing attributes that would multiply Type 2 rows |
| **6** | Type 2 rows plus a Type 1 `current_` column on every version | Full, and current value always available | When both questions (as-then and as-now) are asked regularly |

<div class="cl cl-key">
<div class="cl-tag">Decide per column</div>
<div class="cl-body">

A dimension is rarely all one type. Typically a handful of attributes that facts are sliced by historically are **Type 2**, contact details and corrections are **Type 1**, and noisy operational fields are kept out of the dimension altogether. Write the type of each column in the table's documentation.

</div>
</div>

Be careful which columns you track. If `last_login_at` is a Type 2 column, every active customer gets a new version every day. The dimension grows faster than the fact table, and every point-in-time join gets slower. Tracked columns should be the ones that answer "what was it at the time of the fact?", not every column that happens to change.

## Type 2, designed properly

<div class="code-title">ddl/dim_customer.sql</div>

```sql
CREATE TABLE gold.dim_customer (
  customer_sk  BIGINT    NOT NULL,   -- surrogate key: one per version
  customer_id  STRING    NOT NULL,   -- business key: one per customer
  name         STRING,               -- Type 1
  segment      STRING,               -- Type 2
  region       STRING,               -- Type 2
  row_hash     STRING    NOT NULL,   -- hash of the Type 2 columns only
  valid_from   TIMESTAMP NOT NULL,   -- inclusive
  valid_to     TIMESTAMP NOT NULL,   -- exclusive; 9999-12-31 for the current version
  is_current   BOOLEAN   NOT NULL
)
COMMENT 'Grain: one row per customer version. Type 2 on segment, region.';
```

A few choices here are worth explaining:

- **Half-open intervals.** `valid_from` is inclusive and `valid_to` is exclusive, so a version ending at `2026-07-01 00:00` and the next one starting at the same instant don't overlap and don't leave a gap. With `BETWEEN` and inclusive ends, a fact at exactly `2026-07-01 00:00` matches both versions.
- **A sentinel instead of `NULL`** for the open end. `valid_to = 9999-12-31` lets every lookup use the same `>= / <` predicate without `OR valid_to IS NULL`.
- **Change detection on a hash of the Type 2 columns.** Compare one column instead of many. Build the hash so that nulls can't collide:

```sql
-- WRONG: concat_ws skips NULLs, so ('A', NULL) and (NULL, 'A') hash the same
sha2(concat_ws('||', segment, region), 256)

-- RIGHT: field names and nulls are part of the input
sha2(to_json(named_struct('segment', segment, 'region', region)), 256)
```

- **A deterministic surrogate key.** `xxhash64(customer_id, valid_from)` produces the same key every time the same version is loaded. Identity columns and `monotonically_increasing_id()` produce new keys on every rerun, which breaks the [idempotence](/blog/2026-08-19-idempotent-writes-and-why-retries-duplicate-data/) the next section relies on.

## The load: one MERGE, safe to replay

A Type 2 change needs two writes to the target: **update** the current row to close it, and **insert** the new version. `MERGE` applies one action per source row, so the standard approach (also the example in the [Delta Lake docs](https://docs.delta.io/latest/delta-update.html)) is to feed each changed row in *twice*: once with a key that matches the current version (to close it) and once with a `NULL` key that can't match anything (to insert the new version).

<div class="code-title">gold/dim_customer_scd2.sql</div>

```sql
MERGE INTO gold.dim_customer AS t
USING (
  -- 1) every staged row, keyed: matches the current version if one exists
  SELECT s.customer_id AS merge_key, s.*
  FROM stg_customer s

  UNION ALL

  -- 2) changed rows again, with a NULL key: never matches, so it inserts the new version
  SELECT NULL AS merge_key, s.*
  FROM stg_customer s
  JOIN gold.dim_customer d
    ON d.customer_id = s.customer_id AND d.is_current
  WHERE d.row_hash <> s.row_hash
    AND s.changed_at > d.valid_from          -- ignore replays of older changes
) AS src
ON t.customer_id = src.merge_key AND t.is_current
WHEN MATCHED
  AND t.row_hash <> src.row_hash
  AND src.changed_at > t.valid_from THEN
  UPDATE SET t.is_current = false,
             t.valid_to   = src.changed_at
WHEN NOT MATCHED THEN
  INSERT (customer_sk, customer_id, name, segment, region, row_hash,
          valid_from, valid_to, is_current)
  VALUES (xxhash64(src.customer_id, src.changed_at), src.customer_id, src.name,
          src.segment, src.region, src.row_hash,
          src.changed_at, TIMESTAMP'9999-12-31', true)
```

Here's what each kind of staged row does:

| Staged row | Branch 1 (keyed) | Branch 2 (`NULL` key) | Result |
|---|---|---|---|
| New customer | No match → **insert** | Not produced (no current row to join) | First version created |
| Unchanged customer | Matches, hash equal → nothing | Not produced | No-op |
| Changed customer | Matches, hash differs → **close** current | Produced → **insert** | Old version closed, new one current |
| Same batch replayed | Matches the *new* current, hash equal → nothing | Not produced (hash equal) | No-op: idempotent |
| Older change replayed | Guard `changed_at > valid_from` fails → nothing | Guard fails → not produced | No-op: history not rewound |

Two preconditions. First, **staging must be at the grain of one row per customer per batch**. `MERGE` fails if two source rows match the same target row, and that's the [grain](/blog/2026-08-26-the-grain-of-a-table/) rule again. If a batch can contain several changes to the same customer, as in CDC, either process them one at a time in order or use the rebuild approach below. Second, Type 1 columns such as `name` aren't in `row_hash`, so update them with a separate statement that sets them on **all** versions of the key. A Type 1 change applies to history as well.

## Joining facts: point in time, never just the business key

There are three ways to join a fact to this dimension, and two of them are wrong:

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 312" role="img" aria-label="Timeline for customer C-88412 with three versions: SMB from March 2025 to February 2026, Mid-Market from February to July 2026, and Enterprise from July 2026 onward, which is current. An order on 18 April 2026 falls inside the Mid-Market version. Joining on customer and time range returns one row, Mid-Market. Joining on the current flag returns Enterprise, rewriting history. Joining on the business key alone returns three rows.">
<text x="40" y="36" class="ff-zlabel">CUSTOMER C-88412 · THREE VERSIONS</text>
<text x="40" y="88" class="ff-tok">v1 · SMB</text>
<text x="40" y="128" class="ff-tok">v2 · Mid-Market</text>
<text x="40" y="168" class="ff-tok">v3 · Enterprise</text>
<rect x="218" y="70" width="331" height="28" rx="6" class="ff-node"/>
<text x="383" y="89" text-anchor="middle" class="ff-sub">2025-03-01 → 2026-02-10</text>
<rect x="549" y="110" width="136" height="28" rx="6" class="ff-node ff-node-cy"/>
<rect x="685" y="150" width="175" height="28" rx="6" class="ff-node ff-node-am"/>
<text x="772" y="169" text-anchor="middle" class="ff-sub" style="fill:#e8ecef">2026-07-01 → · current</text>
<line x1="614" y1="54" x2="614" y2="196" class="ff-edge-dash"/>
<text x="614" y="48" text-anchor="middle" class="ff-elabel">order · 2026-04-18</text>
<circle cx="614" cy="124" r="5" fill="#00B7C3"/>
<line x1="160" y1="206" x2="860" y2="206" class="ff-edge"/>
<text x="160" y="224" text-anchor="middle" class="ff-sub">Jan 2025</text>
<text x="335" y="224" text-anchor="middle" class="ff-sub">Jul 2025</text>
<text x="510" y="224" text-anchor="middle" class="ff-sub">Jan 2026</text>
<text x="685" y="224" text-anchor="middle" class="ff-sub">Jul 2026</text>
<text x="845" y="224" text-anchor="middle" class="ff-sub">2027</text>
<text x="40" y="256" class="ff-tok">ON id AND order_ts ∈ [valid_from, valid_to)</text>
<text x="860" y="256" text-anchor="end" class="ff-tok">1 row · Mid-Market ✓</text>
<text x="40" y="278" class="ff-tok ff-amt">ON id AND is_current</text>
<text x="860" y="278" text-anchor="end" class="ff-tok ff-amt">1 row · Enterprise (history rewritten)</text>
<text x="40" y="300" class="ff-tok" style="fill:#e0554a">ON id</text>
<text x="860" y="300" text-anchor="end" class="ff-tok" style="fill:#e0554a">3 rows · revenue counted ×3</text>
</svg>
<figcaption><b>One order, three joins.</b> Only the point-in-time join answers "what segment was this customer in when they ordered?" Joining to the current row answers a different question. Joining on the business key alone multiplies the fact by the number of versions.</figcaption>
</figure>

The standard Kimball approach is to do the point-in-time lookup **once, when the fact is loaded**, and store the surrogate key in the fact table. Reports then join on `customer_sk` with a simple 1:1 equi-join:

<div class="code-title">gold/fact_orders_load.sql</div>

```sql
SELECT o.order_id, o.order_ts, o.amount,
       COALESCE(d.customer_sk, -1) AS customer_sk     -- -1: unknown member
FROM silver.orders o
LEFT JOIN gold.dim_customer d
  ON  d.customer_id = o.customer_id                    -- equality first: keeps it a hash join
  AND o.order_ts >= d.valid_from
  AND o.order_ts <  d.valid_to
```

Use the fact's **event time** for the lookup, not load time. A February order that [arrives late](/blog/2026-09-09-late-arriving-data/) in October should still pick up the February version. Keep the equality on `customer_id` in the join condition: with only the range predicates, Spark can't hash the join and falls back to a [nested loop](/blog/2026-09-23-reading-a-spark-query-plan/).

For the "as it is now" question, don't join facts to `is_current` rows by business key. Add a Type 6 `current_segment` column to every version, or provide a `dim_customer_current` view and join through the surrogate key to the business key. Then both questions get correct answers from the same model.

## Test the invariants

A Type 2 table has three invariants: **exactly one current row per key**, **no overlapping versions**, and **no gaps**. All three can be checked with SQL:

<div class="code-title">checks/dim_customer_invariants.sql</div>

```sql
-- More than one current version
SELECT customer_id FROM gold.dim_customer
WHERE is_current GROUP BY customer_id HAVING count(*) > 1;

-- Overlaps or gaps between consecutive versions
SELECT customer_id, valid_to, next_from
FROM (
  SELECT customer_id, valid_to,
         LEAD(valid_from) OVER (PARTITION BY customer_id ORDER BY valid_from) AS next_from
  FROM gold.dim_customer
)
WHERE next_from IS NOT NULL AND next_from <> valid_to;
```

Any row returned means a point-in-time join will either drop facts (a gap) or duplicate them (an overlap). Run these after every load.

## The hard case: backdated changes

The `MERGE` above assumes changes arrive in order. In practice a sales operations team will eventually backdate a reclassification: "this customer was actually Enterprise from 1 May". By then version 3 already exists, and the change belongs in the *middle* of the history. That means splitting a version, shifting boundaries, and re-keying any facts that were looked up against the old boundaries.

Handling that with incremental `MERGE` logic gets complicated quickly. A more robust approach is to make the dimension **derivable**: keep every change in an append-only log in silver, and rebuild the version chain for any affected customer from that log.

<div class="code-title">gold/dim_customer_rebuild.sql</div>

```sql
WITH changes AS (
  SELECT customer_id, name, segment, region, effective_at, change_seq,
         sha2(to_json(named_struct('segment', segment, 'region', region)), 256) AS row_hash
  FROM silver.customer_changes
  WHERE customer_id IN (SELECT customer_id FROM affected_customers)
),
collapsed AS (                 -- drop changes that didn't touch Type 2 columns
  SELECT *, LAG(row_hash) OVER (PARTITION BY customer_id
                                ORDER BY effective_at, change_seq) AS prev_hash
  FROM changes
)
SELECT xxhash64(customer_id, effective_at) AS customer_sk,
       customer_id, name, segment, region, row_hash,
       effective_at AS valid_from,
       COALESCE(LEAD(effective_at) OVER (PARTITION BY customer_id
                                         ORDER BY effective_at, change_seq),
                TIMESTAMP'9999-12-31') AS valid_to,
       LEAD(effective_at) OVER (PARTITION BY customer_id
                                ORDER BY effective_at, change_seq) IS NULL AS is_current
FROM collapsed
WHERE prev_hash IS NULL OR prev_hash <> row_hash
```

Replace the affected customers' rows with the result (`replaceWhere` or delete-and-insert in one transaction), then re-run the surrogate key lookup for their facts. Because the chain is computed from the log, the rebuild handles backdated changes, out-of-order delivery, and corrections in the same way, and it's idempotent: the same log always produces the same dimension. (In production, take `name` from each customer's latest change rather than from the version row, since it's Type 1.)

The incremental `MERGE` handles the common case cheaply. The rebuild handles everything else correctly. Having both, plus the invariant checks, is what makes a Type 2 dimension reliable.

## On Monday

- For each dimension, list the columns and decide their type with the people who use the reports. Write the decisions down.
- Search for fact-to-dimension joins on business keys where the dimension has more than one row per key. Each one is a fan-out.
- Make sure fact loads look up the dimension version by event time, not load time.
- Replace `concat_ws` hashes with `to_json(named_struct(...))`.
- Add the current-row and overlap checks after every dimension load.
- Keep the change log. If it exists, a corrupted dimension can be rebuilt. If it doesn't, the history is gone.

<nav class="series" aria-label="Series">
<div class="series-k">Series · Part 9 of 10</div>
<div class="series-t">Ten data engineering concepts worth learning before the 2 AM page</div>
<ol>
<li><a href="/blog/2026-08-19-idempotent-writes-and-why-retries-duplicate-data/">Idempotent writes, and why retries duplicate data</a></li>
<li><a href="/blog/2026-08-26-the-grain-of-a-table/">The grain of a table</a></li>
<li><a href="/blog/2026-09-02-event-time-vs-processing-time/">Event time vs processing time</a></li>
<li><a href="/blog/2026-09-09-late-arriving-data/">Late-arriving data</a></li>
<li><a href="/blog/2026-09-16-data-skew-in-spark/">Data skew</a></li>
<li><a href="/blog/2026-09-23-reading-a-spark-query-plan/">Reading a Spark query plan</a></li>
<li><a href="/blog/2026-09-30-partition-pruning/">Partition pruning</a></li>
<li><a href="/blog/2026-10-07-the-small-files-problem/">The small files problem</a></li>
<li class="on">Slowly changing dimensions</li>
<li><a href="/blog/2026-10-21-schema-evolution/">Schema evolution</a></li>
</ol>
</nav>
