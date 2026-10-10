---
title: "One Metric, One Home: Ownership Rules That Stop Drift in Fabric"
description: "How to stop metric drift in Fabric by giving every metric one home layer and one named owner, then enforcing both rules with schemas, grants and versions."
author: Michael John Peña
draft: false
date: 2026-03-28
tags:
  - Microsoft Fabric
  - Data Warehouse
  - Data Modeling
  - Data Governance
  - Power BI
---

Metric drift is when "active customers" means one thing in the finance report, another in the sales dashboard, and a third in the notebook someone wrote for the board pack. Nobody chose three definitions; each was a reasonable local decision made without sight of the others. Fabric makes this easier to fall into, not harder, because a warehouse, a lakehouse, a semantic model and a notebook can all compute the same number from the same OneLake tables, and they all look authoritative.

My position is that drift is an ownership problem before it's a modelling problem. More tooling won't fix it. Two rules will: every metric has exactly one home, and every home has exactly one owner. The rest of this post sets out those two rules, then three mechanisms that enforce them in a Fabric Data Warehouse and the Power BI semantic models that sit on top of it.

## Where drift actually comes from

In my experience, a disputed number is rarely a bug. The cause is usually one of these:

- **Logic duplicated across layers.** A filter like "exclude internal test accounts" lives in a warehouse view *and* in a DAX measure, and one of them gets updated.
- **Ratios computed too early.** Someone stores a conversion rate per row in SQL, and the report sums or averages it. Averages of ratios are not ratios.
- **Grain confusion.** A metric is calculated against a table whose row meaning nobody wrote down. I covered this in [deciding fact table grain before tuning](/blog/2026-03-06-fabric-warehouse-tradeoffs-choosing-model-grain-before-performance-tuning/), and it's the precondition for everything here.
- **Silent edits.** The definition changes in place, and last quarter's numbers move with no record of why.

Only the last is purely a process failure. The other three are design failures that an owner prevents by asking where else a definition is computed before signing it off.

## Rule 1: every metric has exactly one home layer

In a typical Fabric estate a metric can live in three places: a warehouse table or view, a semantic model measure, or ad hoc code in a notebook or report. The third is never a home. The real decision is between the first two, and it isn't arbitrary.

| Belongs in the warehouse | Belongs in the semantic model |
|---|---|
| Row-level classifications (`is_active_customer`, `is_internal_account`) | Aggregations that must respond to filter context |
| Additive measures at the declared grain (net amount per order line) | Ratios, percentages and averages |
| Business rules that other systems also consume | Distinct counts across arbitrary slices |
| Slowly changing attribute history | Time intelligence (year to date, prior period) |

The dividing line is simple: if the logic decides *what a row is*, it belongs in the warehouse. If it decides *how rows combine*, it belongs in the semantic model as a DAX measure. Get that split right and most duplication disappears, because each layer only does the job the other can't do well.

### The Direct Lake trade-off with views

There's a practical wrinkle that pushes metric logic towards tables rather than views. According to the [Direct Lake overview](https://learn.microsoft.com/fabric/fundamentals/direct-lake-overview), Direct Lake on SQL endpoints can include warehouse views, but queries against them fall back to DirectQuery. Direct Lake on OneLake (in public preview at the time of writing; check the overview for its current status) doesn't support SQL views at all and has no DirectQuery fallback. Fallback also kicks in when the warehouse uses SQL granular permissions such as row-level security.

So if a classification like `is_active_customer` is defined in a view, the semantic model either loses Direct Lake performance or can't see the column. My rule of thumb: views are fine as a contract for SQL consumers, but anything a Direct Lake model reads should be materialised as a table during the load, with the logic living in the load procedure that owns it.

## Rule 2: every home has one named owner

An owner is a person with the right to say no, not a team alias. "Data platform team" can't be held to a decision. A metric owner decides the definition, approves changes, and answers when two numbers disagree. They don't need to write the SQL or DAX themselves.

I keep the ownership record next to the data, in the warehouse, because a register in a wiki page drifts just like the metrics do. This is a complete script for a Fabric Warehouse:

```sql
CREATE SCHEMA governance;
GO

CREATE TABLE governance.metric_register
(
    metric_name      varchar(100)  NOT NULL,
    metric_version   int           NOT NULL,
    definition_text  varchar(4000) NOT NULL,
    home_layer       varchar(20)   NOT NULL,  -- 'warehouse' or 'semantic_model'
    home_object      varchar(400)  NOT NULL,  -- e.g. 'metrics.customer_monthly' or '<model-name>[Active Customers]'
    grain            varchar(400)  NOT NULL,
    owner_upn        varchar(256)  NOT NULL,
    effective_from   date          NOT NULL,
    effective_to     date          NULL
);
GO

ALTER TABLE governance.metric_register
ADD CONSTRAINT pk_metric_register
PRIMARY KEY NONCLUSTERED (metric_name, metric_version) NOT ENFORCED;
GO
```

Fabric Warehouse only supports primary keys as `NONCLUSTERED` and `NOT ENFORCED`, added through `ALTER TABLE` rather than inline, so the engine won't stop a duplicate; the key is documentation, not a guarantee. And `metric_version` is there on purpose: definitions get new versions, they don't get edited. More on that below.

## Enforce it: schemas and grants

Ownership that isn't enforced is a suggestion. In the warehouse, I map schemas to owners and use database roles so the boundary is visible in the object name and backed by permissions. Fabric Warehouse supports `CREATE ROLE`, `ALTER ROLE ... ADD MEMBER` and schema-scoped `GRANT` and `DENY`, as described in [SQL granular permissions](https://learn.microsoft.com/fabric/data-warehouse/sql-granular-permissions). You can't run `CREATE USER`: Fabric creates database users automatically, for example when a `GRANT` or `DENY` first names them.

```sql
CREATE SCHEMA core;     -- conformed dimensions and facts, owned by data engineering
GO
CREATE SCHEMA metrics;  -- metric tables consumed by semantic models, decided by metric owners
GO

CREATE ROLE metric_owners;       -- business owners: decide definitions, maintain the register
CREATE ROLE metric_maintainers;  -- engineers who implement the owners' decisions
CREATE ROLE metric_readers;
GO

ALTER ROLE metric_owners      ADD MEMBER [<owner>@<your-domain>];
ALTER ROLE metric_maintainers ADD MEMBER [<engineer>@<your-domain>];
ALTER ROLE metric_readers     ADD MEMBER [<analyst>@<your-domain>];
GO

-- Owners read published metrics and record decisions in the register.
-- UPDATE exists only to set effective_to when a version is closed.
GRANT SELECT ON SCHEMA::metrics    TO metric_owners;
GRANT SELECT, INSERT, UPDATE ON SCHEMA::governance TO metric_owners;

-- Maintainers change table definitions in metrics and read core.
-- Data loads run as the pipeline identity, which is a workspace Contributor.
GRANT CREATE TABLE TO metric_maintainers;
GRANT ALTER  ON SCHEMA::metrics    TO metric_maintainers;
GRANT SELECT ON SCHEMA::metrics    TO metric_maintainers;
GRANT SELECT ON SCHEMA::core       TO metric_maintainers;
GRANT SELECT ON SCHEMA::governance TO metric_maintainers;

-- Readers see published metrics and the register.
GRANT SELECT ON SCHEMA::metrics    TO metric_readers;
GRANT SELECT ON SCHEMA::governance TO metric_readers;

-- Workspace Viewers already hold ReadData on every table, so only DENY narrows them.
DENY  SELECT ON SCHEMA::core       TO metric_readers;
GO
```

The trap is workspace roles. According to [workspace roles in Fabric Data Warehouse](https://learn.microsoft.com/fabric/data-warehouse/workspace-roles), Admin, Member and Contributor get CONTROL on every warehouse in the workspace, which SQL grants don't take away, and Viewer gets CONNECT and ReadData, so a Viewer can already `SELECT` from `core`. Only `DENY` narrows a Viewer, hence the last line of the script. The cleaner option is to keep analysts out of the workspace and share the warehouse item with plain Read, which gives CONNECT only and makes the `GRANT` statements their whole access. If your analytics team are all workspace Contributors, the grants are decoration.

I deny `core` to readers by default so analysts build on published metrics. When someone has a real need to explore, I move them into a role without the `DENY`, because a `DENY` beats any later `GRANT`. Open `core` broadly and people rebuild metrics from base tables, which is the drift you're trying to stop.

One more boundary leaks. A Direct Lake on OneLake model reads Delta files through OneLake, not through the SQL endpoint, so it ignores SQL grants, `DENY` and SQL row-level security entirely ([Direct Lake security](https://learn.microsoft.com/fabric/fundamentals/direct-lake-security-integration)). If your semantic models use that mode, the schema boundary has to be enforced again with OneLake security roles, or with workspace and item permissions that keep `core` out of reach.

## Enforce it: versions, not edits

When the owner decides "active" now means a purchase in the last 90 days instead of 60, the worst outcome is that the number changes overnight with no trace. Instead, add a new row to the register with `metric_version = 2` and an `effective_from` date, close version 1 with `effective_to`, and run both definitions side by side for at least one reporting cycle. Consumers see the change coming, and anyone comparing periods can tell whether a jump is the business or the definition. The owners' `UPDATE` grant is only for setting `effective_to`; SQL can't stop someone rewriting `definition_text` in place, so I catch that by comparing the register with its history, either through Warehouse time travel or by keeping register changes in source control.

Running side by side only works if the published table can hold both. I put the version in the key of the metric table, so the load writes one row per customer, month and live version, and the semantic model filters to the version the report should show:

```sql
CREATE TABLE metrics.customer_monthly
(
    customer_key        int  NOT NULL,
    month_start_date    date NOT NULL,
    metric_version      int  NOT NULL,
    is_active_customer  bit  NOT NULL
);
GO
```

The count of active customers is then a DAX measure over `is_active_customer`, which keeps the distinct count where Rule 1 says it belongs. A reconciliation check makes the parallel run useful. This one recomputes the flag for one version from `core`, compares it with the published rows for that version, and returns rows only when they disagree. Run it once per live version, with the window and `effective_from` date from that version's register entry, because a new version is only loaded from the month it takes effect:

```sql
DECLARE @metric_version int = 2;
DECLARE @active_window_days int = 90;
DECLARE @effective_from date = '<version-effective-from>';

WITH recomputed AS
(
    SELECT
        f.customer_key,
        f.month_start_date,
        CAST(CASE
                 WHEN f.is_internal_account = 0
                  AND f.days_since_last_purchase <= @active_window_days
                 THEN 1 ELSE 0
             END AS bit) AS is_active_customer
    FROM core.fact_customer_activity AS f   -- one row per customer per month
    WHERE f.month_start_date >= @effective_from
),
published AS
(
    SELECT customer_key, month_start_date, is_active_customer
    FROM metrics.customer_monthly
    WHERE metric_version = @metric_version
      AND month_start_date >= @effective_from
)
SELECT 'missing_or_different_in_published' AS issue,
       r.customer_key, r.month_start_date, r.is_active_customer
FROM (SELECT * FROM recomputed EXCEPT SELECT * FROM published) AS r
UNION ALL
SELECT 'missing_or_different_in_recomputed',
       p.customer_key, p.month_start_date, p.is_active_customer
FROM (SELECT * FROM published EXCEPT SELECT * FROM recomputed) AS p;
```

An empty result means the published rows for that version match the owner's definition. Run it as the last step of the load pipeline and fail the run if it returns anything.

## Enforce it: make the home discoverable

Drift also comes from people not knowing a home exists. In Power BI, [endorsement](https://learn.microsoft.com/fabric/fundamentals/endorsement-promote-certify) is the signal. Anyone with write access can promote an item, but only reviewers named by a Fabric administrator can certify it. I reserve certification for semantic models whose measures match the register, and treat a certified model as the only acceptable source for that metric in a published report.

You can also look for drift directly. [Query insights](https://learn.microsoft.com/fabric/data-warehouse/query-insights) keeps a history of completed queries in `queryinsights.exec_requests_history`, including the full command text and the login. Searching it for the columns behind a metric shows who is recomputing it outside its home:

```sql
SELECT TOP 100
    login_name,
    program_name,
    start_time,
    command
FROM queryinsights.exec_requests_history
WHERE command LIKE '%days_since_last_purchase%'
  AND login_name <> '<pipeline-identity>'
ORDER BY start_time DESC;
```

Know its blind spots. Query insights only records T-SQL run against that warehouse or SQL analytics endpoint, so it misses Spark notebooks, Direct Lake queries that don't fall back to DirectQuery, and Import refreshes from other sources, which is where metrics most often get recomputed. It keeps 30 days of history, queries can take up to 15 minutes to appear, and only Admin, Member and Contributor see full query text. Treat it as a signal, not an audit.

I use it to find the analyst who needed a variant the register doesn't have yet, not to police people.

## When this is overkill

If three people own one warehouse and one report, a shared definition document and a conversation are cheaper than a register, roles and reconciliation tests. Exploratory work shouldn't need sign-off either; the rules apply to metrics that appear in published, endorsed reports, not to every number someone calculates in a notebook. And if nobody in the business is willing to be named as owner, don't invent one from the data team. That's a sign the metric isn't important enough to govern yet, or that the real conversation is about who decides, which no schema design can settle.

## The short version

Put row classification in the warehouse and aggregation in the semantic model, and treat any metric without a named business owner as not ready to publish. If you only adopt one mechanism, make it versioning with a reconciliation check, because that's what turns a silent change into a visible one. Grants matter only when workspace editor roles are scarce, so fix workspace membership before writing SQL permissions. Then certify the model that holds the answer, so the easiest number to find is also the correct one.
