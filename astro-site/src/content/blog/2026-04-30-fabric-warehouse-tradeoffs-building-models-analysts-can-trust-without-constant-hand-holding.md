---
title: "Publish Only Verified Loads with Fabric Warehouse Snapshots"
description: "A write-audit-publish pattern for Fabric Data Warehouse: load, run SQL checks, then roll a warehouse snapshot forward so analysts only see verified data."
author: Michael John Peña
draft: false
date: 2026-04-30
tags:
  - Microsoft Fabric
  - Data Warehouse
  - T-SQL
  - Data Quality
  - Power BI
---

Analysts stop trusting a warehouse the first time they catch it half-loaded: the fact table has today's rows, the dimension doesn't, and a report shows a spike of "Unknown" customers for forty minutes. Data tests don't fix that on their own, because by the time a test fails, someone has already queried the bad state. What analysts need is a guarantee that the version they query has already passed validation.

In Fabric Data Warehouse you can build that guarantee with features that are already there: SQL checks after each load, and a [warehouse snapshot](https://learn.microsoft.com/fabric/data-warehouse/warehouse-snapshot), generally available since November 2025, that you only roll forward when the checks pass. This is the write-audit-publish pattern, and in Fabric it costs almost nothing to run.

## Why "test after load" isn't enough

I've written before about giving analysts [a view layer as their contract](/blog/2026-03-17-sql-in-fabric-working-notes-building-models-analysts-can-trust-without-constant-hand-holding/) and testing that contract in SQL. That solves *what* analysts query. It doesn't solve *when*. If analysts and the load process read and write the same warehouse, analysts see every intermediate state: the truncated staging table, the fact rows that landed before the dimension merge, the duplicate customer that the next step would have cleaned up.

The engine won't save you here. [Primary, unique and foreign keys](https://learn.microsoft.com/fabric/data-warehouse/table-constraints) in Fabric Warehouse are only supported as `NOT ENFORCED`, so a duplicate key or an orphaned fact row lands without complaint. Microsoft's own [guidance on loading dimensional models](https://learn.microsoft.com/fabric/data-warehouse/dimensional-modeling-load-tables) says it plainly: because foreign keys aren't enforced, the ETL process has to check integrity itself. Declare the keys anyway, since they document the grain and help Power BI Desktop detect relationships, but treat them as metadata.

So the checks are your job. The open question is what analysts see while the checks run, and what happens when one fails.

## The pattern: write, audit, publish

The idea comes from the lakehouse world, where teams write to a branch, validate it, then merge. Fabric Warehouse doesn't have branches, but it has something that does the same job for readers:

1. **Write.** The pipeline loads the parent warehouse as normal. Only the data team connects to it.
2. **Audit.** A stored procedure runs integrity checks and records the result for this run.
3. **Publish.** If every check passed, the pipeline rolls a warehouse snapshot forward to the moment the audit started. If anything failed, the snapshot stays where it was.

Analysts, and the Power BI semantic models they use, connect to the snapshot. A warehouse snapshot is a read-only child item of the warehouse that shows the data as of a chosen timestamp. Moving that timestamp forward is a single statement, it [completes instantly](https://learn.microsoft.com/fabric/data-warehouse/warehouse-snapshot#update-snapshot-timestamp), and queries already running finish against the version they started on. From the analyst's side, the data jumps from one verified state to the next with nothing in between.

Be clear about what keeps analysts off the parent, though. Snapshots [inherit their permissions from the parent warehouse](https://learn.microsoft.com/fabric/data-warehouse/warehouse-snapshot#security-and-governance), so anyone who can query the snapshot can also query the parent, and a `DENY` on the parent applies to the snapshot too. The isolation is a convention, enforced through connection strings and semantic model sources rather than permissions. Tell analysts to use the snapshot's SQL connection string, and point every shared semantic model at it.

The part I like most is how a failure behaves: analysts keep querying yesterday's verified data, the data team gets an alert, and the conversation becomes "today's numbers are late" rather than "why is revenue wrong?". Late is a much easier conversation.

## The audit step in T-SQL

Keep the checks in the warehouse, next to the data, and log every result so you can show analysts what was verified. This is a minimal version with three checks: duplicate dimension keys, orphaned fact rows and null keys. Table and column names are placeholders for your own model.

```sql
CREATE SCHEMA dq;
GO

CREATE TABLE dq.check_result
(
    run_id      varchar(64)  NOT NULL,
    check_name  varchar(200) NOT NULL,
    failed_rows bigint       NOT NULL,
    checked_at  datetime2(6) NOT NULL
);
GO

CREATE TABLE dq.audit_run
(
    run_id     varchar(64)  NOT NULL,
    audited_at datetime2(6) NOT NULL
);
GO

CREATE TABLE dq.publish_log
(
    run_id       varchar(64)  NOT NULL,
    audit_ts     varchar(30)  NOT NULL,
    published_at datetime2(6) NOT NULL
);
GO

CREATE PROCEDURE dq.usp_run_checks
    @run_id varchar(64)
AS
BEGIN
    SET NOCOUNT ON;

    -- Mark the audit point first, so this row is inside the published version
    INSERT INTO dq.audit_run (run_id, audited_at)
    VALUES (@run_id, CAST(SYSUTCDATETIME() AS datetime2(6)));

    -- The audit time (UTC), taken after the marker insert has returned.
    -- The 20 ms margin survives truncation to hundredths of a second
    -- in audit_ts below, so the published version includes the marker.
    DECLARE @now datetime2(6) = DATEADD(millisecond, 20, CAST(SYSUTCDATETIME() AS datetime2(6)));

    -- One row per customer_key in the dimension
    INSERT INTO dq.check_result (run_id, check_name, failed_rows, checked_at)
    SELECT @run_id, 'dim_customer: duplicate customer_key', COUNT(*), @now
    FROM (
        SELECT customer_key
        FROM dbo.dim_customer
        GROUP BY customer_key
        HAVING COUNT(*) > 1
    ) AS dupes;

    -- Every fact row points at an existing customer
    INSERT INTO dq.check_result (run_id, check_name, failed_rows, checked_at)
    SELECT @run_id, 'fact_sales: orphaned customer_key', COUNT(*), @now
    FROM dbo.fact_sales AS f
    LEFT JOIN dbo.dim_customer AS c
        ON f.customer_key = c.customer_key
    WHERE c.customer_key IS NULL;

    -- No fact row is missing a key
    INSERT INTO dq.check_result (run_id, check_name, failed_rows, checked_at)
    SELECT @run_id, 'fact_sales: null customer_key or date_key', COUNT(*), @now
    FROM dbo.fact_sales
    WHERE customer_key IS NULL OR date_key IS NULL;

    -- Return the total and the audit time so the pipeline can decide
    -- whether to publish, and to which point in time
    SELECT SUM(failed_rows)                 AS total_failed,
           CONVERT(varchar(22), @now, 126)  AS audit_ts  -- YYYY-MM-DDTHH:MM:SS.SS
    FROM dq.check_result
    WHERE run_id = @run_id;
END;
GO
```

Call it from a Script activity named `Run checks` with script type Query, so the result set comes back to the pipeline as `resultSets[0]`, passing the pipeline's run ID through dynamic content so each result row ties back to a specific pipeline run:

```sql
EXEC dq.usp_run_checks @run_id = '@{pipeline().RunId}';
```

If your model uses an "Unknown" member for late-arriving dimensions, as the loading guidance suggests, add a check that counts fact rows pointing at it and decide on a threshold. A handful is normal. A sudden jump usually means an upstream key changed.

## The publish step

Add an If Condition after `Run checks` with this expression:

```text
@equals(activity('Run checks').output.resultSets[0].rows[0].total_failed, 0)
```

The "true" branch runs two Script activities against the parent warehouse, both with script type NonQuery. The first, `Publish snapshot`, moves the snapshot to the audit time the procedure returned, not to the current time:

```sql
ALTER DATABASE [<your-snapshot-name>]
SET TIMESTAMP = '@{activity('Run checks').output.resultSets[0].rows[0].audit_ts}';
```

The second, `Log publish`, is chained to the first with an "On success" dependency and writes the publish record:

```sql
INSERT INTO dq.publish_log (run_id, audit_ts, published_at)
VALUES (
    '@{pipeline().RunId}',
    '@{activity('Run checks').output.resultSets[0].rows[0].audit_ts}',
    CAST(SYSUTCDATETIME() AS datetime2(6))
);
```

Keep them separate. A T-SQL error such as a missing snapshot or a permission failure ends only the statement that raised it, so an `INSERT` in the same batch would still run. Write the publish record in its own Script activity that runs only on success, so the log never claims a publish that didn't happen. If the semantic model on the snapshot uses Import, add a semantic model refresh activity after this script in the true branch, so the model moves with the snapshot. Otherwise it keeps showing the previous publish until its next scheduled refresh.

Pin to the audit time, not `CURRENT_TIMESTAMP`: if you publish "now", any write that lands between the checks and the publish, from a second pipeline, a late activity or someone's manual fix, goes out unchecked. Pinned to the audit time, those writes stay out of the published version until the next run checks them. The checks themselves still read live tables, so the clean guarantee also needs loads to be serialised: nothing else writes to the gated tables while the audit runs. Run one load pipeline at a time and keep manual fixes inside it.

Because `dq.audit_run` gets its row before the audit time is even taken, and the audit time carries a small margin, the published version always contains the marker for the run that passed. Analysts can answer "how fresh is this?" for themselves with `SELECT TOP 1 run_id, audited_at FROM dq.audit_run ORDER BY audited_at DESC;` against the snapshot, and they never have to message the data team to ask whether a load has finished. `dq.publish_log` stays in the parent as the engineering record of what was published and when.

The "false" branch should alert someone and do nothing else. Resist the urge to auto-retry the publish. If a check failed, a human needs to decide whether the check or the data is wrong.

The credential on the Script activity's Warehouse connection needs the Admin, Member or Contributor workspace role, because those are the [only roles allowed to update a snapshot's timestamp](https://learn.microsoft.com/fabric/data-warehouse/warehouse-snapshot#permissions). Analysts need read access to the parent warehouse, because that's where the snapshot gets its permissions. That works in your favour if you follow the view contract: schema-level `GRANT`s on the analyst view schema in the parent carry through to the snapshot, so the view contract and the publish gate combine, and only parent-versus-snapshot isolation is left to convention.

## Decide the collation before analysts arrive

One more thing that generates hand-holding requests, and which you can only get right at creation time: [collation](https://learn.microsoft.com/fabric/data-warehouse/collation). New warehouses default to `Latin1_General_100_BIN2_UTF8`, which is case-sensitive. Analysts coming from SQL Server expect `WHERE state = 'nsw'` to match `NSW`, and on a default warehouse it silently returns nothing. No error appears, so they trust the wrong answer.

You can choose the case-insensitive `Latin1_General_100_CI_AS_KS_WS_SC_UTF8` through the workspace's Data Warehouse settings or the REST API when you create the warehouse, but you can't change it afterwards. Decide deliberately. Either go case-insensitive for an analyst-facing warehouse, or keep the default and normalise text values (upper-case codes, trimmed strings) in the load, so case never matters.

## Where this pattern costs you

Warehouse snapshots carry constraints that decide whether the pattern fits:

| Constraint | What it means for you |
|---|---|
| No Direct Lake | Semantic models on a snapshot must use DirectQuery or Import. If Direct Lake is non-negotiable, model on the parent, [turn off automatic updates](https://learn.microsoft.com/fabric/fundamentals/direct-lake-how-it-works#automatic-updates) on the Direct Lake model and trigger a refresh (reframe) only after the checks pass. With Direct Lake on SQL, queries that fall back to DirectQuery still read the live warehouse. |
| Data is frozen, schema isn't | Dropping, renaming or altering an object in the parent shows up in the snapshot straight away, and objects modified after the snapshot timestamp become invalid in it. Keep loads to DML (`INSERT`, `UPDATE`, `DELETE`, `MERGE`) and ship schema changes as a planned release. |
| 30-day window | The timestamp can only point at the last 30 days of retained history. That's fine for a rolling gate, but it isn't an archive. |
| Warehouse only | Snapshots aren't supported on a lakehouse's SQL analytics endpoint. |

There are also cases where I wouldn't bother. If the warehouse feeds operational reporting that has to be minutes fresh, a gate that holds data back on failure may be worse than showing it with a warning. If a single engineer loads a handful of tables once a day after hours, nobody is querying the intermediate state, and the checks alone are enough. And the gate can't help with data that is correct by the rules but wrong for the business. That's a definition problem, and the [ownership rules](/blog/2026-03-28-warehouse-modeling-in-fabric-preventing-metric-drift-through-ownership-rules/) post is where I'd start.

### Why not table clones?

The obvious alternative inside Fabric Warehouse is zero-copy table clones: after the checks pass, re-create each gated table with `CREATE TABLE ... AS CLONE OF` into a published schema. It works, but it's per-table swap logic you maintain yourself, and readers can catch the published schema halfway through a swap. A snapshot is one statement for the whole warehouse, and every table moves to the same point in time at once. Clones still win in two cases. Clones are ordinary warehouse tables, so a Direct Lake model can sit on the published copy. And because they live in their own schema, you can grant analysts that schema alone and get real permission isolation rather than isolation by convention.

This also isn't the same job as freezing month-end figures. A month-end snapshot stays pinned to a sign-off date, as covered in the [metric drift runbook](/blog/2026-04-08-warehouse-modeling-in-fabric-preventing-metric-drift-through-ownership-rules/). A publishing snapshot moves forward every time a load passes. You can run both from the same warehouse.

## What I'd set up first

Start with one snapshot called something analysts will recognise, such as `sales_published`, and point one semantic model at it. Write the three checks above for your most-queried fact table and its main dimension, log every result, and gate the snapshot on them. Hand analysts the snapshot's connection string, and leave the parent warehouse for engineers by convention.

Once analysts learn that the published snapshot only ever moves to a verified state, the "is this number right?" messages change into "has today's load published yet?", and they can answer that one themselves.
