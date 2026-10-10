---
title: "Blameless Reviews for Data Incidents: Ask Which Control Failed"
description: "How to run blameless reviews for data quality incidents: record who detected it, which control was missing, and turn each review into a tracked change."
author: Michael John Peña
draft: false
date: 2026-04-25
tags:
  - Data Quality
  - Observability
  - Data Products
  - Microsoft Fabric
  - Governance
---

When a dashboard shows the wrong revenue figure, the first question in most organisations is "who broke it?" The answer is usually a name, which changes nothing in the system, so the same failure comes back. Software operations adopted the blameless postmortem to deal with this; data teams have been slower, partly because nothing goes down when a number is quietly wrong for three days. A review that ends in a changed control, not a name, is how you stop the repeat.

## Why blame is the default for data

Blame sticks to data incidents for three structural reasons.

**Ownership is spread across team boundaries.** A single gold table might depend on a CRM export owned by sales operations, a pipeline owned by data engineering, and a semantic model owned by a BI team. When something breaks, every boundary is a place to point.

**Detection is late and indirect.** Application outages page someone within minutes. Bad data is often found by a consumer, days later, in a meeting. By then the conversation is about embarrassment, not mechanism.

**The failure is rarely a single bad act.** A renamed source column only becomes an incident if nothing checked the schema, nothing stopped the publish, and nobody downstream was told. Blaming the person who renamed the column ignores the three controls that were missing.

That last point is the whole argument. The useful question is never "who did this?" but "which control should have caught this, and why didn't it?"

## Ask which control failed

I'd structure every data incident review around a short list of control points, and ask of each one: did it exist, did it fire, and did the signal reach a person who could act?

| Control point | What it should catch | Typical gap |
|---|---|---|
| Source contract | Schema, type and volume changes from the producer | No agreement with the source team, or nobody told them it existed |
| Load-time checks | Nulls, duplicates, out-of-range values in silver | Check exists but only logs a warning |
| Publish gate | Freshness and completeness before gold is refreshed | Pipeline publishes regardless of check results |
| Alert routing | A failed check reaching the owner | Alerts go to a shared mailbox nobody reads |
| Consumer notice | Downstream owners told the data is suspect | No list of who consumes the table |

This table turns a vague "data was wrong" into a specific gap and moves the conversation off individuals. "The publish gate didn't exist" is something a team can fix. "The engineer should have been more careful" is not.

It also exposes a pattern worth tracking. On an immature platform, I would expect most incidents to land in the alert routing and consumer notice rows. In the first, the check was there and fired, but the signal went to a channel the owner doesn't monitor. In the second, the data team knew the table was wrong but had no list of who used it, so consumers kept making decisions on it. Neither is a detection problem, and no amount of new validation rules fixes them.

## What a blameless data review looks like

Keep it short: thirty minutes, within a week, with the producing team, the platform team, and at least one affected consumer, who is the only person who can say what the bad data actually cost.

The written record needs five things.

1. **Timeline in data terms.** When the bad data landed, when it was published, when it was detected, when it was contained. The gap between "landed" and "detected" is the number that matters most.
2. **How it was detected.** By a check (a gate blocked or flagged it before consumers saw it), by an alert (monitoring paged an owner after publish), or by a consumer (a person downstream noticed). If a consumer found it, that is itself a finding.
3. **Impact.** Which tables, reports and decisions consumed the bad data. In Microsoft Fabric, [impact analysis](https://learn.microsoft.com/fabric/governance/impact-analysis) on the affected item shows the downstream items and workspaces, and lets you email the contact lists of the affected workspaces (you need write permission on the item). Use it during the incident, not just in the review.
4. **Contributing factors, phrased as missing or failed controls.** Usually more than one. Use the control points above. Write "no schema check on the CRM landing table", not "sales ops changed the export".
5. **Actions, each with an owner and a date.** Every action should add, fix or reroute a control. "Be more careful" is not an action.

I'd also make the language rule explicit at the start of every review: names appear only in the actions list, as owners, never in the contributing factors. It sounds pedantic, but it forces people to describe mechanisms rather than people.

I've written separately about [splitting each incident into a containment ticket and a root-cause ticket](/blog/2026-03-23-operational-data-quality-notes-separating-incident-response-from-root-cause-fixes/). The review is where the root-cause ticket gets its shape.

## Keep the reviews in a table, not a wiki

Wiki-page reviews are read once and forgotten. Stored as rows, they show patterns across incidents, which is where process improvement comes from. A pair of Delta tables in the platform team's lakehouse is enough: one row per incident, and one row per finding, because a single incident usually has several failed controls and each gets its own action. Each finding records the control and how it failed, which maps to the three review questions: the control was `missing`, it existed but `did_not_fire`, or it fired but was `not_routed` to anyone who could act. A single "missing control" column hides that last value, often the most important finding.

Each block below is a Fabric notebook cell, run in a notebook attached to a lakehouse. The `%%sql` magic on the first line switches the cell from the default PySpark to Spark SQL, so these are not plain SQL scripts: don't paste them into the lakehouse's SQL analytics endpoint, which is read-only for Delta tables and doesn't understand the magic. First, create the two tables:

```sql
%%sql
CREATE TABLE IF NOT EXISTS ops_data_incidents (
    incident_id        STRING    NOT NULL,
    data_product       STRING    NOT NULL,
    landed_at          TIMESTAMP NOT NULL,
    detected_at        TIMESTAMP NOT NULL,
    contained_at       TIMESTAMP,
    detected_by        STRING    NOT NULL
) USING DELTA;

CREATE TABLE IF NOT EXISTS ops_incident_findings (
    incident_id     STRING  NOT NULL,
    control         STRING  NOT NULL,
    failure_mode    STRING  NOT NULL,
    action          STRING,
    action_owner    STRING,
    action_due      DATE,
    action_done     BOOLEAN
) USING DELTA;
```

Then add the constraints in a separate cell:

```sql
%%sql
ALTER TABLE ops_data_incidents DROP CONSTRAINT IF EXISTS valid_detected_by;
ALTER TABLE ops_data_incidents
  ADD CONSTRAINT valid_detected_by
  CHECK (detected_by IN ('check', 'alert', 'consumer'));

ALTER TABLE ops_incident_findings DROP CONSTRAINT IF EXISTS valid_control;
ALTER TABLE ops_incident_findings
  ADD CONSTRAINT valid_control
  CHECK (control IN
    ('source_contract', 'load_check', 'publish_gate', 'alert_routing', 'consumer_notice'));

ALTER TABLE ops_incident_findings DROP CONSTRAINT IF EXISTS valid_failure_mode;
ALTER TABLE ops_incident_findings
  ADD CONSTRAINT valid_failure_mode
  CHECK (failure_mode IN ('missing', 'did_not_fire', 'not_routed'));
```

The `CHECK` constraints matter more than they look. They stop the free-text drift that makes incident registers useless after six months, and they force the reviewer to pick a control rather than write a narrative about a person.

Every statement in both cells is safe to run again: `IF NOT EXISTS` skips tables that already exist, and each constraint is dropped before it is re-added. A cell's statements are not applied as one transaction, so if one fails partway, fix the cause and rerun the whole cell rather than picking out the statements that didn't run.

Once a quarter, run one query over the last three months of incidents:

```sql
%%sql
SELECT
    f.control,
    f.failure_mode,
    COUNT(DISTINCT i.incident_id)                                  AS incidents,
    COUNT(DISTINCT CASE WHEN i.detected_by = 'consumer'
                        THEN i.incident_id END)                    AS found_by_consumers,
    ROUND(AVG((unix_timestamp(i.detected_at)
             - unix_timestamp(i.landed_at)) / 3600.0), 1)          AS avg_hours_to_detect,
    ROUND(AVG((unix_timestamp(i.contained_at)
             - unix_timestamp(i.detected_at)) / 3600.0), 1)        AS avg_hours_to_contain
FROM ops_data_incidents i
JOIN ops_incident_findings f
  ON f.incident_id = i.incident_id
WHERE i.detected_at >= add_months(current_date(), -3)
GROUP BY f.control, f.failure_mode
ORDER BY incidents DESC;
```

The date filter is right for trends but wrong for the backlog: an action from an incident five months ago drops out of the window while still being open. So count open actions in a second cell with no date filter:

```sql
%%sql
SELECT
    control,
    failure_mode,
    COUNT(*) AS open_actions
FROM ops_incident_findings
WHERE action IS NOT NULL
  AND action_owner IS NOT NULL
  AND NOT coalesce(action_done, false)
GROUP BY control, failure_mode
ORDER BY open_actions DESC;
```

Because one incident can have several findings, the same incident appears under each control and failure mode it exposed, so the per-control counts can add up to more than the total number of incidents. That is the point: it shows which controls keep turning up. Average detection and containment times are weighted per finding, which is fine for trends, and `AVG` skips incidents with no `contained_at` yet, so a quarter with an incident still open will look faster to contain than it was. Impact isn't a column on purpose: the list of affected reports and decisions belongs in the written review, and a single consumer count would hide which consumers mattered.

Three numbers are worth putting in front of leadership. The count of consumer-found incidents, set against the total, tells you whether your checks are working as detection or just as decoration. The `not_routed` rows tell you how often a check did its job and the signal still went nowhere. The open actions total, across all time, tells you whether reviews are producing change or producing documents.

## Where tooling helps, and where it doesn't

There is no shortage of tools that will run quality rules for you. Microsoft Purview's [Unified Catalog data quality](https://learn.microsoft.com/purview/data-quality-overview) scores assets against rules and thresholds (check the docs for current connector support). In a Fabric lakehouse, Spark can enforce hard rules as Delta Lake `CHECK` and `NOT NULL` constraints. One caveat: adding a `CHECK` constraint can upgrade the table's Delta writer protocol, so before adding constraints to a production table, test that any non-Spark writers to it, such as Dataflow Gen2 or a pipeline Copy activity, still work. Those tools cover load-time checks and publish gates. Alert routing is different: tools can send a notification, but deciding who owns a table and which channel they actually watch is a configuration and ownership problem that tools only partly solve.

None of them fix source contracts or consumer notice. A source contract is an agreement between two teams, and a consumer notice depends on someone knowing who the consumers are. After a bad incident, buying another tool feels like action. Check the review first: if the gap was alert routing, a new rule engine produces more alerts to the same people who already ignore them.

My rule of thumb is to fix routing before adding detection. One check that reaches the right owner is worth ten that log to a table nobody queries. The [failure budget approach](/blog/2026-04-14-observability-for-data-products-using-failure-budgets-for-data-reliability/) helps here too, because it gives the review a shared measure of how much damage an incident did.

## When this is overkill

Not every bad row needs a review.

- **Single-consumer, self-service data.** If one analyst builds and uses a table, the review is a conversation with themselves.
- **Incidents already caught by a gate.** If the publish gate stopped bad data reaching gold, the system worked. Log it, don't meet about it. The log still gets one finding: the upstream gap that let bad data reach the gate, usually `source_contract` or `load_check` with `failure_mode = 'missing'`. Leave its action and owner empty and the open actions query doesn't count it as work.
- **Teams without any controls yet.** If there are no checks at all, every review will say "add a check". Skip the ceremony, put the basic controls in, and start reviewing once there is something to evaluate.

The other failure mode is the review that becomes its own bureaucracy: a long template, a mandatory meeting for every warning, actions that never close. If the open actions count keeps climbing, run fewer reviews and finish what is already on the list.

## The shift to make

Blameless doesn't mean nobody is accountable. It means accountability attaches to fixing a control, with a name and a date, rather than to having been nearby when something broke. Google's [SRE writing on postmortem culture](https://sre.google/sre-book/postmortem-culture/) makes the same case for services, and it carries over to data with one addition: record who detected the incident. If the answer keeps being "a consumer", your platform isn't observable yet, whatever the dashboards say.

Start with the five control points, the language rule, and one Delta table. After a quarter you'll know which control is actually failing, and that is a far better use of a planning meeting than arguing about who to blame.
