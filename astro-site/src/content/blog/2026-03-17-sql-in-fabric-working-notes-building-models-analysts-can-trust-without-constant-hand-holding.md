---
title: "SQL in Fabric: Give Analysts a View Layer, Not Your Tables"
description: "How I design an analyst-facing schema in Fabric Data Warehouse: views as the contract, permissions scoped to it, and SQL checks that catch breaks first."
author: Michael John Peña
draft: false
date: 2026-03-17
tags:
  - Microsoft Fabric
  - Data Warehouse
  - T-SQL
  - Data Modeling
---

Most of the "can you check this number?" messages I see from analysts aren't data quality problems. They come from analysts querying tables that were built for the pipeline, not for them: staging columns with half-finished logic, surrogate keys with no explanation, and a schema that changes whenever engineering refactors a load. If you want analysts to work in Fabric Data Warehouse without someone holding their hand, give them a stable contract to query. Then make it the only thing they can query, because trust is something you design into the warehouse, not something you train into people.

## The problem with exposing everything

A Fabric warehouse makes everything easy to reach. Anyone with the right workspace role can connect from SSMS, Excel or a Power BI semantic model and see every table. That's useful during development and a liability once analysts depend on it, for three reasons:

- **No stable interface.** When the engineering team renames a column or splits a table, every saved query and report that touched it breaks. Analysts learn the warehouse is fragile and start exporting to Excel "just in case".
- **Hidden decisions.** Whether `amount` includes GST, whether cancelled orders are filtered, what one row means: those decisions live in someone's head or in a pipeline notebook. Analysts have to ask, every time.
- **No safe place to say no.** If analysts can see the staging tables, they will use them, and you will end up supporting them.

The fix is old and unexciting: a presentation layer of views, owned by engineering, documented in the SQL itself, and permissioned separately from everything underneath.

## Three schemas, three audiences

My default layout in a Fabric warehouse uses three schemas:

| Schema | Contains | Who reads it | Change policy |
|---|---|---|---|
| `stg` | Landed and lightly typed data | Pipelines only | Changes freely |
| `dw` | Conformed facts and dimensions | Engineers, semantic models | Changes with review |
| `analytics` | Views written for analysts | Analysts and their tools | Additive changes only; breaking changes get a new view |

The `analytics` schema is the contract. Each view uses business names, applies the filters everyone otherwise forgets, and says in a header comment what one row represents. If you've read my earlier post on [deciding fact table grain before tuning](/blog/2026-03-06-fabric-warehouse-tradeoffs-choosing-model-grain-before-performance-tuning/), this is where that grain sentence ends up being useful to someone other than the engineer who wrote it.

```sql
-- Explicit owner on both schemas, so ownership chaining works (see below).
CREATE SCHEMA dw AUTHORIZATION dbo;
GO
CREATE SCHEMA analytics AUTHORIZATION dbo;
GO
```

With the schemas in place and the load populating the `dw` tables, the first analyst view looks like this:

```sql
-- Assumes the dw tables already exist (created by the load).
-- Grain: one row per order line that was invoiced.
-- Excludes cancelled orders and test customers.
-- Lines with no order_status are kept (treated as not cancelled).
-- net_amount_aud is ex-GST, in Australian dollars.
CREATE VIEW analytics.invoiced_order_lines
AS
SELECT
    f.order_id,
    f.order_line_number,
    d.calendar_date       AS invoice_date,
    c.customer_name,
    c.customer_segment,
    p.product_name,
    p.product_category,
    f.quantity,
    f.net_amount_aud
FROM dw.fact_order_line AS f
JOIN dw.dim_date        AS d ON d.date_key = f.invoice_date_key
JOIN dw.dim_customer    AS c ON c.customer_key = f.customer_key
JOIN dw.dim_product     AS p ON p.product_key = f.product_key
WHERE (f.order_status IS NULL OR f.order_status <> 'Cancelled')
  AND c.is_test_customer = 0;
GO
```

The view is three joins and two filters; its value is that the filters are written down, so analysts stop having to ask about them. Even the `IS NULL` test is a decision made visible: a plain `<> 'Cancelled'` would quietly drop lines with no status, which is exactly the kind of hidden rule the view exists to remove. "Additive changes only" means you can add a column, but renaming or removing one means creating `invoiced_order_lines_v2` and retiring the old view on a published date.

## Make the contract the only door

A view layer only helps if analysts can't get around it. In Fabric, that comes down to how you grant access, and the most common mistake I see is adding analysts to the workspace.

Workspace roles are broad. Admin, Member and Contributor can change items, and even Viewer gets read access to data across the warehouse through the SQL connection. Once analysts are workspace members, your schema design is a suggestion unless you claw access back. You can `DENY SELECT` on `stg` and `dw` to a Viewer group, but that is opt-out security: every new schema is exposed until someone remembers to deny it. Item sharing plus `GRANT` is opt-in, which is the failure mode I'd rather have.

The better route is to [share the warehouse item](https://learn.microsoft.com/fabric/data-warehouse/share-warehouse-manage-permissions) with the analyst group and grant only the base **Read** permission, which lets them connect. Don't tick "Read all data using SQL" (ReadData), because that opens every table. Then use [SQL granular permissions](https://learn.microsoft.com/fabric/data-warehouse/sql-granular-permissions) to grant exactly what they need. Fabric doesn't support `CREATE USER`; the database user for an Entra user or group is created implicitly the first time you `GRANT` or `DENY` something to it. That makes the simplest version a single statement:

```sql
GRANT SELECT ON SCHEMA::analytics TO [<your-analyst-entra-group>];
```

I only add a database role when several groups need the same access. In that case, grant the schema to the role and add the groups to it with `ALTER ROLE ... ADD MEMBER`.

Because the grant is at schema level, new views in `analytics` become visible automatically, and nothing in `stg` or `dw` does. Views work here through ownership chaining: when the view and the underlying tables have the same owner, the analyst doesn't need direct permission on `dw` tables. As in SQL Server, `CREATE SCHEMA` without `AUTHORIZATION` makes the user who runs it the owner, and in Fabric that is the engineer's own Entra identity, not `dbo`. That's why the script above creates both with `AUTHORIZATION dbo`. If analysts get a permission error on `dw` tables through the view, the schemas have different owners, and this query shows who owns what:

```sql
SELECT name, USER_NAME(principal_id) AS owner_name
FROM sys.schemas;
```

If some analysts shouldn't see every row (a regional sales team, for example), apply [row-level security](https://learn.microsoft.com/fabric/data-warehouse/row-level-security) with a security policy on the underlying fact table rather than building one view per region. One view with a policy is easier to maintain than eight copies that slowly drift apart.

## Test the contract in SQL, not in someone's inbox

Analysts stop trusting a warehouse the first time they find a duplicated revenue line before you do. Most of these breaks can be caught with a few assertions that run after every load. Each one returns the rows that break a rule, so an empty result means pass:

```sql
-- 1. Grain check: one row per order line.
SELECT order_id, order_line_number, COUNT(*) AS row_count
FROM analytics.invoiced_order_lines
GROUP BY order_id, order_line_number
HAVING COUNT(*) > 1;

-- 2. Orphan check: every fact row resolves to a known customer.
--    TOP 100 here and below: enough to diagnose, cheap on a large fact.
SELECT TOP 100 f.order_id, f.customer_key
FROM dw.fact_order_line AS f
LEFT JOIN dw.dim_customer AS c ON c.customer_key = f.customer_key
WHERE c.customer_key IS NULL;

-- 3. Sanity check: no negative invoiced amounts.
--    Assumes credit notes are modelled in a separate fact, not as negative lines.
SELECT TOP 100 order_id, order_line_number, net_amount_aud
FROM analytics.invoiced_order_lines
WHERE net_amount_aud < 0;
```

Note the orphan check deliberately reads `dw`, not the view. The view's inner joins silently drop fact rows with no matching customer, so querying it would always pass.

Why test in SQL rather than relying on constraints? Fabric Data Warehouse lets you declare primary, unique and foreign keys, but [only as `NOT ENFORCED` and only through `ALTER TABLE`](https://learn.microsoft.com/fabric/data-warehouse/table-constraints), so the engine never checks them. Declare them anyway, because they document intent and help tools that read metadata. Just don't treat them as protection, because they aren't.

I run these checks as the last step of the load, from a pipeline Script activity or a notebook. A `SELECT` that returns rows doesn't fail a Script activity on its own, so wrap each check in `IF EXISTS` and raise an error:

```sql
IF EXISTS (
    SELECT 1
    FROM analytics.invoiced_order_lines
    GROUP BY order_id, order_line_number
    HAVING COUNT(*) > 1
)
    THROW 50001, 'Grain check failed: duplicate order lines', 1;

IF EXISTS (
    SELECT 1
    FROM dw.fact_order_line AS f
    LEFT JOIN dw.dim_customer AS c ON c.customer_key = f.customer_key
    WHERE c.customer_key IS NULL
)
    THROW 50002, 'Orphan check failed: fact rows with unknown customer_key', 1;

IF EXISTS (
    SELECT 1
    FROM analytics.invoiced_order_lines
    WHERE net_amount_aud < 0
)
    THROW 50003, 'Sanity check failed: negative invoiced amounts', 1;
```

Each check has its own error number and message, so the run history tells you which rule broke, and the thrown error fails the activity and the pipeline run. A failed pipeline that someone looks at by 8am beats a dashboard that is quietly wrong all morning.

When a check fails after something has already been published, warehouse time travel is useful for working out what changed. Time travel timestamps are in UTC, so adding `OPTION (FOR TIMESTAMP AS OF '2026-03-16T12:00:00')` to a query shows the table as it was at 11pm Sydney time on 16 March, before an overnight load, as long as that point is within the 30-day retention window. It's an investigation tool, not a substitute for the checks.

## Where this approach doesn't fit

Views aren't free, and there are cases where I wouldn't put them in front of a consumer.

### Direct Lake semantic models

This is the one that catches people. Direct Lake reads Delta tables directly, and SQL views aren't Delta tables.

A Direct Lake on SQL model that touches a warehouse view [falls back to DirectQuery](https://learn.microsoft.com/fabric/fundamentals/direct-lake-overview) through the SQL analytics endpoint, and the same happens when SQL-based security such as the RLS policy above applies to a table it reads. Direct Lake on OneLake, in public preview behind a tenant setting, doesn't fall back at all: it can't use views, and it ignores SQL RLS because it reads the files themselves.

So I split by audience:

| Audience | What they query | Where security lives |
|---|---|---|
| Power BI report users | Direct Lake model over the `dw` tables | Semantic-model RLS, with a fixed-identity cloud connection |
| Analysts writing SQL | `analytics` views | `GRANT` on the schema plus SQL RLS on the fact |

Because the SQL policy sits on `dw.fact_order_line`, the Power BI row means Direct Lake on OneLake, where the model enforces RLS itself; a Direct Lake on SQL model over that table would fall back to DirectQuery. The fixed-identity connection matters: the docs strongly recommend it with Direct Lake on OneLake and RLS, and it means report viewers don't need OneLake read access of their own, which would widen access below the view layer the rest of this design protects.

If you won't put a preview storage mode in front of production reports, use Import mode for that model, or keep the SQL RLS off the tables a Direct Lake on SQL model reads and enforce rows only in the semantic model.

### Other cases

**Heavy transformation logic.** If a view needs several nested CTEs and window functions over a large fact table, every analyst query pays that cost again. Materialise it as a table in the load and keep the view a thin projection over it.

**Very small teams.** If the analyst and the engineer are the same person, three schemas and a role are ceremony. Start with one well-named schema and add the separation when a second consumer turns up.

**Exploratory work.** Data scientists who need raw history sometimes have a legitimate reason to read `dw` or `stg`. Grant that explicitly to a separate role rather than widening the analyst role, so the exception stays visible.

## What I'd do first

None of this is new, and all of it removes a hidden decision, the same idea as writing down [the grain before you tune anything](/blog/2026-03-06-fabric-warehouse-tradeoffs-choosing-model-grain-before-performance-tuning/). If you only do one thing this week, take the three questions analysts ask you most often and answer each one inside a view in an `analytics` schema, with a header comment saying what one row means. Then share the warehouse with Read only, grant that schema, and add a grain check to the end of your load. The hand-holding drops off quickly once the answers live in the warehouse instead of in your inbox.
