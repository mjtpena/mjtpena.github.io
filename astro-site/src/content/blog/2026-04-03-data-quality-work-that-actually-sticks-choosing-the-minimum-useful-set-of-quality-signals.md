---
title: "Pruning Data Quality Checks: Keep, Demote, or Delete"
description: "How to cut an inherited data quality rule set down to the checks that change decisions, using failure history, ownership and an explicit retirement path."
author: Michael John Peña
draft: false
date: 2026-04-03
tags:
  - Data Quality
  - Microsoft Fabric
  - Observability
  - Data Engineering
  - Governance
---

Most data teams don't need more quality checks. They need fewer, and they need to know which ones to drop. An inherited rule set with hundreds of checks, a muted alert channel and no record of why each rule exists is worse than a short list, because it gives everyone the feeling of coverage without changing what happens when the data is wrong.

In an [earlier post](/blog/2026-03-12-data-quality-work-that-actually-sticks-choosing-the-minimum-useful-set-of-quality-signals/) I argued for starting a new handoff table with five signals: freshness, volume, schema contract, completeness on key fields and one critical validity rule. That's the easy case. The harder and more common case is the opposite: the checks already exist, there are too many of them, and nobody wants to be the person who deletes the one that would have caught next quarter's incident. This post is about getting from there back to a minimum useful set.

## Why rule sets only ever grow

Checks get added for good reasons: an incident, a new consumer, a profiling tool that suggested a hundred rules in an afternoon. They almost never get removed, and the asymmetry is about blame. Adding a check is visible diligence. Removing one is a visible risk with no visible reward.

The cost of keeping a check is real but spread thin. Every check that fires without consequence teaches people that failures can be ignored. Every check without an owner turns into a question in a stand-up. And every threshold that nobody can explain makes the genuinely important checks harder to see. The result is the familiar pattern: a channel full of red, and the real incident still reported by a business user who noticed the numbers looked odd.

So pruning needs to be a deliberate, documented process, not a clean-up somebody does when they're bored. The point of documenting it is the same as documenting any design decision: when the intent lives in someone's head, the check outlives the reason it was created.

## Give every check a register entry

Before deciding what to cut, write down what each check is for. I'd keep a register with one row per check, in whatever your team already uses for living documentation. The fields that matter:

| Field | Why it matters |
|---|---|
| Owner | The team that fixes the data when it fails. "The platform" doesn't count. |
| Consumer | Who is protected by it. If you can't name one, that's a pruning candidate already. |
| Action on failure | Block the load, quarantine rows, notify, or nothing. "Nothing" is an answer, and a telling one. |
| Origin | The incident, requirement or contract it came from. |
| Threshold rationale | Why 1% and not 5%. Ideally agreed with the consumer. |
| Review date | When someone will look at it again. |

Filling this in is where most of the pruning happens, before any data is queried. A check whose owner, consumer and action are all blank is not protecting anyone. Writing "unknown" three times in a row is usually enough to convince a team to retire it.

## Let failure history do the arguing

Opinions about which checks matter are cheap. Failure history is better evidence. If your checks write their results to a table (the `quality_signals` table from the earlier post has one row per signal per run, with `table_name`, `signal`, `status`, `batch_loaded_at` and `checked_at`), a single query tells you how each check has behaved over the last quarter. This runs as Spark SQL in a Fabric notebook or any Spark environment that can read the table:

```sql
WITH per_batch AS (
  -- one result per check per batch, using the latest re-run if there were several
  SELECT
    table_name,
    signal,
    batch_loaded_at,
    max_by(status, checked_at) AS status
  FROM quality_signals
  WHERE status <> 'info'
    AND checked_at >= current_timestamp() - INTERVAL 90 DAYS
  GROUP BY table_name, signal, batch_loaded_at
),
summary AS (
  SELECT
    table_name,
    signal,
    count(*) AS batches,
    sum(CASE WHEN status = 'fail' THEN 1 ELSE 0 END) AS failures,
    max(CASE WHEN status = 'fail' THEN batch_loaded_at END) AS last_failure
  FROM per_batch
  GROUP BY table_name, signal
)
SELECT
  table_name,
  signal,
  batches,
  failures,
  round(failures / batches, 3) AS fail_rate,
  last_failure,
  CASE
    WHEN failures = 0 THEN 'review: never fired'
    WHEN failures / batches > 0.2 THEN 'review: noisy'
    ELSE 'keep'
  END AS triage
FROM summary
ORDER BY fail_rate DESC, table_name, signal;
```

The query doesn't decide anything on its own. It sorts checks into three piles worth talking about.

### Checks that never fire

A check with zero failures in 90 days is not automatically useless. A freshness check on a stable pipeline should be quiet most of the time; it exists for the day the upstream extract silently stops. The question for a silent check is whether the failure it guards against is still possible and still matters. A range check on a column that is now constrained at the source, or a check on a field no consumer reads any more, can go. A freshness or schema check on a table feeding a model stays, quiet or not.

### Checks that fire constantly

A check failing in more than a fifth of batches is either detecting a real, persistent problem that nobody is fixing, or its threshold is wrong. Both are worth a conversation, and both end with a change. Either the producer fixes the data, or the threshold is re-agreed with the consumer, or the check is demoted to a trend metric. What can't continue is the current state, where a red result is normal and therefore meaningless. The 20% cut-off in the query is my starting point, not a standard; tune it to your batch frequency.

### Checks that fire occasionally

These are the ones doing their job. Check that the register entry is complete and the action on failure actually happens, and move on.

## Keep, demote, or delete

Every check ends up in one of three tiers, and I'd make the tier part of the register rather than an informal understanding.

| Tier | What a failure does | Belongs here |
|---|---|---|
| Blocking | Stops the load or the downstream refresh | Contract checks a consumer depends on: schema, freshness, key completeness, critical validity |
| Advisory | Records a trend, notifies the owner, never stops anything | Drift indicators, soft ranges, checks still earning trust |
| Retired | Removed from the pipeline; the register row stays with the reason | Checks with no consumer, no owner, or a failure mode now prevented elsewhere |

Demotion is the underrated option. Teams often hesitate to delete a check because it might matter one day. Moving it to advisory keeps the history without letting it page anyone, and the next review either promotes it back or retires it with evidence.

Retired checks keep their register row. That's the "documenting intent" part: six months later, when someone proposes adding the same check, the register says why it was removed and what changed. That one line saves a repeat of the same debate.

## Move hard rules upstream

Some checks are on the list only because the data is allowed to be wrong in the first place. Where a rule is a true invariant, such as "tenure is never negative" or "the order ID is never null", stop checking it after the fact and make the bad write impossible. Delta Lake [`CHECK` and `NOT NULL` constraints](https://docs.delta.io/delta-constraints/) reject any write that violates them, and they work on lakehouse tables in Fabric Spark:

```sql
ALTER TABLE customer_features
ADD CONSTRAINT tenure_non_negative CHECK (tenure_days >= 0);
```

Adding the constraint validates the existing rows first, so clean them before you add it. The trade-off is bluntness: one bad row fails the whole write, and the constraint upgrades the table's writer protocol, so any writer that doesn't support Delta constraints will be refused. Use it for invariants, not for anything you'd rather quarantine. Each rule you move into the table is one less check to own, alert on and review.

## Make the remaining failures land somewhere

A pruned set only stays pruned if the remaining blocking checks reach a named person. If your results already land in a Delta table and a Power BI report, [Fabric Activator](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-introduction) (generally available since November 2024) can alert on a failure-count measure in that report and route it by table. If your organisation runs data quality scans in [Microsoft Purview Unified Catalog](https://learn.microsoft.com/purview/data-quality-overview), put those rules through the same register and the same tiers. Two parallel rule sets with different owners is how you end up back at hundreds of checks.

## When not to prune this way

- **Regulated controls.** If a check exists because an auditor or regulation requires evidence that it ran, it stays regardless of failure history. Mark it as such in the register so nobody wastes a review on it.
- **Short histories.** Ninety days of a monthly batch is three data points. For infrequent loads, extend the window or rely on the register review alone.
- **Ownership gaps.** If nobody will accept ownership of the checks you keep, pruning just produces a shorter list nobody acts on. Sort out ownership first.
- **During an active incident.** Don't retire checks while the team is under pressure. Pruning is a calm, scheduled activity, ideally once a quarter.

## The rule I'd adopt

Every check needs an owner, a consumer, an action and a reason, written down. A check that can't supply all four within a quarter gets demoted, and an advisory check that hasn't earned promotion by the next review gets retired with its reason recorded. Add checks when an incident proves you needed one, remove them when the evidence says they no longer change anything, and keep the register so both decisions can be explained later. A short list that people trust beats a long one they've learned to ignore.
