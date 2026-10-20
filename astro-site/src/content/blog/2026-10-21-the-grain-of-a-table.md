---
title: "The Grain of a Table: Declare It Before the First Join"
author: Michael John Peña
draft: false
date: 2026-10-21T12:01:00Z
description: "Grain is what one row of a table means. Most wrong numbers come from a join or aggregation that quietly changed it. How to declare grain and test it."
tags:
  - Data Engineering
  - Data Modeling
  - SQL
  - Analytics
  - Data Quality
---

A report gets one new column, product category, and shipping revenue goes up 2.4× overnight. Nobody touched shipping. Nobody touched the orders table. The change was a join to `order_lines` so the report could show category, and that join made every order's shipping fee appear once per line.

No query failed and no test went red. The SQL was valid, and the number was wrong because the table no longer meant what everyone assumed it meant. What changed was its **grain**.

## Grain is a sentence, not a key

The grain of a table is what a single row represents. You should be able to say it out loud:

- `orders`: **one row per order**, latest state from the source system.
- `order_lines`: **one row per line item per order**.
- `inventory_daily`: **one row per product per warehouse per calendar day**, as of end of day.
- `web_events`: **one row per event received**, duplicates included.

The primary key is how the grain is expressed mechanically: `order_id`, `(order_id, line_no)`, `(product_id, warehouse_id, snapshot_date)`. The sentence carries the meaning the key leaves out. "As of end of day", "latest state", and "duplicates included" each change which questions the table can answer.

Kimball's dimensional modelling process puts **declare the grain** before choosing dimensions or facts, and Microsoft's [star schema guidance](https://learn.microsoft.com/en-us/power-bi/guidance/star-schema) makes the same point for Power BI models. That order isn't arbitrary. Each later decision depends on it: which measures belong in the table, which dimensions you can join, how to partition, what to `MERGE` on.

<div class="cl cl-key">
<div class="cl-tag">Rule</div>
<div class="cl-body">

If you can't finish the sentence "one row per ___", the table isn't ready for anyone to query, and it certainly isn't ready for a join.

</div>
</div>

## How a join changes the grain

A join to a table at a finer grain *fans out*. Each row on the coarse side repeats once for every match on the fine side. Measures that belonged to the coarse grain get repeated too, and `SUM` doesn't know they're copies.

<figure class="ff">
<svg class="ff-svg" viewBox="0 0 900 340" role="img" aria-label="An orders table with one row per order holds order 1001 with a shipping fee of 15.00. An order_lines table has three lines for order 1001. Joining them on order_id produces one row per line, each carrying the 15.00 shipping fee, so the sum of shipping is 45.00 while the actual shipping charged was 15.00.">
<defs>
<marker id="grN" markerWidth="9" markerHeight="9" refX="6.5" refY="3" orient="auto"><path d="M0,0 L6.5,3 L0,6 Z" class="ff-ah"/></marker>
</defs>
<rect x="40" y="36" width="300" height="108" rx="12" class="ff-node ff-node-cy"/>
<text x="60" y="62" class="ff-title">orders</text>
<text x="60" y="80" class="ff-sub">grain: one row per order</text>
<text x="60" y="108" class="ff-zlabel">ORDER_ID</text>
<text x="200" y="108" class="ff-zlabel">SHIPPING_FEE</text>
<text x="60" y="128" class="ff-tok">1001</text>
<text x="200" y="128" class="ff-tok">15.00</text>
<rect x="40" y="172" width="300" height="140" rx="12" class="ff-node ff-node-cy"/>
<text x="60" y="198" class="ff-title">order_lines</text>
<text x="60" y="216" class="ff-sub">grain: one row per line</text>
<text x="60" y="242" class="ff-zlabel">ORDER_ID</text>
<text x="150" y="242" class="ff-zlabel">LINE</text>
<text x="230" y="242" class="ff-zlabel">AMOUNT</text>
<text x="60" y="262" class="ff-tok">1001</text><text x="150" y="262" class="ff-tok">L1</text><text x="230" y="262" class="ff-tok">40.00</text>
<text x="60" y="280" class="ff-tok">1001</text><text x="150" y="280" class="ff-tok">L2</text><text x="230" y="280" class="ff-tok">25.00</text>
<text x="60" y="298" class="ff-tok">1001</text><text x="150" y="298" class="ff-tok">L3</text><text x="230" y="298" class="ff-tok">10.00</text>
<path d="M342,90 C430,90 430,150 516,150" class="ff-edge" marker-end="url(#grN)"/>
<path d="M342,242 C430,242 430,192 516,192" class="ff-edge" marker-end="url(#grN)"/>
<rect x="380" y="163" width="104" height="17" rx="4" class="ff-elabel-bg"/>
<text x="432" y="175" text-anchor="middle" class="ff-elabel">JOIN order_id</text>
<rect x="520" y="36" width="340" height="276" rx="12" class="ff-node ff-node-dn"/>
<text x="540" y="62" class="ff-title">orders ⋈ order_lines</text>
<text x="540" y="80" class="ff-sub">grain: one row per line (it changed)</text>
<text x="540" y="110" class="ff-zlabel">ORDER_ID</text>
<text x="622" y="110" class="ff-zlabel">LINE</text>
<text x="680" y="110" class="ff-zlabel">AMOUNT</text>
<text x="766" y="110" class="ff-zlabel">SHIPPING</text>
<text x="540" y="132" class="ff-tok">1001</text><text x="622" y="132" class="ff-tok">L1</text><text x="680" y="132" class="ff-tok">40.00</text><text x="766" y="132" class="ff-tok ff-amt">15.00</text>
<text x="540" y="152" class="ff-tok">1001</text><text x="622" y="152" class="ff-tok">L2</text><text x="680" y="152" class="ff-tok">25.00</text><text x="766" y="152" class="ff-tok ff-amt">15.00</text>
<text x="540" y="172" class="ff-tok">1001</text><text x="622" y="172" class="ff-tok">L3</text><text x="680" y="172" class="ff-tok">10.00</text><text x="766" y="172" class="ff-tok ff-amt">15.00</text>
<line x1="540" y1="194" x2="840" y2="194" stroke="#2c343c" stroke-width="1"/>
<text x="540" y="220" class="ff-tok">SUM(amount)   = 75.00</text>
<text x="800" y="220" text-anchor="end" class="ff-sub">correct</text>
<text x="540" y="244" class="ff-tok ff-amt">SUM(shipping) = 45.00</text>
<text x="800" y="244" text-anchor="end" class="ff-sub">wrong ×3</text>
<text x="540" y="284" class="ff-sub">Shipping actually charged on order 1001: 15.00</text>
</svg>
<figcaption><b>Fan-out.</b> Joining a one-row-per-order table to a one-row-per-line table produces a one-row-per-line result. Line measures are still correct. Order measures are now repeated once per line.</figcaption>
</figure>

The grain changes in other ways too, and all of them pass every syntax check:

- **Mixed-grain tables.** Order-level totals stored on every line row "for convenience". Each row is accurate on its own, but summing any of those columns is wrong.
- **Joining a history table on the business key.** A [Type 2 dimension](/blog/2026-10-21-slowly-changing-dimensions/) has one row per version of each customer. Joining facts on `customer_id` alone multiplies every fact by the number of versions.
- **Unioning tables at different grains.** Daily snapshot rows unioned with transaction rows "to get everything in one place".
- **A `GROUP BY` that gains a column.** Adding `channel` to a grouping changes "one row per day" to "one row per day per channel". Downstream code that assumed one row per day now sums several.
- **Duplicates you didn't know about.** If `orders` actually holds two rows for some orders because of a [non-idempotent load](/blog/2026-10-21-idempotent-writes-and-why-retries-duplicate-data/), the grain you declared isn't the grain you have.

## Grain decides which measures can be added up

Even when a table's grain is correct, its measures don't all aggregate the same way. The type of fact table tells you which aggregations are safe.

| Fact table type | Grain | Example | Typical measures |
|---|---|---|---|
| Transaction | One row per event | `order_lines` | Amount, quantity: sum freely |
| Periodic snapshot | One row per entity per period | `inventory_daily` | Balance, on-hand: **don't sum across time** |
| Accumulating snapshot | One row per process instance, updated as it moves | `order_fulfilment` | Durations between milestones |

And the additivity of each measure:

| Additivity | Example | Across dimensions | Across time |
|---|---|---|---|
| Additive | Sales amount, units sold | Sum | Sum |
| Semi-additive | Account balance, stock on hand | Sum | Last, average, or min/max. **Never sum** |
| Non-additive | Unit price, margin %, distinct customers | Recompute | Recompute |

Distinct counts catch people out more than anything else on that list. Thirty daily-active-user numbers summed together aren't a monthly active user count, because a user active on ten days gets counted ten times. Store the components (the user IDs, or a sketch like HyperLogLog) and recompute at the grain you want to report.

## Three ways to join without fanning out

### Aggregate to the coarser grain first

If the report is at order grain, bring lines up to order grain *before* the join:

<div class="code-title">gold/orders_with_line_summary.sql</div>

```sql
WITH line_summary AS (
  SELECT order_id,
         count(*)                    AS line_count,
         sum(amount)                 AS lines_amount,
         count(DISTINCT category_id) AS category_count
  FROM silver.order_lines
  GROUP BY order_id
)
SELECT o.order_id, o.order_date, o.shipping_fee,
       s.line_count, s.lines_amount, s.category_count
FROM silver.orders o
LEFT JOIN line_summary s ON s.order_id = o.order_id   -- 1:1, grain preserved
```

### Allocate the coarse measure down to the finer grain

If the report really needs line grain, as with "shipping cost by product category", shipping has to be *allocated* to lines, not copied onto them. Allocate in proportion to line amount and assign the rounding remainder to one line, so the parts still add up to the whole:

<div class="code-title">gold/order_lines_allocated.sql</div>

```sql
WITH base AS (
  SELECT l.order_id, l.line_no, l.category_id, l.amount, o.shipping_fee,
         ROUND(o.shipping_fee * l.amount / SUM(l.amount) OVER (PARTITION BY l.order_id), 2)
           AS shipping_raw,
         ROW_NUMBER() OVER (PARTITION BY l.order_id ORDER BY l.amount DESC, l.line_no)
           AS rank_in_order
  FROM silver.order_lines l
  JOIN silver.orders o ON o.order_id = l.order_id
)
SELECT order_id, line_no, category_id, amount,
       shipping_raw
         + CASE WHEN rank_in_order = 1
                THEN shipping_fee - SUM(shipping_raw) OVER (PARTITION BY order_id)
                ELSE 0 END AS shipping_allocated
FROM base
```

`SUM(shipping_allocated)` now equals `SUM(shipping_fee)` at order level, to the cent. The allocation rule (by amount, by quantity, by weight) is a business decision. Write it down next to the table.

### Keep each measure at its own grain and let the model join

In a semantic layer such as a Power BI or Fabric semantic model, the cleanest approach is often not to join facts at all. Keep `orders` and `order_lines` as separate fact tables that share conformed dimensions (date, customer), and let each measure aggregate in its own table. Problems start when someone flattens everything into one wide table so it's "easier to use".

## Declare it, then test it

Grain only protects you if it's written down where people will see it and checked where a machine will notice.

<div class="code-title">ddl/silver_orders.sql</div>

```sql
CREATE TABLE silver.orders (
  order_id      BIGINT NOT NULL,
  customer_id   BIGINT NOT NULL,
  order_date    DATE   NOT NULL,
  shipping_fee  DECIMAL(18,2),
  source_updated_at TIMESTAMP NOT NULL
)
COMMENT 'Grain: one row per order (latest source state). Key: order_id.'
TBLPROPERTIES ('grain' = 'order_id');
```

Most lakehouse engines won't enforce it for you. Delta Lake supports [`NOT NULL` and `CHECK` constraints](https://docs.delta.io/latest/delta-constraints.html) but no unique constraint. Primary keys in Unity Catalog and the [`PRIMARY KEY ... NOT ENFORCED`](https://learn.microsoft.com/en-us/fabric/data-warehouse/table-constraints) syntax in Fabric Warehouse are informational: the optimiser may rely on them, and nothing stops you inserting a duplicate. So the check has to be explicit:

<div class="code-title">checks/assert_grain.py</div>

```python
from pyspark.sql import functions as F

def assert_grain(df, keys: list[str], name: str):
    dupes = (df.groupBy(*keys).count()
               .where(F.col("count") > 1)
               .limit(5).collect())
    if dupes:
        raise AssertionError(f"{name}: grain {keys} violated, e.g. {dupes}")

def assert_no_fanout(left, joined, keys: list[str], name: str):
    before, after = left.count(), joined.count()
    if after != before:
        raise AssertionError(
            f"{name}: join changed row count {before} -> {after}; "
            f"expected 1:1 on {keys}")
```

Put `assert_grain` after every write of a table people query. Put `assert_no_fanout` after any join where the code assumes 1:1, and especially after joins to dimensions, where a duplicated dimension key can multiply a fact table without anyone noticing.

## Grain shows up in the rest of the series

Once you notice grain, it turns up in most of the other topics here:

- The `MERGE` key in an [idempotent write](/blog/2026-10-21-idempotent-writes-and-why-retries-duplicate-data/) *is* the grain. If you merge on something else, duplicates follow.
- A [slowly changing dimension](/blog/2026-10-21-slowly-changing-dimensions/) is a deliberate change of grain, from "one row per customer" to "one row per customer version".
- [Partitioning](/blog/2026-10-21-partition-pruning/) should follow a column that's part of how the table is queried, and that usually means the time component of its grain.

## On Monday

- Add a one-sentence grain to the comment of every table in your gold layer. Any table you can't describe is your first bug.
- Add a uniqueness check on the grain key after each write.
- Search reports and models for `SUM` over semi-additive or non-additive measures: balances, prices, ratios, distinct counts.
- Find the wide "everything" table and check which of its measures are repeated across rows.

Most wrong numbers have nothing to do with bad data. They come from correct data summed at the wrong grain.

<nav class="series" aria-label="Series">
<div class="series-k">Series · Part 2 of 10</div>
<div class="series-t">Ten data engineering concepts worth learning before the 2 AM page</div>
<ol>
<li><a href="/blog/2026-10-21-idempotent-writes-and-why-retries-duplicate-data/">Idempotent writes, and why retries duplicate data</a></li>
<li class="on">The grain of a table</li>
<li><a href="/blog/2026-10-21-event-time-vs-processing-time/">Event time vs processing time</a></li>
<li><a href="/blog/2026-10-21-late-arriving-data/">Late-arriving data</a></li>
<li><a href="/blog/2026-10-21-data-skew-in-spark/">Data skew</a></li>
<li><a href="/blog/2026-10-21-reading-a-spark-query-plan/">Reading a Spark query plan</a></li>
<li><a href="/blog/2026-10-21-partition-pruning/">Partition pruning</a></li>
<li><a href="/blog/2026-10-21-the-small-files-problem/">The small files problem</a></li>
<li><a href="/blog/2026-10-21-slowly-changing-dimensions/">Slowly changing dimensions</a></li>
<li><a href="/blog/2026-10-21-schema-evolution/">Schema evolution</a></li>
</ol>
</nav>
