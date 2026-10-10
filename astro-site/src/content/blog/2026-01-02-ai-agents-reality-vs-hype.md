---
title: "AI Agents in 2026: Where They Earn Their Keep and Where They Don't"
description: "A practitioner's reality check on AI agents going into 2026: the use cases that work, where they break, and how to pick a framework without the hype."
author: Michael John Peña
draft: false
date: 2026-01-02
tags:
  - AI
  - Agents
  - Microsoft Foundry
  - Architecture
  - Opinion
---

2025 was sold as the year of agents (my [year in review](/blog/2025-12-01-december-ai-topic/) covers it). The useful question for 2026 is why so many agent pilots haven't paid off. My answer is that most of them asked an agent to do a job that a workflow, a search index, or a single well-written prompt would have done better and cheaper.

So agent work this year should start by asking whether it needs an agent at all.

## What an agent actually is

An agent is a language model in a loop with four things around it:

- **Tools:** APIs, databases, search indexes, file systems, and increasingly MCP servers.
- **Memory:** conversation state plus some form of retrieval over longer-lived knowledge.
- **Planning:** the model decides which step comes next instead of following a fixed path.
- **Action:** it changes something in the world, not just produces text.

None of those parts is new. The interesting part is orchestration: who decides the next step, how state is carried between steps, and what happens when a step fails. When I review an agent design I read the orchestration before the prompt, because that's where the bugs and cost overruns come from.

My working definition is blunt: if the sequence of steps is known in advance, you don't need an agent. You need a workflow that calls a model at one or two points. Microsoft's own [Agent Framework overview](https://learn.microsoft.com/en-us/agent-framework/overview/) makes the same point, contrasting agents for open-ended, conversational tasks with workflows for well-defined steps, and advising you to write a function instead of an agent whenever a function will do.

## Where agents work well

I've deployed agents for four kinds of work. They share a constrained problem space, a human close by, and one design choice that makes each work.

**Code review automation.** Agents catch the obvious issues and draft fixes. The design detail is permissions: the agent posts review comments and suggested changes, and it can't push or merge. The value is a shorter first pass for the reviewer. Don't make it a merge gate: it usually reviews the diff with limited repository context, so it misses cross-service and architectural problems.

**Data pipeline monitoring.** An agent watching for anomalies, pulling the relevant logs, and proposing a likely root cause works because there are only so many ways a pipeline fails. Give it read-only tools (run history, logs, row counts) and put any remediation, such as a rerun or a backfill, behind an explicit approval step. A wrong diagnosis is cheap; a rerun against the wrong partition isn't.

**Documentation generation.** Scope retrieval to the repository, the team's conventions, and two or three examples of good existing docs, and have it open a pull request rather than writing to the wiki directly. Generated docs go stale when the code changes, so regenerate in CI on merge; if you can't, skip it.

**Customer support triage.** Routing tickets, gathering missing details, and suggesting articles is the most mature use case I know. Limit retrieval to the approved knowledge base, require a citation for every suggested article, and treat an answer without a citation as "route to a person". The agent prepares the case; a person closes it.

Notice what isn't on that list: an agent making an irreversible decision alone. The ones that work are boring and specific, and they augment a workflow rather than replace it.

## Where they still struggle

**Long reasoning chains in specialist domains.** Give an agent a multi-step problem that needs genuine domain expertise and it will often produce a confident, well-formatted, wrong answer. Errors compound: five steps at 90% accuracy each succeed together only about 59% of the time.

**State management.** Agents lose track of context, repeat tool calls, or contradict actions they took ten steps earlier. Memory and checkpointing help; keeping runs short helps more.

**Error recovery.** When a tool call fails or returns something unexpected, agents tend to retry the same approach rather than backtrack. Good recovery is something you design into the orchestration, for example by returning a structured error the model can read and capping retries per tool, not something you can prompt into existence.

**Cost.** A chatbot makes one model call per response. An agent can easily make twenty. Each one carries the growing conversation as input tokens, so cost grows faster than the step count. Your Azure OpenAI bill reflects the loop long before users notice any extra value.

## What successful deployments have in common

In my client work, the agent deployments that made it to production share the same traits.

1. **Narrow scope.** Don't build a general-purpose agent. Build one that does three things well and refuses everything else.
2. **Human in the loop at the points that matter.** Require approval before anything that sends, deletes, pays, or publishes.
3. **Testing that assumes creative failure.** Unit tests for tools, integration tests for flows, evaluation datasets for model behaviour, and red teaming for prompts.
4. **Observability from day one.** Every run, model call, and tool call should be a span in one trace. In production, the trace is the only way to find out why an agent misbehaved.
5. **Graceful degradation.** When the agent fails, it should fail safely: hand over to a person, return a clear message, and never leave data half-written.

I'd add a sixth that teams consistently skip: **a step and token budget per run.** Cap the number of loop iterations and the tokens spent, and treat hitting the cap as a handled outcome rather than an exception. It's the cheapest protection you can buy against runaway cost. Set each cap from the 95th percentile of steps and tokens in your evaluation runs, plus some headroom, rather than picking a round number.

### A step budget and a trace

Here are traits 4 and 6 in a plain function-calling loop, using the `openai` Python SDK against the Azure OpenAI v1 API and the Azure Monitor OpenTelemetry distro to send spans to Application Insights. It authenticates with Microsoft Entra ID, not an API key, so each agent can run under its own managed identity. The tool is a read-only stub for pipeline monitoring.

```python
# pip install "openai>=1.106" azure-identity azure-monitor-opentelemetry
import json
import os

from azure.identity import DefaultAzureCredential, get_bearer_token_provider
from azure.monitor.opentelemetry import configure_azure_monitor
from openai import OpenAI
from opentelemetry import trace

# Export OpenTelemetry spans to Application Insights.
configure_azure_monitor(
    connection_string=os.environ["APPLICATIONINSIGHTS_CONNECTION_STRING"]
)
tracer = trace.get_tracer("pipeline-triage-agent")

# Entra ID auth: one identity per agent shows up in the audit log.
token_provider = get_bearer_token_provider(
    DefaultAzureCredential(), "https://cognitiveservices.azure.com/.default"
)
# The v1 API needs no api_version; the token provider refreshes tokens itself.
client = OpenAI(
    base_url="https://<your-resource-name>.openai.azure.com/openai/v1/",
    api_key=token_provider,
)
DEPLOYMENT = "<your-deployment-name>"
MAX_STEPS = 8
MAX_TOKENS = 40_000


def get_pipeline_logs(run_id: str) -> str:
    """Read-only tool. Replace the stub with a query against your log store."""
    return json.dumps({"run_id": run_id, "status": "failed",
                       "error": "Timeout reading source table"})


TOOL_FUNCTIONS = {"get_pipeline_logs": get_pipeline_logs}
TOOLS = [{
    "type": "function",
    "function": {
        "name": "get_pipeline_logs",
        "description": "Read the logs for one pipeline run.",
        "parameters": {
            "type": "object",
            "properties": {"run_id": {"type": "string"}},
            "required": ["run_id"],
        },
    },
}]


def run_agent(question: str) -> dict:
    messages = [
        {"role": "system", "content": "You diagnose failed pipeline runs. "
         "Read logs with the tools and propose a likely root cause. "
         "You cannot change anything."},
        {"role": "user", "content": question},
    ]
    tokens_used = 0
    with tracer.start_as_current_span("agent.run") as run_span:
        for step in range(1, MAX_STEPS + 1):
            with tracer.start_as_current_span("agent.step") as span:
                response = client.chat.completions.create(
                    model=DEPLOYMENT, messages=messages, tools=TOOLS
                )
                tokens_used += response.usage.total_tokens
                span.set_attribute("agent.step", step)
                span.set_attribute("agent.tokens_used", tokens_used)
                message = response.choices[0].message

                if not message.tool_calls:
                    run_span.set_attribute("agent.outcome", "answered")
                    return {"outcome": "answered", "answer": message.content,
                            "steps": step, "tokens": tokens_used}
                # Stop before running tools whose results no model call would read.
                if step == MAX_STEPS or tokens_used >= MAX_TOKENS:
                    break

                messages.append(message)
                for call in message.tool_calls:
                    with tracer.start_as_current_span("agent.tool_call") as tool_span:
                        tool_span.set_attribute("agent.tool", call.function.name)
                        func = TOOL_FUNCTIONS.get(call.function.name)
                        try:
                            if func is None:
                                raise ValueError(f"unknown tool {call.function.name}")
                            result = func(**json.loads(call.function.arguments))
                        except Exception as exc:  # bad JSON, wrong args, tool failure
                            # Give the model a readable error instead of crashing the run.
                            tool_span.record_exception(exc)
                            result = json.dumps({"error": str(exc)})
                    messages.append({"role": "tool", "tool_call_id": call.id,
                                     "content": result})

        # Budget exhausted: a handled outcome, routed to a person.
        run_span.set_attribute("agent.outcome", "budget_exceeded")
        return {"outcome": "budget_exceeded", "steps": step, "tokens": tokens_used}


if __name__ == "__main__":
    print(run_agent("Why did pipeline run <your-run-id> fail?"))
```

The pieces worth copying are the `budget_exceeded` outcome, which your calling code routes to a person instead of raising; the structured error the model can read when a tool call fails; and the span per step and tool call, which lets you query Application Insights for runs that hit the cap. Frameworks do this with less code: Agent Framework emits OpenTelemetry traces, and Foundry Agent Service shows agent traces once you connect an Application Insights resource to the project.

## Choosing a framework in January 2026

Here's how I see the main options after a busy late 2025.

| Option | Status now | Where it fits | Watch out for |
|---|---|---|---|
| Foundry Agent Service (Microsoft Foundry) | Core service GA (Build, May 2025); new Ignite 2025 capabilities such as hosted and workflow agents in preview | Managed agents with Azure identity, tools, and tracing | Platform names and portal experiences are still settling |
| Microsoft Agent Framework | Public preview (October 2025) | New .NET or Python agent and workflow code on Microsoft's stack | Preview APIs can change before 1.0 |
| Semantic Kernel | Stable, supported | Existing SK applications | New feature work is heading to Agent Framework |
| AutoGen | Bug fixes and critical security patches only | Existing AutoGen research code | No new features; plan migration to Agent Framework |
| LangGraph | 1.0 since October 2025 | Explicit, stateful graphs with fine control | Steeper learning curve; you own more of the hosting |

**Foundry Agent Service.** The service went GA at Build in May 2025, when the platform was still Azure AI Foundry; Ignite renamed it Microsoft Foundry. The GA label covers the original service, not every preview shown in the keynote. The [Foundry Agent Service overview](https://learn.microsoft.com/en-us/azure/foundry/agents/overview) is the place to start.

**When not to use the managed service.** If the agent has to run across clouds, on-premises, or in a region the service doesn't support, or if even the standard agent setup, which keeps threads in your own Cosmos DB account, doesn't satisfy your data-residency rules (for example, the data can't leave on-premises), a code-first framework such as LangGraph or Agent Framework in your own containers fits better. You take on more operations work in exchange for control over where every thread lives.

**Agent Framework, Semantic Kernel, and AutoGen.** Microsoft announced [Agent Framework in public preview](https://devblogs.microsoft.com/dotnet/introducing-microsoft-agent-framework-preview/) on 1 October 2025 as the successor that brings Semantic Kernel and AutoGen together. At the same time, Microsoft said AutoGen will now get only bug fixes and critical security patches ([announcement](https://github.com/microsoft/autogen/discussions/7066), [AutoGen README](https://github.com/microsoft/autogen)), so new projects that would have started on AutoGen should start on Agent Framework instead. If you have a working Semantic Kernel application, there's no reason to rewrite it this month. For new work on Microsoft's stack that can tolerate preview APIs, I'd start on Agent Framework and expect some churn before it stabilises. I covered the older approach in [Semantic Kernel: Orchestrating AI Agents with Plugins and Planners](/blog/2025-11-13-november-ai-topic/).

**LangGraph.** It's powerful for complex, stateful workflows and shipped 1.0 on 17 October 2025, which settles the breaking-change worry. The trade-off is more code and more decisions you own.

**MCP.** The Model Context Protocol has become the default way to expose tools to agents across vendors, and in December 2025 it moved to the [Agentic AI Foundation under the Linux Foundation](https://blog.modelcontextprotocol.io/posts/2025-12-09-mcp-joins-agentic-ai-foundation/). Neutral governance says nothing about any individual server. My rule is to allow only first-party MCP servers from the vendor whose system they front, or ones we build internally; pin each to a specific version, review its tool list and permissions before every upgrade, and run it under an identity scoped to the data it actually needs.

My advice hasn't changed: build your first agent with plain function calling, like the loop above, before you adopt any framework. Once you've handled a failed tool call and watched the token count grow, you'll know which parts of a framework you need.

## The hard part isn't the model

Integration, not model capability, is where organisations struggle. Identity, data access, and legacy APIs eat the schedule, because an agent is only as useful as the systems it can reach, each with its own permission model.

Security is the sharpest version of that problem: what is an agent allowed to do, and on whose behalf? Microsoft Entra Agent ID (in preview) is the first serious attempt at agent identity, but most organisations haven't designed agent permissions yet. Until they do, the safe default is the one from the use cases above: read-only tools, a person approving every write, and a separate identity per agent so the audit log tells you which one acted.

## Deciding whether your problem needs an agent

Before you commit to an agent, run through three questions.

1. **Can you write the steps down?** If yes, build a workflow with model calls at specific points. It will be cheaper, faster, and easier to test.
2. **What's the worst action it could take?** If that action is irreversible or customer-facing, put a person in front of it, or don't give the agent that tool.
3. **How will you know it's working?** If you can't define an evaluation set and a business metric before you start, you're building a demo, not a product.

Agents prepare decisions well and replace judgement badly. If your answer to question 1 is yes, don't build an agent this quarter. Build the workflow, measure it, and come back when you hit a step you genuinely can't write down.
