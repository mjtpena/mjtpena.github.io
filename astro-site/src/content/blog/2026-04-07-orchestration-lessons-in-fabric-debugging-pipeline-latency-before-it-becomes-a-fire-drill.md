---
title: "Fabric Pipeline Latency: Find Where the Minutes Actually Go"
description: "How to split a slow Fabric pipeline run into start delay, queueing, Spark start-up, copy transfer and idle gaps, with KQL and the activity runs API."
author: Michael John Peña
draft: false
date: 2026-04-07
tags:
  - Microsoft Fabric
  - Data Factory
  - Performance
  - Monitoring
  - KQL
---

When a pipeline that used to finish by 6am starts finishing at 7:40 and nobody can say why, the usual reaction is to bump the copy throughput setting, add a bigger Spark pool, or move the schedule earlier, and all three are guesses. Pipeline latency is almost never one slow thing. It's a stack of small waits, and until you can name each layer you're tuning blind. My rule is simple: no tuning change goes in until someone can say which layer of the run grew.

## Wall-clock time is five different numbers

When someone says "the pipeline is slow", they mean end-to-end time from when it should have started to when the data landed. In Fabric that number is made of at least five parts, and each has a different owner and a different fix.

| Layer | What it looks like | Usual cause |
|---|---|---|
| Start delay | Scheduled for 5:00, actually started 5:09 | Run queue, capacity pressure, overlapping runs |
| Activity queueing | Activity shows a long queue time before doing work | Workspace concurrency limits, gateway, workspace ITO limit (400) |
| Compute start-up | Notebook activity spends minutes before the first cell | Spark session start, library installs, network settings |
| Transfer and processing | Copy or notebook genuinely runs longer | Data growth, source throttling, poor partitioning |
| Idle gaps | Nothing is running, but the pipeline isn't finished | Serial dependencies, Wait activities, polling loops |

The last row is the one people miss. A pipeline can have every activity running at a healthy speed and still get slower, because someone added a fourth step to a chain that used to run beside another chain.

## Start with a baseline, not a single bad run

One slow run tells you almost nothing. You need to know whether this run is an outlier or whether the median has been creeping for a month. The Monitoring hub gives you run history, a Gantt view and per-activity details, which is fine for looking at last night. It isn't built for trend questions like "has the p95 moved since we onboarded the new source?"

For that, I'd turn on workspace monitoring. It's still in preview as of April 2026, it keeps data for 30 days, and it bills the capacity for the eventhouse it creates, so it isn't free. In return you get the [`ItemJobEventLogs` table](https://learn.microsoft.com/fabric/fundamentals/item-job-event-logs), which records `JobScheduleTime`, `JobStartTime`, `JobEndTime` and `DurationMs` for each pipeline job. Having both the scheduled time and the actual start time is the useful part. It separates "the run was slow" from "the run started late".

```kql
// Daily latency baseline per pipeline over the last 14 days.
// Confirm the job type values in your workspace first:
//   ItemJobEventLogs | summarize count() by ItemKind, JobType
let pipelineJobTypes = dynamic(["Pipeline", "Data Pipeline"]);
ItemJobEventLogs
| where Timestamp > ago(14d)
| where JobType in (pipelineJobTypes)
| summarize arg_max(Timestamp, *) by JobInstanceId   // keep the final event per run
| where JobStatus in ("Completed", "Failed")
| extend StartDelaySec = iff(isnotnull(JobScheduleTime),
                             datetime_diff('second', JobStartTime, JobScheduleTime),
                             long(null)),
         RunMin = DurationMs / 60000.0
| summarize Runs = count(),
            P50RunMin = round(percentile(RunMin, 50), 1),
            P95RunMin = round(percentile(RunMin, 95), 1),
            P95StartDelaySec = percentile(StartDelaySec, 95)
    by ItemName, Day = bin(JobStartTime, 1d)
| order by ItemName asc, Day asc
```

Two things to read from this. If `P95StartDelaySec` is climbing while run time is flat, the problem is upstream of your pipeline: capacity, scheduling, or overlapping runs. If run time is climbing, you need to look inside the run. Those are different investigations, and mixing them up wastes days.

The table only holds pipeline-level events. Activity-level detail isn't in workspace monitoring yet, so the next step uses the activity runs instead.

## Look inside one run

For a single run, the Monitoring hub's activity list shows each activity's duration. Select a Copy activity and you get a duration breakdown by stage, plus copy output properties such as `copyDuration`, `throughput`, `usedParallelCopies`, `sourcePeakConnections` and `sinkPeakConnections`. The service sometimes adds performance tuning tips at the top of that view. Read them. They name the bottleneck the service saw for that specific run.

The UI is fine when a run has a handful of activities. When it has a ForEach over 200 tables, I want the data in a script. The Fabric REST API exposes the same activity runs through a [`queryactivityruns` endpoint](https://learn.microsoft.com/fabric/data-factory/pipeline-rest-api-capabilities) on the pipeline run's job instance ID. This script pulls them and answers two questions: which activities took longest, and how much of the run had no work activity executing at all. Control-flow containers (ForEach, Until, If Condition, Switch), Wait, Filter and variable activities are left out of the busy calculation, because a ForEach that spans the whole run would otherwise make the run look fully busy.

```python
# pip install azure-identity requests
from datetime import datetime, timedelta, timezone

import requests
from azure.identity import DefaultAzureCredential

WORKSPACE_ID = "<your-workspace-id>"
JOB_INSTANCE_ID = "<pipeline-run-job-instance-id>"
# The query filters on each activity run's last update time, so this window
# must reach back far enough to cover when the run you're inspecting last updated.
LOOKBACK = timedelta(days=2)
# Activities that orchestrate or wait rather than move or process data.
# Invoke Pipeline is deliberately not listed: the child runs as its own job
# instance, so its activities aren't returned here and its time must count as busy.
CONTROL = {
    "ForEach", "Until", "IfCondition", "Switch", "Wait", "Filter",
    "SetVariable", "AppendVariable",
}

token = DefaultAzureCredential().get_token("https://api.fabric.microsoft.com/.default").token
url = (
    f"https://api.fabric.microsoft.com/v1/workspaces/{WORKSPACE_ID}"
    f"/datapipelines/pipelineruns/{JOB_INSTANCE_ID}/queryactivityruns"
)
now = datetime.now(timezone.utc)
body = {
    "filters": [],
    "orderBy": [{"orderBy": "ActivityRunStart", "order": "ASC"}],
    "lastUpdatedAfter": (now - LOOKBACK).isoformat(),
    "lastUpdatedBefore": now.isoformat(),
}

runs = []
while True:
    resp = requests.post(
        url, headers={"Authorization": f"Bearer {token}"}, json=body, timeout=60
    )
    resp.raise_for_status()
    page = resp.json()
    if isinstance(page, list):  # unpaged response: everything came back at once
        runs.extend(page)
        break
    runs.extend(page.get("value", []))
    token_next = page.get("continuationToken")
    if not token_next:
        break
    body["continuationToken"] = token_next  # request the next page


def ts(value: str) -> datetime:
    # Trim fractional seconds to 6 digits so fromisoformat accepts them.
    value = value.replace("Z", "+00:00")
    if "." in value:
        head, tail = value.split(".", 1)
        frac, offset = tail[:-6], tail[-6:]
        value = f"{head}.{frac[:6]}{offset}"
    return datetime.fromisoformat(value)


done = [r for r in runs if r.get("activityRunStart") and r.get("activityRunEnd")]
done.sort(key=lambda r: ts(r["activityRunStart"]))
work = [r for r in done if r["activityType"] not in CONTROL]

print("Slowest activities:")
for r in sorted(done, key=lambda r: r["durationInMs"], reverse=True)[:10]:
    print(f"  {r['durationInMs'] / 1000:8.1f}s  {r['activityType']:<16} {r['activityName']}")

if done:
    span_start = ts(done[0]["activityRunStart"])
    span_end = max(ts(r["activityRunEnd"]) for r in done)
    idle = timedelta(0)
    busy_until = span_start
    for r in work:
        start, end = ts(r["activityRunStart"]), ts(r["activityRunEnd"])
        if start > busy_until:
            idle += start - busy_until
        busy_until = max(busy_until, end)
    idle += max(span_end - busy_until, timedelta(0))
    print(f"Span {span_end - span_start}, of which no work activity was running for {idle}")
```

The idle number is the most useful output. It counts time when no work activity (Copy, Notebook, Dataflow, Script, Web and so on) was executing. If a 90-minute run has 25 minutes like that, no amount of copy tuning will get those minutes back. That time belongs to the pipeline's shape: Wait activities, Until loops polling on a long interval, or dependencies that force work to run in series when it doesn't need to. If the slow part is inside a child pipeline, run the script again with the child's run ID from the Invoke Pipeline activity output.

The script only reports durations, so it can't split one activity's time into queueing, start-up and execution. For that you still need the Monitoring hub: the stage breakdown on a Copy activity, or the Spark run details behind a notebook activity.

## What each layer usually means

### Start delay and capacity

Pipelines run as background operations, and Fabric smooths background usage over 24 hours. That's why a capacity can look busy for a long time before anything is throttled. The throttling stages matter here: interactive work is delayed and then rejected first, and background jobs are only rejected once the capacity has used up its next 24 hours of compute. If your pipeline start delay is growing, check the Capacity Metrics app before touching the pipeline. A noisy neighbour on the same capacity is a capacity decision, not a pipeline fix. I covered sizing trade-offs in [From F64 to F32](/blog/2026-01-20-fabric-capacity-planning/).

### Activity queueing and concurrency limits

Fabric has workspace-level limits that are easy to hit with metadata-driven pipelines: 100 concurrent external activities (Web, stored procedure and similar), 100 concurrent Lookup, Get Metadata and Delete activities, and 400 concurrent Intelligent throughput optimization (ITO) units shared between pipelines and Copy jobs. ForEach runs 20 items in parallel by default and allows up to 50. The [Data Factory limitations page](https://learn.microsoft.com/fabric/data-factory/data-factory-limitations) is worth reading before you design a fan-out, because these limits are per workspace. Two teams' pipelines in the same workspace compete for them.

When activities show queue time rather than run time, raising the ForEach batch count usually makes it worse. Spread the work across time, or across workspaces if the ownership split makes sense anyway.

### Spark start-up

A notebook activity on a starter pool with no extra libraries typically gets a session in 5 to 10 seconds. Change the node size or customise compute, or put the workspace behind Managed VNets or Private Links, and Fabric has to create a cluster on demand, which Microsoft's Spark compute documentation puts at 2 to 5 minutes. Environment libraries add their own install step on top: roughly 30 seconds to 5 minutes in Quick mode, 1 to 3 minutes in Full mode. Eight notebook activities in series pay that start-up eight times.

The cheapest fixes come first. Merge small notebooks so you pay start-up once, or turn on high concurrency mode for pipelines so notebooks with the same default lakehouse, Spark configuration and libraries share a session. By default a shared session hosts up to five notebooks with the same session tag; you can raise that to 50 with `spark.highConcurrency.max`, at the cost of more contention inside one session. Both trade isolation for speed, so don't share a session between a job that must not fail and an experimental one.

There's a third option worth knowing about, though it's in preview as of April 2026. [Custom live pools](https://learn.microsoft.com/fabric/data-engineering/custom-live-pools-overview) keep Spark clusters prewarmed during a schedule window you define, so sessions start in about 5 seconds once the pool is hydrated, with an environment's Full-mode library snapshot already installed. That's the direct fix for a scheduled, deadline-bound notebook activity. The trade-off is that you pay for warm clusters while they're held in the active window, not only while a notebook is running on them. I wouldn't use them for irregular or infrequent runs, where you'd be paying for idle warm clusters to save a few minutes now and then. Also plan for overflow: when every warm cluster is busy, extra jobs fall back to on-demand start-up.

Spark also has its own queue. When capacity is at its compute limit, notebooks triggered by pipelines can be [queued](https://learn.microsoft.com/fabric/data-engineering/job-queueing-for-fabric-spark) (FIFO, expiring after 24 hours) and show as **Not started** in the Monitoring hub. That looks like a slow pipeline but is really a capacity signal.

### Transfer and processing

If the copy breakdown shows most time in the transfer stage and the peak connection counts are low, the copy isn't using the parallelism available to it. Check whether the source is partitioned, and look at ITO and degree of copy parallelism. If connections are high and throughput is still poor, the source or destination is the ceiling, and more parallelism will only increase the load on a system that's already struggling. For incremental loads that have quietly turned into full loads, the fix is in the watermark logic, not the throughput setting.

## When not to bother

Not every slow pipeline deserves this treatment. If a run finishes well inside its window and nothing downstream waits on it, a 20% regression is noise, not a problem. Workspace monitoring costs capacity, and a latency script someone has to maintain is overhead too. I'd set this up for pipelines with a real deadline: a report people read at 8am, a downstream system with an SLA, or a chain where one late step pushes everything after it.

Don't treat the activity runs API output as a stable contract for anything beyond diagnosis either. The `executionDetails` structure in copy output is explicitly documented as subject to change, so read it, don't build alerting on it.

## The order I'd check things in

When a run is late, work from the outside in:

1. Did it start late? Compare scheduled and actual start. If yes, look at capacity and overlapping runs first.
2. How much of the run was idle? If a big share, the pipeline's shape is the problem.
3. Which activity grew? Compare it with its own history, not with other activities.
4. Inside that activity, was it queueing, starting compute, or doing work? This one needs the Monitoring hub's copy breakdown or the notebook's Spark run details.

Each answer rules out a class of fix. The expensive part of a latency incident is usually the week spent guessing, not the change that resolves it. If you're also deciding what a late run should do when it finally fails, [Fabric Pipeline Failure Paths](/blog/2026-03-27-orchestration-lessons-in-fabric-designing-pipelines-for-failure-not-the-happy-path/) covers the timeout and failure side.
