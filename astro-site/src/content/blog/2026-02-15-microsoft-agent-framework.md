---
title: "The Microsoft Agent Framework: What You Need to Know"
description: "It's Microsoft's opinionated framework for building production AI agents. Not just chatbots. Agents that reason, plan, use tools, and collaborate with other…"
author: Michael John Peña
draft: false
date: 2026-02-15
tags:
  - AI
  - Agents
  - Azure
  - dotnet
---

## What Is the Microsoft Agent Framework?

It's Microsoft's opinionated framework for building production AI agents. Not just chatbots. Agents that reason, plan, use tools, and collaborate with other agents.

Think of it as the layer above Semantic Kernel. Semantic Kernel gives you the building blocks. The Agent Framework gives you the architecture.

## Why Another Framework?

Because building agents from scratch is painful.

Every team building agents ends up solving the same problems:
- How do agents communicate with each other?
- How do you manage agent state across conversations?
- How do you orchestrate multi-agent workflows?
- How do you observe what agents are actually doing?

The Agent Framework provides answers to all of these.

## The Core Concepts

### Agents

An agent is a unit of work with a specific role, instructions, and tools.

```csharp
var agent = AgentBuilder.CreateChatCompletionAgent()
    .WithInstructions("You are an order support specialist. Help customers with order inquiries.")
    .WithAzureOpenAIChatCompletion("gpt-4o", endpoint, credential)
    .WithPlugin<OrderPlugin>()
    .WithPlugin<ShippingPlugin>()
    .Build();
```

Each agent has a clear responsibility. It knows what it can do and stays in its lane.

### Multi-Agent Collaboration

This is where it gets interesting. Multiple agents working together on a problem.

```csharp
var triageAgent = AgentBuilder.CreateChatCompletionAgent()
    .WithInstructions("Classify customer requests and route to the right specialist.")
    .Build();

var orderAgent = AgentBuilder.CreateChatCompletionAgent()
    .WithInstructions("Handle order-related queries. Check status, process returns.")
    .WithPlugin<OrderPlugin>()
    .Build();

var billingAgent = AgentBuilder.CreateChatCompletionAgent()
    .WithInstructions("Handle billing questions. Explain charges, process refunds.")
    .WithPlugin<BillingPlugin>()
    .Build();

var group = new AgentGroupChat(triageAgent, orderAgent, billingAgent)
{
    ExecutionSettings = new()
    {
        TerminationStrategy = new MaxTurnsTermination(10),
        SelectionStrategy = new PromptBasedSelection()
    }
};
```

The triage agent reads the customer request and decides which specialist should handle it. The specialists do their work. The framework manages the conversation flow.

### Conversation State

Agents need memory. The framework handles this.

```csharp
var thread = await agent.CreateThreadAsync();

// First interaction
var response = await agent.InvokeAsync(thread, "What's the status of order 12345?");

// Follow-up - agent remembers the context
var followUp = await agent.InvokeAsync(thread, "Can you cancel it?");
```

Threads persist across interactions. The agent maintains context without you managing chat history manually.

## How It Differs from Semantic Kernel

**Semantic Kernel** = AI SDK. Plugins, function calling, prompt templates. The plumbing.

**Agent Framework** = Agent patterns. Multi-agent orchestration, state management, conversation flows. The architecture.

They work together. The Agent Framework uses Semantic Kernel under the hood. You don't choose between them—you use both.

```
Agent Framework (orchestration, patterns)
    └── Semantic Kernel (AI capabilities, plugins)
        └── Azure OpenAI (model inference)
```

## Real-World Pattern: Customer Support

Here's how I'm structuring a client project:

**Agent 1: Router** — Reads the customer message, classifies intent, picks the right specialist.

**Agent 2: Order Specialist** — Handles order status, cancellations, modifications. Has access to order database.

**Agent 3: Technical Support** — Handles product questions, troubleshooting. Has access to knowledge base.

**Agent 4: Escalation** — Takes over when other agents can't resolve. Flags for human review.

Each agent is small, focused, and testable. The framework orchestrates the handoffs.

## What Works Well

**Clean separation of concerns.** Each agent has one job. Easy to test, easy to update.

**Built-in guardrails.** Max turns, timeout strategies, and termination conditions prevent runaway agents.

**Azure integration.** Works with Azure OpenAI, Azure AI Search, and the rest of the Microsoft stack out of the box.

**Observability.** Built-in hooks for logging what agents are doing and why.

## What to Watch Out For

**Still evolving.** The API surface is changing. Expect breaking changes between releases.

**Complexity budget.** Multi-agent systems add cognitive overhead. Don't use three agents when one would do.

**Debugging multi-agent conversations.** When agents disagree or loop, understanding why requires good logging.

**Cost multiplication.** Each agent turn is an LLM call. Three agents discussing a problem means 3x the tokens.

## Should You Use It?

**Yes, if:**
- You're building agents that need to collaborate
- You need structured multi-step reasoning
- You want production patterns, not just prototypes
- You're in the Microsoft/Azure ecosystem

**Not yet, if:**
- A single Semantic Kernel agent solves your problem
- You need a fully stable API
- You're not on Azure

## The Bottom Line

The Agent Framework fills a real gap. Building multi-agent systems from scratch is hard. Having an opinionated framework with sensible defaults saves real development time.

It's not mature yet. But the direction is right. If you're building agents on Azure, this is worth investing in now.

Start simple. One agent. Add complexity only when needed. The framework grows with you.
