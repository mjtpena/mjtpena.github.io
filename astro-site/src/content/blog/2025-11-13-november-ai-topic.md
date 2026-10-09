---
title: "Semantic Kernel: Orchestrating AI Agents with Plugins and Planners"
description: "Semantic Kernel abstracts the complexity of working with multiple AI services while providing extensibility through plugins. This allows developers to…"
author: Michael John Peña
draft: false
date: 2025-11-13
tags:
  - Semantic Kernel
  - AI Agents
  - Azure OpenAI
  - C#
  - Orchestration
---

## Understanding Semantic Kernel

Semantic Kernel abstracts the complexity of working with multiple AI services while providing extensibility through plugins. This allows developers to create modular, maintainable AI applications.

## Building Plugins

Create reusable functionality that AI agents can invoke:

```csharp
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.Connectors.OpenAI;
using System.ComponentModel;

public class CustomerPlugin
{
    private readonly ICustomerRepository _repository;
    private readonly IEmailService _emailService;

    public CustomerPlugin(ICustomerRepository repository, IEmailService emailService)
    {
        _repository = repository;
        _emailService = emailService;
    }

    [KernelFunction("get_customer_info")]
    [Description("Retrieves customer information by customer ID")]
    public async Task<CustomerInfo> GetCustomerInfoAsync(
        [Description("The unique customer identifier")] string customerId)
    {
        var customer = await _repository.GetByIdAsync(customerId);
        return new CustomerInfo
        {
            Id = customer.Id,
            Name = customer.Name,
            Email = customer.Email,
            Tier = customer.LoyaltyTier,
            TotalPurchases = customer.TotalPurchases
        };
    }

    [KernelFunction("send_customer_email")]
    [Description("Sends an email to a customer")]
    public async Task<bool> SendCustomerEmailAsync(
        [Description("The customer's email address")] string email,
        [Description("Email subject line")] string subject,
        [Description("Email body content")] string body)
    {
        return await _emailService.SendAsync(email, subject, body);
    }

    [KernelFunction("update_customer_tier")]
    [Description("Updates a customer's loyalty tier based on purchase history")]
    public async Task<string> UpdateCustomerTierAsync(
        [Description("The unique customer identifier")] string customerId)
    {
        var customer = await _repository.GetByIdAsync(customerId);
        var newTier = CalculateTier(customer.TotalPurchases);

        if (newTier != customer.LoyaltyTier)
        {
            await _repository.UpdateTierAsync(customerId, newTier);
            return $"Customer {customerId} upgraded to {newTier}";
        }

        return $"Customer {customerId} remains at {customer.LoyaltyTier}";
    }

    private string CalculateTier(decimal totalPurchases) =>
        totalPurchases switch
        {
            >= 10000 => "Platinum",
            >= 5000 => "Gold",
            >= 1000 => "Silver",
            _ => "Bronze"
        };
}
```

## Configuring the Kernel

Set up the kernel with plugins and AI services:

```csharp
var builder = Kernel.CreateBuilder();

// Add Azure OpenAI service
builder.AddAzureOpenAIChatCompletion(
    deploymentName: "gpt-4",
    endpoint: configuration["AzureOpenAI:Endpoint"],
    apiKey: configuration["AzureOpenAI:ApiKey"]
);

// Register plugins
builder.Plugins.AddFromType<CustomerPlugin>();
builder.Plugins.AddFromType<OrderPlugin>();
builder.Plugins.AddFromType<InventoryPlugin>();

var kernel = builder.Build();

// Enable automatic function calling
var settings = new OpenAIPromptExecutionSettings
{
    ToolCallBehavior = ToolCallBehavior.AutoInvokeKernelFunctions,
    MaxTokens = 1000
};

// Execute with automatic plugin invocation
var result = await kernel.InvokePromptAsync(
    "Check customer C12345's loyalty tier and send them a thank you email if they're Gold or above",
    new KernelArguments(settings)
);
```

## Using Planners

Planners enable complex multi-step reasoning:

```csharp
var planner = new FunctionCallingStepwisePlanner();

var result = await planner.ExecuteAsync(
    kernel,
    "Review all orders from last week, identify customers who spent over $500, " +
    "upgrade their loyalty tier if applicable, and send them a personalized thank you email"
);

Console.WriteLine($"Plan executed with {result.Iterations} steps");
Console.WriteLine($"Final answer: {result.FinalAnswer}");
```

Semantic Kernel's architecture enables building sophisticated AI agents that can reason about complex tasks while maintaining full control over the actions they can take.
