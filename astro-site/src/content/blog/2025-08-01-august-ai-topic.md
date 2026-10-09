---
title: "Getting Started with Semantic Kernel 2.x: A Practical Introduction"
description: "Semantic Kernel is an SDK that integrates Large Language Models (LLMs) with conventional programming languages. Version 2.x introduces a more streamlined…"
author: Michael John Peña
draft: false
date: 2025-08-01
tags:
  - Semantic Kernel
  - AI
  - .NET
  - Microsoft
  - LLM
---

## What is Semantic Kernel 2.x?

Semantic Kernel is an SDK that integrates Large Language Models (LLMs) with conventional programming languages. Version 2.x introduces a more streamlined API, better function calling support, and enhanced memory capabilities.

## Setting Up Your First Project

```csharp
using Microsoft.SemanticKernel;
using Microsoft.SemanticKernel.ChatCompletion;

// Create the kernel with Azure OpenAI
var builder = Kernel.CreateBuilder();
builder.AddAzureOpenAIChatCompletion(
    deploymentName: "gpt-4o",
    endpoint: Environment.GetEnvironmentVariable("AZURE_OPENAI_ENDPOINT")!,
    apiKey: Environment.GetEnvironmentVariable("AZURE_OPENAI_KEY")!
);

var kernel = builder.Build();

// Get the chat completion service
var chatService = kernel.GetRequiredService<IChatCompletionService>();

// Create a chat history
var history = new ChatHistory();
history.AddSystemMessage("You are a helpful assistant.");
history.AddUserMessage("Explain microservices architecture in simple terms.");

// Get the response
var response = await chatService.GetChatMessageContentAsync(history);
Console.WriteLine(response.Content);
```

## Key Concepts in 2.x

The plugin system in Semantic Kernel 2.x allows you to expose native functions to the LLM. This enables the model to call your code when it determines it would be helpful for completing a task.

```csharp
public class WeatherPlugin
{
    [KernelFunction("get_weather")]
    [Description("Gets the current weather for a specified city")]
    public string GetWeather(
        [Description("The city name")] string city)
    {
        // In production, call a real weather API
        return $"The weather in {city} is 72°F and sunny.";
    }
}
```

Semantic Kernel 2.x provides a solid foundation for building AI applications that combine the reasoning capabilities of LLMs with the precision of traditional code.
