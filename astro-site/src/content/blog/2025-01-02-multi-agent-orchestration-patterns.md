---
title: "Multi-Agent Orchestration: Pick the Pattern Before the Framework"
description: "Four multi-agent orchestration patterns, what Semantic Kernel, AutoGen 0.4 and Azure AI Agent Service offered for each in January 2025, and when to skip them."
author: Michael John Peña
draft: false
date: 2025-01-02
tags:
  - AI Agents
  - Multi-Agent
  - Semantic Kernel
  - AutoGen
  - Architecture
---

Most multi-agent designs I review start with a framework choice and end up with a group chat of five agents that nobody can debug. The orchestration pattern decides your cost, latency, failure modes and how you test the system, and you should choose it before you pick a library. As 2025 starts, the Microsoft stack gives you several ways to build these systems, but none of them is stable yet, so it pays to know which parts are settled and which are still experimental.

I covered the general building blocks in [Multi-Agent Frameworks: Orchestrating AI Agent Collaboration](/blog/2024-11-11-multi-agent-framework/) and production plumbing in [Agent Orchestration Patterns for Production](/blog/2024-05-24-agent-orchestration-patterns/). This post is narrower. It covers which pattern to choose, what each one costs you, and what you could actually use in January 2025.

## Start by asking whether you need more than one agent

A single agent with well-described tools is still the right answer most of the time. Every extra agent adds model calls, a hand-off that can lose context, and another prompt that can drift. I only reach for multiple agents when at least one of these is true:

- **The instructions conflict.** A writer that should be creative and a reviewer that should be pedantic work badly as one system prompt.
- **The tool sets need different permissions.** An agent that can run SQL against production shouldn't share a context with one that browses the web.
- **The context won't fit.** Each specialist only needs its own slice of the documents and tool schemas.
- **You want an independent check.** A second model call that critiques the first catches a class of errors that self-reflection misses.

If none of these apply, splitting the work just spreads one problem across more prompts. Start with one agent and a good tool list, and split it only when you can name the reason.

## The four patterns that matter

Strip away the framework vocabulary and most designs reduce to four shapes.

| Pattern | Who decides the next step | Best for | Main risk |
|---|---|---|---|
| Sequential pipeline | Your code, fixed order | Repeatable multi-stage work | Errors in one stage carry into the next |
| Maker-checker loop | Your code, alternating | Output that needs review before use | Loops that never converge |
| Router / orchestrator | An LLM picks the next agent | Varied requests, open-ended tasks | Unpredictable cost and paths |
| Hand-off (swarm-style) | The current agent transfers control | Conversational triage, customer service | Context lost at each transfer |

### Sequential pipeline

Extract, then transform, then summarise. Each agent gets the previous agent's output and a narrow instruction. This is the easiest pattern to test because you can assert on each stage's output, and you don't need an agent framework for it. A Python function that calls three chat completions in order is a perfectly good pipeline. If a stage doesn't need a model, replace it with ordinary code. It'll be cheaper and deterministic.

### Maker-checker loop

One agent produces and another critiques, and they alternate until the checker approves or you hit a turn limit. This is the pattern I'd recommend most for enterprise work. It maps to how teams already review things, and it puts a quality gate in front of anything that leaves the system. The two non-negotiables are an explicit approval signal and a hard iteration cap.

### Router / orchestrator

An orchestrator model reads the conversation and decides which specialist acts next. This is the most flexible pattern and the most expensive, because every turn costs an extra model call just for the routing decision. Microsoft Research's [Magentic-One](https://www.microsoft.com/en-us/research/articles/magentic-one-a-generalist-multi-agent-system-for-solving-complex-tasks/) (November 2024) is the most complete public example. Its Orchestrator keeps a task ledger (facts, guesses and the plan) and a progress ledger (is the task done, who goes next), and replans when progress stalls. Read it for the design, but treat that level of autonomy as research, not as a template for a line-of-business app.

### Hand-off

Each agent can transfer the conversation to another agent, usually through a function call. OpenAI's experimental Swarm library made this style popular in late 2024. It works well for triage, such as routing a support chat from a general agent to a billing agent. It works poorly when the receiving agent needs the full reasoning trail, because only what fits in the shared history survives the transfer.

## What the Microsoft stack offers in January 2025

Expect to deal with preview labels.

| Option | Status on 2 January 2025 | Patterns it supports directly |
|---|---|---|
| Semantic Kernel Agent Framework (Python 1.17.1, .NET) | `AgentGroupChat` and `ChatCompletionAgent` marked experimental | Maker-checker, router via a kernel-function selection strategy |
| AutoGen 0.4 AgentChat | Pre-release (`0.4.0.dev13`); 0.2 is still the stable line | Round-robin, selector (router), `Swarm` hand-off, `MagenticOneGroupChat` |
| Azure AI Agent Service | Public preview, announced at Ignite in November 2024 | Single hosted agents; you write the orchestration yourself |

**Semantic Kernel** is the one I'd pick for a .NET or Python team that already uses it. [`AgentGroupChat`](https://learn.microsoft.com/en-us/python/api/semantic-kernel/semantic_kernel.agents.group_chat.agent_group_chat.agentgroupchat) splits orchestration into two pluggable decisions. A *selection strategy* chooses who speaks next, and a *termination strategy* decides when to stop. That split is the right abstraction because it forces you to write the stop condition down. The classes are experimental, so pin the package version and expect breaking changes.

**AutoGen 0.4** is a ground-up rewrite on an asynchronous, event-driven core, and its AgentChat layer already ships ready-made teams for all four patterns. It's still a pre-release, though, and its API has changed between dev builds. I'd prototype with it, but I wouldn't put a 0.4 dev build into production this month.

**[Azure AI Agent Service](https://learn.microsoft.com/en-us/azure/ai-services/agents/)** hosts individual agents for you. It manages threads, tool execution such as code interpreter, file search and Bing grounding, and the state. It uses the same protocol as the Assistants API. It doesn't orchestrate several agents for you, so a multi-agent design on it means your code calls one agent, reads the result and decides which agent to call next. That's more work, but it's also the most auditable option, because the routing logic is code you can read.

## A maker-checker loop in Semantic Kernel

Here's the pattern I'd start with, written against `semantic-kernel==1.17.1`. A writer drafts T-SQL and a reviewer either lists problems or replies `APPROVED`. The selection strategy is deterministic round-robin. Only the reviewer can end the conversation, and six turns is the hard ceiling.

```python
import asyncio

from semantic_kernel import Kernel
from semantic_kernel.agents import AgentGroupChat, ChatCompletionAgent
from semantic_kernel.agents.strategies import SequentialSelectionStrategy
from semantic_kernel.agents.strategies.termination.termination_strategy import TerminationStrategy
from semantic_kernel.connectors.ai.open_ai import AzureChatCompletion
from semantic_kernel.contents import ChatMessageContent
from semantic_kernel.contents.utils.author_role import AuthorRole

WRITER = "Writer"
REVIEWER = "Reviewer"


class ApprovalTerminationStrategy(TerminationStrategy):
    """Stop when the reviewer's latest message contains APPROVED."""

    async def should_agent_terminate(self, agent, history):
        return "APPROVED" in (history[-1].content or "").upper()


def build_kernel(service_id: str) -> Kernel:
    # Reads AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY and
    # AZURE_OPENAI_CHAT_DEPLOYMENT_NAME from the environment.
    kernel = Kernel()
    kernel.add_service(AzureChatCompletion(service_id=service_id))
    return kernel


async def main() -> None:
    writer = ChatCompletionAgent(
        service_id=WRITER,
        kernel=build_kernel(WRITER),
        name=WRITER,
        instructions=(
            "You write T-SQL for Azure SQL Database. Return one query and a "
            "one-paragraph explanation. When given feedback, revise the query."
        ),
    )
    reviewer = ChatCompletionAgent(
        service_id=REVIEWER,
        kernel=build_kernel(REVIEWER),
        name=REVIEWER,
        instructions=(
            "You review T-SQL for correctness, sargable predicates and "
            "unbounded scans. List concrete problems. If there are none, "
            "reply with the single word APPROVED."
        ),
    )

    chat = AgentGroupChat(
        agents=[writer, reviewer],
        selection_strategy=SequentialSelectionStrategy(),
        termination_strategy=ApprovalTerminationStrategy(
            agents=[reviewer],      # only the reviewer can end the loop
            maximum_iterations=6,   # hard cap: three write/review rounds
        ),
    )

    await chat.add_chat_message(
        ChatMessageContent(
            role=AuthorRole.USER,
            content="Monthly revenue by region for 2024 from dbo.Orders "
            "(OrderDate, Region, Amount).",
        )
    )

    async for message in chat.invoke():
        print(f"## {message.name}\n{message.content}\n")

    print(f"Approved: {chat.is_complete}")


if __name__ == "__main__":
    asyncio.run(main())
```

Three details in that code matter more than the agent prompts:

- **`agents=[reviewer]` on the termination strategy.** Without it, a writer that happens to say "approved" in its explanation ends the loop early.
- **`maximum_iterations`.** The default is 99. If the agents never converge, that's 99 model calls on one request. Set the cap to the number of rounds you'd accept from a human reviewer.
- **`chat.is_complete`.** When the loop ends because it hit the cap, `is_complete` stays `False`. Treat that as a failure and escalate to a person. Don't ship the last draft.

The keyword check is crude, and a reviewer can write "not APPROVED" and still trigger it. For anything important, have the reviewer return structured output, such as a JSON verdict, and parse that instead of searching for a substring.

## The controls every pattern needs

Whichever pattern you pick, the same four controls decide whether it survives production:

1. **A stop condition you can explain.** You need an approval signal, a fixed number of stages or a router that is allowed to say "done". "The model will figure it out" isn't a stop condition.
2. **A budget per request.** Cap the turns and the tokens. LLM-based routing roughly doubles the calls per turn, so measure it before you commit.
3. **Traces per agent turn.** Log which agent ran, its input, its output and its token count. Without that you can't tell whether a bad answer came from the router or from a specialist. I wrote more about this in [Agent Observability](/blog/2024-10-11-agent-observability/).
4. **Least privilege per agent.** This is often the real reason to split agents in the first place. If the reviewer doesn't need database access, don't give its kernel the plugin.

## When not to use multi-agent orchestration

Skip it when the task is a fixed sequence that a workflow engine or plain code can run. Skip it when latency matters more than quality, because every turn adds a full model round trip. Skip it when you can't yet evaluate a single agent, because adding agents makes evaluation harder, not easier. And be careful with LLM routers in regulated processes, where you'll be asked to explain why step B followed step A. "The orchestrator decided" won't satisfy that question.

## Where I'd start

Default to one agent. When you can name a reason to split it, use a sequential pipeline or a maker-checker loop with deterministic turn order, an explicit approval signal and a hard cap. Move to a model-driven router only when the request types are too varied to route in code. At that point Semantic Kernel's selection strategies or AutoGen 0.4's selector team are worth evaluating, as long as you pin versions and accept that both are still experimental this month.
