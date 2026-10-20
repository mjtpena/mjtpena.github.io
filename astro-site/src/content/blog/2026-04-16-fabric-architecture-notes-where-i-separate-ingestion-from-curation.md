---
title: "Ingestion vs Curation in Fabric: Where I Draw the Workspace Line"
description: "Why I split Fabric ingestion and curation at the landing table, when that means separate workspaces joined by shortcuts, and when one lakehouse is enough."
author: Michael John Peña
draft: false
date: 2026-04-16
tags:
  - Microsoft Fabric
  - Architecture
  - Lakehouse
  - OneLake
  - Data Engineering
---

Most Fabric estates start as one workspace holding everything: the pipelines that call source systems, the raw files, the notebooks that clean them, the silver and gold tables, and the semantic model on top. It works for the first few sources. Then a source credential changes, a backfill eats the capacity during business hours, or someone fixes a landing problem by editing a curated table, and it becomes clear that two very different jobs have been sharing one set of permissions, one capacity and one release cadence.

My position: ingestion and curation are separate jobs, and the boundary between them should be a real object you can point at, not a folder naming convention.

## Two jobs, different failure modes

Ingestion moves bytes from somewhere else into OneLake. Curation turns those bytes into tables people can trust. Almost everything about running them differs.

| | Ingestion | Curation |
|---|---|---|
| Talks to | Source systems, gateways, external storage | OneLake only |
| Holds secrets | Yes: connections, gateway credentials | Ideally none |
| Changes when | A source changes (schema, auth, endpoint) | The business definition changes |
| Typical failure | Source unavailable, late file, auth expiry | Contract violation, logic bug, drift |
| Right response | Retry, alert the source owner | Stop publishing, alert the data owner |
| Compute profile | Spiky: backfills, catch-up loads | Predictable, schedule-driven |

When both jobs live in one workspace, every row in that table gets the same answer: same people, same capacity, same deployment. That's the root of most of the "how did that get into gold?" conversations I see.

## The line is the landing table

I put the boundary at the landing table: the bronze Delta table (or batch folder under `Files`) that ingestion writes and curation reads. Ingestion's job is done when a batch is landed with its metadata. Curation's job starts when it reads that batch.

That gives two rules that are easy to state and easy to review:

1. **Ingestion never interprets.** It lands data as close to the source as it can, appends rather than updates, and stamps every row with a batch ID, a landed timestamp and the source file or extract name. Type casting, deduplication and business keys are not its problem. It also makes completeness explicit: each batch is either written in a single Delta commit, or followed by a completion marker (a row in a `batch_control` table or a `_SUCCESS` file) written last, and curation only selects batch IDs that have that marker.
2. **Curation never calls a source.** No connections, no gateways, no API keys in curation notebooks. If curation needs data that isn't landed, that's a request to ingestion, not a workaround.

Everything else about the contract, such as column expectations, constraints and quarantine, sits on the curation side. I covered that in [table contracts in a Fabric lakehouse](/blog/2026-03-03-lakehouse-decisions-i-made-this-week-turning-messy-raw-zones-into-reliable-products/), and the landing layout itself in [when a slow lakehouse is really a raw zone problem](/blog/2026-04-05-fabric-lakehouse-patterns-turning-messy-raw-zones-into-reliable-products/). Physical separation is what makes those rules stick.

## Three ways to enforce the line

### Schemas in one lakehouse

The cheapest option is one schema-enabled lakehouse with a `landing` schema and curated schemas next to it. [Lakehouse schemas](https://learn.microsoft.com/fabric/data-engineering/lakehouse-schemas) are generally available and are now the default for new lakehouses when created in the portal (the REST API still needs `enableSchemas: true`, which matters if your estate is built from infrastructure as code), so there's no reason not to use them.

The weakness is that the boundary is a convention. Workspace roles apply to every item in the workspace, so anyone who can run the ingestion pipeline can also write to curated tables. [OneLake security](https://learn.microsoft.com/fabric/onelake/security/data-access-control-model), which defines table- and folder-level roles that apply across engines, would let you enforce schema-level audiences inside one lakehouse, but as of mid-April 2026 it's still in preview. I'd wait for it before relying on it as the only control on a production estate.

### Separate lakehouses in one workspace

Separate landing and curated lakehouses get their own SQL analytics endpoints, item permissions and clearer lineage. Workspace roles don't change, though: contributors can still write to both. It's tidiness more than security.

### Separate workspaces joined by shortcuts

This is my default once more than one team is involved or a source is sensitive. The ingestion workspace holds the pipelines, connections and the landing lakehouse. The curation workspace holds notebooks, curated lakehouses or warehouses, and whatever serves consumers. The curated lakehouse reads landing tables through OneLake shortcuts, so there's no second copy.

What you get for one extra workspace:

- **Roles that match the jobs.** Ingestion engineers are contributors in the ingestion workspace and nothing more in curation. The curation team gets read access to the landing lakehouse only.
- **Secrets in one place.** Connections and gateway bindings exist only where ingestion runs. A compromised or careless curation notebook has nothing to call out with.
- **Separate capacity if you need it.** Each workspace is assigned to one capacity, so a heavy backfill can run on a different capacity from the one serving reports.
- **Separate release cadence.** Each workspace can have its own Git connection and deployment pipeline, so a connector fix doesn't wait for a semantic model change to be reviewed.
- **Firewalled sources stay contained.** If ingestion reads from storage behind a firewall, [workspace identity and trusted workspace access](https://learn.microsoft.com/fabric/security/security-trusted-workspace-access) are configured on the ingestion workspace only. Trusted workspace access needs an F SKU capacity and isn't available on trial capacities.

## How curation reads the landing zone

The pattern I use is item-level sharing plus shortcuts. Share the landing lakehouse (not the workspace) with the curation team's group and include the [Read all with Apache Spark permission](https://learn.microsoft.com/fabric/data-engineering/lakehouse-sharing). Sharing never grants write access, which is exactly the point. Then create shortcuts in the `Tables` area of the curated lakehouse, under a `landing` schema (or as a schema shortcut to the landing lakehouse's schema), that point at the landing tables. That's what lets `landing.orders` resolve as a two-part name. Shortcuts aren't optional here: a schema-enabled lakehouse can't be referenced directly as a shared lakehouse, and the [lakehouse schemas limitations](https://learn.microsoft.com/fabric/data-engineering/lakehouse-schemas#current-limitations) list shortcuts in a lakehouse where the user has a workspace role as the workaround.

Three identity details matter here. For OneLake-to-OneLake shortcuts, Spark checks the calling user's permissions on the target, so a notebook run by someone without access to the landing lakehouse fails even though the shortcut is visible. The SQL analytics endpoint in its default delegated mode uses the identity of the item owner instead (unless you've switched it to user identity mode under OneLake security), so check who owns the curated lakehouse before you assume a T-SQL query through a shortcut proves the reader has access. Scheduled notebooks run under the identity of whoever created or last updated the schedule, not the notebook author, so grant read access to that identity (and re-check it whenever someone edits the schedule).

With that in place, the curation notebook reads landed batches it hasn't processed yet. This fragment assumes:

- A schema-enabled curated lakehouse attached as the notebook's default.
- Shortcuts for `landing.orders` and `landing.batch_control`, where ingestion writes a row with `status = 'complete'` after each batch. If every batch lands in a single Delta commit, drop that join.
- Existing Delta tables `curated.orders` (the listed columns) and `curated.processed_batches` (one string `_batch_id` column).
- Non-null `source_updated_at` per the landing contract (quarantine violations first), and batch IDs that sort chronologically.

```python
from delta.tables import DeltaTable
from pyspark.sql import functions as F
from pyspark.sql.window import Window

landing = spark.read.table("landing.orders")

# Only batches ingestion has marked complete, so a half-written batch is never merged
ready = (
    spark.read.table("landing.batch_control")
    .where("status = 'complete'")
    .select("_batch_id")
    .distinct()
)

# Batches already merged, tracked by batch ID rather than timestamp
done = spark.read.table("curated.processed_batches")

# Pin the batch set once, so a batch that lands mid-run isn't logged unmerged
batch_ids = [
    r["_batch_id"]
    for r in landing.join(ready, on="_batch_id", how="left_semi")
    .join(done, on="_batch_id", how="left_anti")
    .select("_batch_id").distinct().collect()
]

if batch_ids:
    # Cast the key first, so '00123' and '123' dedupe as the same order
    pending = (
        landing.where(F.col("_batch_id").isin(batch_ids))
        .withColumn("order_id", F.col("order_id").cast("bigint"))
    )

    # Latest version of each order across the pending batches
    latest = Window.partitionBy("order_id").orderBy(
        F.col("_src_ts").desc(), F.col("_batch_id").desc()
    )
    staged = (
        pending
        .withColumn("_src_ts", F.to_timestamp("source_updated_at"))
        .withColumn("_rn", F.row_number().over(latest))
        .where("_rn = 1")
        .select(
            F.col("order_id"),
            F.col("customer_id").cast("bigint").alias("customer_id"),
            F.col("order_total").cast("decimal(18,2)").alias("order_total"),
            F.col("_src_ts").alias("source_updated_at"),
            F.col("_batch_id").cast("string").alias("_batch_id"),
        )
    )

    (
        DeltaTable.forName(spark, "curated.orders").alias("t")
        .merge(staged.alias("s"), "t.order_id = s.order_id")
        .whenMatchedUpdateAll(
            condition="t.source_updated_at IS NULL OR s.source_updated_at > t.source_updated_at",
        )
        .whenNotMatchedInsertAll()
        .execute()
    )

    # Record exactly the batches this run merged, not a fresh read of landing
    # MERGE, not append, so a repeated or overlapping run can't duplicate log rows
    log = spark.createDataFrame([(str(b),) for b in batch_ids], "_batch_id string")
    (
        DeltaTable.forName(spark, "curated.processed_batches").alias("t")
        .merge(log.alias("s"), "t._batch_id = s._batch_id")
        .whenNotMatchedInsertAll()
        .execute()
    )
```

Why this is safe and idempotent:

- **No path back to the source or landing.** There's no connection string, no source call and no write to `landing`, and sharing is read-only, provided the run identity (including whoever last updated the schedule, for scheduled runs) has no role in the ingestion workspace.
- **Only finished, unprocessed batches.** The semi-join to `landing.batch_control` skips half-written batches, and tracking by `_batch_id` rather than "rows newer than the last run" means a late batch is picked up next run.
- **The batch set is pinned before the merge.** `pending` is lazy, so re-reading it to write the log would see the latest landing snapshot and could record a batch that arrived mid-run without merging it.
- **Older versions can't win.** The merge condition stops an older batch from overwriting a newer version of the same order, while still filling in a target row that somehow has no timestamp.
- **A failed run reruns cleanly.** If it fails after the merge but before the batch log is written, the rerun repeats the merge harmlessly.
- **Run it single-instance.** Two overlapping runs pin the same batches and can hit Delta concurrent-write conflicts. The log MERGE prevents duplicate rows, but keep one schedule or pipeline and no overlapping runs.

In production, the contract checks and quarantine from the earlier post belong in the cast step.

## Where materialized lake views fit

[Materialized lake views](https://learn.microsoft.com/fabric/data-engineering/materialized-lake-views/overview-materialized-lake-view) sit in an awkward spot in April 2026: the overview docs dropped their preview label with the FabCon release in March, but the Fabric What's new page still lists them as a preview feature, so I treat them as preview until a GA announcement says otherwise. They're a curation tool: declarative definitions over lakehouse tables, with constraints, managed refresh and lineage. They don't change the boundary argument: a view that Fabric refreshes for you is only as trustworthy as the landing table underneath, and the ingestion side still needs its own owners, alerts and release path. I'd trial them for the curated layer in a new build, keep a notebook fallback until they're formally GA, and keep ingestion on pipelines, Copy job, mirroring or eventstreams, whichever fits the source.

## When not to split

A separate ingestion workspace is overhead, and it isn't always worth paying:

- **One team, a few sources, nothing sensitive.** Schemas in one lakehouse and a clear naming rule are enough. Split when a second team or a regulated source arrives.
- **Mirroring is the whole ingestion story.** If the source is replicated by Fabric mirroring with no custom landing logic, the mirrored item is already the landing zone. Shortcut it into curation and skip the extra workspace until you add pipelines.
- **Proofs of concept.** Prove the value first, but keep the two rules (ingestion doesn't interpret, curation doesn't call sources) so the later split is a move, not a rewrite.
- **When nobody owns ingestion separately.** Separate workspaces with the same three people in every role are ceremony. The boundary only pays off if it maps to [different owners and different alerts](/blog/2026-03-14-fabric-architecture-notes-turning-messy-raw-zones-into-reliable-products/).

## Where I'd start

If your estate is still one workspace, don't reorganise it all at once. Start with the rules: append-only landing with batch metadata, and no source connections in curation code. Then move connections and pipelines into an ingestion workspace, share the landing lakehouse read-only, and replace direct reads with shortcuts. The workspace boundary works today with features that are already generally available, which is why it's my default.
