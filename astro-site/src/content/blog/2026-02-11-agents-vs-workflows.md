---
title: "Workflow First, Agent Inside: Putting the Model in One Step"
description: "Most agent designs only need autonomy in one step. How to build the workflow around it with Agent Framework executors, switch-case edges and loop caps."
author: Michael John Peña
draft: false
date: 2026-02-11
tags:
  - AI
  - AI Agents
  - Architecture
  - Workflows
  - Python
---

"Agent or workflow?" is usually asked about a whole system, and that's the wrong unit. Most business processes teams want to automate have one or two steps where nobody can write the path down in advance, wrapped in a lot of steps everyone can. If you hand the whole thing to an agent because of those two steps, you pay for unpredictability everywhere: in cost, in testing, and in every incident review.

I argued the strategic case in [AI Agents in 2026: Where They Earn Their Keep](/blog/2026-01-02-ai-agents-reality-vs-hype/). This post is the practical follow-up: how to decide which steps get autonomy, and what the hybrid looks like in code.

## The distinction that matters

Anthropic's [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) gives the cleanest definition I know. In a workflow, your code decides the path and the model fills in steps along it. In an agent, the model decides the path: which tool to call next, and when it's finished. Microsoft's [Agent Framework overview](https://learn.microsoft.com/en-us/agent-framework/overview/) draws the same line, and adds the advice I repeat most: if you can write a function to handle the task, write the function.

The useful consequence is that "who decides the next step" is a property of a *step*, not of a system. A support ticket process can classify with one model call (a workflow step), apply refund policy in plain code (not AI at all), and investigate an outage with a model that chooses which status checks to run (an agent step).

## A test for each step

I run every step in a proposed design through four questions. A "no" on either of the first two pushes the step towards a fixed path; a "no" on the last two means it isn't ready to ship in any form.

| Question | If yes | If no |
|---|---|---|
| Is the set of possible next actions too large or too situational to enumerate? | Candidate for an agent step | Write the branches yourself |
| Can a wrong intermediate action be caught before it reaches a customer or a system of record? | Autonomy is tolerable | Fixed path with an approval gate |
| Can you put a ceiling on the number of model calls? | Cost is bounded | Don't ship it yet |
| Do you have evaluation examples for this step on its own? | You can measure it | You're guessing |

In practice the answers are lopsided. Classification, extraction, summarisation and routing are workflow steps: the output space is known, so a single structured model call does the job and you can test it against a labelled set. Policy decisions such as refunds, approvals and entitlements shouldn't involve a model choosing anything, because the policy already exists and an auditor will ask where it's written down. What's left is investigation and research: steps where the useful next lookup depends on what the last one returned. That's the only place an agent loop is worth what it costs.

## The hybrid in Agent Framework

Microsoft Agent Framework has been in public preview since October 2025, and its workflows feature models exactly this split. A workflow is a graph: [executors](https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/) are the nodes and can hold plain code or an agent, and edges route typed messages between them, including switch-case edges that pick one target based on the message content.

Here's the support example. One model call classifies the ticket into a fixed set of categories; billing goes to deterministic code; outages go to an agent with a single read-only tool; anything else goes to a person. It's written against the 30 January beta (`1.0.0b260130`), pinned on purpose: the `1.0.0b260210` beta, published the day this post went out, renames `ChatAgent` to `Agent` and moves the start executor into the `WorkflowBuilder` constructor.

```python
# pip install agent-framework-core==1.0.0b260130 openai==2.20.0 azure-identity
import asyncio
from dataclasses import dataclass
from typing import Annotated, Literal

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from pydantic import BaseModel

from agent_framework import (
    Case,
    ChatAgent,
    Default,
    Executor,
    WorkflowBuilder,
    WorkflowContext,
    handler,
    tool,
)
from agent_framework.azure import AzureOpenAIChatClient

# Entra ID auth; the token provider refreshes tokens for you.
client = AzureOpenAIChatClient(
    endpoint="https://<your-resource-name>.openai.azure.com",
    deployment_name="<your-deployment-name>",
    ad_token_provider=get_bearer_token_provider(
        DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
    ),
)
# Cap the tool-calling loop inside any agent built on this client (default is 40).
client.function_invocation_configuration.max_iterations = 6


class Triage(BaseModel):
    category: Literal["billing", "outage", "other"]
    confidence: Literal["high", "low"]
    summary: str


@dataclass
class TriagedTicket:
    text: str
    triage: Triage


@tool(approval_mode="never_require")
def get_service_status(
    service: Annotated[str, "Service name, for example 'api' or 'portal'."],
) -> str:
    """Read-only status lookup. Replace the stub with your status API."""
    return f"{service}: degraded in australiaeast since 09:40 AEDT"


classifier = ChatAgent(
    chat_client=client,
    instructions=(
        "Classify the support ticket. Use 'other' if it fits no category, "
        "and set confidence to 'low' if you are unsure."
    ),
)
investigator = ChatAgent(
    chat_client=client,
    instructions=(
        "Investigate the reported outage with the status tool and draft a reply "
        "for a support engineer to review. Never promise credits or timelines."
    ),
    tools=[get_service_status],
)


class Classify(Executor):
    @handler
    async def classify(self, ticket: str, ctx: WorkflowContext[TriagedTicket]) -> None:
        response = await classifier.run(ticket, options={"response_format": Triage})
        await ctx.send_message(TriagedTicket(text=ticket, triage=response.value))


class BillingPolicy(Executor):
    # Deterministic: billing answers come from policy, not from the model.
    @handler
    async def answer(self, t: TriagedTicket, ctx: WorkflowContext[None, str]) -> None:
        await ctx.yield_output(f"[billing queue] {t.triage.summary} -> refund policy v3")


class InvestigateOutage(Executor):
    # The only agentic step: the model chooses which lookups to make.
    @handler
    async def investigate(self, t: TriagedTicket, ctx: WorkflowContext[None, str]) -> None:
        response = await investigator.run(t.text)
        await ctx.yield_output(f"[draft for review] {response.text}")


class HumanQueue(Executor):
    @handler
    async def route(self, t: TriagedTicket, ctx: WorkflowContext[None, str]) -> None:
        await ctx.yield_output(f"[human queue] {t.triage.summary}")


classify = Classify(id="classify")
workflow = (
    WorkflowBuilder()
    .set_start_executor(classify)
    .add_switch_case_edge_group(
        classify,
        [
            Case(condition=lambda t: t.triage.category == "billing"
                 and t.triage.confidence == "high",
                 target=BillingPolicy(id="billing")),
            Case(condition=lambda t: t.triage.category == "outage"
                 and t.triage.confidence == "high",
                 target=InvestigateOutage(id="outage")),
            Default(target=HumanQueue(id="human")),
        ],
    )
    .build()
)


async def main() -> None:
    result = await workflow.run("The portal has been timing out for an hour.")
    print(result.get_outputs())


if __name__ == "__main__":
    asyncio.run(main())
```

### What the structure buys you

**The classifier can't invent a route.** The `Literal` in the `Triage` model means the structured output has three legal values, and the switch-case edge maps each one to a known executor. A ticket the model can't place falls to `Default`, which is a person. If the response doesn't match the schema at all, `response.value` raises a validation error and the run fails loudly instead of routing somewhere plausible. What the `Literal` can't stop is a legal but wrong label: an outage ticket classified as billing is misrouted silently, and `other` only catches anything if the model chooses it. That's why `Triage` also carries a `confidence` field and both cases require `"high"`: a low-confidence label falls through to `Default` instead of being trusted. It narrows the gap rather than closing it, so track recall per category as well as precision, because a missed outage costs more than a false one.

**Autonomy is confined to one executor.** Only `InvestigateOutage` runs a tool loop, and that loop is capped at six tool-calling round trips through the client's `function_invocation_configuration`, plus one final answer call if it hits the cap. The default is 40, which is far more than a status investigation should ever need. The workflow graph has its own cap too: `WorkflowBuilder` defaults to 100 supersteps, which only matters once you add cycles.

**Each step is testable on its own.** The classifier gets a labelled evaluation set with precision and recall targets per category. Billing gets ordinary unit tests, because it's ordinary code. The investigator gets scenario tests and a reviewer, because its output is a draft for an engineer, not a reply to the customer.

**Cost is mostly predictable.** Billing and "other" tickets cost exactly one model call. Outage tickets cost between two and eight, which is a range you can budget for. When the cap is hit, or after three consecutive tool errors (for example, a broken status API), the framework makes one final call with tools disabled. Log both cases and treat those drafts as low confidence, because they were written from partial evidence.

Compare that with a single agent given a status tool, a refund-policy tool and a hand-off tool, where every ticket pays for the model to reason about which branch it's in.

## When the hybrid is the wrong call

**If every step is fixed, skip the framework.** A classifier and a routing table don't need a workflow engine. Two functions and an `if` statement are easier to read and have no preview dependency. Reach for the graph when you need fan-out, checkpointing so a long run can resume, or human-in-the-loop pauses, all of which the framework's workflows support.

**If you can't write the categories down, you can't route.** A general-purpose assistant whose requests don't fall into a handful of buckets is closer to a genuine agent problem. Bound it with tool permissions and loop caps instead of pretending a router will tame it.

**If preview churn is unacceptable, wait or go managed.** Agent Framework's Python package has shipped roughly weekly betas since October, and they've included renames: the `ai_function` decorator became `tool` in the 28 January beta (`1.0.0b260128`), and the `1.0.0b260210` beta, published the day this post went out, renames `ChatAgent` to `Agent`, drops `set_start_executor` and turns `FunctionInvocationConfiguration` into a TypedDict, so the sample above would break on it. That's why the install line pins exact versions. Check the [release history](https://pypi.org/project/agent-framework-core/#history) before you upgrade. If your team can't absorb that, either hold the agent step in plain function-calling code for now or look at the managed option in [Microsoft Foundry Agent Service](https://learn.microsoft.com/en-us/azure/foundry/agents/overview), where prompt agents are GA but hosted agents and workflows were still in preview at the time of writing.

## How I'd decide on Monday

Draw the process as boxes before anyone mentions frameworks. For each box, ask who should choose the next step: your code, a policy, a person, or the model. Most boxes will be the first three. Build those as a workflow, put a model call only where language has to be understood, and give the model control of the path in the one or two boxes where nobody can write it down. Cap that loop, make its output a draft rather than an action, and measure it on its own. If a later evaluation shows the agent step adds nothing over a fixed sequence of lookups, replace it with one. You've made the system cheaper and easier to test.
