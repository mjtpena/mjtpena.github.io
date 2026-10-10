---
title: "Fabric Pipeline Failure Paths: Catch the Error, Then Fail the Run"
description: "How dependency conditions decide a Fabric pipeline's final status, why try-catch hides failures, and how to log, alert and still fail the run honestly."
author: Michael John Peña
draft: false
date: 2026-03-27
tags:
  - Microsoft Fabric
  - Data Factory
  - Data Engineering
  - Observability
  - Architecture
---

The most dangerous failure handler in a Fabric pipeline is the one that works. Someone adds an On fail path with a Teams message to the silver notebook, tests it once, and ships, so the next time the notebook fails the message goes out and the run goes green. Designing for failure means deciding what the run's final status should mean, then wiring the failure paths so it means that. The happy path takes ten minutes to build; the failure paths are the actual design work.

## How a pipeline decides it failed

Fabric pipelines use the same four dependency conditions as Azure Data Factory: On success, On fail, On completion and On skip. Two rules from the [ADF error handling guide](https://learn.microsoft.com/azure/data-factory/tutorial-pipeline-failure-error-handling) explain almost every confusing status I've seen in Fabric, because the orchestration engine behaves the same way:

1. The engine looks at the **leaf** activities, the ones with nothing after them. If a leaf was skipped, it evaluates that leaf's parent instead.
2. The run succeeds only if every node it evaluated succeeded.

Applied to a main activity that fails, the rules give results that look wrong until you trace them:

| What you wired | What the engine evaluates | Final status |
|---|---|---|
| Only an On fail path (try-catch) | Handler (succeeded) | **Succeeded** |
| On success and On fail paths (if-else) | Skipped On success leaf, so the failed parent | Failed |
| On fail path ending in a Fail activity | Fail activity (failed) | Failed, with your message |
| Nothing after the main activity | Main activity (failed) | Failed |

The first row is the trap. A try-catch is the right shape when the failure genuinely doesn't matter, such as a best-effort logging step. It's the wrong shape for a step whose output someone downstream depends on, because you've converted a failure into a success with a side effect.

The second row is why people say status is "random". Whether the run fails depends on whether something hangs off the On success branch, which is a layout detail, not a decision anyone made on purpose.

## Catch, record, notify, rethrow

My default for any step that matters is a catch path that does three things and then fails the run on purpose. In code you'd call it catch-and-rethrow.

1. **Record** the failure in a table you can query.
2. **Notify** whoever owns the step.
3. **Fail** the run with a [Fail activity](https://learn.microsoft.com/fabric/data-factory/fail-activity), carrying the original error message and an error code you chose.

The Fail activity is what keeps the status honest. Its message and error code appear in the run history, so the person who opens Monitoring hub at 7:00 sees `SILVER_LOAD_FAILED` and the notebook's own error text instead of a generic activity failure three levels deep.

The Fail activity's settings are expressions. This is a fragment of the Settings tab, not a full pipeline definition, and `Notebook_silver` is a placeholder activity name:

```text
Message:    @{activity('Notebook_silver').error.message}
Error code: SILVER_LOAD_FAILED
```

Pick error codes from a short, fixed list per pipeline. They're the join key between a failed run and the runbook that tells someone what to do, which I wrote about in [who gets paged for a Fabric lakehouse](/blog/2026-03-14-fabric-architecture-notes-turning-messy-raw-zones-into-reliable-products/). Map every code to a runbook step, or drop it.

### Recording the failure

Teams messages are a poor system of record. I want a Delta table that answers "how often does this step fail, and why?" without anyone reading chat history. The catch path runs a small notebook with the run details passed in as parameters.

This is complete for a Fabric PySpark notebook attached to a lakehouse. The table name is a placeholder, and the pipeline overrides the parameter cell with expressions such as `@pipeline().RunId`, `@pipeline().PipelineName` and `@pipeline().DataFactory` (which returns the workspace ID in Fabric), all documented in the [pipeline expression reference](https://learn.microsoft.com/fabric/data-factory/expression-language).

```python
from datetime import datetime, timezone

# Parameters (mark this cell as a parameter cell so the pipeline can override them)
pipeline_run_id = "<pipeline-run-id>"
pipeline_name = "<pipeline-name>"
workspace_id = "<workspace-id>"
failed_activity = "<activity-name>"
error_code = "<error-code>"
error_message = "<error-message>"
log_table = "ops_pipeline_failures"

# The defaults above are placeholders for interactive testing; refuse to log them
if pipeline_run_id.startswith("<"):
    raise ValueError("pipeline parameters not supplied")

row = [
    (
        pipeline_run_id,
        pipeline_name,
        workspace_id,
        failed_activity,
        error_code,
        error_message[:4000],
        datetime.now(timezone.utc),
    )
]

schema = (
    "pipeline_run_id string, pipeline_name string, workspace_id string, "
    "failed_activity string, error_code string, error_message string, "
    "logged_at_utc timestamp"
)

spark.createDataFrame(row, schema).write.format("delta").mode("append").saveAsTable(log_table)

notebookutils.notebook.exit("logged")
```

On the catch-path Notebook activity, the base parameters map like this (a fragment; the run-level parameters are set the same way):

```text
error_message:   @{activity('Notebook_silver').error.message}
error_code:      SILVER_LOAD_FAILED
failed_activity: Notebook_silver
```

Three choices are deliberate. The placeholder check stops a run that forgot to override the parameter cell from logging `<pipeline-run-id>` rows. The message is truncated because some activity errors are too long to be useful in a dashboard. And the log write is append-only with the run ID in it, so a rerun that fails again adds a second row rather than overwriting the first.

### Wiring it without the status trap

The order on the catch path is: log notebook, then notification, then Fail. Connect each with On completion, not On success. If the log notebook itself fails because the lakehouse is unavailable, you still want the notification to go out and the run to fail with the original error. Otherwise the catch path only works when nothing else is broken.

For notifications, Fabric has Teams and Office 365 Outlook activities. Both use a connection, and with user authentication that connection belongs to a person. The [Teams activity docs](https://learn.microsoft.com/fabric/data-factory/teams-activity) call out that, with user authentication, a pipeline deployed to another workspace has its Teams activity inactive until someone creates a new connection in the target workspace, and the Outlook activity has the same connection model. Put that on your deployment checklist.

Invoke pipeline has the same trap. With **Wait on completion** off, the activity succeeds once the child starts, so the parent run says nothing about the child's failure. Keep it on for any child whose output matters; for fire-and-forget children, rely on job events instead.

When a pipeline has many steps, don't give each one its own catch path. The ADF guide's generic pattern works: connect both On fail and On skip from the last activity in a sequence to a single handler. If any earlier step fails, everything after it is skipped, so the handler runs. If they all succeed, it doesn't.

The catch is that the handler no longer knows which step broke. The `activity('Notebook_silver').error.message` expression from earlier can't be relied on when that activity was skipped or succeeded, and `coalesce()` won't rescue it: the [expression reference](https://learn.microsoft.com/fabric/data-factory/expression-language#coalesce) says empty strings aren't null, and an activity that didn't fail gives you no clean null to skip over. If the step name has to be in the Fail message, you need one small catch path per critical step. For the rest, I accept losing it: build the Fail message from the pipeline's fixed error code and let Monitoring hub show which step failed in the run's activity list.

## The failures your pipeline can't catch

In-pipeline handlers only run if the pipeline is running. They won't fire if the capacity is paused, if someone cancels the run, or if the schedule never triggers. So I don't rely on the pipeline to report its own death.

The second layer sits outside the pipeline. Fabric [job events in Real-Time hub](https://learn.microsoft.com/fabric/real-time-hub/explore-fabric-job-events) raise `Microsoft.Fabric.ItemJobFailed` for pipelines, notebooks, Copy jobs and other items, and the documentation says it covers jobs that get stuck or are cancelled. An Activator rule on that event can email or message the owning team. This layer only sees the run's final status, so a catch path without a Fail activity hides the failure from Activator too. Fabric events, including job events, have been generally available since 2025, so this layer is a reasonable production dependency.

That still doesn't cover the run that never started. For that, the check is freshness: does today's batch exist by the time it should? That belongs in a readiness gate, which I covered in [gating daily loads on data readiness](/blog/2026-03-05-pipelines-i-trust-in-fabric-reducing-brittle-dependencies-in-daily-loads/).

## Timeouts are a failure path too

Most activities that do work (Notebook, Copy, Script, Web, Lookup and so on) have a timeout on their General tab; pure control activities such as Wait, Set variable and If Condition don't. The documented default is 12 hours, and the maximum is seven days. A notebook that starts at 5:05 and hangs won't take its On fail path until 17:05. Job events don't help here either: a stuck job only raises ItemJobFailed once Fabric marks it failed, so the activity timeout is what sets how soon anyone hears about it.

I set timeouts explicitly on every activity that matters, at about two to three times its normal duration. A silver notebook that usually takes 15 minutes gets 45. When it times out, it counts as a failure, the catch path runs, and the run fails with a reason at a sensible hour. Retries are a separate decision; for a hung step, a retry usually just gives it another 45 minutes to hang.

## Recovery is part of the design

After a failure, someone has to get the batch through. The Monitoring hub lets you rerun a pipeline in full, from the failed activity, or from an activity you select. Rerun from the failed activity is the one people reach for, and it's only safe if the steps that already succeeded don't need to run again and the failed step can run twice. Whether they can is a property of the steps themselves, and [designing copies for the half-finished run](/blog/2026-03-16-data-movement-without-drama-designing-pipelines-for-failure-not-the-happy-path/) covers the data movement side.

Test the rerun before you need it: fail a step deliberately in a development workspace, rerun from the failed activity, and check what ran again, especially with Invoke pipeline children and ForEach loops.

## When this is too much

Not every pipeline needs a log table and two alert layers.

- **A development or exploratory pipeline** just needs to fail loudly. Leave failure paths off entirely so a failure shows up as a failed run.
- **A best-effort step**, such as refreshing a non-critical cache or writing telemetry, should connect the next step with On completion (or use the ADF guide's try-catch-proceed shape) so the run carries on whether or not it worked.
- **A pipeline one person owns and watches** can rely on job event alerts alone, provided no catch path swallows the failure. The catch-log-notify-fail path pays off when the person who reads the alert isn't the person who built the pipeline.

The opposite mistake is a generic error-handling framework built before there are three pipelines that need it. Start with a Fail activity at the end of every catch path. It's one activity, and it stops a failed step from showing as a green run.

## The question to ask in review

When I review a Fabric pipeline, I ask one thing about every failure path: if this step fails, what colour is the run? If the answer is green, the next question is whether anyone has agreed that this failure doesn't matter. Usually nobody has, and the fix is a Fail activity at the end of the catch path.
