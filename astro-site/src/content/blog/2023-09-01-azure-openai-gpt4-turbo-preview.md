---
title: "Semantic Kernel: Building AI-Powered Applications with .NET"
author: Michael John Peña
draft: false
date: 2023-09-01
description: "Learn how to use Microsoft's Semantic Kernel SDK to build intelligent applications that leverage GPT-4 and Azure OpenAI Service."
tags:
  - Azure
  - OpenAI
  - Semantic Kernel
  - AI
  - .NET

---

I wrote "Semantic Kernel: Building AI-Powered Applications with .NET" to share practical, production-minded guidance on this topic.

## Introduction

Semantic Kernel has emerged as Microsoft's recommended way to build AI-powered applications. This open-source SDK provides a clean abstraction layer for integrating large language models into your applications, whether you're using Azure OpenAI Service or OpenAI directly.

## What is Semantic Kernel?

Semantic Kernel is an SDK that lets you combine AI services like GPT-4 with conventional programming. Think of it as a way to orchestrate AI capabilities within your applications, enabling scenarios like:

- Intelligent assistants
- Automated workflows
- Natural language interfaces
- AI-augmented business processes

## Getting Started with Semantic Kernel

### Installation

```bash
# .NET
dotnet add package Microsoft.SemanticKernel

# Python
pip install semantic-kernel
```

### Basic Setup with Azure OpenAI

```csharp
using Microsoft.SemanticKernel;

// Create a kernel with Azure OpenAI
var builder = Kernel.CreateBuilder();
builder.AddAzureOpenAIChatCompletion(
    deploymentName: "gpt-4",
    endpoint: Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT"),
    apiKey: Environment.GetEnvironmentVariable("AZURE_OPENAI_KEY")
);

var kernel = builder.Build();
```

```python
import semantic_kernel as sk
from semantic_kernel.connectors.ai.open_ai import AzureChatCompletion

kernel = sk.Kernel()

kernel.add_chat_service(
    "azure-gpt4",
    AzureChatCompletion(
        deployment_name="gpt-4",
        endpoint=os.environ["AZURE_OPENAI_ENDPOINT"],
        api_key=os.environ["AZURE_OPENAI_KEY"]
    )
)
```

## Core Concepts

### 1. Semantic Functions

Semantic functions are prompts that the kernel can execute:

```csharp
// Define a semantic function inline
var summarizeFunction = kernel.CreateFunctionFromPrompt(
    @"Summarize the following text in 3 bullet points:

    {{$input}}

    Summary:",
    new OpenAIPromptExecutionSettings
    {
        MaxTokens = 500,
        Temperature = 0.3
    }
);

// Execute the function
var result = await kernel.InvokeAsync(summarizeFunction, new()
{
    ["input"] = longDocument
});

Console.WriteLine(result.GetValue<string>());
```

### 2. Native Functions

Combine AI with regular code using native functions:

```csharp
public class DateTimePlugin
{
    [KernelFunction]
    [Description("Gets the current date and time")]
    public string GetCurrentDateTime()
    {
        return DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss");
    }

    [KernelFunction]
    [Description("Calculates days between two dates")]
    public int DaysBetween(
        [Description("Start date")] string startDate,
        [Description("End date")] string endDate)
    {
        var start = DateTime.Parse(startDate);
        var end = DateTime.Parse(endDate);
        return (end - start).Days;
    }
}

// Register the plugin
kernel.ImportPluginFromType<DateTimePlugin>();
```

### 3. Plugins

Organize functions into reusable plugins:

```csharp
public class EmailPlugin
{
    private readonly IEmailService _emailService;

    public EmailPlugin(IEmailService emailService)
    {
        _emailService = emailService;
    }

    [KernelFunction]
    [Description("Sends an email to a recipient")]
    public async Task<string> SendEmail(
        [Description("Email recipient")] string to,
        [Description("Email subject")] string subject,
        [Description("Email body")] string body)
    {
        await _emailService.SendAsync(to, subject, body);
        return $"Email sent to {to}";
    }

    [KernelFunction]
    [Description("Drafts an email based on notes")]
    public async Task<string> DraftEmail(
        [Description("Notes or points to include")] string notes,
        [Description("Tone: formal, casual, friendly")] string tone = "professional")
    {
        var prompt = $@"Draft an email with {tone} tone based on these notes:
        {notes}

        Email:";

        // This would use the kernel's AI service
        return $"[Draft based on: {notes}]";
    }
}
```

## Building a Chat Assistant

Here's a complete example of building a chat assistant:

```csharp
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;

public class ChatAssistant
{
    private readonly Kernel _kernel;
    private readonly IChatCompletionService _chatService;
    private readonly ChatHistory _history;

    public ChatAssistant(Kernel kernel)
    {
        _kernel = kernel;
        _chatService = kernel.GetRequiredService<IChatCompletionService>();
        _history = new ChatHistory();

        // Set system message
        _history.AddSystemMessage(@"You are a helpful assistant for a software company.
        You help users with technical questions, documentation, and troubleshooting.
        Be concise but thorough. Ask clarifying questions when needed.");
    }

    public async Task<string> ChatAsync(string userMessage)
    {
        _history.AddUserMessage(userMessage);

        var response = await _chatService.GetChatMessageContentAsync(
            _history,
            executionSettings: new OpenAIPromptExecutionSettings
            {
                MaxTokens = 1000,
                Temperature = 0.7
            },
            kernel: _kernel
        );

        _history.AddAssistantMessage(response.Content ?? "");
        return response.Content ?? "";
    }

    public void ClearHistory()
    {
        _history.Clear();
    }
}

// Usage
var assistant = new ChatAssistant(kernel);

Console.WriteLine(await assistant.ChatAsync("How do I configure Azure Key Vault?"));
Console.WriteLine(await assistant.ChatAsync("What about managed identities?"));
```

## Planners: Automatic Task Orchestration

Semantic Kernel can automatically plan and execute multi-step tasks:

```csharp
using Microsoft.SemanticKernel.Planning.Handlebars;

// Register plugins
kernel.ImportPluginFromType<EmailPlugin>();
kernel.ImportPluginFromType<CalendarPlugin>();
kernel.ImportPluginFromType<SearchPlugin>();

// Create a planner
var planner = new HandlebarsPlanner();

// Let the AI figure out how to accomplish a goal
var plan = await planner.CreatePlanAsync(kernel,
    "Find any meetings I have tomorrow, summarize them, and draft an email to my team about my schedule");

// Execute the plan
var result = await plan.InvokeAsync(kernel);
Console.WriteLine(result);
```

## Memory and Context

Add memory capabilities for context-aware AI:

```csharp
using Microsoft.SemanticKernel.Memory;
using Microsoft.SemanticKernel.Connectors.Memory.AzureCognitiveSearch;

// Configure memory with Azure Cognitive Search
var memoryBuilder = new MemoryBuilder();
memoryBuilder.WithAzureCognitiveSearchMemoryStore(
    Environment.GetEnvironmentVariable("SEARCH_ENDPOINT"),
    Environment.GetEnvironmentVariable("SEARCH_KEY")
);
memoryBuilder.WithAzureOpenAITextEmbeddingGeneration(
    "text-embedding-ada-002",
    Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT"),
    Environment.GetEnvironmentVariable("AZURE_OPENAI_KEY")
);

var memory = memoryBuilder.Build();

// Store information
await memory.SaveInformationAsync(
    collection: "company-docs",
    id: "policy-1",
    text: "Our return policy allows returns within 30 days with receipt."
);

// Search memory
var results = memory.SearchAsync(
    collection: "company-docs",
    query: "What is the return policy?",
    limit: 3
);

await foreach (var result in results)
{
    Console.WriteLine($"Relevance: {result.Relevance}, Text: {result.Metadata.Text}");
}
```

## Best Practices

### 1. Prompt Engineering

```csharp
// Good: Specific, structured prompt
var goodPrompt = @"
You are analyzing customer feedback for a software product.

Feedback: {{$feedback}}

Analyze this feedback and provide:
1. Sentiment (positive/negative/neutral)
2. Key issues mentioned
3. Suggested actions

Format as JSON.";

// Bad: Vague prompt
var badPrompt = "What do you think about this: {{$feedback}}";
```

### 2. Error Handling

```csharp
try
{
    var result = await kernel.InvokeAsync(myFunction, arguments);
}
catch (HttpOperationException ex) when (ex.StatusCode == HttpStatusCode.TooManyRequests)
{
    // Handle rate limiting
    await Task.Delay(TimeSpan.FromSeconds(10));
    // Retry...
}
catch (KernelException ex)
{
    _logger.LogError(ex, "Kernel execution failed");
    throw;
}
```

### 3. Token Management

```csharp
// Monitor token usage
var settings = new OpenAIPromptExecutionSettings
{
    MaxTokens = 500,  // Limit output
    Temperature = 0.5
};

// Use streaming for long responses
await foreach (var chunk in chatService.GetStreamingChatMessageContentsAsync(history, settings, kernel))
{
    Console.Write(chunk.Content);
}
```

## Conclusion

Semantic Kernel provides a powerful framework for building AI-powered applications with Azure OpenAI Service. Its plugin architecture, planning capabilities, and memory integration make it ideal for building sophisticated AI applications. As we move into the era of AI-augmented software, tools like Semantic Kernel will become essential in every developer's toolkit.

## Resources

- [Semantic Kernel GitHub](https://github.com/microsoft/semantic-kernel)
- [Semantic Kernel Documentation](https://learn.microsoft.com/semantic-kernel/)
- [Azure OpenAI Service](https://azure.microsoft.com/products/cognitive-services/openai-service/)

