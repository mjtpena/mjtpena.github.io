---
title: "Semantic Kernel Agents in Production: What's Stable, What Isn't"
description: "Running Semantic Kernel agents in production in early 2026: which APIs are GA, which are preview, how to guard tool calls, and where Agent Framework fits."
author: Michael John Peña
draft: false
date: 2026-01-13
tags:
  - Semantic Kernel
  - AI Agents
  - .NET
  - Azure OpenAI
  - Multi-Agent
---

Semantic Kernel agents are easy to demo. Coming from LangChain, AutoGen, and hand-rolled agent loops, I find the hard part is knowing which pieces are stable enough to put behind a production SLA, and which tool calls you should never let a model make unsupervised. That question got harder in October 2025, when Microsoft announced Agent Framework as Semantic Kernel's successor, so this post is about building on Semantic Kernel agents today without boxing yourself in.

I covered the multi-agent design side in [Building Multi-Agent Systems with Semantic Kernel](/blog/2025-08-31-august-ai-topic/). This one is about production readiness: status, guardrails, observability, and the exit plan.

## What's stable as of January 2026

Before writing any code, check the release status of every package you'll depend on. Semantic Kernel's .NET packages carry a `-preview` or `-alpha` suffix, or an `[Experimental]` attribute (with an `SKEXP` diagnostic code) when an API can still change. As of Semantic Kernel .NET 1.68.0 (released early December 2025), this is where things sit:

| Piece | Package | Status |
|---|---|---|
| `ChatCompletionAgent`, `ChatHistoryAgentThread` | `Microsoft.SemanticKernel.Agents.Core` | GA |
| Plugins, function calling, filters | `Microsoft.SemanticKernel` | GA |
| `AgentGroupChat` | `Microsoft.SemanticKernel.Agents.Core` | Experimental (`SKEXP0110`), superseded |
| Sequential, Concurrent, Handoff, Group Chat orchestrations | `Microsoft.SemanticKernel.Agents.Orchestration` | Preview |
| Magentic orchestration | `Microsoft.SemanticKernel.Agents.Magentic` | Preview |
| In-process agent runtime | `Microsoft.SemanticKernel.Agents.Runtime.InProcess` | Preview |
| `ISemanticTextMemory` and the old memory stores | `Microsoft.SemanticKernel.Abstractions` | Experimental, superseded by vector store connectors |

The practical rule I follow: the agent itself, its plugins, and its filters can carry a production workload. Multi-agent orchestration is experimental and ships as preview packages, so it goes behind a feature flag or into internal tools until it stabilises.

## A single agent with narrow tools

Most production agents I'd sign off on are a single `ChatCompletionAgent` with a small number of narrow, typed tools. Here's a complete console app against Azure OpenAI, using Microsoft Entra ID authentication instead of an API key.

```bash
dotnet add package Microsoft.SemanticKernel
dotnet add package Microsoft.SemanticKernel.Agents.Core
dotnet add package Azure.Identity
```

```csharp
using System.ComponentModel;
using Azure.Identity;
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.Agents;

IKernelBuilder builder = Kernel.CreateBuilder();
builder.AddAzureOpenAIChatCompletion(
    deploymentName: "<your-chat-deployment>",
    endpoint: "https://<your-resource-name>.openai.azure.com/",
    credentials: new DefaultAzureCredential());
builder.Plugins.AddFromType<OrdersPlugin>("Orders");
Kernel kernel = builder.Build();

ChatCompletionAgent agent = new()
{
    Name = "OrderSupport",
    Instructions = """
        You answer questions about customer orders.
        Use the Orders tools to look up facts. Never guess an order status.
        If a tool returns no data, say so plainly.
        """,
    Kernel = kernel,
    Arguments = new KernelArguments(new PromptExecutionSettings
    {
        FunctionChoiceBehavior = FunctionChoiceBehavior.Auto()
    })
};

AgentThread thread = new ChatHistoryAgentThread();

foreach (string question in new[] { "Where is order 1001?", "And order 1002?" })
{
    await foreach (AgentResponseItem<ChatMessageContent> response in agent.InvokeAsync(question, thread))
    {
        Console.WriteLine($"{response.Message.AuthorName}: {response.Message.Content}");
        thread = response.Thread;
    }
}

public sealed class OrdersPlugin
{
    private static readonly Dictionary<string, string> Orders = new()
    {
        ["1001"] = "Shipped on 8 January, tracking AU123456",
        ["1002"] = "Awaiting stock, expected dispatch 20 January"
    };

    [KernelFunction("get_order_status")]
    [Description("Gets the current status of a single order by its order number.")]
    public string GetOrderStatus(
        [Description("The order number, digits only.")] string orderId) =>
        Orders.TryGetValue(orderId, out string? status)
            ? status
            : $"No order found with number {orderId}.";
}
```

An earlier version of this post showed a `QuerySalesData(string query)` tool that runs model-written SQL after a `StartsWith("SELECT")` check. Don't. A string blocklist doesn't stop a `SELECT` that reads a table the user shouldn't see, and it doesn't stop a query that scans a billion rows. If an agent needs data, give it typed functions with parameters you validate, run them under an identity with read access to exactly what it needs, and keep free-form SQL for analysts.

## Guard the tool loop with a filter

With `FunctionChoiceBehavior.Auto()`, Semantic Kernel runs the model, executes the tool calls it asks for, feeds the results back, and repeats. That loop is where production incidents come from: a model that calls the same tool twenty times, or calls a write operation nobody approved.

[Filters](https://learn.microsoft.com/en-us/semantic-kernel/concepts/enterprise-readiness/filters) are the GA way to intercept it. An `IAutoFunctionInvocationFilter` sees every automatic tool call before it runs, so it's the right place for logging, a call budget, and approval gates.

```csharp
using Microsoft.Extensions.Logging;
using Microsoft.SemanticKernel;

public sealed class ToolGuardFilter(ILogger<ToolGuardFilter> logger) : IAutoFunctionInvocationFilter
{
    private const int MaxModelRoundTrips = 5;
    private static readonly HashSet<string> RequiresApproval = ["cancel_order", "issue_refund"];

    public async Task OnAutoFunctionInvocationAsync(
        AutoFunctionInvocationContext context,
        Func<AutoFunctionInvocationContext, Task> next)
    {
        string name = context.Function.Name;
        logger.LogInformation(
            "Tool call {Plugin}.{Function} (round trip {Round})",
            context.Function.PluginName, name, context.RequestSequenceIndex);

        if (context.RequestSequenceIndex >= MaxModelRoundTrips)
        {
            // No Terminate here: the model reads this result and writes the final answer.
            context.Result = new FunctionResult(context.Function,
                "Tool budget exhausted. Answer with the information you already have.");
            return;
        }

        if (RequiresApproval.Contains(name))
        {
            context.Result = new FunctionResult(context.Function,
                "This action needs human approval. Tell the user a request has been raised.");
            return;
        }

        await next(context);
    }
}
```

Register it on the kernel the agent uses, before invoking the agent. This is a fragment for the program above: add `using Microsoft.Extensions.Logging;` to its usings and the `Microsoft.Extensions.Logging.Console` package for `AddConsole`. The `using` declaration disposes the factory at the end of the program, which flushes the console logger before the process exits.

```csharp
using ILoggerFactory loggerFactory = LoggerFactory.Create(b => b.AddConsole());
kernel.AutoFunctionInvocationFilters.Add(
    new ToolGuardFilter(loggerFactory.CreateLogger<ToolGuardFilter>()));
```

Two design choices are worth explaining. The first is that the filter returns a result to the model instead of throwing. An exception ends the run with a stack trace; a returned message lets the agent explain to the user what happened. That's also why the budget branch doesn't set `context.Terminate = true`. Terminating stops the loop before the model sees the message, and `ChatCompletionAgent` hands back the raw tool-result message, whose `Content` is empty. If you do want a hard stop, keep `Terminate` and have the caller detect the terminated run and write the user-facing message itself. With the soft version, the model gets one more round trip to answer, and the next filter call sees an index over the budget, so a model that ignores the instruction gets the same message back instead of running another real tool.

The second choice is that the approval gate doesn't execute anything. In a real system that branch writes a request to a queue or a ticketing system and a person approves it outside the agent loop. I don't let an agent hold a conversation open while waiting for a human, because threads, tokens, and user patience all expire.

## Retries: be careful what you repeat

Don't wrap the whole agent call in a retry loop. The Azure OpenAI client underneath Semantic Kernel already retries transient HTTP failures with backoff. If you pass your own `HttpClient` (for example from `IHttpClientFactory` in ASP.NET Core), Semantic Kernel turns the SDK's retries off, so add a resilience handler such as `Microsoft.Extensions.Http.Resilience` at that layer. Retrying the entire agent invocation on top of that can re-run tool calls that already happened. That's harmless for `get_order_status` and very harmful for anything that sends an email or moves money.

My rule of thumb: retries belong at the HTTP layer and inside individual idempotent tools. Non-idempotent tools need an idempotency key, or they belong behind the approval gate above. Derive the key from something stable in the business request (order id plus action, or a request id your app assigns before invoking the agent), not from the tool-call id, which changes every time the model re-plans. `AutoFunctionInvocationContext.ToolCallId` is still useful for correlating the call in logs and traces. At the agent level, fail fast and return a clear message.

## Multi-agent orchestration is preview, and should feel like it

The old pattern of `AgentGroupChat` with custom selection and termination strategies is still in the package, still experimental, and no longer where the team is investing. Microsoft introduced a new orchestration model in May 2025 with sequential, concurrent, handoff, group chat, and Magentic patterns that all share one invocation shape. The [agent orchestration docs](https://learn.microsoft.com/en-us/semantic-kernel/frameworks/agent/agent-orchestration/) cover each pattern. These packages are preview, so you install them with `--prerelease`:

```bash
dotnet add package Microsoft.SemanticKernel.Agents.Orchestration --prerelease
dotnet add package Microsoft.SemanticKernel.Agents.Runtime.InProcess --prerelease
```

A sequential pipeline looks like this. It's a fragment that assumes three `ChatCompletionAgent` instances built as above, and you'll need to suppress the `SKEXP0110` diagnostic to compile it:

```csharp
using Microsoft.SemanticKernel.Agents.Orchestration;
using Microsoft.SemanticKernel.Agents.Orchestration.Sequential;
using Microsoft.SemanticKernel.Agents.Runtime.InProcess;

#pragma warning disable SKEXP0110
SequentialOrchestration orchestration = new(researchAgent, writerAgent, editorAgent);

InProcessRuntime runtime = new();
await runtime.StartAsync();

OrchestrationResult<string> result = await orchestration.InvokeAsync(
    "Summarise the open supplier incidents for this week", runtime);
string output = await result.GetValueAsync(TimeSpan.FromMinutes(2));
Console.WriteLine(output);

await runtime.RunUntilIdleAsync();
#pragma warning restore SKEXP0110
```

Before reaching for this, ask whether three agents in sequence are really doing anything that three prompt calls in ordinary code wouldn't. A fixed sequence is a workflow, and a workflow you write yourself is easier to test, retry, and explain. I'd only use the orchestration packages when the routing is dynamic (handoff, group chat) and the result can tolerate preview API churn.

## Observability and cost

You can't run an agent you can't see. Semantic Kernel emits OpenTelemetry traces and metrics, and the [observability docs](https://learn.microsoft.com/en-us/semantic-kernel/concepts/enterprise-readiness/observability/) show how to export them to Application Insights or the Aspire dashboard. Subscribe to the `Microsoft.SemanticKernel*` activity sources and meters. The GenAI semantic-convention attributes, including model and token usage, are behind the `Microsoft.SemanticKernel.Experimental.GenAI.EnableOTelDiagnostics` app switch. That switch is experimental too. Token counts are also emitted without the switch, as the `semantic_kernel.connectors.openai.tokens.prompt` and `.completion` counters on the `Microsoft.SemanticKernel.Connectors.OpenAI` meter; base cost tracking on those, and treat the span attributes as debugging detail.

A tempting shortcut is to subclass `ChatCompletionAgent` to track costs; that doesn't compile, because the class is sealed. Telemetry is the supported route. Those counters aren't tagged by agent, so record token counts per agent yourself (tag your own metric with the agent name, or use separate kernels and services per agent), count tool calls per tool from the filter, and alert on the round-trip budget from the filter. A model that keeps hitting the budget is telling you its instructions or tools are wrong.

## Memory: skip the old APIs

If you find a tutorial using `MemoryBuilder`, `SaveInformationAsync`, and `AzureAISearchMemoryStore`, it's out of date. Those memory APIs were experimental, and Semantic Kernel moved to vector store connectors built on `Microsoft.Extensions.VectorData`. The abstraction to code against now is `VectorStoreCollection<TKey, TRecord>`; the Azure AI Search connector implements it as `AzureAISearchCollection<TKey, TRecord>`, with typed record classes instead of the old string-and-metadata records.

For an agent, the simplest durable pattern is still retrieval through a tool: a plugin that searches that collection with the caller's permissions applied, rather than a hidden memory layer the agent writes to freely. A tool call shows up in your traces and goes through your filter; a hidden layer doesn't. I'd only accept agent-written memory when the agent genuinely needs to remember things across sessions that no system of record holds, such as a user's stated preferences, and even then I'd scope it per user, give it a retention period, and let the user see and delete it.

## Where Agent Framework fits

Microsoft announced Agent Framework in public preview on 1 October 2025, built by the Semantic Kernel and AutoGen teams as the successor to both. Semantic Kernel still gets critical bug and security fixes, and the Semantic Kernel team has [committed to supporting it for at least a year after Agent Framework reaches GA](https://devblogs.microsoft.com/semantic-kernel/semantic-kernel-and-microsoft-agent-framework/), but most new features are landing in Agent Framework. As of this month, Agent Framework for .NET is still shipping preview builds.

That gives a clear decision:

- **Existing Semantic Kernel agents in production:** keep them. Stick to the GA packages, add filters and telemetry, and read the [migration guide](https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-semantic-kernel) so you know the mapping (`ChatCompletionAgent` becomes `ChatClientAgent`, and messages move to `Microsoft.Extensions.AI` types).
- **New single-agent work that must ship this quarter on GA bits:** Semantic Kernel's `ChatCompletionAgent` is a reasonable choice. Keep your tools as plain classes with clear contracts so they move cleanly.
- **New multi-agent or workflow-heavy work:** I'd prototype on Agent Framework rather than adopt Semantic Kernel's preview orchestration packages. You'd be taking on preview risk either way, so take it on the framework that's getting the investment.

## The short version

For Azure-based enterprise clients on .NET, Semantic Kernel became my default agent framework, and the GA core (one agent, typed tools, filters, telemetry) is still a sound production base in January 2026. The parts I'd keep out of customer-facing paths are the preview orchestration packages and anything marked `SKEXP`. Treat the tool loop as the risk surface: narrow tools, a filter that enforces a budget and approval, and no blanket retries. Plan the move to Agent Framework once it reaches GA rather than rushing it. For the wider question of when an agent is the right tool at all, see [AI Agents in 2026: Where They Earn Their Keep and Where They Don't](/blog/2026-01-02-ai-agents-reality-vs-hype/).
