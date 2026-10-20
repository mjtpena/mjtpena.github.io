---
title: "Explicit State for Agent Workflows: Stop Making the Model Remember"
description: "Agents get confused when workflow state lives in the chat transcript. Four patterns for typed state, fresh context and code-owned transitions."
author: Michael John Peña
draft: false
date: 2026-03-22
tags:
  - AI
  - AI Agents
  - Architecture
  - Workflows
  - Python
---

When an agent "forgets" that an invoice was already approved, or acts on a supplier name it read three tool calls ago, the usual fix is a longer system prompt. That rarely works, because the real problem is where the state lives. In most agent designs I review, the only record of what's true, what's been decided and what's left to do is the conversation transcript, and the model is expected to re-derive all of it on every turn. That's the source of most of the confusion people blame on the model.

My position is simple: the transcript is a scratchpad, not a database. Anything the process depends on should live in typed state that your code owns, and the model should get a fresh, minimal view of it at each step.

## Why transcripts make agents unreliable

A chat history mixes four different things in one undifferentiated stream: facts fetched from systems, the model's own guesses, instructions, and decisions. The model has no reliable way to tell a confirmed fact from its own earlier speculation, and neither do you when you read the logs later. Three failure modes follow from that.

- **Stale facts.** A tool result from ten turns ago still looks authoritative, even if the record changed or a later step superseded it.
- **Lossy summaries.** Once history gets long, something trims or summarises it. Whatever gets dropped is exactly the detail the next step needed, and nothing tells the model it's gone.
- **Leaky multi-agent threads.** When agents share one thread, one agent's hypothesis reads to the next agent as an established fact.

Anthropic's write-up on [effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) makes the same point from the model side: context is a finite resource, and the goal is the smallest set of high-signal tokens for the step at hand. Workflow state is how you make that practical.

## Pattern 1: separate three kinds of state

Before writing code, I sort everything the process touches into three buckets, because each has a different owner and lifetime.

| Kind | Example | Owner | Where it lives |
|---|---|---|---|
| Facts of record | Invoice amount, PO number, goods receipt | The source system | Re-read from the system; copied into state with provenance |
| Workflow state | Case status, which checks have run, attempt counts | Your code | Typed object in workflow state, checkpointed |
| Conversation | The model's reasoning, draft wording, tool chatter | The agent | Session or transcript; disposable |

The test for each item is: if this value were wrong, who would be accountable? If the answer is "the ERP" or "the workflow", it doesn't belong only in a transcript. The conversation bucket is the only one you should be comfortable losing.

## Pattern 2: compose context from state, don't replay history

Once state is typed, each agent step can be given a purpose-built prompt: the confirmed facts it needs, the rule it's working under, and the single decision it has to make. No transcript, no earlier agents' musings. This does three useful things. Token use stays flat as the process gets longer. Every step's input is reproducible, so you can turn it into an evaluation case. And the model can't confuse its own earlier guess with a fact, because its earlier guesses aren't there.

The trade-off is that you lose cross-step nuance. If a step genuinely benefits from the reasoning behind an earlier decision, write that reasoning into state as a short, named field (`escalation_reason`), rather than passing the whole thread forward.

## Pattern 3: the agent proposes, code commits

The most effective single change is to stop letting the model write state directly. The agent returns a structured proposal: an action from a fixed set, a reason, and the facts it relied on. Deterministic code then validates the proposal against state and business rules before anything changes. If the model cites a fact that doesn't exist, or proposes an action the rules don't allow, the transition is rejected and the case is escalated.

This is the state equivalent of the [least-privilege tool design](/blog/2026-03-11-building-useful-ai-agents-tool-access-policies-that-improve-reliability/) I wrote about earlier this month: the model can suggest, but only code can change the record. It also gives auditors a clear line between "what the model said" and "what the system did".

## Pattern 4: one owner per key, and checkpoint at boundaries

Microsoft Agent Framework's workflows make this pattern concrete. In Python, `1.0.0rc5` is the current release candidate (published 20 March 2026); the framework moved from weekly betas to RCs in February and hasn't reached GA yet, so pin the version. A workflow is a graph of executors, and executors share data through workflow state with `ctx.set_state()` and `ctx.get_state()`.

Two details in how that state behaves matter for design:

- **Writes are staged per superstep.** A `set_state` call goes to a pending buffer and is committed at the end of the superstep. If two executors running in the same superstep write the same key, the last write wins, with no merge and no error. My rule is one owning executor per key; anything concurrent writes to its own key.
- **Checkpoints capture state at superstep boundaries.** With checkpoint storage configured, the framework saves executor state, shared state and pending messages at the end of each superstep, so a failed run can [resume from a checkpoint](https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints) instead of starting over and repeating model calls and side effects. In the Python release candidate, non-JSON values in checkpoints are serialised with pickle, and the source warns that loading a checkpoint can execute code. Treat checkpoint storage as trusted infrastructure: never load checkpoints from somewhere a user or another tenant can write.

## A worked example: invoice variance review

Here's a small accounts payable workflow. An invoice doesn't match its purchase order. One executor loads facts from the ERP into a typed `CaseState`. An agent reviews only those facts and returns a `Proposal`. A commit executor applies the business rules and decides what actually happens. It's written against `agent-framework-core==1.0.0rc5`, and the ERP is a dictionary standing in for a real API.

```python
# pip install agent-framework-core==1.0.0rc5 openai==2.29.0 azure-identity==1.25.3
# Sign in with `az login`; your identity needs an Azure OpenAI user role on the resource.
import asyncio
from dataclasses import dataclass, field
from typing import Literal

from agent_framework import (
    Agent,
    Executor,
    FileCheckpointStorage,
    WorkflowBuilder,
    WorkflowContext,
    handler,
)
from agent_framework.azure import AzureOpenAIChatClient
from azure.identity import AzureCliCredential
from pydantic import BaseModel

# Stand-in for the ERP. In production this is an API call, not a dict.
ERP = {
    "INV-20931": {"po": "PO-7714", "po_amount": 12000.00, "invoice_amount": 12480.00,
                  "goods_received": True, "supplier": "Contoso Freight"},
}
TOLERANCE_PCT = 5.0


@dataclass
class CaseState:
    invoice_id: str
    facts: dict = field(default_factory=dict)  # copied from the ERP, never from the model
    status: Literal["open", "variance_approved", "credit_requested", "escalated"] = "open"
    notes: list[str] = field(default_factory=list)


class Proposal(BaseModel):
    action: Literal["approve_variance", "request_credit_note", "escalate"]
    reason: str
    cited_facts: list[str]


class LoadFacts(Executor):
    @handler
    async def load(self, invoice_id: str, ctx: WorkflowContext[str]) -> None:
        case = CaseState(invoice_id=invoice_id, facts=dict(ERP[invoice_id]))
        po, inv = case.facts["po_amount"], case.facts["invoice_amount"]
        case.facts["variance_pct"] = round((inv - po) / po * 100, 2)
        ctx.set_state("case", case)  # this executor owns the "case" key
        await ctx.send_message(invoice_id)


class Investigate(Executor):
    def __init__(self, agent: Agent):
        super().__init__(id="investigate")
        self.agent = agent

    @handler
    async def run(self, invoice_id: str, ctx: WorkflowContext[Proposal]) -> None:
        case: CaseState = ctx.get_state("case")
        # Fresh, minimal context built from state, not a replayed transcript.
        prompt = (
            f"Invoice {case.invoice_id} does not match its purchase order.\n"
            f"Confirmed facts: {case.facts}\n"
            f"Variance tolerance: {TOLERANCE_PCT}%.\n"
            "Propose one action. Cite the fact names you relied on."
        )
        response = await self.agent.run(prompt, options={"response_format": Proposal})
        await ctx.send_message(response.value)


class Commit(Executor):
    @handler
    async def commit(self, proposal: Proposal, ctx: WorkflowContext[None, CaseState]) -> None:
        case: CaseState = ctx.get_state("case")
        unknown = [f for f in proposal.cited_facts if f not in case.facts]
        within_tolerance = abs(case.facts["variance_pct"]) <= TOLERANCE_PCT
        if unknown or (proposal.action == "approve_variance"
                       and not (within_tolerance and case.facts["goods_received"])):
            case.status = "escalated"
            case.notes.append(f"Rejected proposal {proposal.action}; unknown facts: {unknown}")
        else:
            case.status = {"approve_variance": "variance_approved",
                           "request_credit_note": "credit_requested",
                           "escalate": "escalated"}[proposal.action]
            case.notes.append(proposal.reason)
        ctx.set_state("case", case)
        await ctx.yield_output(case)


async def main() -> None:
    agent = Agent(
        client=AzureOpenAIChatClient(
            endpoint="https://<your-resource-name>.openai.azure.com",
            deployment_name="<your-deployment-name>",
            credential=AzureCliCredential(),
        ),
        name="variance-investigator",
        instructions="You review invoice variances. Use only the facts you are given.",
    )
    load, investigate, commit = LoadFacts(id="load"), Investigate(agent), Commit(id="commit")
    workflow = (
        WorkflowBuilder(
            name="invoice-variance",
            start_executor=load,
            checkpoint_storage=FileCheckpointStorage("./checkpoints"),
        )
        .add_edge(load, investigate)
        .add_edge(investigate, commit)
        .build()
    )
    result = await workflow.run("INV-20931")
    for case in result.get_outputs():
        print(case.status, case.notes)


if __name__ == "__main__":
    asyncio.run(main())
```

A few things are deliberate here. The `facts` dictionary is only ever written by `LoadFacts`, from the ERP, so nothing the model says can turn into a fact. The variance percentage is calculated in code, not by the model. The agent's prompt is built from state, so running the same case twice gives it identical input. And `Commit` approves a variance only if the rule allows it, whatever the model proposed: an "approve" for a 9% variance becomes an escalation with a note explaining why.

Because the builder has `FileCheckpointStorage`, each superstep boundary is saved under `./checkpoints`. If the model call fails, you can call `workflow.run(checkpoint_id=...)` against the last good checkpoint and skip the ERP load. For production I'd swap the file store for a durable, access-controlled one, for the pickle reason above.

## When this is overkill

Not every agent needs this. Skip typed workflow state when:

- **The conversation is the product.** A chat assistant answering questions over documents has no process state to protect; session history is the right tool.
- **The task is one step.** A single extraction or classification call has nothing to carry between steps. The state is the input and output.
- **You're still exploring.** In a prototype, the transcript tells you which facts the process actually depends on. Promote them to typed state once the steps settle down.

The cost is real: more types, more executors, and a schema to version when the process changes. A checkpoint written by one version of `CaseState` may not load cleanly after you rename a field, so treat state types the way you'd treat a database schema.

## The rule I'd start with

If a fact or decision matters after the current step, it goes into typed state owned by code, with one writer, and the model sees a fresh view of it rather than a replay of everything that happened. That one rule removes most of the "the agent got confused" incidents, because the agent no longer has to remember anything important. If you're still deciding which steps should be agents at all, start with [Workflow First, Agent Inside](/blog/2026-02-11-agents-vs-workflows/), then read the [Agent Framework workflows overview](https://learn.microsoft.com/en-us/agent-framework/workflows/) for the executor and edge model this builds on.
