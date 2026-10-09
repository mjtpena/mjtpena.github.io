---
title: "Semantic Kernel: Building AI Orchestration with .NET"
description: "Semantic Kernel provides a clean abstraction for building AI-powered features while maintaining flexibility to switch between different LLM providers."
author: Michael John Peña
draft: false
date: 2025-10-14
tags:
  - Semantic Kernel
  - .NET
  - AI Orchestration
  - Azure OpenAI
  - C#
---

## Setting Up Semantic Kernel

Configure Semantic Kernel with Azure OpenAI:

```csharp
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;
using Microsoft.SemanticKernel.Connectors.AzureOpenAI;

public class AIOrchestrator
{
    private readonly Kernel _kernel;

    public AIOrchestrator(string endpoint, string apiKey, string deploymentName)
    {
        var builder = Kernel.CreateBuilder();

        builder.AddAzureOpenAIChatCompletion(
            deploymentName: deploymentName,
            endpoint: endpoint,
            apiKey: apiKey
        );

        _kernel = builder.Build();
    }

    public async Task<string> ProcessQueryAsync(string userQuery)
    {
        var chatService = _kernel.GetRequiredService<IChatCompletionService>();

        var history = new ChatHistory();
        history.AddSystemMessage("You are a helpful assistant for enterprise data analysis.");
        history.AddUserMessage(userQuery);

        var response = await chatService.GetChatMessageContentAsync(history);
        return response.Content ?? string.Empty;
    }
}
```

## Creating Native Functions as Plugins

Extend AI capabilities with custom functions:

```csharp
using Microsoft.SemanticKernel;
using System.ComponentModel;

public class DataAnalysisPlugin
{
    [KernelFunction("GetSalesData")]
    [Description("Retrieves sales data for a specified date range and region")]
    public async Task<string> GetSalesDataAsync(
        [Description("Start date in YYYY-MM-DD format")] string startDate,
        [Description("End date in YYYY-MM-DD format")] string endDate,
        [Description("Region code (NA, EU, APAC)")] string region)
    {
        // Simulated data retrieval
        var data = new
        {
            Region = region,
            Period = $"{startDate} to {endDate}",
            TotalSales = 1250000.00m,
            OrderCount = 4523,
            TopProduct = "Enterprise License"
        };

        return System.Text.Json.JsonSerializer.Serialize(data);
    }

    [KernelFunction("CalculateTrend")]
    [Description("Calculates trend analysis for provided metrics")]
    public string CalculateTrend(
        [Description("Current period value")] double currentValue,
        [Description("Previous period value")] double previousValue)
    {
        var change = ((currentValue - previousValue) / previousValue) * 100;
        var trend = change > 0 ? "increasing" : "decreasing";

        return $"Trend is {trend} by {Math.Abs(change):F2}%";
    }
}
```

## Automatic Function Calling

Enable the AI to automatically invoke plugins:

```csharp
public async Task<string> ProcessWithFunctionsAsync(string userQuery)
{
    _kernel.Plugins.AddFromType<DataAnalysisPlugin>();

    var settings = new AzureOpenAIPromptExecutionSettings
    {
        FunctionChoiceBehavior = FunctionChoiceBehavior.Auto()
    };

    var response = await _kernel.InvokePromptAsync(userQuery, new(settings));
    return response.ToString();
}
```

Semantic Kernel provides a clean abstraction for building AI-powered features while maintaining flexibility to switch between different LLM providers.
