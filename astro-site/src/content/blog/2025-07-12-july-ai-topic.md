---
title: "Semantic Kernel v2: Building Composable AI Applications in C#"
description: "Semantic Kernel v2 brings enterprise-grade patterns to AI development, making it easier to build maintainable, testable AI applications."
author: Michael John Peña
draft: false
date: 2025-07-12
tags:
  - Semantic Kernel
  - C#
  - .NET
  - AI Applications
  - Microsoft
---

## Setting Up the Kernel

The v2 API provides cleaner dependency injection and configuration:

```csharp
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.Connectors.AzureOpenAI;

var builder = Kernel.CreateBuilder();

// Add AI services
builder.AddAzureOpenAIChatCompletion(
    deploymentName: "gpt-4o",
    endpoint: configuration["AzureOpenAI:Endpoint"],
    apiKey: configuration["AzureOpenAI:ApiKey"]
);

// Add plugins
builder.Plugins.AddFromType<CustomerPlugin>();
builder.Plugins.AddFromType<OrderPlugin>();

// Configure filters for observability
builder.Services.AddSingleton<IPromptRenderFilter, LoggingPromptFilter>();
builder.Services.AddSingleton<IFunctionInvocationFilter, MetricsFilter>();

var kernel = builder.Build();
```

## Creating Plugins with Native Functions

Plugins encapsulate domain logic that the AI can invoke:

```csharp
public class CustomerPlugin
{
    private readonly ICustomerService _customerService;

    public CustomerPlugin(ICustomerService customerService)
    {
        _customerService = customerService;
    }

    [KernelFunction("GetCustomerDetails")]
    [Description("Retrieves customer information by customer ID")]
    public async Task<CustomerInfo> GetCustomerAsync(
        [Description("The unique customer identifier")] string customerId)
    {
        return await _customerService.GetByIdAsync(customerId);
    }

    [KernelFunction("UpdateCustomerPreferences")]
    [Description("Updates customer communication preferences")]
    public async Task<bool> UpdatePreferencesAsync(
        string customerId,
        [Description("Email opt-in preference")] bool emailOptIn,
        [Description("SMS opt-in preference")] bool smsOptIn)
    {
        return await _customerService.UpdatePreferencesAsync(
            customerId, emailOptIn, smsOptIn);
    }
}
```

## Orchestrating with Planners

The new Handlebars planner creates execution plans dynamically:

```csharp
var planner = new HandlebarsPlanner(new HandlebarsPlannerOptions
{
    AllowLoops = true,
    MaxTokens = 4096
});

var plan = await planner.CreatePlanAsync(kernel,
    "Find customer John Smith and update their email preferences to opt-in");

var result = await plan.InvokeAsync(kernel);
```

Semantic Kernel v2 brings enterprise-grade patterns to AI development, making it easier to build maintainable, testable AI applications.
