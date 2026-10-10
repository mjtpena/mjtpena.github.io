---
title: "Last Known Good: A Debugging Lesson From My Son's LEGO Set"
description: "My nine-year-old fixed a stuck LEGO build by going back to the last step that worked. It's the debugging discipline I'd let slip on a Fabric pipeline."
author: Michael John Peña
draft: false
date: 2026-02-19
tags:
  - Personal
  - Parenting
  - Debugging
  - Engineering
  - Reflection
---

My son Andriel is nine. Last weekend he got stuck building a LEGO set, and for twenty minutes I watched him work through it without realising he was teaching me something. The day before, I'd spent an hour trying fixes on a broken data pipeline before doing what he did straight away.

## Three pages back

A section wouldn't line up. He'd followed the instructions and the pieces were right, but the structure sat at a slight angle and wouldn't seat properly.

His first move was to flip back to the previous page and recheck the last ten steps.

He didn't start over. He didn't give up. He didn't ask me to fix it. He went looking for the last point where the build was definitely right.

He found it three pages back. One piece was rotated 90 degrees, and in the diagram it looked almost identical to the correct orientation if you weren't paying close attention. Everything he'd built after that step was technically correct. It was just sitting on a slightly wrong foundation.

He pulled the build back to that step, fixed the piece, and the rest snapped together in minutes.

## The mistake I keep seeing, and making

When something breaks, the instinct is to look at the last thing you changed. Often that's right, which is why the habit sticks. But when it's wrong, it's expensive, because every step after the real fault looks fine on its own. You can stare at a correct step for a long time.

The version I see most often is someone reverting their last commit, then the one before that, without first checking when the output was last right. I'm not exempt. The best debuggers I've worked with share a simpler discipline:

1. Establish when it last worked correctly.
2. Identify what changed between then and now.
3. Narrow the gap from there.

So the first question to ask is "what's the last known good state, and how did I get from there to here?", and only then "what did I just do wrong?"

Version control has this idea built in. [`git bisect`](https://git-scm.com/docs/git-bisect) asks you for one commit you know is good and one you know is bad, then binary-searches the history between them until it finds the commit that introduced the problem. It works without any theory about the cause, as long as you're honest about where "good" was. Andriel did a linear version of the same thing with a paper instruction booklet.

## The Fabric pipeline I should have read like a LEGO manual

The day before the LEGO build, I'd been debugging a Microsoft Fabric pipeline failure. I spent an hour trying things before I stepped back, traced the lineage, and found a schema change from three weeks earlier that nobody had flagged.

That's the LEGO problem exactly. The pipeline steps that ran after the schema change were doing what they were told. The fault was upstream and weeks old, so nothing I'd touched recently was going to explain it.

In Fabric, I'd now start with run history rather than the failing step. The [Monitor hub](https://learn.microsoft.com/fabric/admin/monitoring-hub), or the pipeline's own run history, shows the last successful run, as long as that run is still inside the run-history retention window. Check the current limit on the Monitor hub page, and don't rely on it for anything older than a few weeks. That run is your last known good page in the manual. Compare that run with the failing one: its activity inputs and outputs in the run details, then the source table's current schema against what the pipeline expects. The gap usually gets small quickly. Be careful with what "successful" means: a run can succeed on data that's already wrong, so the last green run isn't always the last good state. Compare schemas and outputs, not just run status.

Then use the workspace [lineage view](https://learn.microsoft.com/fabric/governance/lineage). It shows how items in the workspace connect, plus the data sources one step upstream of the workspace, so you can walk back through the dependencies instead of guessing at the step that failed. It doesn't capture every connection (see the limitations on the lineage page), and it won't tell you when the data was last right. Run history tells you when; lineage tells you where to look.

It took me an hour. Andriel would have found it in twenty minutes.

## What he skipped that I didn't

Andriel didn't need me. He had the instructions, the pieces, and enough patience to backtrack.

Somewhere in professional life, a lot of us learn to panic faster, second-guess more, and reach for help or a rewrite before we've fully engaged with the problem. Starting over feels decisive and asking for help feels efficient, but both skip the slightly boring work of walking back to the last good state, which is usually the fastest route.

He just worked the problem.

## When "last known good" isn't enough

It's a strong default, but it has limits:

- **There may be no good state.** If something never worked, there's nothing to walk back to. You're designing, not debugging.
- **The change may not be in your history.** A schema change from an upstream team, an expired credential or a changed API on the other side of a connection won't show up in your own commits. That's why lineage across systems matters as much as version history, and why a guard at ingestion (below) is worth having.
- **Some faults are intermittent.** If it works on one run and fails the next, "when did it last work?" has no clean answer. Look for what differs between runs instead.

In each of these the instinct still helps: find a reference point you trust and reason from it, rather than from whatever you touched last.

### Catch it on day one

The cheapest fix for my Fabric problem would have been a schema contract at ingestion. My rule of thumb: put a notebook activity after the copy activity and before any transform, which compares the landed table's columns and types with an expected schema and raises on a mismatch. The run then fails at the step where the change arrived, with a message that names the column, instead of somewhere downstream. If the upstream change had been caught at ingestion, it would have failed loudly on day one rather than taking me an hour to trace three weeks later.

A minimal version in a Fabric PySpark notebook looks like this (a fragment: `spark` is the notebook's session, and the table and columns are placeholders):

```python
from pyspark.sql.types import StructType, StructField, StringType, DecimalType, TimestampType

expected = StructType([
    StructField("order_id", StringType()),
    StructField("amount", DecimalType(18, 2)),
    StructField("order_ts", TimestampType()),
])

actual = spark.read.table("<your-staging-table>").schema
got = {f.name: f.dataType for f in actual.fields}
want = {f.name: f.dataType for f in expected.fields}
if got != want:
    raise ValueError(f"Schema mismatch: expected {want}, got {got}")
```

It compares names and types only, so nullability differences won't trip it. Keep the expected schema in source control next to the pipeline, and change it on purpose when the source changes on purpose. I covered the wider drift policy, including when to fail and when to evolve, in [running data pipelines in production](/blog/2026-02-05-data-pipelines-production/).

## The parenting part

I'm trying to raise kids who can think through hard things without immediately outsourcing the discomfort. Living with Andriel's need for structure has already [changed how I design systems](/blog/2026-01-08-autism-and-routine/); this was a smaller lesson in the same direction.

Watching him refuse to give up, not because I told him to keep going but because he wanted to solve it himself, was better than anything I could have taught him directly. He already had the debugging instinct; nobody had to teach it to him.

I needed the reminder.

## The question to ask first

Next time you're stuck on something at work, start with one question: when did this last work correctly?

Don't stop at the last change. Find the last good state, and walk forward from there.

My nine-year-old worked that out with LEGO. The principle scales.
