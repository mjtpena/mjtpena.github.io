---
title: "Implementing Semantic Kernel Plugins for Enterprise Applications"
author: Michael John Peña
draft: false
date: 2025-08-05
tags:
  - Semantic Kernel
  - Plugins
  - .NET
  - Enterprise
  - AI Integration

---

I wrote "Implementing Semantic Kernel Plugins for Enterprise Applications" to share practical, production-minded guidance on this topic.

## Creating Native Function Plugins

Native plugins expose C# methods to the kernel, allowing the LLM to invoke them when appropriate.

```csharp
using Microsoft.SemanticKernel;
using System.ComponentModel;

public class CustomerPlugin
{
    private readonly ICustomerRepository _repository;

    public CustomerPlugin(ICustomerRepository repository)
    {
        _repository = repository;
    }

    [KernelFunction("get_customer_orders")]
    [Description("Retrieves recent orders for a customer by their email address")]
    public async Task<string> GetCustomerOrdersAsync(
        [Description("Customer email address")] string email,
        [Description("Number of orders to retrieve")] int limit = 5)
    {
        var customer = await _repository.GetByEmailAsync(email);
        if (customer == null)
            return "Customer not found.";

        var orders = await _repository.GetOrdersAsync(customer.Id, limit);

        return System.Text.Json.JsonSerializer.Serialize(orders,
            new JsonSerializerOptions { WriteIndented = true });
    }

    [KernelFunction("update_customer_preferences")]
    [Description("Updates customer communication preferences")]
    public async Task<string> UpdatePreferencesAsync(
        [Description("Customer email")] string email,
        [Description("Email opt-in preference")] bool emailOptIn,
        [Description("SMS opt-in preference")] bool smsOptIn)
    {
        var result = await _repository.UpdatePreferencesAsync(
            email, emailOptIn, smsOptIn);

        return result ? "Preferences updated successfully." : "Update failed.";
    }
}
```

## Registering Plugins with the Kernel

```csharp
var kernel = Kernel.CreateBuilder()
    .AddAzureOpenAIChatCompletion(deploymentName, endpoint, apiKey)
    .Build();

// Register the plugin
kernel.Plugins.AddFromObject(
    new CustomerPlugin(customerRepository),
    "CustomerService");

// Enable automatic function calling
var settings = new OpenAIPromptExecutionSettings
{
    ToolCallBehavior = ToolCallBehavior.AutoInvokeKernelFunctions
};

var result = await kernel.InvokePromptAsync(
    "Check recent orders for customer@example.com",
    new KernelArguments(settings));
```

Well-designed plugins make your AI applications genuinely useful by connecting natural language understanding to real business actions.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
