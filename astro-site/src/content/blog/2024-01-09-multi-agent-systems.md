---
title: "When to Split One AI Agent into Several: A Supervisor Pattern"
description: "When a single GPT-4 agent stops being reliable, split it into specialists. A framework-free supervisor pattern on Azure OpenAI, with trade-offs and limits."
author: Michael John Peña
draft: false
date: 2024-01-09
tags:
  - AI Agents
  - Multi-Agent
  - Azure OpenAI
  - Architecture
---

A single agent with a long system prompt and a dozen tools works well right up until it doesn't. Once one prompt has to cover SQL, statistics, business writing and calendar access, it starts picking the wrong tool, forgetting constraints, and failing in ways you can't reproduce. Splitting into small specialist agents usually gives clearer reasoning, easier testing and more predictable cost, but "multi-agent" is also the most over-applied idea in generative AI right now. Knowing when not to split matters as much as knowing how.

## The real reason to split: separate concerns, not more intelligence

Take a typical enterprise request: "Analyse our Q4 sales, find the underperforming regions, and draft an email to each regional manager with suggestions."

One agent can attempt this, but it has to hold several unrelated jobs in a single context window: writing correct queries against your schema, interpreting the numbers, and writing in your organisation's tone. Every instruction you add for one job dilutes the others. When the email comes out wrong, you can't tell whether the prompt, the data or the tool call was at fault.

Splitting the work gives you three things that matter in production:

- **Smaller prompts you can test in isolation.** A data agent with one job and three tools can have its own evaluation set. A writer agent can be checked against a style guide without touching a database.
- **Least privilege.** Only the data agent gets database credentials. The writer never sees a connection string, which limits the damage from prompt injection in retrieved content.
- **Model choice per role.** Planning and synthesis benefit from GPT-4 Turbo (`1106-preview`, still in preview on Azure OpenAI). Preview model versions can be auto-upgraded to a newer version, so pin the planner deployment's model version and re-run your evaluations before moving it. Formatting, classification and simple extraction often run fine on GPT-35-Turbo at a fraction of the price.

What splitting does *not* give you is a smarter system. Agents talking to each other still run on the same models. You are trading one hard prompt for several easy ones plus a coordination problem.

## Three coordination patterns, and which one I'd start with

| Pattern | How it works | Good for | Main risk |
|---|---|---|---|
| Supervisor (hierarchical) | One planner breaks the task into steps and delegates to named workers | Business workflows with clear stages | Planner becomes a bottleneck and single point of failure |
| Peer-to-peer / group chat | Agents message each other; a selection rule decides who speaks next | Open-ended exploration, code-and-review loops | Conversations that loop, drift or never terminate |
| Critic / debate | Agents produce answers, then critique each other over a few rounds | Reasoning and factual accuracy on high-stakes outputs | Token cost multiplies with every round |

I start almost every enterprise build with the supervisor pattern. It is the easiest to log, the easiest to explain to a risk or audit team, and its failure modes are obvious: the plan was wrong, or a step failed. Peer-to-peer conversation is powerful, and it is what Microsoft Research's AutoGen is built around: its `GroupChat` manager, which since 0.2.2 picks the next speaker from each agent's description ([All About Agent Descriptions](https://microsoft.github.io/autogen/0.2/blog/2023/12/29/AgentDescriptions)). The `description` field on each worker in the sample below plays the same role for the planner. It is also much harder to put a ceiling on. The critic pattern has research behind it (Du et al., [Improving Factuality and Reasoning in Language Models through Multiagent Debate](https://arxiv.org/abs/2305.14325)), but I treat it as a verification step bolted onto a supervisor flow, not an architecture on its own.

## A minimal supervisor on Azure OpenAI

You don't need a framework to understand the pattern. The sketch below uses the `openai` Python library 1.x ([v1.0.0 shipped on 6 November 2023](https://github.com/openai/openai-python/releases/tag/v1.0.0)) with `AsyncAzureOpenAI`. The steps run one after another here; the async client is there so that independent steps can later run concurrently with `asyncio.gather`. The planner uses JSON mode, which Azure OpenAI supports on the GPT-4 Turbo `1106-preview` model from API version `2023-12-01-preview` ([JSON mode docs](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/json-mode)). Deployment names are placeholders for whatever you called your deployments.

```python
import asyncio
import json
import logging
import os
import uuid
from dataclasses import dataclass

from openai import AsyncAzureOpenAI

client = AsyncAzureOpenAI(
    azure_endpoint="https://<your-resource-name>.openai.azure.com",
    api_key=os.environ["AZURE_OPENAI_API_KEY"],
    api_version="2023-12-01-preview",
)

PLANNER_DEPLOYMENT = "<your-gpt-4-1106-preview-deployment>"
WORKER_DEPLOYMENT = "<your-gpt-35-turbo-deployment>"
MAX_STEPS = 6

logging.basicConfig(level=logging.INFO, format="%(message)s")
log = logging.getLogger("supervisor")


@dataclass
class Worker:
    name: str
    description: str
    system_prompt: str
    deployment: str

    async def run(self, task: str, run_id: str) -> str:
        response = await client.chat.completions.create(
            model=self.deployment,
            temperature=0,
            messages=[
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": task},
            ],
        )
        choice = response.choices[0]
        log.info(
            "run=%s agent=%s deployment=%s prompt_tokens=%d completion_tokens=%d finish=%s",
            run_id,
            self.name,
            self.deployment,
            response.usage.prompt_tokens,
            response.usage.completion_tokens,
            choice.finish_reason,
        )
        if not choice.message.content:
            raise RuntimeError(
                f"{self.name} returned no content (finish_reason={choice.finish_reason})"
            )
        return choice.message.content


WORKERS = {
    "analyst": Worker(
        name="analyst",
        description="Interprets sales figures supplied in the task and identifies trends.",
        system_prompt="You are a sales analyst. Only use numbers given to you. "
        "If data is missing, say so instead of guessing.",
        deployment=PLANNER_DEPLOYMENT,
    ),
    "writer": Worker(
        name="writer",
        description="Drafts short, professional business emails.",
        system_prompt="You write concise business emails in Australian English. "
        "Never invent figures that are not in the brief.",
        deployment=WORKER_DEPLOYMENT,
    ),
}


async def plan(task: str) -> list[dict]:
    roster = "\n".join(f"- {w.name}: {w.description}" for w in WORKERS.values())
    response = await client.chat.completions.create(
        model=PLANNER_DEPLOYMENT,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": "You plan work for a team of agents. Available agents:\n"
                f"{roster}\n"
                'Reply in JSON as {"steps": [{"agent": "<name>", "task": "<instruction>"}]}. '
                f"Use at most {MAX_STEPS} steps and only the agents listed.",
            },
            {"role": "user", "content": task},
        ],
    )
    steps = json.loads(response.choices[0].message.content or "{}").get("steps")
    if not isinstance(steps, list) or not steps:
        raise ValueError(f"Planner returned no usable steps: {steps!r}")
    for step in steps:
        if not isinstance(step, dict) or "agent" not in step or "task" not in step:
            raise ValueError(f"Malformed plan step: {step!r}")
    return steps[:MAX_STEPS]


async def run(task: str) -> str:
    run_id = str(uuid.uuid4())
    context = ""
    for step in await plan(task):
        worker = WORKERS.get(step["agent"])
        if worker is None:
            raise ValueError(f"Planner chose an unknown agent: {step['agent']}")
        log.info("run=%s step agent=%s task=%s", run_id, worker.name, step["task"])
        prompt = f"{step['task']}\n\nResults so far:\n{context or '(none)'}"
        output = await worker.run(prompt, run_id)
        context += f"\n## {worker.name}\n{output}\n"
    return context


if __name__ == "__main__":
    task = (
        "Q4 revenue by region (AUD): NSW 4.2m (target 4.0m), VIC 3.1m (target 3.6m), "
        "QLD 2.0m (target 2.4m). Identify regions below target and draft one email "
        "per underperforming regional manager with two practical suggestions."
    )
    print(asyncio.run(run(task)))
```

A few design decisions in there are deliberate:

- **The planner can only choose from a fixed roster.** An unknown agent name is an error, not something to improvise around. If the model can invent agents, it will.
- **There's a hard step limit and a shape check**, enforced in code as well as in the prompt. Prompts are suggestions; validating every step and slicing to `MAX_STEPS` is a guarantee. The same goes for empty worker output: a content-filter finish returns no text, and it should stop the run rather than pass the word "None" to the next agent.
- **Every model call logs tokens and the deployment against one run ID.** That's the minimum you need to see which role is expensive and to replay a bad run.
- **Workers get the accumulated results as plain text.** That keeps the hand-off visible in your logs. For anything long-running, you'd write each step to a store such as Cosmos DB or Table Storage so a failed run can resume and be audited.
- **The analyst runs on the GPT-4 Turbo preview deployment and the writer on GPT-35-Turbo.** That split is where most of the cost saving comes from, and it only works because each role is narrow enough for the cheaper model to handle.

The analyst here receives figures in the prompt. In a real system it would call a query tool through [function calling](https://learn.microsoft.com/en-us/azure/ai-services/openai/how-to/function-calling), and that tool, not the model, would hold the database permissions.

### Evaluate the planner separately from the workers

Each worker gets its own evaluation set: fixed inputs with checks on the output, such as "the email mentions only figures from the brief". The planner needs one too. Keep a fixed set of tasks with the agent sequence you expect for each (this task should be `analyst` then `writer`, that one `analyst` only) and score `plan()` against it on its own, without running any workers. When a run goes wrong, that tells you quickly whether the plan or a step was at fault, and it's the test to re-run whenever the planner's model version or prompt changes.

## Where multi-agent designs go wrong

The failure modes are predictable enough that I'd design for them from day one.

**Error compounding.** If each step is right 90% of the time, a five-step plan is right about 59% of the time. More agents means more hand-offs, and every hand-off is a chance to lose information. This is the strongest argument for keeping the agent count small.

**Runaway cost and latency.** Every agent turn is a full model call with its own context. A three-agent debate over three rounds is at least nine GPT-4 calls before you synthesise anything. Put step limits, token budgets and timeouts in code, and log tokens per agent so you can see which role is expensive.

**Loops and politeness spirals.** Peer agents happily thank each other, ask clarifying questions back and forth, or re-do each other's work. Free-form chat needs an explicit termination condition and a maximum number of turns. AutoGen's `GroupChat` has a `max_round` setting for exactly this reason.

**Untraceable failures.** If you can't replay which agent said what, with which inputs, you can't debug it. Log the plan, every step's input and output, the model deployment used, and token counts, with a single correlation ID per request.

**Trusting the critic too much.** A critic agent using the same model as the author shares its blind spots. Critique improves outputs on average, but it isn't validation. For figures, check them in code against the source data.

## When one agent (or no agent) is the better answer

I'd stay with a single agent, or a plain deterministic pipeline, when:

- **The steps are fixed.** If the workflow is always extract, validate, summarise, write it as ordinary code that calls the model three times. You don't need an LLM to plan a sequence you already know.
- **The tool count is small.** A single agent with three or four well-described functions is usually reliable. Split when the toolset spans genuinely different domains or permission boundaries, not because the prompt feels long.
- **Latency matters.** Sequential agent hand-offs add seconds each. A user-facing chat response rarely survives a five-agent plan.
- **You can't evaluate it yet.** If you don't have test cases for the single-agent version, adding agents only multiplies what you can't measure.

On frameworks: AutoGen is the most capable option for conversational multi-agent patterns today, and the 0.2 releases are moving quickly. Semantic Kernel, whose .NET SDK [reached 1.0 in December 2023](https://devblogs.microsoft.com/semantic-kernel/semantic-kernel-v1-0-1-has-arrived-to-help-you-build-agents/), is the better fit when you want planners and plugins inside an existing .NET application. My advice is to build the supervisor loop by hand once, as above, so you understand what any framework is doing for you, then adopt one when you need its conversation management rather than its abstractions. If retrieval is the main job, the self-correcting patterns in [agentic RAG](/blog/2024-01-08-agentic-rag-patterns/) often solve the problem without multiple agents at all.

## The decision in one line

Split an agent when its jobs need different tools, permissions or models, and keep the coordination as boring as possible: a fixed roster, a supervisor that plans, hard limits in code, and a log of every hand-off. If the workflow is predictable, skip the agents and write the pipeline.
