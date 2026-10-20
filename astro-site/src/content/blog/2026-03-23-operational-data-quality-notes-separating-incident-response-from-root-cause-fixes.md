---
title: "Two Tickets per Data Incident: Contain First, Fix the Cause Second"
description: "Why every data quality incident should produce two pieces of work, a containment action and a root-cause fix, and how to run both on a Fabric lakehouse."
author: Michael John Peña
draft: false
date: 2026-03-23
tags:
  - Data Quality
  - Microsoft Fabric
  - Observability
  - Data Engineering
  - Delta Lake
---

When a dashboard shows the wrong revenue figure or a feature table fills with nulls, two jobs start at the same moment. One is stopping the damage: consumers need to know, and bad rows have to stop flowing downstream. The other is working out why it happened and making sure it can't happen the same way again. Most data teams treat these as one job, and that's why the same incident keeps coming back.

## Why one ticket is the wrong unit

The usual pattern goes like this. A check fails or a stakeholder complains. An engineer investigates, finds a bad upstream extract, reruns the load, and closes the ticket. Everyone moves on.

What actually happened is that the symptom was handled and the cause was never touched. The upstream extract can still arrive half-written tomorrow. The pipeline still has no gate that would have stopped it. The ticket says "resolved", so nobody has a reason to look again.

Change the unit of work instead: I'd make every data incident produce two tickets with different owners, different deadlines, and different definitions of done:

| | Containment ticket | Root-cause ticket |
|---|---|---|
| Goal | Stop bad data reaching consumers | Stop this class of failure recurring |
| Clock | Minutes to hours | Days to a sprint |
| Owner | Whoever is on call for the data product | The team that owns the failing component |
| Done means | Consumers are on known-good data or know the data is stale | A control exists that would have caught or prevented it |
| Typical actions | Pause refresh, restore previous version, quarantine rows, notify | Add a contract check, change an upstream interface, fix the pipeline design |

This isn't a new idea. IT operations has separated incident management from problem management for decades, and the Azure Well-Architected Framework's [incident response guidance](https://learn.microsoft.com/azure/well-architected/operational-excellence/incident-response) separates triage and mitigation from root-cause analysis and post-incident reviews. Data teams are just late to apply it, mostly because data incidents don't page anyone at 2am the way an outage does. They leak slowly into reports instead.

## Containment: optimise for speed and reversibility

During containment, the only question is "what's the fastest reversible action that stops consumers being misled?" It is not the time to debug.

I rank containment options roughly like this:

1. **Tell consumers.** A short message that a table or report is suspect, and from when, costs nothing and stops people making decisions on bad numbers. Do this first, even before you know the cause. A text box on the report page saying "figures from Monday onwards are under review" reaches people who never read the incident channel.
2. **Stop the spread.** Pause the downstream pipeline or semantic model refresh so the bad data doesn't propagate into more tables. A stale report is almost always less harmful than a wrong one. In Fabric that means turning off the pipeline's schedule and the semantic model's scheduled refresh. For a Direct Lake model, also turn off the setting that keeps Direct Lake data up to date automatically, otherwise the model reframes onto whatever version of the table lands next, bad or restored, while you're still working.
3. **Roll back to the last known-good state.** On a Fabric lakehouse, Delta tables keep version history, so you can inspect them with `DESCRIBE HISTORY`, query an earlier one with `VERSION AS OF`, and bring it back with `RESTORE` (see the [Delta Lake utility commands](https://docs.delta.io/delta-utility/); time-travel queries are under [querying an older snapshot](https://docs.delta.io/delta-batch/#query-an-older-snapshot-of-a-table-time-travel)).
4. **Quarantine instead of delete.** If only some rows are bad, move them to a quarantine table rather than dropping them. The root-cause investigation will need them.

Notice what's not on the list: patching the data by hand. Manual updates to fix "just these 300 rows" feel productive, but they destroy evidence and create a table state nobody can reproduce.

### A containment runbook fragment

Here's the kind of fragment I'd put in a runbook for a lakehouse table, run from a Fabric notebook with a default lakehouse attached, using Spark SQL (`%%sql` cells). Pause first, check history, confirm which version was good, keep the bad rows, restore, then bring the model back. It assumes `sales_curated` and `sales_quarantine` are lakehouses in the same workspace (or schemas in a schema-enabled lakehouse, generally available since December 2025), so the two-part names resolve.

```sql
-- 0. Pause the scheduled pipeline / semantic model refresh before continuing

-- 1. See recent writes to the table and find the last good version
DESCRIBE HISTORY sales_curated.daily_orders LIMIT 10;

-- 2. Confirm the candidate version looks right before restoring
SELECT order_date, COUNT(*) AS row_count, SUM(net_amount) AS net_total
FROM sales_curated.daily_orders VERSION AS OF 41
GROUP BY order_date
ORDER BY order_date DESC
LIMIT 7;

-- 3. Keep the rows added or rewritten since the good version, as evidence
CREATE TABLE sales_quarantine.daily_orders_incident_20260323 AS
SELECT * FROM sales_curated.daily_orders
EXCEPT ALL
SELECT * FROM sales_curated.daily_orders VERSION AS OF 41;

-- 4. Restore the table to the known-good version
RESTORE TABLE sales_curated.daily_orders TO VERSION AS OF 41;

-- 5. After checks pass: refresh the semantic model manually (reframes Direct Lake),
--    then re-enable schedules once the gate exists
```

Version `41` and the table names are placeholders. Step 3 compares the current table with the good version rather than filtering on `order_date`, because a date filter sweeps up good rows and misses bad rows when a late load writes older dates. `EXCEPT ALL` keeps rows present now that weren't in version 41, duplicates included. Rows the bad load deleted aren't in this copy; they're in version 41 itself, so capture `SELECT * FROM ... VERSION AS OF 41 EXCEPT ALL SELECT * FROM ...` too if deletions are part of the incident. `EXCEPT` doesn't work on MAP columns or across a schema change, so list the columns explicitly for those tables.

The quarantine copy exists because history doesn't last forever. `RESTORE` keeps the bad version in history, but time travel only works while the old files and log entries exist. By default `VACUUM` removes unreferenced files older than 7 days (`delta.deletedFileRetentionDuration`) and the log keeps 30 days (`delta.logRetentionDuration`), so an incident found a fortnight late may be past rollback. And a restore doesn't stop the next scheduled load writing the same bad data, which is why pausing comes first.

### Containment has an exit condition

A containment ticket closes when consumers are back on known-good data, or explicitly know they're looking at stale data and until when. For a Direct Lake model, "back on known-good data" means the manual refresh after the restore has actually run: with automatic updates turned off, the model stays framed on the bad version no matter what the table now holds. It does not close when the cause is understood. Those are different events and they belong to different tickets.

## Root cause: the output is a control

The root-cause ticket is where most teams lose interest, because the pressure is gone. That's exactly why it needs its own owner and a due date.

A good root-cause ticket answers three questions:

- **What changed?** An upstream schema, a late extract, a new source system, a code deployment, or a business change nobody told the data team about.
- **Why didn't we catch it before consumers did?** This question matters most. It almost always points at a missing or mis-placed check.
- **What control would have caught it?** A schema contract, a freshness gate, a volume check, an agreed interface with the upstream team.

The output should be a control, not a narrative. "The source team changed the date format" is a story. "The pipeline now fails if `order_date` doesn't parse, and the source team has a documented contract for that column" is a control.

Concretely, that control can be a notebook activity before the load that counts rows where `try_cast(order_date AS date)` is null and, above a threshold, calls `notebookutils.notebook.exit` with a failure status. The pipeline's If Condition branches on that exit value and stops the load, so the next bad extract never reaches consumers.

I'd also push the fix as far upstream as you can reach. Adding a downstream filter that silently drops malformed dates makes the symptom disappear and hides the next instance. Getting the producing team to own a contract for the column fixes it for every consumer. In [Five Data Quality Signals for the Data-to-AI Handoff](/blog/2026-03-12-data-quality-work-that-actually-sticks-choosing-the-minimum-useful-set-of-quality-signals/) I covered which signals I'd start with, and root-cause tickets are usually how those signals get added in practice: one per real failure, rather than hundreds generated up front.

### Blameless, with an owner

Root-cause work goes badly when it turns into "whose fault was it". People hide details, and the real cause, often an unstated assumption between two teams, never surfaces. Keep the review blameless.

Blameless doesn't mean ownerless, though. The fix needs a named team and a date. If the root cause sits with an upstream team that won't commit to a fix, record that as an accepted risk with a named decision-maker. That's an honest outcome. A root-cause ticket quietly closed as "won't fix" is not.

## Making it stick in a Fabric workspace

You don't need a new tool for this. You need a few habits wired into what you already run:

- **Make the gate part of the pipeline.** Put a readiness gate before the load (a notebook or script activity whose result an If Condition branches on) that fails the run when row counts, freshness or key columns look wrong, so containment starts with "nothing was published" rather than a rollback. The pattern is in [Fabric Daily Loads: Gate on Data Readiness, Not the Clock](/blog/2026-03-05-pipelines-i-trust-in-fabric-reducing-brittle-dependencies-in-daily-loads/).
- **Route each alert to a named owner.** Set the recipient of each [Fabric Activator](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-introduction) rule to the on-call person for that data product, not a shared inbox. A rule nobody owns is a rule nobody acts on, as I argued in [Alerts People Don't Mute](/blog/2026-03-18-real-time-signals-that-actually-help-building-alerting-that-avoids-fatigue/).
- **Check your Delta retention settings.** Your rollback window is the shorter of `delta.deletedFileRetentionDuration` (with the retention you pass to [`VACUUM` in table maintenance](https://learn.microsoft.com/fabric/data-engineering/lakehouse-table-maintenance)) and `delta.logRetentionDuration`. If incidents on a table are often noticed late, raise both on that table deliberately rather than living with the defaults, e.g. `ALTER TABLE sales_curated.daily_orders SET TBLPROPERTIES ('delta.deletedFileRetentionDuration' = 'interval 30 days', 'delta.logRetentionDuration' = 'interval 60 days')`.
- **Create both tickets at the start.** Open the root-cause ticket when the incident is declared, not after containment. If it isn't created in the moment, it usually isn't created.

## When this is overkill

Not every failed check deserves two tickets. If a pipeline failed, wrote nothing, and a retry succeeded, there's nothing to contain. A short note on the run is enough, unless it keeps happening. The same goes for sandbox and exploratory workspaces with no downstream consumers.

My rule of thumb: if a consumer saw, or could have seen, wrong data, it's an incident and it gets both tickets. If the failure was caught before anything was published, it's a pipeline defect and goes straight to the backlog.

## The takeaway

Containment and root-cause work need different speeds, owners and definitions of done, and putting them in one ticket means the slow one never gets finished. Contain fast and reversibly, keep the evidence, and don't call the incident closed until a control exists that would have caught it. This is one of the cheapest changes a data team can make: it costs a second ticket per incident and stops you fighting the same fire twice.
