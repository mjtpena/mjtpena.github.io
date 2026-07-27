---
title: "Building AI Agents with Semantic Kernel Planners"
author: Michael John Peña
draft: false
date: 2025-08-17
tags:
  - Semantic Kernel
  - AI Agents
  - Planners
  - Autonomous AI
  - .NET

---

I wrote "Building AI Agents with Semantic Kernel Planners" to share practical, production-minded guidance on this topic.

## Understanding Planners

Planners analyze a user's goal and create an execution plan using available plugins. The Handlebars planner generates a template-based plan, while function calling lets the model decide which functions to invoke.

## Implementing an Agent with Auto Function Calling

```csharp
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;
using Microsoft.SemanticKernel.Connectors.OpenAI;

public class TaskAgent
{
    private readonly Kernel _kernel;
    private readonly IChatCompletionService _chat;

    public TaskAgent(Kernel kernel)
    {
        _kernel = kernel;
        _chat = kernel.GetRequiredService<IChatCompletionService>();
    }

    public async Task<string> ExecuteTaskAsync(string goal)
    {
        var history = new ChatHistory();
        history.AddSystemMessage(@"
            You are a helpful assistant that completes tasks step by step.
            Use the available functions to accomplish the user's goal.
            Think through each step before acting.
            Report progress as you work.");

        history.AddUserMessage(goal);

        var settings = new OpenAIPromptExecutionSettings
        {
            ToolCallBehavior = ToolCallBehavior.AutoInvokeKernelFunctions,
            MaxTokens = 4000
        };

        var response = await _chat.GetChatMessageContentAsync(
            history,
            settings,
            _kernel);

        return response.Content ?? "Task completed.";
    }
}
```

## Creating Agent Plugins

```csharp
public class ResearchPlugin
{
    [KernelFunction("search_web")]
    [Description("Search the web for information on a topic")]
    public async Task<string> SearchWebAsync(string query)
    {
        // Implementation using Bing Search API
        return await _searchService.SearchAsync(query);
    }

    [KernelFunction("summarize_url")]
    [Description("Fetch and summarize content from a URL")]
    public async Task<string> SummarizeUrlAsync(string url)
    {
        var content = await _httpClient.GetStringAsync(url);
        return await _summarizer.SummarizeAsync(content);
    }

    [KernelFunction("save_notes")]
    [Description("Save research notes to the knowledge base")]
    public async Task<string> SaveNotesAsync(string topic, string notes)
    {
        await _notesRepository.SaveAsync(topic, notes);
        return $"Notes saved for topic: {topic}";
    }
}
```

Agents represent the next evolution of AI applications, moving from reactive assistants to proactive collaborators that can complete complex tasks with minimal human intervention.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
