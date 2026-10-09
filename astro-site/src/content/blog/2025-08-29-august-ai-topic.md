---
title: "Semantic Kernel Filters: Intercepting and Modifying AI Operations"
description: "Semantic Kernel supports several filter types: function invocation filters, prompt render filters, and auto function invocation filters. Each intercepts…"
author: Michael John Peña
draft: false
date: 2025-08-29
tags:
  - Semantic Kernel
  - Filters
  - Middleware
  - .NET
  - AI Architecture
---

## Understanding Filter Types

Semantic Kernel supports several filter types: function invocation filters, prompt render filters, and auto function invocation filters. Each intercepts different stages of the AI pipeline.

## Implementing a Function Invocation Filter

```csharp
using Microsoft.SemanticKernel;

public class LoggingFilter : IFunctionInvocationFilter
{
    private readonly ILogger<LoggingFilter> _logger;

    public LoggingFilter(ILogger<LoggingFilter> logger)
    {
        _logger = logger;
    }

    public async Task OnFunctionInvocationAsync(
        FunctionInvocationContext context,
        Func<FunctionInvocationContext, Task> next)
    {
        var startTime = DateTime.UtcNow;

        _logger.LogInformation(
            "Invoking function {PluginName}.{FunctionName}",
            context.Function.PluginName,
            context.Function.Name);

        try
        {
            await next(context);

            var duration = DateTime.UtcNow - startTime;
            _logger.LogInformation(
                "Function {FunctionName} completed in {Duration}ms",
                context.Function.Name,
                duration.TotalMilliseconds);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Function {FunctionName} failed",
                context.Function.Name);
            throw;
        }
    }
}
```

## Prompt Render Filter for Modification

```csharp
public class PromptEnhancementFilter : IPromptRenderFilter
{
    public async Task OnPromptRenderAsync(
        PromptRenderContext context,
        Func<PromptRenderContext, Task> next)
    {
        // Add context before rendering
        if (context.Arguments.TryGetValue("user_context", out var userContext))
        {
            context.Arguments["enhanced_prompt"] =
                $"User Context: {userContext}\n\n{context.Arguments["prompt"]}";
        }

        await next(context);

        // Log the final rendered prompt
        Console.WriteLine($"Rendered prompt: {context.RenderedPrompt}");
    }
}
```

## Registering Filters

```csharp
var builder = Kernel.CreateBuilder();
builder.AddAzureOpenAIChatCompletion(deploymentName, endpoint, apiKey);

// Add filters
builder.Services.AddSingleton<IFunctionInvocationFilter, LoggingFilter>();
builder.Services.AddSingleton<IPromptRenderFilter, PromptEnhancementFilter>();

var kernel = builder.Build();
```

Filters enable clean separation of cross-cutting concerns from your core AI logic, making applications more maintainable and testable.
