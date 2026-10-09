---
title: "Building Multi-Agent Systems with Semantic Kernel"
description: "Define clear responsibilities for each agent to avoid confusion and improve reliability. Multi-agent architectures excel at complex workflows where…"
author: Michael John Peña
draft: false
date: 2025-08-31
tags:
  - Semantic Kernel
  - Multi-Agent
  - AI Agents
  - Orchestration
  - .NET
---

## Designing Agent Roles

Define clear responsibilities for each agent to avoid confusion and improve reliability.

```csharp
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.Agents;

public class ResearchAgent
{
    public static ChatCompletionAgent Create(Kernel kernel)
    {
        return new ChatCompletionAgent
        {
            Name = "Researcher",
            Instructions = @"
                You are a research specialist. Your role is to:
                - Search for relevant information on topics
                - Summarize findings concisely
                - Cite sources when possible
                - Ask clarifying questions if the research topic is unclear

                You do NOT write final documents. Pass your findings to the Writer.",
            Kernel = kernel
        };
    }
}

public class WriterAgent
{
    public static ChatCompletionAgent Create(Kernel kernel)
    {
        return new ChatCompletionAgent
        {
            Name = "Writer",
            Instructions = @"
                You are a technical writer. Your role is to:
                - Take research findings and create polished documents
                - Structure content logically with clear headings
                - Maintain consistent tone and style
                - Request more research if information is insufficient

                You do NOT do research. Request it from the Researcher.",
            Kernel = kernel
        };
    }
}
```

## Orchestrating Agent Collaboration

```csharp
public class AgentOrchestrator
{
    private readonly ChatCompletionAgent _researcher;
    private readonly ChatCompletionAgent _writer;
    private readonly AgentGroupChat _groupChat;

    public AgentOrchestrator(Kernel kernel)
    {
        _researcher = ResearchAgent.Create(kernel);
        _writer = WriterAgent.Create(kernel);

        _groupChat = new AgentGroupChat(_researcher, _writer)
        {
            ExecutionSettings = new()
            {
                TerminationStrategy = new MaxTurnsTerminationStrategy(10),
                SelectionStrategy = new RoundRobinSelectionStrategy()
            }
        };
    }

    public async Task<string> CreateDocumentAsync(string topic)
    {
        _groupChat.AddChatMessage(new ChatMessageContent(
            AuthorRole.User,
            $"Create a technical document about: {topic}"));

        var responses = new List<string>();

        await foreach (var message in _groupChat.InvokeAsync())
        {
            responses.Add($"[{message.AuthorName}]: {message.Content}");
        }

        return string.Join("\n\n", responses);
    }
}
```

Multi-agent architectures excel at complex workflows where different expertise is needed at different stages. Design your agents with clear boundaries and communication protocols for best results.
