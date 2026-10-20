---
title: "Microsoft Agent Framework in .NET: A February 2026 Preview Field Guide"
description: "What Microsoft Agent Framework for .NET really is in February 2026: agents, sessions, tool approvals and handoffs, plus where it fits before it reaches GA."
author: Michael John Peña
draft: false
date: 2026-02-15
tags:
  - AI
  - Agents
  - .NET
  - Multi-Agent
  - Semantic Kernel
---

A lot of early write-ups describe Microsoft Agent Framework as "a layer on top of Semantic Kernel", and some show APIs that never shipped. That's a problem if you're deciding where a .NET team should build its next agent, because the real framework has a different foundation, a different object model, and a release status you need to plan around. Here's what it is in mid-February 2026, what the code looks like against the current preview, and where I'd still hold back.

## What it is, and what it isn't

Microsoft [announced Agent Framework in public preview](https://devblogs.microsoft.com/foundry/introducing-microsoft-agent-framework-the-open-source-engine-for-agentic-ai-apps/) on 1 October 2025. It's an open-source SDK for .NET and Python, built by the Semantic Kernel and AutoGen teams as the successor to both. It is not a wrapper around Semantic Kernel. The .NET version sits on `Microsoft.Extensions.AI`, the `IChatClient` abstraction the .NET team publishes as NuGet packages, so any provider with an `IChatClient` implementation (Azure OpenAI, OpenAI, Foundry, Ollama and others) can back an agent. Semantic Kernel isn't in the dependency graph at all.

That matters for two reasons. First, there's no "use both" stack to design. If you adopt Agent Framework, Semantic Kernel plugins become plain functions and the `Kernel` object disappears. Second, Semantic Kernel isn't going away tomorrow: the team has [committed to supporting it for at least a year after Agent Framework reaches GA](https://devblogs.microsoft.com/agent-framework/semantic-kernel-and-microsoft-agent-framework/), with most new features landing in Agent Framework instead. I covered how to run Semantic Kernel agents safely in the meantime in [Semantic Kernel Agents in Production](/blog/2026-01-13-semantic-kernel-agents/).

The framework has two halves, and the [overview](https://learn.microsoft.com/en-us/agent-framework/overview/) is clear about the split:

| Concept | What decides the next step | Use it for |
|---|---|---|
| Agent | The model, choosing which tool to call and when it's done | Open-ended steps: investigation, research, conversation |
| Workflow | Your graph of executors and edges | Multi-step processes with known routing, checkpoints and human approvals |

Agents can run inside workflows, and a workflow can be exposed as an agent. The Learn docs also say something I wish more framework docs said: if you can write a function to handle the task, do that instead of using an agent.

## Release status on 15 February 2026

The .NET packages are on `1.0.0-preview.260212.1`, published on 12 February. Python is on `1.0.0b260212`. Both have shipped roughly weekly since October, and the previews have included renames. The current samples create an agent with `AsAIAgent(...)` and hold conversation state in an `AgentSession` created by `CreateSessionAsync()`. If you find a tutorial from late 2025 using `CreateAIAgent(...)` or `GetNewThread()`, it was written against an earlier preview, and it won't compile against the current one without changes.

My rule: pin the exact preview version in your project file and upgrade on purpose, reading the [release history](https://github.com/microsoft/agent-framework/releases) before you do. Floating on a version like `1.0.0-preview.*` guarantees a broken build on a Monday morning.

The signal to watch for is the version scheme itself. When the API freezes, the date-stamped previews give way to `1.0.0-rc` and then `1.0.0`, and that's the point I'd start the clock on a production migration, not before.

## One agent, done properly

Start with a single agent. You need `Microsoft.Agents.AI.OpenAI` (prerelease), `Azure.AI.OpenAI` and `Azure.Identity`:

```bash
dotnet new console -n OrderSupport && cd OrderSupport
dotnet add package Microsoft.Agents.AI.OpenAI --version 1.0.0-preview.260212.1
dotnet add package Azure.AI.OpenAI --version 2.8.0-beta.1
dotnet add package Azure.Identity --version 1.17.1
```

This agent answers order questions with a read-only lookup tool, and it has a cancellation tool that needs a person to approve each call before it runs.

```csharp
using System.ComponentModel;
using Azure.AI.OpenAI;
using Azure.Identity;
using Microsoft.Agents.AI;
using Microsoft.Extensions.AI;
using OpenAI.Chat;
using ChatMessage = Microsoft.Extensions.AI.ChatMessage;

#pragma warning disable MEAI001 // Tool approval types are experimental in Microsoft.Extensions.AI 10.3

var endpoint = new Uri("https://<your-resource-name>.openai.azure.com/");
var deployment = "<your-deployment-name>";

[Description("Get the status of an order by its order number.")]
static string GetOrderStatus([Description("The order number.")] string orderNumber)
    => $"Order {orderNumber}: shipped, arriving Thursday."; // Replace with your order API.

[Description("Cancel an order that has not shipped yet.")]
static string CancelOrder([Description("The order number.")] string orderNumber)
    => $"Order {orderNumber} cancelled."; // Replace with your order API.

AIAgent agent = new AzureOpenAIClient(endpoint, new DefaultAzureCredential())
    .GetChatClient(deployment)
    .AsAIAgent(
        name: "OrderSupport",
        instructions: "You help customers with order enquiries. Use the tools; never guess an order status.",
        tools:
        [
            AIFunctionFactory.Create(GetOrderStatus),
            new ApprovalRequiredAIFunction(AIFunctionFactory.Create(CancelOrder)),
        ]);

// The session carries the conversation history between turns.
AgentSession session = await agent.CreateSessionAsync();
Console.WriteLine(await agent.RunAsync("What's the status of order 12345?", session));

AgentResponse response = await agent.RunAsync("It's late. Please cancel it.", session);

// Approval-required tools come back as requests instead of running.
var approvals = response.Messages
    .SelectMany(m => m.Contents)
    .OfType<FunctionApprovalRequestContent>()
    .ToList();

while (approvals.Count > 0)
{
    var decisions = approvals.ConvertAll(request =>
    {
        Console.Write($"Approve {request.FunctionCall.Name}? (y/n) ");
        bool approved = Console.ReadLine()?.Trim().Equals("y", StringComparison.OrdinalIgnoreCase) ?? false;
        return new ChatMessage(ChatRole.User, [request.CreateResponse(approved)]);
    });

    response = await agent.RunAsync(decisions, session);
    approvals = response.Messages
        .SelectMany(m => m.Contents)
        .OfType<FunctionApprovalRequestContent>()
        .ToList();
}

Console.WriteLine(response);
```

Three things here are worth more than the line count suggests.

**Tools are ordinary methods.** `AIFunctionFactory` comes from `Microsoft.Extensions.AI`, and the `[Description]` attributes become the tool schema the model sees. There's no plugin class or kernel to register. Your tool code stays testable without a model in the loop.

**Approval is declared on the tool, not in the prompt.** Wrapping `CancelOrder` in `ApprovalRequiredAIFunction` means the framework stops and hands you a `FunctionApprovalRequestContent` instead of executing it. Those approval types are still marked experimental (diagnostic `MEAI001`) in Microsoft.Extensions.AI 10.3, the version this preview depends on, hence the `#pragma` at the top: one more sign that the ground under this API is still moving. "Ask before cancelling" in the system prompt is a request; this is a control. Any tool that writes to a system of record should start life wrapped like this, and you should have to argue it out of the wrapper.

**The session is state you own.** Conversation history lives in the `AgentSession`, not in a hidden service. That's convenient in a console app and a design decision in a web app. Between requests you can persist it with `agent.SerializeSessionAsync(session)` and restore it with `agent.DeserializeSessionAsync(json)`, or pass your own `ChatHistoryProvider` to `ChatClientAgent.CreateSessionAsync(...)` so messages go straight to a store you control. The exception is a client with service-side history, such as the Responses API or Foundry agents: there the transcript lives in the service and the session only holds a conversation ID, which moves the data-residency question to that service's retention settings. Decide where it lives, how long it's kept and who can read it before you go live, because it contains whatever your customers typed.

For production, swap `DefaultAzureCredential` for `ManagedIdentityCredential`, and add OpenTelemetry with `.AsBuilder().UseOpenTelemetry(...).Build()` on the agent so every model call and tool call shows up as a span you can export to Application Insights.

## Multi-agent handoff

For a customer support design I'm structuring, the shape is a router, an order specialist, a technical support agent, and an escalation path that flags conversations for human review. Agent Framework's workflow package has a handoff orchestration built for exactly this, where agents transfer control to each other through generated handoff tools. Add `Microsoft.Agents.AI.Workflows` at the same preview version:

```bash
dotnet add package Microsoft.Agents.AI.Workflows --version 1.0.0-preview.260212.1
```

```csharp
using Azure.AI.OpenAI;
using Azure.Identity;
using Microsoft.Agents.AI;
using Microsoft.Agents.AI.Workflows;
using Microsoft.Extensions.AI;

IChatClient client = new AzureOpenAIClient(
        new Uri("https://<your-resource-name>.openai.azure.com/"), new DefaultAzureCredential())
    .GetChatClient("<your-deployment-name>")
    .AsIChatClient();

ChatClientAgent router = new(client,
    "Work out what the customer needs and hand off to a specialist. Never answer yourself.",
    "router", "Routes customer messages to the right specialist");
ChatClientAgent orders = new(client,
    "Handle order status, changes and returns. Hand back to the router if the request is not about an order.",
    "orders", "Specialist for order questions");
ChatClientAgent techSupport = new(client,
    "Handle product questions and troubleshooting. Hand back to the router if the request is not technical.",
    "tech_support", "Specialist for product and technical questions");

Workflow workflow = AgentWorkflowBuilder.CreateHandoffBuilderWith(router)
    .WithHandoffs(router, [orders, techSupport])
    .WithHandoffs([orders, techSupport], router)
    .Build();

List<ChatMessage> messages = [new(ChatRole.User, "My blender arrived but it won't turn on.")];

await using StreamingRun run = await InProcessExecution.StreamAsync(workflow, messages);
await run.TrySendMessageAsync(new TurnToken(emitEvents: true));

await foreach (WorkflowEvent evt in run.WatchStreamAsync())
{
    if (evt is AgentResponseUpdateEvent update)
    {
        Console.Write(update.Update.Text);
    }
    else if (evt is WorkflowOutputEvent output)
    {
        // The full conversation so far. Keep it as your history and call StreamAsync again with it for the next customer turn.
        messages = output.As<List<ChatMessage>>()!;
        break;
    }
}
```

In the real design the specialists get their tools (the order lookup from earlier, a knowledge base search for tech support), and escalation is a deterministic step that writes to a human queue rather than another agent. I don't want a model deciding whether a model's work needs a human to check it.

The handoff builder is the successor to Semantic Kernel's `HandoffOrchestration`. If you used `AgentGroupChat` with selection and termination strategies, the closer equivalent is the group chat builder, `AgentWorkflowBuilder.CreateGroupChatBuilderWith(...)` with a `GroupChatManager` such as `RoundRobinGroupChatManager` and its `MaximumIterationCount`. `AgentGroupChat` was always experimental. The [migration guide](https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-semantic-kernel) maps the Semantic Kernel agent types (`ChatCompletionAgent` becomes `ChatClientAgent`, `AgentThread` becomes `AgentSession`, plugins become plain functions); it doesn't cover `AgentGroupChat` or the orchestrations, so map those to the workflow builders yourself.

## Where it falls short today

**It's still preview.** The API is settling, but it hasn't settled. Weekly releases with renames are fine for a prototype and expensive for a product with a support contract.

**Multi-agent multiplies everything.** Each handoff is at least one more model call, every agent's instructions are another prompt to evaluate, and a router that misclassifies sends the customer to the wrong specialist with full confidence. Before reaching for handoff, try one agent with all the tools. If it handles your evaluation set, stop there.

**Routing you can write down belongs in a workflow, not a handoff.** If the router's decision is really a classification into a fixed set of categories, a single structured model call plus switch-case edges is cheaper and easier to test than an agent deciding when to hand off. I walked through that pattern, with code, in [Workflow First, Agent Inside](/blog/2026-02-11-agents-vs-workflows/).

**Debugging is on you.** When two agents hand a conversation back and forth, traces are the practical way to see why. Turn on OpenTelemetry before you need it, not after the first incident.

## How I'd decide this month

If you're starting new agent work in .NET and can tolerate preview churn, build it on Agent Framework, not Semantic Kernel: the investment is going here, and migrating later costs more than learning the new model now. Pin the version, wrap every write tool in approval, own the session storage, and keep to one agent until an evaluation proves you need more. If you have Semantic Kernel agents in production on GA packages, leave them alone, read the migration guide, and plan the move for after GA rather than chasing each preview. And if a customer-facing release this quarter depends on API stability, the honest answer is to wait for the framework's first stable release before putting it on that path.
