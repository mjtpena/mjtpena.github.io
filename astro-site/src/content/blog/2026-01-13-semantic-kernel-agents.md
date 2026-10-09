---
title: "Semantic Kernel: Building Production AI Agents"
description: "After building agents with LangChain, AutoGen, and custom solutions, I finally gave Semantic Kernel a proper try. Here's what I learned building production…"
author: Michael John Peña
draft: false
date: 2026-01-13
tags:
  - AI
  - Semantic-Kernel
  - Agents
  - Microsoft
---

After building agents with LangChain, AutoGen, and custom solutions, I finally gave Semantic Kernel a proper try. Here's what I learned building production agents with Microsoft's framework.

## Why Semantic Kernel?

If you're in the Microsoft ecosystem, Semantic Kernel makes sense:
- First-class .NET support
- Azure integration is seamless
- Enterprise-ready patterns
- Good documentation (mostly)

If you're Python-only or multi-cloud, maybe look elsewhere.

## Basic Agent Setup

```csharp
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.Agents;

var builder = Kernel.CreateBuilder();
builder.AddAzureOpenAIChatCompletion(
    deploymentName: "gpt-4o",
    endpoint: config["AzureOpenAI:Endpoint"],
    apiKey: config["AzureOpenAI:ApiKey"]
);

var kernel = builder.Build();

// Create agent with plugins
var agent = new ChatCompletionAgent
{
    Name = "DataAnalyst",
    Instructions = """
        You are a data analysis expert.
        Use available tools to answer questions about data.
        Be precise and cite your sources.
        """,
    Kernel = kernel
};
```

## Adding Tools (Plugins in SK Terms)

Semantic Kernel calls them "plugins." They're functions the agent can call.

```csharp
public class DataPlugin
{
    [KernelFunction, Description("Query the sales database")]
    public async Task<string> QuerySalesData(
        [Description("SQL query to execute")] string query
    )
    {
        // Validate query (important!)
        if (!IsSelectQuery(query))
        {
            return "Error: Only SELECT queries allowed";
        }
        
        using var connection = new SqlConnection(connectionString);
        var result = await connection.QueryAsync(query);
        return JsonSerializer.Serialize(result);
    }
    
    [KernelFunction, Description("Get product information")]
    public async Task<string> GetProductInfo(
        [Description("Product ID")] string productId
    )
    {
        // Implementation
        var product = await productService.GetProduct(productId);
        return JsonSerializer.Serialize(product);
    }
    
    private bool IsSelectQuery(string query)
    {
        var normalized = query.Trim().ToUpperInvariant();
        return normalized.StartsWith("SELECT") &&
               !normalized.Contains("DROP") &&
               !normalized.Contains("DELETE") &&
               !normalized.Contains("UPDATE") &&
               !normalized.Contains("INSERT");
    }
}

// Add plugin to kernel
kernel.Plugins.AddFromType<DataPlugin>("Data");
```

## The Agent Loop

```csharp
public class AgentOrchestrator
{
    private readonly ChatCompletionAgent agent;
    private readonly AgentGroupChat chat;
    
    public async Task<string> ProcessQuery(string userQuery)
    {
        // Add user message
        chat.AddChatMessage(new ChatMessageContent(
            AuthorRole.User,
            userQuery
        ));
        
        // Agent processes with tool calling
        await foreach (var message in chat.InvokeAsync())
        {
            // Log each step
            logger.LogInformation(
                "Agent: {Name}, Message: {Content}",
                message.AuthorName,
                message.Content
            );
            
            // Check if done
            if (message.AuthorName == agent.Name && 
                !message.Items.Any(i => i is FunctionCallContent))
            {
                return message.Content;
            }
        }
        
        throw new InvalidOperationException("Agent didn't complete");
    }
}
```

## Multi-Agent Patterns

Where Semantic Kernel shines: orchestrating multiple agents.

```csharp
// Create specialized agents
var researchAgent = new ChatCompletionAgent
{
    Name = "Researcher",
    Instructions = "Research information and gather facts",
    Kernel = researchKernel
};

var writerAgent = new ChatCompletionAgent
{
    Name = "Writer",
    Instructions = "Write clear, engaging content based on research",
    Kernel = writerKernel
};

var editorAgent = new ChatCompletionAgent
{
    Name = "Editor",
    Instructions = "Review and improve content for clarity",
    Kernel = editorKernel
};

// Orchestrate them
var workflow = new SequentialAgentGroupChat(
    researchAgent,
    writerAgent,
    editorAgent
)
{
    ExecutionSettings = new()
    {
        TerminationStrategy = new ApprovalTerminationStrategy
        {
            Agents = new[] { editorAgent },
            MaximumIterations = 10
        }
    }
};

// Run the workflow
await foreach (var message in workflow.InvokeAsync(userTask))
{
    Console.WriteLine($"{message.AuthorName}: {message.Content}");
}
```

## Memory and Context

Agents need memory. Semantic Kernel has built-in support:

```csharp
using Microsoft.SemanticKernel.Memory;

// Setup memory
var memoryBuilder = new MemoryBuilder();
memoryBuilder.WithAzureOpenAITextEmbeddingGeneration(
    deploymentName: "text-embedding-ada-002",
    endpoint: config["AzureOpenAI:Endpoint"],
    apiKey: config["AzureOpenAI:ApiKey"]
);
memoryBuilder.WithMemoryStore(new AzureAISearchMemoryStore(
    searchServiceEndpoint,
    searchApiKey
));

var memory = memoryBuilder.Build();

// Store facts
await memory.SaveInformationAsync(
    collection: "customer-interactions",
    id: interaction.Id,
    text: interaction.Summary,
    description: interaction.Type
);

// Recall relevant context
var memories = memory.SearchAsync(
    collection: "customer-interactions",
    query: currentQuery,
    limit: 5
);

await foreach (var item in memories)
{
    context.Add(item.Metadata.Text);
}
```

## Error Handling and Retries

Production agents need resilience:

```csharp
public class ResilientAgent
{
    private readonly ChatCompletionAgent agent;
    private readonly ILogger logger;
    
    public async Task<string> ExecuteWithRetry(
        string query,
        int maxRetries = 3
    )
    {
        for (int attempt = 1; attempt <= maxRetries; attempt++)
        {
            try
            {
                return await agent.InvokeAsync(query);
            }
            catch (HttpRequestException ex) when (attempt < maxRetries)
            {
                logger.LogWarning(
                    "Attempt {Attempt} failed: {Error}. Retrying...",
                    attempt,
                    ex.Message
                );
                
                await Task.Delay(TimeSpan.FromSeconds(Math.Pow(2, attempt)));
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Agent execution failed");
                throw;
            }
        }
        
        throw new InvalidOperationException("Max retries exceeded");
    }
}
```

## Cost Tracking

Track every agent interaction:

```csharp
public class CostTrackingAgent : ChatCompletionAgent
{
    private readonly ICostTracker costTracker;
    
    public override async Task<ChatMessageContent> GetChatMessageContentAsync(
        ChatHistory history,
        PromptExecutionSettings settings,
        Kernel kernel,
        CancellationToken cancellationToken
    )
    {
        var startTime = DateTime.UtcNow;
        
        var result = await base.GetChatMessageContentAsync(
            history,
            settings,
            kernel,
            cancellationToken
        );
        
        // Track usage
        var usage = result.Metadata?["Usage"] as Usage;
        if (usage != null)
        {
            await costTracker.TrackUsage(new UsageRecord
            {
                Timestamp = startTime,
                Model = settings.ModelId,
                PromptTokens = usage.PromptTokens,
                CompletionTokens = usage.CompletionTokens,
                Duration = DateTime.UtcNow - startTime
            });
        }
        
        return result;
    }
}
```

## What Works Well

**Azure integration.** Connections to Azure OpenAI, AI Search, Cosmos DB—all straightforward.

**Plugin system.** Clean way to give agents capabilities.

**Type safety.** Being in C# means compile-time checks. Fewer runtime surprises.

**Multi-agent orchestration.** Sequential and parallel agent workflows work well.

## What's Painful

**Python support lags behind .NET.** If you're Python-first, LangChain is probably easier.

**Documentation gaps.** Some advanced scenarios lack examples.

**Learning curve.** The abstraction levels can be confusing at first.

**Debugging.** When agents misbehave, tracing through the framework layers is tedious.

## When to Use Semantic Kernel

**Good fit:**
- .NET applications
- Azure-heavy infrastructure
- Enterprise scenarios needing strong typing
- Teams comfortable with Microsoft stack

**Not ideal:**
- Python-only projects
- Need maximum flexibility
- Want cutting-edge features first
- Multi-cloud requirements

## Production Checklist

- [ ] Implement proper error handling and retries
- [ ] Add cost tracking and monitoring
- [ ] Set up observability (logging, traces)
- [ ] Implement rate limiting
- [ ] Add security checks on tool usage
- [ ] Test agent behavior extensively
- [ ] Document agent capabilities and limitations
- [ ] Set up alerting for failures
- [ ] Implement graceful degradation
- [ ] Add human-in-the-loop for critical actions

## The Verdict

Semantic Kernel is solid for building production agents in the Microsoft ecosystem. It's not perfect, but it's improving rapidly.

If you're building AI agents with .NET and Azure, give it a serious look. If you're Python-first or multi-cloud, maybe explore alternatives first.

For my use case—Azure-based enterprise clients using .NET—it's become my default agent framework.

Your mileage may vary. Test it with your specific requirements before committing.
