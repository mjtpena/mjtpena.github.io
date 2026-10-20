---
title: "Feeding AI Teams Through OneLake Shortcuts Without Over-Sharing"
description: "A passthrough OneLake shortcut adds speed but no boundary: how to give data science teams curated Fabric features without opening the whole lakehouse."
author: Michael John Peña
draft: false
date: 2026-04-17
tags:
  - Microsoft Fabric
  - OneLake
  - Governance
  - Data Science
  - Security
---

The handoff between data engineering and an AI team is where OneLake shortcuts get used most and understood least. The data scientists want curated feature tables today, the engineers don't want to maintain a copy, and a shortcut answers both. It is a good answer for speed. It is not a boundary, and when a team assumes it is, the result is either a broken notebook or a data science workspace that can read far more than anyone intended.

I've written before about [access boundaries across workspaces](/blog/2026-03-15-keeping-onelake-clean-under-delivery-pressure-balancing-speed-and-access-boundaries/) and about [treating shortcuts as dependencies](/blog/2026-04-06-onelake-shortcuts-in-practice-why-governance-has-to-be-designed-before-scale/). This post narrows in on one consumer, the AI team, because their needs differ from a report consumer's: they read through Spark, they want whole tables, and they need training runs they can reproduce.

## A shortcut doesn't move the boundary

The detail that drives every decision below is in the [OneLake shortcut security documentation](https://learn.microsoft.com/fabric/onelake/onelake-shortcut-security): OneLake-to-OneLake shortcuts use passthrough authentication. When a data scientist reads a shortcut in their own lakehouse, OneLake checks *their* identity against the target path in the engineering lakehouse. Effective access is the more restrictive of the shortcut path and the target path.

That has two consequences people rarely think through.

First, a shortcut can't grant access the user doesn't already have at the target. Creating a shortcut in the AI workspace and giving the data scientists Contributor there does nothing for them if they have no read access on the engineering side. The notebook fails with an authorisation error.

Second, and this is the one that hurts, a shortcut can't narrow access either. A common plan is to build a "features" lakehouse that contains shortcuts to five tables in the engineering lakehouse, then share only the features lakehouse with the AI team. Under passthrough, that doesn't work as a boundary: to read through those shortcuts, the data scientists need read access at the target. If the target is a lakehouse without OneLake security, that read access for Spark is the **Read all with Apache Spark** permission ([lakehouse sharing](https://learn.microsoft.com/fabric/data-engineering/lakehouse-sharing)), which applies to the whole item. They can then point a notebook at every other table in the engineering lakehouse directly. The features lakehouse becomes a curated *view*, not a curated *permission*.

So the real question for the handoff isn't "shortcut or copy?". It's "where does the boundary sit, and what enforces it?".

## Three ways to hand over features

| Approach | Speed to set up | Freshness | What enforces the boundary | Status (April 2026) |
|---|---|---|---|---|
| Shortcut, with Read all with Apache Spark on the engineering lakehouse | Minutes | Always current | Nothing below the item; the AI team can read every table | GA |
| Shortcut, with a OneLake security role on the engineering lakehouse scoped to the feature tables | An hour or two | Always current | OneLake security role at the target | Public preview |
| Materialise feature tables into a separate published lakehouse, then share or shortcut that | A day, plus a job to own | As fresh as the job | The item boundary of the published lakehouse | GA |

### Option 1: broad read on the source

This is the fast path, and it's fine more often than governance people like to admit. If the engineering lakehouse holds only curated, non-sensitive tables, and the AI team is part of the same domain, Read all with Apache Spark plus a shortcut is a perfectly reasonable design. My test is simple: list every table in the target item and ask whether you'd be comfortable seeing any of them in a training dataset. If yes, stop here.

It goes wrong when the engineering lakehouse also holds raw zones, staging tables or anything with personal data.

### Option 2: OneLake security roles at the target

[OneLake security](https://learn.microsoft.com/fabric/onelake/security/get-started-security) lets you define roles on the engineering lakehouse that grant read on specific tables or folders, with optional row and column rules, enforced in OneLake so Spark respects them. You can't define OneLake security roles on a passthrough shortcut itself; the role lives on the target, and the shortcut inherits whatever the caller can see there. That is exactly the shape the feature handoff needs: one role, "AI feature readers", scoped to the published feature tables, assigned to an Entra group. Users don't need Fabric Read on the engineering lakehouse to read through a shortcut, so the AI team creates shortcuts to those tables in their own workspace and the role decides what they can see.

Edit or remove DefaultReader on the engineering lakehouse. Enabling OneLake security creates that role, and it gives every existing holder of Read all with Apache Spark access to all the lakehouse's data; leave it in place and the feature role narrows nothing.

OneLake security in Spark needs Fabric Runtime 1.3 (Spark 3.5). With row or column rules I'd also plan on catalog reads (`lakehouse.schema.table`), because path-based reads such as the `abfss` example below may be blocked. Test that against your own secured table before you design around it.

Two caveats keep me from making this the default yet. It's still in public preview as I write this, so I'd pilot it rather than rely on it as the only control in front of sensitive data. And OneLake security roles don't restrict users who hold Admin, Member or Contributor in the engineering workspace. If a data scientist is also a Contributor on the engineering side, which happens on small teams, the role does nothing for them.

The [preview limitations](https://learn.microsoft.com/fabric/onelake/security/data-access-control-model) also bite AI teams specifically:

- **Mixed mode fails.** A single query that touches both OneLake-security-enabled data and data without it errors out, so a Spark join between the secured feature shortcut and the team's own label tables fails. Enable OneLake security on the AI team's lakehouse too, even with a single DefaultReader-style role, so both sides of the join are under the same model.
- **No cross-region shortcuts.** Shortcuts across capacities in different regions aren't supported and return 404s.
- **Group changes are slow.** A change to the Entra group behind a role takes about an hour to apply.

### Option 3: materialise into a published lakehouse

The boring option is still the one I trust most for sensitive domains. A notebook or pipeline writes the feature tables into a separate lakehouse whose only job is to be consumed, and the AI team gets read access to that item. The item boundary is GA, well understood, and holds regardless of which engine the consumer uses.

The costs are real: duplicated storage, a job someone has to own, and freshness that's only as good as its schedule. For features that are recomputed daily anyway, that lag rarely matters. For near-real-time features, it does, and that's where option 2 earns its place.

## Speed has a second meaning: reproducibility

For an AI team, a shortcut's "always current" is a mixed blessing. If the producer overwrites a feature table halfway through a week of experiments, two runs with identical code can train on different data, and nobody notices until the metrics don't line up.

The fix is cheap. Delta tables keep a version history, and Spark can read a table [as of a specific version](https://docs.delta.io/delta-batch/#query-an-older-snapshot-of-a-table-time-travel), including through a shortcut, because the shortcut exposes the target's Delta log. Resolve the version once at the start of a run, read that version explicitly, and log it with the model.

This fragment runs in a Fabric notebook. Replace the placeholders with your workspace and lakehouse names (names without spaces work as-is in the path). It reads by path, which is why I keep feature roles table-scoped with no row or column rules:

```python
import mlflow
from delta.tables import DeltaTable

# Shortcut in the AI team's lakehouse that points at the published feature table
FEATURE_PATH = (
    "abfss://<ai-workspace-name>@onelake.dfs.fabric.microsoft.com/"
    # schema-enabled lakehouse (the portal default for new lakehouses); drop dbo/ for a non-schema lakehouse
    "<ai-lakehouse-name>.Lakehouse/Tables/dbo/customer_features_v1"
)

# The columns and types the producer has agreed to keep stable
EXPECTED_SCHEMA = {
    "customer_id": "string",
    "tenure_days": "int",
    "orders_90d": "bigint",
    "churned": "boolean",
}

# Resolve the current version once, then pin every read in this run to it
latest = (
    DeltaTable.forPath(spark, FEATURE_PATH)
    .history(1)
    .select("version", "timestamp")
    .first()
)

training_df = (
    spark.read.format("delta")
    .option("versionAsOf", latest["version"])
    .load(FEATURE_PATH)
)

# Fail fast if the producer broke the contract
actual = {f.name: f.dataType.simpleString() for f in training_df.schema.fields}
broken = {col: typ for col, typ in EXPECTED_SCHEMA.items() if actual.get(col) != typ}
if broken:
    raise ValueError(f"Feature contract broken for columns: {broken}")

mlflow.set_experiment("<your-experiment-name>")
with mlflow.start_run():
    mlflow.log_params({
        "feature_table": "customer_features_v1",
        "feature_version": latest["version"],
        "feature_timestamp": str(latest["timestamp"]),
    })
    # Train and log the model here, using training_df
```

If the feature role does carry row or column rules, switch both reads to the catalog name (`<ai-lakehouse-name>.dbo.customer_features_v1`) and confirm history and time travel work for a Viewer on that secured table; if they don't, snapshot the training set at training time, as described next.

Two limits apply. Time travel only works while the old data files exist, and the producer controls that: Delta's `VACUUM` keeps unreferenced files for seven days by default, so a version you logged three weeks ago may no longer be readable. If the AI team needs to reproduce training data over months, either agree longer `delta.deletedFileRetentionDuration` and `delta.logRetentionDuration` settings on the producer's table (defaults are 7 and 30 days) or snapshot the training set into the AI team's own lakehouse at training time. The second is more reliable, because your audit trail doesn't depend on someone else's maintenance job.

The schema check is the other half. A shortcut means a producer's schema change reaches the AI team instantly. The `_v1` suffix and the expected-schema dictionary are a crude but effective contract: the producer can add `customer_features_v2` alongside, and the consumer fails loudly rather than training quietly on a renamed column. The [table contracts post](/blog/2026-03-04-keeping-onelake-clean-under-delivery-pressure-why-governance-has-to-be-designed-before-scale/) covers the producer side of this in more depth.

## Watch which engine the AI team actually uses

Passthrough holds for Spark and the OneLake APIs. It doesn't hold everywhere. The same security documentation notes that the SQL analytics endpoint in delegated identity mode, and Power BI semantic models using Direct Lake over SQL, reach the shortcut target with the *item owner's* identity rather than the caller's. If the AI team explores features through their lakehouse's SQL analytics endpoint, the owner's access at the target sets the ceiling and the feature role from option 2 is bypassed. The fix is to switch that SQL analytics endpoint to User's identity mode, and to build any semantic models on Direct Lake on OneLake rather than Direct Lake over SQL, so the caller's identity reaches the target and the feature role applies. That's another reason I prefer the AI team to own the lakehouse that holds their shortcuts, and to know who that owner is.

## When not to bother

If one team builds and consumes the features in the same workspace, none of this is necessary: put the notebooks next to the tables and move on. The same goes for prototypes on public or synthetic data. The design work pays off once producers and model builders are different teams, or the source lakehouse holds anything you wouldn't train on.

## What I'd do

Decide the boundary before anyone creates the first shortcut. If everything in the source item is safe to train on, a shortcut plus Read all with Apache Spark is the right, fast answer. If it isn't, materialise the feature tables into a published lakehouse today, and pilot OneLake security roles at the target for the cases where freshness matters more than a copy. Whichever you choose, pin the Delta version on every training run. A shortcut makes the handoff fast; the version number is what makes it reproducible.
