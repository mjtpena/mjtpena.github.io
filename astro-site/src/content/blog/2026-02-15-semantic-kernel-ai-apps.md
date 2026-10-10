---
title: "Semantic Kernel Apps in February 2026: Stay, Bridge, or Rewrite"
description: "Agent Framework is still in preview and Semantic Kernel is in fix-and-stabilise mode: how to decide whether to stay, bridge, or rewrite in February 2026."
author: Michael John Peña
draft: false
date: 2026-02-15
tags:
  - Semantic Kernel
  - AI Agents
  - .NET
  - Azure OpenAI
  - Migration
---

If you have a Semantic Kernel app in production, you've been living with an awkward question since October: Microsoft has named Agent Framework as the successor, but Agent Framework is still a preview. Rewriting now means building on an API that is still moving. Waiting means adding more code to a framework whose new features have mostly stopped. Neither is free, and the right answer depends on what your app actually uses.

## Where things stand on 15 February 2026

**Semantic Kernel is supported, not growing.** In the [Semantic Kernel and Microsoft Agent Framework](https://devblogs.microsoft.com/semantic-kernel/semantic-kernel-and-microsoft-agent-framework/) post from October 2025, the team said they'll keep fixing critical bugs and security issues and take some existing features to GA, but most new features will be built for Agent Framework. Support continues for at least a year after Agent Framework reaches GA. That's a long runway, but it starts on a date nobody has announced yet. Releases are still frequent: .NET 1.70.0 shipped on 23 January.

**Agent Framework is a public preview.** The .NET packages (`Microsoft.Agents.AI`, `Microsoft.Agents.AI.OpenAI` and friends) are on [`1.0.0-preview.260212.1`](https://www.nuget.org/packages/Microsoft.Agents.AI.OpenAI) as I write this, and the Python package is a beta. There's no release candidate and no GA date.

**The preview API is still changing week to week.** This is the part people underestimate. Here's how the "create a conversation" call in the official .NET samples changed across the preview builds since mid-December:

| Preview build | Create the agent | Start a conversation |
|---|---|---|
| `251219.1`, `260108.1` | `chatClient.CreateAIAgent(...)` | `agent.GetNewThread()` returning `AgentThread` |
| `260121.1` | `chatClient.AsAIAgent(...)` | `await agent.GetNewThreadAsync()` |
| `260127.1`, `260128.1` | `AsAIAgent(...)` | `await agent.GetNewSessionAsync()` returning `AgentSession` |
| `260205.1` onwards | `AsAIAgent(...)` | `await agent.CreateSessionAsync()` |

Four shapes for the same operation in about seven weeks. None of these changes are hard to apply. They're also the reason so many blog posts and Copilot suggestions written against earlier builds don't compile against the current one. If you start on Agent Framework now, pin the exact preview version and expect to spend time on every upgrade.

## What actually changes in your code

The [official migration guide](https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-semantic-kernel/) has the full mapping. These are the changes that matter for planning, because they decide how big your migration really is.

| Semantic Kernel | Agent Framework | Migration effort |
|---|---|---|
| `Kernel` with registered services | No kernel. The agent wraps an `IChatClient` from Microsoft.Extensions.AI | Low, but touches your DI setup |
| `ChatCompletionAgent`, `AzureAIAgent`, `OpenAIResponseAgent` | `ChatClientAgent` (via `AsAIAgent`) or a provider-specific extension | Low |
| `agent.InvokeAsync(...)` returning an async stream of items | `agent.RunAsync(...)` returning one `AgentResponse`, or `RunStreamingAsync(...)` returning `AgentResponseUpdate`s for streaming | Low |
| `ChatHistoryAgentThread` | `AgentSession` from the agent | Low |
| `[KernelFunction]` plugins | Plain methods wrapped with `AIFunctionFactory.Create`; no plugin concept required | Low to medium |
| Prompt templates and `KernelArguments` | No template engine on the agent; render the prompt yourself | Medium if you lean on templates |
| Function invocation filters | Middleware on the agent and on function calls | Medium; same ideas, different shape |
| `AgentGroupChat`, preview orchestrations | Workflows (`Microsoft.Agents.AI.Workflows`) | High; it's a redesign, not a rename |
| Vector store connectors | Keep them; they implement the `Microsoft.Extensions.VectorData` abstractions Agent Framework uses. You keep the `Microsoft.SemanticKernel.Connectors.*` packages for now, but they don't need a `Kernel` | Low |

A single agent with tools is a day of work, provided your plugins don't take a `Kernel` and you don't rely on filters or templates. A multi-agent orchestration is a new design, because Workflows model the flow as executors and edges rather than a group chat with a selection strategy. Code that relied heavily on Semantic Kernel's prompt templating or on filters for guardrails sits in between.

## The bridge: reuse your plugins first

The detail that makes a staged migration practical is that a Semantic Kernel `KernelFunction` is already a Microsoft.Extensions.AI `AIFunction`. Since Semantic Kernel moved onto the Microsoft.Extensions.AI abstractions, `KernelFunction` derives from `AIFunction`, so an Agent Framework agent can call your existing plugins without you rewriting them.

That lets you move the agent shell first and leave the tools (usually where the business logic and the tests live) untouched. Here's a complete console app that does exactly that, against the preview build current on this date. Every package is pinned to a version that was current on 15 February, so the sample keeps compiling as the previews move. `Azure.AI.OpenAI` has to be the `2.8.0-beta.1` build: `Microsoft.Agents.AI.OpenAI` `1.0.0-preview.260212.1` depends on `OpenAI` 2.8.0, and the latest stable `Azure.AI.OpenAI` (2.1.0) is built against `OpenAI` 2.1.0, which doesn't match.

```bash
dotnet new console -n OrdersAgent
cd OrdersAgent
dotnet add package Microsoft.Agents.AI.OpenAI --version 1.0.0-preview.260212.1
dotnet add package Azure.AI.OpenAI --version 2.8.0-beta.1
dotnet add package Azure.Identity --version 1.17.1
dotnet add package Microsoft.SemanticKernel --version 1.70.0
```

```csharp
using System.ComponentModel;
using Azure.AI.OpenAI;
using Azure.Identity;
using Microsoft.Agents.AI;
using Microsoft.SemanticKernel;
using OpenAI.Chat;

// The existing Semantic Kernel plugin, unchanged.
KernelPlugin orders = KernelPluginFactory.CreateFromType<OrdersPlugin>("Orders");

AIAgent agent = new AzureOpenAIClient(
        new Uri("https://<your-resource-name>.openai.azure.com/"),
        new DefaultAzureCredential())
    .GetChatClient("<your-chat-deployment>")
    .AsAIAgent(
        name: "OrderSupport",
        instructions: """
            You answer questions about customer orders.
            Use the Orders tools to look up facts. Never guess an order status.
            If a tool returns no data, say so plainly.
            """,
        tools: [.. orders]); // KernelFunction is an AIFunction, so the plugin's functions are tools as-is

AgentSession session = await agent.CreateSessionAsync();

foreach (string question in new[] { "Where is order 1001?", "And order 1002?" })
{
    AgentResponse response = await agent.RunAsync(question, session);
    Console.WriteLine($"> {question}\n{response.Text}\n");
}

public sealed class OrdersPlugin
{
    [KernelFunction, Description("Gets the current status of an order by its ID.")]
    public string GetOrderStatus([Description("The order ID, for example 1001.")] string orderId) =>
        orderId switch
        {
            "1001" => "Shipped on 12 February, arriving 17 February.",
            "1002" => "Awaiting payment confirmation.",
            _ => "No order found with that ID."
        };
}
```

`DefaultAzureCredential` is fine on a developer machine. In Azure, use a managed identity credential explicitly so the app doesn't probe every credential source on startup.

Two caveats with the bridge. First, a plugin function that takes a `Kernel` parameter or calls other kernel services will resolve a `Kernel` from the agent's service provider (the `services:` parameter of `AsAIAgent`) if one is registered there; otherwise it gets a new, empty `Kernel` built on that provider. Attach one explicitly, for example `tools: [.. orders.Select(f => f.WithKernel(kernel))]`. Check for that before you rely on it. Second, this is a transition state, not a destination. Once the agent shell is stable, replace `[KernelFunction]` with plain methods registered through `AIFunctionFactory.Create` and drop the Semantic Kernel core reference (the vector store connector packages can stay until their replacements settle).

## My call, by situation

**Single agent with tools, in production, working.** Stay on Semantic Kernel for now. Keep your plugin classes free of `Kernel` dependencies so they bridge cleanly, and plan the move for after Agent Framework reaches a release candidate. Migrating a working production app onto a preview with this rate of change buys you nothing a customer will notice.

**New app starting this month, shipping mid-year or later.** Start on Agent Framework, pin the preview version, and budget for API churn. Starting on Semantic Kernel today means a guaranteed migration later on top of the work you're doing now. The one exception: if your organisation won't let preview packages near production and you need to ship before GA, build on Semantic Kernel's GA surface and design for the move.

**Multi-agent orchestration on `AgentGroupChat` or the preview orchestrations.** You were already on experimental or preview APIs, so stability isn't an argument for staying. But this is the expensive migration, so don't do it twice. Prototype the same flow in Workflows on a branch and only cut over when the Workflows API settles.

**Heavy use of prompt templates (Handlebars or Liquid).** This is where I'd slow down. Agent Framework doesn't carry Semantic Kernel's template engine on the agent, so you'll need to render prompts yourself. If templating is central to how your app works, keep that layer on Semantic Kernel the longest.

**Python teams.** The same reasoning applies. The Python package (`agent-framework`) is a beta whose API is also still changing; it ships dated beta builds (`1.0.0b260212` as of 13 February). Pin it the same way.

## Prove it behaves the same before you cut over

Whichever path you take, don't switch on a code review alone. Record a set of real prompts with their expected tool calls, run them through the Semantic Kernel agent and the Agent Framework agent, and compare the tool-call sequences, the outputs and the token usage side by side. This is harder than it sounds, because the logging and guardrails you hung off Semantic Kernel filters now live in Agent Framework middleware, so port that instrumentation first or you'll be comparing two systems that see different things. For a multi-agent flow, run the same recorded conversations through the group chat and the Workflow and expect differences in turn order before you see differences in answers.

## When not to migrate at all yet

Don't migrate because a framework is newer. Migrate when it removes a cost you're paying. The honest reasons to move now are: you need something only Agent Framework has (Workflows with checkpointing, hosting adapters, the A2A and AG-UI integrations), or you're starting fresh and the preview risk is cheaper than a second rewrite.

If none of those apply, the best work you can do this quarter is unglamorous: get your Semantic Kernel tools into small, dependency-free classes with tests, put your guardrail logic somewhere you can lift out of filters, and track the [Agent Framework repository](https://github.com/microsoft/agent-framework) for the release candidate. When it lands, the move becomes a mechanical exercise instead of a rewrite.

If you want the background first, see [The Microsoft Agent Framework: What You Need to Know](/blog/2026-02-15-microsoft-agent-framework/) for how its pieces fit, and [Semantic Kernel Agents in Production: What's Stable, What Isn't](/blog/2026-01-13-semantic-kernel-agents/) for which Semantic Kernel APIs are safe to run today.
