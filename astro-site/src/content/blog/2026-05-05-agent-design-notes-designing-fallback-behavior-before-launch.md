---
title: "Agent Fallbacks Are a Launch Requirement, Not an Ops Task"
description: "Decide what an agent does when a tool fails, a step runs out of budget or grounding is weak before launch, and make the release check fail without it."
author: Michael John Peña
draft: false
date: 2026-05-05
tags:
  - AI Agents
  - Architecture
  - Reliability
  - Python
  - Testing
---

Most agent launches have a plan for when the model is down and no plan for anything else. The model endpoint is the easy failure because it is loud, and it already has a known fix. The failures that hurt are quieter: a tool times out halfway through a write, the agent loops until it runs out of budget, or it answers confidently from retrieval that found nothing useful. If nobody decided before launch what the agent should do in those cases, the model decides at runtime, and it usually decides to improvise.

I wrote about [fallback chains for AI applications](/blog/2024-09-24-fallback-patterns/) and [degradation levels](/blog/2024-09-25-graceful-degradation-ai/) in 2024. Those posts treat the model call as the thing that fails. Agents change the problem, because an agent acts: it calls tools, changes records and works across several steps. A fallback for an agent has to answer "what state did we leave the world in?", not just "what do we show the user?".

## Why "retry, then apologise" isn't a design

The default fallback in most agent code is a retry loop around everything, then a generic "Sorry, something went wrong." It's fine for a chatbot that only reads. For an agent that writes, it's wrong in both directions.

Retrying a write that may already have happened can do it twice. I covered why in [where agent state breaks](/blog/2026-04-24-where-agent-systems-break-state-handling-patterns-that-reduce-agent-confusion/): the durable unit in a workflow is the checkpoint, not the side effect, so a retry has to carry an idempotency key or check before it acts. The generic apology is wrong too. It throws away what the agent already knows, so the user has to start again, and it doesn't tell support whether anything was changed.

The other trap is leaving the fallback to the model. "If a tool fails, explain the problem to the user" in the system prompt sounds reasonable. In practice the model sees an error string, decides it can probably work around it, and tries a different tool or answers from memory. That's the behaviour you least want when the failed tool was the source of truth.

My position: fallback behaviour for an agent is part of its specification, written down per failure class before launch, and enforced in code rather than in the prompt.

## The five failure classes I plan for

Each class needs its own response, because the right move depends on whether anything changed and whether a person can still be helped.

| Failure class | Example | What the agent should do |
|---|---|---|
| Model unavailable or throttled | 429s or 5xx from the deployment | Route to a secondary deployment if one exists; otherwise stop cleanly and queue the request |
| Read tool fails | Search index or CRM lookup times out | Say what it couldn't check; never fill the gap from model knowledge |
| Write tool fails or the outcome is unknown | Timeout after the request was sent | Stop, record the attempt, hand off with the exact arguments; never retry blindly |
| Run exceeds its budget | Too many steps, tokens or seconds | Stop, summarise progress and what's left, offer a handoff |
| Weak grounding or low confidence | Retrieval returns nothing relevant | Answer narrowly or decline, and point to the person or system that owns the answer |

The first row is the only one infrastructure can handle for you. If you call Azure OpenAI through Azure API Management, a [backend pool with priority-based load balancing and circuit breaker rules](https://learn.microsoft.com/azure/api-management/backends) can send traffic to a secondary deployment when the primary trips its rule, including honouring the `Retry-After` header on 429s. Both features have been GA since May 2024, though the circuit breaker isn't available in the Consumption tier. That moves model failover out of agent code entirely, which is where I want it.

Everything else in the table is a decision about the business process, and no gateway can make it for you.

### Writes with an unknown outcome get the most attention

The third row is the one I'd spend the most design time on. A timeout after a request was sent doesn't mean the request failed. The supplier portal may have created the credit note and the response was lost. The safe fallback is to treat "unknown" as its own state: record that the attempt started, don't retry automatically unless the downstream system supports idempotency keys, and give a person enough detail (tool, arguments, time, correlation ID) to check and finish the job.

This is where tool design and fallback design meet. A write tool that accepts an idempotency key gets a cheap fallback: retry once with the same key. A write tool that doesn't gets an expensive one: a human. Knowing that before launch is a good reason to push for idempotency on the APIs your agent calls.

### Budgets are fallbacks too

An agent that hits its step or token limit hasn't crashed, but it has failed the user. The worst version stops mid-thought with a truncated reply. Agree a budget per run (steps, tool calls, wall-clock time) and decide what happens at the limit: a short summary of what was done, what wasn't, and how to continue. I'd split it the same way as in [latency budgets per step](/blog/2026-04-26-practical-ai-performance-tuning-setting-latency-budgets-per-user-journey/), so the final summary always has time to run.

## Put the contract in code, next to the tools

The fallback for each tool belongs beside the tool's definition, not in a runbook. That way a new tool can't be added without someone deciding what happens when it fails, and the decision can be tested.

Whichever framework you use, the enforcement point is the same: wrap tool invocation, catch failures, and return a structured result that the orchestration code acts on, rather than passing a raw exception string back to the model. In Microsoft Agent Framework, which [reached 1.0 for .NET and Python](https://devblogs.microsoft.com/agent-framework/microsoft-agent-framework-version-1-0/) in early April, that's [function middleware](https://learn.microsoft.com/agent-framework/agents/middleware/): it runs around every tool call and can replace the result. The policy that middleware applies is plain code, and that's the part worth reviewing before launch.

The script below is framework-agnostic and uses only the Python standard library (3.10 or later). It declares a fallback contract for each tool, resolves a failure into an action, and runs a release check that fails if any tool is missing a contract or any write tool is allowed to retry without an idempotency key.

```python
from dataclasses import dataclass
from enum import Enum


class Failure(Enum):
    TIMEOUT = "timeout"
    ERROR = "error"
    UNKNOWN_OUTCOME = "unknown_outcome"


class Action(Enum):
    RETRY_ONCE = "retry_once"
    REPORT_GAP = "report_gap"
    HANDOFF = "handoff"


@dataclass(frozen=True)
class ToolContract:
    name: str
    writes: bool
    idempotent: bool
    on_failure: dict[Failure, Action]
    handoff_queue: str | None = None


CONTRACTS = {
    "lookup_invoice": ToolContract(
        name="lookup_invoice",
        writes=False,
        idempotent=True,
        on_failure={
            Failure.TIMEOUT: Action.RETRY_ONCE,
            Failure.ERROR: Action.REPORT_GAP,
            Failure.UNKNOWN_OUTCOME: Action.REPORT_GAP,
        },
    ),
    "request_credit_note": ToolContract(
        name="request_credit_note",
        writes=True,
        idempotent=False,
        on_failure={
            Failure.TIMEOUT: Action.HANDOFF,
            Failure.ERROR: Action.HANDOFF,
            Failure.UNKNOWN_OUTCOME: Action.HANDOFF,
        },
        handoff_queue="<your-accounts-payable-queue>",
    ),
}


def resolve(tool: str, failure: Failure, attempt: int) -> Action:
    """Decide what to do after a tool failure. Unknown tools always hand off."""
    contract = CONTRACTS.get(tool)
    if contract is None:
        return Action.HANDOFF
    action = contract.on_failure.get(failure, Action.HANDOFF)
    if action is Action.RETRY_ONCE and attempt >= 1:
        return Action.HANDOFF if contract.writes else Action.REPORT_GAP
    return action


def release_check(registered_tools: list[str]) -> list[str]:
    """Return the problems that should block a launch."""
    problems = []
    for tool in registered_tools:
        contract = CONTRACTS.get(tool)
        if contract is None:
            problems.append(f"{tool}: no fallback contract")
            continue
        missing = set(Failure) - set(contract.on_failure)
        if missing:
            names = sorted(f.value for f in missing)
            problems.append(f"{tool}: no action for {names}")
        retries = Action.RETRY_ONCE in contract.on_failure.values()
        if contract.writes and retries and not contract.idempotent:
            problems.append(f"{tool}: retries a non-idempotent write")
        hands_off = Action.HANDOFF in contract.on_failure.values()
        if contract.writes and hands_off and not contract.handoff_queue:
            problems.append(f"{tool}: hands off a write but has no queue")
    return problems


if __name__ == "__main__":
    assert resolve("lookup_invoice", Failure.TIMEOUT, attempt=0) is Action.RETRY_ONCE
    assert resolve("lookup_invoice", Failure.TIMEOUT, attempt=1) is Action.REPORT_GAP
    assert resolve("request_credit_note", Failure.UNKNOWN_OUTCOME, 0) is Action.HANDOFF
    assert resolve("delete_vendor", Failure.ERROR, attempt=0) is Action.HANDOFF

    problems = release_check(["lookup_invoice", "request_credit_note", "delete_vendor"])
    print("\n".join(problems) or "all tools have a fallback contract")
    assert problems == ["delete_vendor: no fallback contract"]
```

Two choices in there are deliberate. Unknown tools resolve to a handoff, so forgetting a contract fails safe rather than open. And `REPORT_GAP` is an explicit action, so a failed read becomes "I couldn't check the invoice system" instead of an invented answer. Run `release_check` in CI against the tools your agent actually registers, and a missing decision blocks the release instead of surfacing in production.

## The handoff is the fallback most teams under-build

Almost every row in the table ends with "hand off", and the handoff is often an afterthought: a link to a generic support form. A useful handoff carries the context so the person doesn't redo the agent's work: the user's request, what the agent did and found, the action that failed with its arguments, and whether the outcome is known. If the receiving team can't act on it without asking the user again, it isn't a fallback, it's a dead end with better wording.

Test it the same way as the happy path. Before launch I'd force each failure class in a test environment (block the read tool, make the write tool time out after accepting the request, cap the step budget at two) and check three things: what the user saw, what the handoff queue received, and what changed in the downstream system.

## When this is overkill

If your agent only reads (a Q&A assistant over documents) most of this collapses to two rows: model failover and "say what you couldn't check". A full per-tool contract and release check are worth it once an agent can change records, spend money or contact people outside the organisation. They're also worth it when several teams add tools to the same agent, because that's when undecided fallbacks slip in.

## What I'd ask for before sign-off

Before an agent goes live, I want a one-page answer to "what happens when each tool fails?", written by the people who own the business process, not inferred from the prompt. Put model failover in the gateway, put the rest in code next to the tools, and make the release fail when a tool doesn't have a decision. The agent will still fail in production. The goal is that every failure is one you chose.
