---
title: "Fabric Pipeline Deadlines: Alert on a Late Run Before Anyone Asks"
description: "How to catch a slipping Fabric pipeline before its deadline: alert on missing and late runs, not just failures, using job events, KQL and the jobs API."
author: Michael John Peña
draft: false
date: 2026-04-29
tags:
  - Microsoft Fabric
  - Data Factory
  - Monitoring
  - KQL
  - Data Engineering
---

Most pipeline fire drills don't start with an alert. They start with a message from someone in finance at 8:05 asking why yesterday's numbers aren't in the report. By then the team is diagnosing under pressure instead of fixing calmly. The pipeline being slow was never the real problem. Nothing was watching the deadline.

I've already written about [finding where the minutes go in a slow Fabric pipeline run](/blog/2026-04-07-orchestration-lessons-in-fabric-debugging-pipeline-latency-before-it-becomes-a-fire-drill/). That post is about diagnosis after the fact. This one is about detection: knowing a run is slipping while there's still time to do something about it.

## Failure alerts don't catch lateness

The default alerting most teams build is "tell me when the pipeline fails". It's necessary, and it misses the cases that actually cause the 8am escalation:

| What happened | Failure alert fires? | When you find out |
|---|---|---|
| Run failed at 5:20 | Yes | 5:20 |
| Run is still going at 7:30, normally done by 6:00 | No | When it finishes, or when someone asks |
| Run never started (schedule disabled, capacity paused, or a deployment to production left the schedule off) | No | When someone asks |
| Run finished "successfully" but loaded zero rows | No | When someone asks |

Three of those four produce no failure event. The late run never produces a terminal event, the missing run produces no event at all, and the empty load reports success. An event-driven alert can only react to something that happened. A run that hasn't finished, or never started, is the absence of an event, and you need a different mechanism to see it. The empty load is a different problem again, which I come back to at the end.

My rule: every pipeline with a real consumer gets a failure alert **and** a deadline check. The failure alert is the easy half.

## Write the deadline down first

Before any tooling, agree on two times per pipeline:

- **The deadline.** When downstream needs the data. Not when the pipeline usually finishes. If the report is read at 8:00 and the semantic model refresh takes 20 minutes, the pipeline deadline is around 7:30.
- **The checkpoint.** When you want to know the run is in trouble, early enough to act. I set it at the point where a rerun from the failed step would still beat the deadline. If a full rerun takes 60 minutes and the deadline is 7:30, the checkpoint is no later than 6:30.

The gap between a run's usual finish time and its deadline is its headroom. Headroom is what you actually want to monitor. A pipeline that takes 50 minutes with two hours of headroom is healthy. One that takes 50 minutes with ten minutes of headroom is a fire drill waiting for a slightly bigger month-end file.

This conversation is usually more valuable than the alert itself. Often nobody has written down when the data is needed, and the "pipeline is late" complaint turns out to be "the schedule was set before the report moved earlier".

## Layer one: failures, from inside and outside the pipeline

Inside the pipeline, give every activity a timeout that reflects reality. Fabric pipeline activities default to a 12-hour timeout (`0.12:00:00`), which means a hung copy can sit there quietly long past any deadline you care about. A timeout turns a silent hang into a failure, and failures you can alert on. How that failure should flow through the pipeline is covered in [Fabric Pipeline Failure Paths](/blog/2026-03-27-orchestration-lessons-in-fabric-designing-pipelines-for-failure-not-the-happy-path/).

Outside the pipeline, Real-Time hub exposes [Fabric job events](https://learn.microsoft.com/fabric/real-time-hub/explore-fabric-job-events), which fire when an item's job is created, changes status, succeeds or fails (failed includes cancelled and stuck jobs). You can attach an Activator rule to them and send a Teams message or email when a specific pipeline's job fails. Activator has been generally available since late 2024, and [Azure and Fabric events in Real-Time hub](https://learn.microsoft.com/fabric/real-time-hub/fabric-events-overview), job events included, are generally available too. Job events aren't supported in every region, though, and the job events page lists the ones that are excluded, so check it before you rely on them.

I prefer the outside alert to an Office 365 or Teams activity on the pipeline's failure path, for one reason: it still fires when the pipeline's own error handling is broken.

One caveat applies to this layer and the next: Activator rules run on Fabric capacity and respect its state, so if the capacity is paused or throttled, the alerts in layers one and two can go quiet at exactly the wrong moment, even though workspace monitoring keeps ingesting through throttling. There's a middle option before leaving Fabric altogether: put the Activator in a separate workspace on its own small capacity. Job events are published for jobs across the tenant, so an alert there doesn't share fate with a throttled production capacity, though it still depends on Fabric itself being up. That shared fate is why the third layer runs outside Fabric.

## Layer two: the slide, from history

The second layer catches the pipeline that isn't late yet but is heading there. This needs history, and in Fabric the cleanest source is workspace monitoring. It's still in preview as of April 2026 and it bills capacity for the eventhouse it creates, so turn it on deliberately, not everywhere. It gives you the [`ItemJobEventLogs` table](https://learn.microsoft.com/fabric/fundamentals/item-job-event-logs) with scheduled time, start time, end time and duration for each pipeline job. Watch the names: the table records pipeline runs with a `JobType` of `Data Pipeline`, while the REST API calls the same job type `Pipeline`, and the documented `JobStatus` values are `Not started`, `In progress`, `Completed` and `Failed`.

If you don't want a preview feature in your alerting path, the generally available alternative is to route Fabric job events through an Eventstream into an eventhouse you own, ideally on that separate monitoring capacity. You then build the duration history yourself from the created and terminal events, which is more work but gives you control over retention and placement.

This query flags runs that are in progress right now and have already run longer than 90% of their completed runs over the last two weeks:

```kql
// Runs still in progress that have exceeded their own p90 duration.
// Confirm JobType and JobStatus values in your workspace first:
//   ItemJobEventLogs | summarize count() by JobType, JobStatus
let pipelineJobTypes = dynamic(["Data Pipeline"]);
// Cancelled isn't in the documented list; it's here so a cancelled run
// never looks like one that is still in progress.
let terminal = dynamic(["Completed", "Failed", "Cancelled"]);
let history =
    ItemJobEventLogs
    | where Timestamp > ago(14d)
    | where JobType in (pipelineJobTypes) and JobStatus == "Completed"
    | summarize arg_max(Timestamp, *) by JobInstanceId
    | summarize P90Min = percentile(DurationMs / 60000.0, 90), Runs = count() by ItemId
    | where Runs >= 5;   // not enough history means no baseline
ItemJobEventLogs
| where Timestamp > ago(2d)   // a long-hung run may have stopped logging
| where JobType in (pipelineJobTypes)
| summarize arg_max(Timestamp, *) by JobInstanceId
| where JobStatus !in (terminal)
| extend ElapsedMin = datetime_diff('minute', now(), JobStartTime)
| join kind=inner history on ItemId
| where ElapsedMin > P90Min
| project ItemName, JobInstanceId, JobStartTime, ElapsedMin, P90Min = round(P90Min, 1)
```

If that first check shows status strings that differ from the documented ones, for example `InProgress` and `NotStarted` instead of `In progress` and `Not started`, the `!in (terminal)` filter still holds, because it excludes finished runs rather than matching active ones. What it can't survive is a terminal status spelled differently: copy the finished values you actually see into `terminal` and the `JobStatus == "Completed"` filter, or every finished run will look like one that is still going.

Save it in a KQL queryset against the monitoring eventhouse, then use [Activator's KQL queryset alerts](https://learn.microsoft.com/fabric/real-time-intelligence/data-activator/activator-alert-queryset) to run it on a schedule and alert for each row it returns (one per slipping run), so keep the projection to one row per job instance. If you'd rather get one alert per check, end the query with `| summarize Slipping = make_list(ItemName)` and a `where array_length(Slipping) > 0` filter.

The default is every five minutes, but the docs warn that this effectively keeps the eventhouse always on, and a join like this one costs more than a simple filter. For a daily batch pipeline, every 15 to 30 minutes around the expected run window is enough and lets the eventhouse idle. A run hung for longer than the two-day window drops out of this query, but layer three's STUCK check still catches it.

Two notes on this design. First, p90 against the pipeline's own history beats a fixed threshold, because a fixed threshold is wrong the day the source grows. Second, require a minimum number of runs. A new pipeline with three runs has no meaningful baseline, and alerting on it trains people to ignore the channel. I covered that failure mode in [alerting that avoids fatigue](/blog/2026-03-18-real-time-signals-that-actually-help-building-alerting-that-avoids-fatigue/).

The gap: this query only sees runs that started. It can't tell you about a run that never appeared.

## Layer three: the deadline check that catches absence

The only reliable way to detect a missing run is to ask, at the checkpoint, "has today's run completed?" and treat silence as a failure. That's a dead man's switch, and it's the layer most teams skip.

The Fabric REST API's [job scheduler](https://learn.microsoft.com/rest/api/fabric/core/job-scheduler) lets you list a pipeline's job instances with their status and start and end times. This script checks one pipeline at its checkpoint and exits non-zero unless today's run has completed:

```python
# pip install azure-identity requests
# Run at the checkpoint time. Exit code 0 = on track, 1 = needs attention.
import sys
from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

import requests
from azure.identity import DefaultAzureCredential

WORKSPACE_ID = "<your-workspace-id>"
PIPELINE_ID = "<your-pipeline-item-id>"
LOCAL_TZ = ZoneInfo("Australia/Sydney")
WINDOW_START = time(4, 0)  # earliest local time today's run can start

API = "https://api.fabric.microsoft.com/v1"


def parse_utc(value):
    if not value:
        return None
    value = value.rstrip("Z")
    if "." in value:
        head, frac = value.split(".", 1)
        value = f"{head}.{frac[:6]}"
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def list_job_instances(token):
    url = f"{API}/workspaces/{WORKSPACE_ID}/items/{PIPELINE_ID}/jobs/instances"
    headers = {"Authorization": f"Bearer {token}"}
    while url:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        body = resp.json()
        yield from body.get("value", [])
        url = body.get("continuationUri")


def main():
    token = DefaultAzureCredential().get_token(
        "https://api.fabric.microsoft.com/.default"
    ).token
    now_local = datetime.now(LOCAL_TZ)
    window_start = datetime.combine(now_local.date(), WINDOW_START, LOCAL_TZ)

    # The API keeps only the ~100 most recently completed instances per item
    # (active runs are unlimited). For a pipeline triggered every few minutes,
    # today's earliest runs may have dropped off, which is why this check looks
    # only at the latest run.
    jobs = list(list_job_instances(token))

    # A run still InProgress from an earlier window is a separate problem:
    # it can block today's run, which then shows up as Deduped.
    stuck = [
        job for job in jobs
        if job["status"] == "InProgress"
        and (start := parse_utc(job.get("startTimeUtc"))) and start < window_start
    ]
    for job in stuck:
        print(f"STUCK: run {job['id']} started {job['startTimeUtc']} UTC, still InProgress")

    # Today's runs: started since the window opened, or queued with no start yet.
    todays = [
        job for job in jobs
        if (
            (start := parse_utc(job.get("startTimeUtc"))) is None
            and job["status"] == "NotStarted"
        )
        or (start is not None and start >= window_start)
    ]
    if not todays:
        print(f"MISSING: no run of {PIPELINE_ID} since {window_start:%H:%M %Z}")
        return 1

    # A queued (NotStarted) run with no start time sorts as the newest.
    newest = datetime.max.replace(tzinfo=timezone.utc)
    latest = max(
        todays, key=lambda job: parse_utc(job.get("startTimeUtc")) or newest
    )
    status = latest["status"]
    if status == "Completed":
        print(f"OK: run {latest['id']} completed at {latest['endTimeUtc']} UTC")
        return 1 if stuck else 0
    if status in ("NotStarted", "InProgress"):
        print(f"LATE: run {latest['id']} is {status} at checkpoint")
    elif status == "Deduped":
        print(f"DEDUPED: run {latest['id']} skipped; a previous instance is still running")
    else:
        reason = latest.get("failureReason") or {}
        print(f"{status.upper()}: run {latest['id']} {reason.get('message', '')}".rstrip())
    return 1


if __name__ == "__main__":
    sys.exit(main())
```

The identity running it needs at least Viewer access to the workspace. A Fabric admin also has to make sure the tenant setting *Service principals can call Fabric public APIs* is enabled (it's on by default for new tenants) for the whole organisation or for a security group that includes that identity. Use a service principal or managed identity, not a person's account, so the check doesn't stop when someone changes roles.

Where you run it matters more than the code. My preference is to run it **outside Fabric**: a scheduled GitHub Actions or Azure DevOps job, or an Azure Function on a timer, with that scheduler's own failure notification doing the paging. If the check runs as a Fabric notebook on the same capacity, it fails in exactly the situations it's meant to catch: a paused capacity, heavy throttling, or a workspace someone moved. A watchdog that shares fate with the thing it watches isn't a watchdog.

## What job checks can't see

One row in the opening table isn't covered by any of the three layers: the run that completed and loaded nothing. The job-instances check exits 0 on a `Completed` run, and the p90 query only looks at duration. A zero-row load needs a data check, not a job check. The cheapest version is a final activity in the pipeline itself: an If Condition that compares the copy activity's `rowsCopied` output (for example `@activity('Copy sales').output.rowsCopied`) against a sensible minimum and routes to a Fail activity when it's below it, so an empty load becomes a failed run that layer one already alerts on. Where several sources feed one table, a row-count or freshness query on the target table, run by the same deadline script, is more honest than trusting any single activity's output.

Also resist the urge to make the deadline check fix things automatically. Auto-rerun at the checkpoint sounds attractive, but a rerun on a throttled capacity makes the throttling worse, and a rerun of a non-idempotent load can double the data. Alert a human, with enough context to decide.

## When this is too much

Not every pipeline needs three layers. A pipeline feeding an exploratory dataset that people look at weekly needs a failure alert and nothing more. Workspace monitoring costs capacity, Activator rules cost capacity, and every alert channel needs someone who'll act on it. If nobody is on the hook for a deadline, a deadline alert just produces noise.

I'd reserve the full setup for pipelines with a named consumer and a time: a board report, a downstream system with an SLA, or the first step in a chain where one late run pushes everything after it. For those, the cost is small compared with one 8am escalation.

## What to set up this week

If you only do one thing, write down the deadline and checkpoint for your three most important pipelines and put a dead man's switch on each. Failure alerts tell you something broke. Deadline checks tell you something is about to be noticed, while there's still time to rerun before anyone downstream opens the report. When the alert does fire, the [latency breakdown](/blog/2026-04-07-orchestration-lessons-in-fabric-debugging-pipeline-latency-before-it-becomes-a-fire-drill/) is where to start looking.
