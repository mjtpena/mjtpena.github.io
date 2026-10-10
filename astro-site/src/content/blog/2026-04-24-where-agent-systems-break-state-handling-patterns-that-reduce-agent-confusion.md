---
title: "Where Agent State Breaks: Resume, Retries and Duplicate Runs"
description: "Typed state and checkpoints don't stop an agent paying twice: five places agent workflow state breaks at its boundaries, and patterns that hold."
author: Michael John Peña
draft: false
date: 2026-04-24
tags:
  - AI Agents
  - Architecture
  - Reliability
  - Cosmos DB
  - Python
---

Moving agent workflow state out of the transcript and into typed, checkpointed state fixes the "agent forgot what it decided" class of bugs. It doesn't fix the next class, which shows up once the workflow runs for real: a resumed run sends the same request to a supplier twice, two runs act on the same invoice, or an approval that sat for three days gets applied to facts that have since changed. These are ordinary distributed-systems problems that agent frameworks don't solve, and they hurt more with agents because steps are slow and expensive to repeat.

In March I argued for [explicit state for agent workflows](/blog/2026-03-22-agent-workflows-in-practice-state-handling-patterns-that-reduce-agent-confusion/): typed state owned by code, the model proposes and code commits, one writer per key. This post assumes you've done that and looks at where it still breaks: the boundaries between a run and the outside world. The examples use Microsoft Agent Framework, which [reached 1.0 for .NET and Python](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/) at the start of April, so the workflow APIs are stable rather than release candidates.

## Break 1: resume replays the step that failed

Agent Framework workflows run in supersteps. Executors that have messages run, their state writes are staged, and at the end of the superstep the state is committed and, if you configured checkpoint storage, a checkpoint is written. [Resuming](https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints) with `workflow.run(checkpoint_id=...)` restores the last committed state and pending messages, then carries on.

The unit of durability is the superstep, not the side effect. If an executor requests a credit note from the supplier portal and the process dies before the superstep ends, the checkpoint doesn't know the call happened. Resume, and the executor runs again with the same input. The framework is doing exactly what it says, and preventing the duplicate is your job.

The fix is the one payment systems have used for decades: every external side effect gets an idempotency key, and you record the effect in your own store before and after you make it. Two details matter for agents specifically:

- **The key must be deterministic.** If the executor generates a `uuid4()` per attempt, a replayed superstep produces a new key and the duplicate sails through. Derive it from things that are stable across replays: the case ID, the action, and the version of the case the decision was made against.
- **"Started but not finished" is a real state.** If your ledger shows an effect started with no recorded outcome, you don't know whether it happened. Don't retry blindly. Ask the downstream system (by the same key, if it supports one), or send the case to a person.

## Break 2: two runs, one case

Workflow state belongs to a run. Nothing stops a second run picking up the same invoice: a webhook delivered twice, a user who clicks "investigate" again, a scheduler that overlaps itself. Each run has perfectly consistent state, and between them they approve a variance and request a credit note for the same invoice.

The guard belongs on the business record, not in the workflow. Keep a `version` on the case and make every status change conditional on it. In Azure Cosmos DB that's [optimistic concurrency with the item's `_etag`](https://learn.microsoft.com/en-us/azure/cosmos-db/database-transactions-optimistic-concurrency): read the item, send the ETag back with the replace, and the second writer gets a 412 instead of silently overwriting. Put the same version into the idempotency key from Break 1, and two concurrent runs that reach the same decision compute the same key, so the side effect happens once. The loser either sees the recorded result, backs off while the winner's call is still in flight, or escalates, and only one of them commits the status change.

## Break 3: checkpoint failures are quiet

Nothing fails here, which is the problem. As of 1.2.0, if writing a checkpoint throws, the runner logs a warning ("Failed to create checkpoint") and keeps going. The run succeeds. You find out the next time something fails and there's nothing to resume from, or the newest checkpoint is several supersteps behind.

I understand the choice: a storage blip shouldn't kill a healthy run. But for a workflow whose point is resumability, I want to know. My rules:

- Alert on that warning in your logs, the same way you'd alert on a failed database write.
- Don't treat the checkpoint as your system of record. The case document and the effect ledger are the record; the checkpoint is an optimisation that saves you repeating model calls.

## Break 4: deploys and upgrades strand old runs

Resume only works if the code that loads the checkpoint matches the code that wrote it, and there are three ways that stops being true.

The first is the graph. Each checkpoint stores a signature of the workflow graph, and restoring into a workflow whose graph has changed raises `WorkflowCheckpointException` with "Workflow graph has changed since the checkpoint was created." Add an executor or rewire an edge, and every in-flight run on the old shape can't resume on the new build.

The second is your state types. Rename a dataclass field and an old checkpoint may restore into an object your executors no longer expect.

The third is the deserialisation restriction. Per the [Python changelog](https://github.com/microsoft/agent-framework/blob/main/python/CHANGELOG.md), 1.0.1 (9 April) made checkpoint loading restricted by default, and the beta Cosmos DB checkpoint storage in `agent-framework-azure-cosmos` followed suit in the release that shipped with 1.1.0 on 21 April. That's a good change, and it's a boundary you have to plan for. Checkpoint values that aren't plain JSON are pickled, and loading only allows a safe set plus framework types, so your own state classes must be listed. With the Cosmos DB checkpoint storage, that looks like this:

```python
# Fragment: register application state types that checkpoints may contain.
# pip install agent-framework-azure-cosmos --pre azure-identity aiohttp   (beta package)
from azure.identity.aio import DefaultAzureCredential
from agent_framework_azure_cosmos import CosmosCheckpointStorage

storage = CosmosCheckpointStorage(
    endpoint="https://<your-account>.documents.azure.com:443/",
    credential=DefaultAzureCredential(),
    database_name="<your-database>",
    container_name="checkpoints",
    allowed_checkpoint_types=["invoice_review.state:CaseState"],
)
```

`FileCheckpointStorage` in the core package takes the same `allowed_checkpoint_types` list. Upgrade from a release candidate or 1.0.0 to 1.0.1 or later without that list and checkpoints holding your own types stop loading. That's the correct default, because unrestricted unpickling of a file someone else could write is code execution. Just plan for it.

What I do: treat checkpoints as short-lived and version-bound. Drain or finish in-flight runs before deploying a graph change. Store a schema version in the case document, not just in the checkpoint. If a run can't resume, rebuild it from the case document, which is the record anyway, and accept that the model calls get repeated.

## Break 5: approvals outlive their facts

Human-in-the-loop steps are where state goes stale. An executor calls `ctx.request_info(...)`, the workflow pauses, and the pending request is stored in the checkpoint until someone responds, which after a restart means `workflow.run(checkpoint_id=..., responses={request_id: ...})` to restore and answer in one call. That might be three days later. In that time the supplier may have issued a credit note, someone may have edited the PO, or another run may have closed the case.

The response handler should never apply the approval to the state it had when it asked. It should re-read the facts of record, compare the case version with the one the approver saw, and if they differ, send the case back for review rather than committing. Put the version in the request payload so the person and the code are looking at the same thing.

## The pattern in code

Here's the core of Breaks 1 and 2 with the Azure Cosmos DB Python SDK, independent of any agent framework. It uses two containers: `cases`, partitioned on `/id`, and `effects`, partitioned on `/caseId`. The supplier portal is a stand-in function.

```python
# pip install azure-cosmos==4.15.0 azure-identity==1.25.3
# Create containers "cases" (partition key /id) and "effects" (partition key /caseId) first.
# Your identity needs the Cosmos DB Built-in Data Contributor data-plane role. It is not an
# Azure IAM role: assign it with `az cosmosdb sql role assignment create`, not the portal's IAM blade.
import hashlib
from datetime import datetime, timedelta, timezone

from azure.core import MatchConditions
from azure.cosmos import CosmosClient, exceptions
from azure.identity import DefaultAzureCredential

client = CosmosClient("https://<your-account>.documents.azure.com:443/", credential=DefaultAzureCredential())
database = client.get_database_client("<your-database>")
cases = database.get_container_client("cases")
effects = database.get_container_client("effects")

# Longer than the supplier call's own timeout, so a younger "started" row may still be in flight.
CALL_TIMEOUT = timedelta(minutes=2)


class NeedsReconciliation(Exception):
    """An earlier attempt started this effect and never recorded an outcome."""


class EffectInFlight(Exception):
    """Another attempt started this effect recently; back off and re-read."""


class StaleDecision(Exception):
    """The case moved on after the decision was made; re-read and re-decide."""


def effect_key(case_id: str, action: str, case_version: int) -> str:
    # Deterministic, so a replayed superstep or a duplicate run computes the same key.
    return hashlib.sha256(f"{case_id}:{action}:v{case_version}".encode()).hexdigest()[:32]


def request_credit_note(case_id: str, idempotency_key: str) -> str:
    # Stand-in for the supplier portal. A real call should forward the key downstream.
    return f"CN-{case_id}-{idempotency_key[:8]}"


def run_effect_once(case_id: str, action: str, case_version: int) -> str:
    key = effect_key(case_id, action, case_version)
    try:
        prior = effects.read_item(item=key, partition_key=case_id)
        if prior["status"] == "done":
            return prior["result"]  # Already happened: reuse the recorded outcome.
    except exceptions.CosmosResourceNotFoundError:
        pass
    # Gate the effect itself on the version, not just the status commit.
    case = cases.read_item(item=case_id, partition_key=case_id)
    if case["version"] != case_version:
        raise StaleDecision(f"{case_id} is at v{case['version']}, decision was made on v{case_version}")
    try:
        effects.create_item({"id": key, "caseId": case_id, "action": action, "status": "started"})
    except exceptions.CosmosResourceExistsError:
        prior = effects.read_item(item=key, partition_key=case_id)
        if prior["status"] == "done":
            return prior["result"]
        # _ts is the server's last-write time in epoch seconds, so only this worker's clock
        # matters, not the clock of the worker that started the call.
        started = datetime.fromtimestamp(prior["_ts"], timezone.utc)
        if datetime.now(timezone.utc) - started < CALL_TIMEOUT:
            raise EffectInFlight(f"{action} for {case_id} is in progress; retry shortly")
        raise NeedsReconciliation(f"{action} for {case_id} started at {started.isoformat()} with no outcome")
    result = request_credit_note(case_id, key)
    effects.patch_item(item=key, partition_key=case_id, patch_operations=[
        {"op": "set", "path": "/status", "value": "done"},
        {"op": "set", "path": "/result", "value": result},
    ])
    return result


def commit_status(case_id: str, decided_on_version: int, new_status: str) -> bool:
    case = cases.read_item(item=case_id, partition_key=case_id)
    if case["version"] != decided_on_version:
        return False  # The case moved on after the decision; re-read and re-decide.
    case["status"] = new_status
    case["version"] += 1
    try:
        cases.replace_item(item=case_id, body=case, etag=case["_etag"],
                           match_condition=MatchConditions.IfNotModified)
    except exceptions.CosmosAccessConditionFailedError:
        return False  # Another writer got there first.
    return True


if __name__ == "__main__":
    cases.upsert_item({"id": "INV-20931", "status": "open", "version": 1})
    case = cases.read_item(item="INV-20931", partition_key="INV-20931")
    note = run_effect_once(case["id"], "request_credit_note", case["version"])
    committed = commit_status(case["id"], case["version"], "credit_requested")
    print(note, "committed" if committed else "lost the race")
    # Run the effect again for the same version: no second request, same result.
    print(run_effect_once(case["id"], "request_credit_note", case["version"]))
```

In an Agent Framework workflow, the commit executor calls `run_effect_once` and `commit_status` instead of writing status straight into workflow state. If that executor's superstep replays after a crash, the ledger returns the recorded result rather than calling the supplier again.

Note where the version check sits: before the supplier call, not only in `commit_status`. Otherwise a run that decided on v1, after a PO edit moved the case to v2, computes a fresh v1 key, calls the supplier, and only then loses the commit. Break 5's rule applies to the effect too. A small window remains between that read and the call, which is why the commit keeps its own ETag check.

The ledger can't tell a crashed attempt from one that's still running, so the code uses age as the tiebreak. A `started` row younger than the call timeout means another run is mid-call: back off and re-read, and you'll usually find the recorded result. Only an older row means an attempt died between the portal call and the `patch_item`, and that's surfaced as `NeedsReconciliation` rather than guessed at. The start time comes from the server's `_ts`, so only the reading worker's clock matters, not the clock of the worker that started the call. Set `CALL_TIMEOUT` from the downstream call's real timeout, with a margin larger than any plausible host clock skew.

## When this is more than you need

Skip the ledger for steps with no external side effects. Re-running a model call that only produces a proposal costs tokens, not correctness. Skip the version check if exactly one run can ever touch a record, for example when a queue partitions work by case ID and processes each partition serially. And if the downstream API already enforces idempotency keys, you still need a deterministic key, but the ledger becomes a record of outcomes rather than your only guard.

One gap the code doesn't close: recording the outcome in `effects` and committing the status in `cases` are two separate writes to different containers and partition keys, and they aren't atomic. Cosmos DB [transactional batch](https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/transactional-batch) only covers items that share a partition key, so a crash between them leaves a done effect on a case that still says `open`. That's recoverable, because the next attempt gets the recorded result and retries the commit, but your reconciliation job should look for it.

The cost is a second container, two extra writes per side effect, and a reconciliation path someone has to own. For anything that moves money or messages a customer, I'd pay it.

## The short version

Checkpoints make a run resumable. They don't make it safe to resume. Before you put an agent workflow in front of a real process, I'd check five things:

1. Every external side effect has a deterministic idempotency key and a ledger entry.
2. Every status change is conditional on a case version.
3. Checkpoint write failures raise an alert.
4. Deploys drain or finish in-flight runs, and your state types are registered for checkpoint loading.
5. Approval handlers re-read the facts and compare versions before committing.
