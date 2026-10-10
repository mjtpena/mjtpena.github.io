---
title: "Harness Agent or Plain Agent? What Agent Framework Now Decides for You"
description: "The Agent Framework Harness bundles planning, memory, compaction, approvals and telemetry. When to accept its opinions and when a plain Agent is better."
author: Michael John Peña
draft: false
date: 2026-07-29
tags:
  - AI Agents
  - Architecture
  - Python
  - .NET
  - Observability
---

In the week of 21 July Microsoft [announced the Agent Framework Harness as released](https://devblogs.microsoft.com/agent-framework/the-microsoft-agent-framework-harness-is-now-released/): `create_harness_agent` in Python and `HarnessAgent` (or `AsHarnessAgent()` on any `IChatClient`) in .NET. It wraps a chat client in an opinionated runtime that decides how your agent loops, plans, remembers, trims its context, asks for approval and reports telemetry. That is a lot of design decisions made on your behalf, and the real question for anyone shipping agents is which of those decisions you should accept and which you should keep for yourself.

My short answer: most line-of-business agents should take the harness and switch off what they don't need. A smaller set of agents, those with tight latency budgets, state that lives somewhere else, or approval flows a regulator will read, are better off on the plain `Agent` (Python) or `ChatClientAgent` (.NET) with only the pieces they choose.

## What the harness actually assembles

The harness is not a new runtime underneath. In Python, `create_harness_agent` returns an ordinary `Agent` with a pre-built list of context providers and middleware. In .NET, `HarnessAgent` is a `DelegatingAIAgent` over the same building blocks: function invocation, per-service-call history persistence and the provider pipeline. That matters for the decision, because "plain agent" doesn't mean giving up these capabilities. It means you compose them yourself.

Here is what you get as of `agent-framework-core` 1.12 (21 July) and `Microsoft.Agents.AI.Harness` 1.14/1.15 (21–22 July), the first non-preview harness package. The [Agent Harness concept page](https://learn.microsoft.com/en-us/agent-framework/concepts/harness) covers the same ground.

| Capability | Default | Notes |
|---|---|---|
| Tool-calling loop | On | Function invocation, with history persisted after every model call, not only at the end of a run |
| Planning | On | A todo provider plus a plan/execute mode provider |
| File memory | On | File-based session memory; defaults to an `agent-file-memory` folder under the working directory |
| Compaction | Off unless sized | Only wired when you pass context-window and output token limits (or your own strategy) |
| Tool approval | On | "Don't ask again" standing rules plus optional auto-approval heuristics |
| Web search | On | Python adds it only if the client implements `SupportsWebSearchTool` (`FoundryChatClient` does); .NET always adds a `HostedWebSearchTool` unless `DisableWebSearch` is set |
| Skills | .NET on, Python opt-in | Python only adds a skills provider when you pass `skills_paths` or a provider |
| OpenTelemetry | On | Python's `Agent` already carries the telemetry layer and the harness names the provider; .NET adds the OpenTelemetry decorator |
| Background agents, file access, looping, shell | Opt-in | Experimental or pre-release (see below) |

Two defaults deserve attention before you go anywhere near production. First, web search: the Foundry client's own documentation notes that its Bing-backed web grounding sends search data outside the Azure compliance boundary. An internal claims or HR agent that quietly gains public web search is a data-handling decision nobody signed off. Second, file memory writes to local disk relative to the process's working directory. That's fine on a laptop and wrong in a container that scales out or restarts, so either disable it or accept that replacing its store means implementing `AgentFileStore` (Python) or setting `FileMemoryStore` (.NET), both still marked experimental.

## Why I'd accept the opinions for most line-of-business agents

The bulk of agents I see proposed inside organisations are some variation of "look things up across a few systems, draft something, and ask a human before changing anything". For that shape of work, the harness defaults are close to what a careful team would build by hand, and they're harder to get wrong when someone else has written and tested them.

Per-service-call persistence is the quiet win. A plain agent loop that only saves history at the end of a run loses everything if the process dies midway through a ten-tool-call task. The harness persists after each model call, so a crash leaves you with a recoverable session instead of a half-finished side effect and no record of it. I covered why this kind of explicit state matters in [where agent systems break](/blog/2026-04-24-where-agent-systems-break-state-handling-patterns-that-reduce-agent-confusion/).

The plan/execute split is the other one. Having the agent produce a todo list in plan mode, get it confirmed, then work through it in execute mode gives users something to approve before anything happens, and gives you a trace that reads like a work log rather than a stream of tool calls. Teams building this themselves tend to bolt it on after the first incident.

Compaction is useful but not automatic. If you don't pass `max_context_window_tokens` and `max_output_tokens` (or `MaxContextWindowTokens` and `MaxOutputTokens` in .NET), compaction stays off and a long tool loop can still overflow the context window. The [compaction docs](https://learn.microsoft.com/en-us/agent-framework/concepts/agents/conversations/compaction) explain the strategies. One .NET-specific wrinkle: those compaction properties on `HarnessAgentOptions` still carry the `MAAI001` experimental diagnostic even though `HarnessAgent` itself is released, so your build will tell you to suppress a warning to size the window.

A typical line-of-business setup in Python looks like this. It accepts the loop, persistence, planning, approvals and telemetry, sizes compaction, and turns off the defaults that don't belong in an internal agent.

```python
# pip install agent-framework-foundry azure-identity
# Requires FOUNDRY_PROJECT_ENDPOINT and FOUNDRY_MODEL, plus `az login`.
# If you re-enable web search, FOUNDRY_MODEL must be an Azure OpenAI deployment.
import asyncio
from typing import Annotated

from agent_framework import create_harness_agent, tool
from agent_framework.foundry import FoundryChatClient
from azure.identity import AzureCliCredential
from pydantic import Field


@tool(approval_mode="never_require")  # read-only lookup; write tools should use "always_require"
def get_invoice_status(
    invoice_id: Annotated[str, Field(description="The invoice number, e.g. INV-1042.")],
) -> str:
    """Return the payment status of an invoice."""
    return f"Invoice {invoice_id} is approved and scheduled for payment on Friday."


async def main() -> None:
    agent = create_harness_agent(
        client=FoundryChatClient(credential=AzureCliCredential()),
        name="accounts-payable-assistant",
        agent_instructions="You help finance staff answer questions about supplier invoices.",
        tools=[get_invoice_status],
        max_context_window_tokens=128_000,  # enables compaction
        max_output_tokens=16_384,
        disable_web_search=True,   # internal data only
        disable_file_memory=True,  # no local-disk memory in a scaled-out host
    )

    # Tool approval is on by default, so runs need a session to hold its state.
    session = agent.create_session()
    response = await agent.run("What's the status of invoice INV-1042?", session=session)
    print(response.text)


if __name__ == "__main__":
    asyncio.run(main())
```

In .NET the equivalent is options on the extension method. This is a fragment, assuming `chatClient` is an `IChatClient` you have already built. Unlike Python, .NET turns the skills provider on by default and discovers `SKILL.md` files from the working directory, which is the same local-disk concern as file memory, so I switch it off too:

```csharp
// dotnet add package Microsoft.Agents.AI.Harness  (using Microsoft.Agents.AI; using Microsoft.Extensions.AI;)
#pragma warning disable MAAI001 // compaction sizing is still marked experimental
AIAgent agent = chatClient.AsHarnessAgent(new HarnessAgentOptions
{
    Name = "accounts-payable-assistant",
    ChatOptions = new ChatOptions
    {
        Instructions = "You help finance staff answer questions about supplier invoices.",
    },
    MaxContextWindowTokens = 128_000,
    MaxOutputTokens = 16_384,
    DisableWebSearch = true,
    DisableFileMemory = true,
    DisableAgentSkillsProvider = true, // .NET discovers skills from the working directory by default
});
```

## When I'd stay on the plain Agent

The harness's costs are not bugs. They are the price of its opinions, and some agents can't afford that price.

### Strict latency budgets

Every default provider adds something to every model call. The todo and mode providers inject state and instructions, file memory injects a memory index, and the default harness instructions explicitly tell the model to explain its reasoning between tool calls. That's good behaviour for an assistant a person is watching; it's extra prompt and output tokens for a classification step, a routing agent, or anything sitting in a synchronous API with a hard p95. Per-call history persistence also means a write after every model call rather than one at the end.

If you've set a budget per user journey, as I argued in [setting latency budgets per user journey](/blog/2026-04-26-practical-ai-performance-tuning-setting-latency-budgets-per-user-journey/), you need to know exactly what's in the prompt. A plain `Agent` with one or two tools and your own instructions is easier to reason about than a harness with five providers disabled.

### Your state already has a home

The harness keeps its state in the agent session and, by default, an in-memory history provider plus file memory. That's sensible when the conversation *is* the state. It's a problem when the real state is a case record, a ticket, or a loan application in your own database. You then have two sources of truth: the domain record, and the agent's todo list and memory notes about that record. When they disagree, the agent will act on its own notes.

For agents like that, I'd rather use a plain agent with a custom context provider that reads the domain record at the start of each run and writes changes back through tools, so there is exactly one place the truth lives.

### Approval flows a regulator will read

The harness's approval model is designed for convenience: a user can choose "always approve", which becomes a standing rule in session state, and you can add heuristic auto-approval rules. The built-in file-access auto-approval rules (`FileAccessProvider.read_only_tools_auto_approval_rule` and `all_tools_auto_approval_rule`) approve local calls by tool name only, and their docstrings warn that any other tool registered under a reserved name such as `file_access_read` is auto-approved too.

To be fair, the standing rules are narrower than they sound. In Python they come in two scopes, tool-wide or tool plus exact arguments (`create_always_approve_tool_with_arguments_response`), and .NET binds each approval response to exactly the call that was surfaced unless you set `DisableApprovalResponseBinding`. Both stop an approval being replayed against a different call. Neither records who approved, nor gives you a two-person sign-off.

In a regulated process, an approval usually needs a named approver, a timestamp, the exact arguments approved, and sometimes a second person. "Don't ask again" is the opposite of that. You can keep the harness and set `disable_tool_auto_approval=True` (or `DisableToolAutoApproval`), but at that point I'd rather start from a plain agent, mark every side-effecting tool `approval_mode="always_require"`, and handle each approval request through the workflow system that already records sign-offs. The [human-in-the-loop approval docs](https://learn.microsoft.com/en-us/agent-framework/agents/tools/tool-approval) show that pattern on the basic agent.

## The experimental line: treat it as not production-ready

The harness itself is released, but four of the capabilities it can wire in are not:

- **Background agents** (`background_agents`, `BackgroundAgents`): delegating work to sub-agents that run concurrently.
- **File access** (`file_access_store`, `FileAccessStore`): read and write tools over a working folder.
- **Looping** (`loop_should_continue` in Python, `LoopEvaluators` and `LoopAgent` in .NET): re-running the agent until a predicate or judge is satisfied.
- **Shell tooling** (`shell_executor`): command execution from the pre-release `agent-framework-tools` package. The .NET harness dropped its shell dependency entirely when it graduated.

The file-store abstraction behind file memory is also experimental: in Python 1.12 importing the harness raises a `[HARNESS]` `ExperimentalWarning` for `AgentFileStore`, and .NET marks `FileMemoryStore` with `MAAI001`. Filter that one warning by message, not globally.

Python emits an `ExperimentalWarning` naming the parameter when you enable any of the four; .NET marks the types and options with `MAAI001`. I treat both signals literally. These APIs can change without notice, and three of the four widen the trust boundary: a background agent's output flows back into the parent's context, file access touches real files, and a shell is a shell. Use them in prototypes and internal tools where a breaking change costs an afternoon. Don't put them behind a customer-facing or regulated workload until they graduate, and don't suppress the warnings globally to make a build go green.

## How I'd decide

Start from the harness when the agent is conversational, multi-step, watched by a person, and its state can reasonably live in the session. Size compaction, disable web search unless public grounding is a deliberate choice, move or disable file memory, and leave the experimental parameters unset.

Start from the plain `Agent` or `ChatClientAgent` when a latency budget is measured in hundreds of milliseconds, when a domain system already owns the state, or when every approval must be individually recorded. You lose nothing permanent: the harness is built from the same parts, and you can add per-call persistence, compaction or OpenTelemetry one piece at a time. If you're new to the framework itself, my [Agent Framework overview](/blog/2026-02-15-microsoft-agent-framework/) covers the basics.

The harness is a good set of defaults. Treat it as a starting configuration you review line by line, not a runtime you adopt wholesale.
