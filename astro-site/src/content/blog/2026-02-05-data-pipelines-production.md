---
title: "Data Pipelines: What Production Actually Teaches You"
author: Michael John Peña
draft: false
date: 2026-02-05
tags:
  - Data
  - Fabric
  - Engineering
  - Lessons
---

I've built data pipelines for 8 years. Every production deployment humbled me. Here's what the tutorials don't teach.

## Lesson 1: Data Is Never Clean

Every data source lies to you.

"These fields are always populated." They're not.

"Dates are in ISO format." Some are. Some are US format. One is a Unix timestamp. Another is "last Tuesday."

"IDs are unique." Until they're not.

```python
# What you expect
{"id": 123, "name": "John", "date": "2026-02-05"}

# What you get at 3 AM
{"id": None, "name": "", "date": "02/05/26", "extra_field": "surprise"}
```

Build for the data you'll get, not the data you're told you'll get.

## Lesson 2: Idempotency Is Everything

Your pipeline will fail. It will be rerun. If it can't handle reruns, you'll have duplicates.

```python
# Bad: Append always
def process_batch(data):
    insert_into_table(data)

# Good: Upsert or merge
def process_batch(data):
    merge_into_table(
        data,
        match_on=["id"],
        when_matched="update",
        when_not_matched="insert"
    )
```

Every pipeline should be safe to rerun. No exceptions.

## Lesson 3: Monitoring Beats Prevention

You can't prevent all failures. But you can detect them fast.

What to monitor:

- Row counts (sudden drops or spikes)
- Schema changes (new columns, type changes)
- Freshness (when did data last arrive?)
- Null rates (unexpected nulls in required fields)
- Value distributions (is 90% of a column suddenly the same value?)

```python
def check_data_quality(df):
    alerts = []

    if df.count() < expected_min_rows:
        alerts.append("Row count below threshold")

    null_rate = df.filter(col("key_field").isNull()).count() / df.count()
    if null_rate > 0.01:
        alerts.append(f"Null rate {null_rate:.2%} exceeds 1%")

    return alerts
```

## Lesson 4: Start with Microsoft Fabric Data Factory

For Azure shops, Fabric's Data Factory handles 80% of pipeline needs without custom code.

Where it shines:

- Copy activities between sources
- Simple transformations
- Scheduling and orchestration
- Built-in monitoring

Where you need code:

- Complex business logic
- Multi-step ML pipelines
- Custom data quality checks

Don't write code when configuration will do.

## Lesson 5: Late Data Is Normal

Data arrives late. Sometimes hours late. Sometimes days late.

Design for this:

- Use event time, not processing time
- Build late-arrival windows
- Re-process when late data arrives

## Lesson 6: Schema Evolution Will Happen

Sources change schemas without telling you. New fields appear. Types change. Fields disappear.

Handle it gracefully or wake up at 3 AM.

## The Reality

Production data pipelines are 20% building and 80% maintaining.

The exciting part is building them. The valuable part is keeping them running.

Design for maintenance from day one. Your future self will thank you.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
