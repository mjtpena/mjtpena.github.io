---
title: "Azure OpenAI .NET SDK: Building Enterprise AI with C#"
author: Michael John Peña
draft: false
date: 2023-01-19
tags:
  - Azure
  - OpenAI
  - ".NET"
  - csharp
  - SDK
---

## Installation

```bash
dotnet add package Azure.AI.OpenAI --prerelease
```

## Basic Setup

```csharp
using Azure;
using Azure.AI.OpenAI;

// API Key authentication
var client = new OpenAIClient(
    new Uri("https://your-resource.openai.azure.com/"),
    new AzureKeyCredential("your-api-key")
);

// Azure AD authentication (recommended for production)
using Azure.Identity;

var credential = new DefaultAzureCredential();
var client = new OpenAIClient(
    new Uri("https://your-resource.openai.azure.com/"),
    credential
);
```

## Completions

```csharp
using Azure.AI.OpenAI;

public class CompletionService
{
    private readonly OpenAIClient _client;
    private readonly string _deploymentName;

    public CompletionService(OpenAIClient client, string deploymentName)
    {
        _client = client;
        _deploymentName = deploymentName;
    }

    public async Task<string> CompleteAsync(
        string prompt,
        int maxTokens = 500,
        float temperature = 0.7f)
    {
        var options = new CompletionsOptions
        {
            Prompts = { prompt },
            MaxTokens = maxTokens,
            Temperature = temperature
        };

        Response<Completions> response = await _client.GetCompletionsAsync(
            _deploymentName,
            options
        );

        return response.Value.Choices[0].Text.Trim();
    }

    public async Task<CompletionResult> CompleteWithMetadataAsync(
        string prompt,
        CompletionsOptions? options = null)
    {
        options ??= new CompletionsOptions { Prompts = { prompt } };
        if (!options.Prompts.Any())
        {
            options.Prompts.Add(prompt);
        }

        Response<Completions> response = await _client.GetCompletionsAsync(
            _deploymentName,
            options
        );

        var choice = response.Value.Choices[0];
        var usage = response.Value.Usage;

        return new CompletionResult
        {
            Text = choice.Text.Trim(),
            FinishReason = choice.FinishReason.ToString(),
            PromptTokens = usage.PromptTokens,
            CompletionTokens = usage.CompletionTokens,
            TotalTokens = usage.TotalTokens
        };
    }

    public async IAsyncEnumerable<string> StreamCompleteAsync(
        string prompt,
        int maxTokens = 500)
    {
        var options = new CompletionsOptions
        {
            Prompts = { prompt },
            MaxTokens = maxTokens
        };

        await foreach (StreamingCompletions streaming in
            _client.GetCompletionsStreamingAsync(_deploymentName, options))
        {
            await foreach (StreamingChoice choice in streaming.GetChoicesStreaming())
            {
                await foreach (string text in choice.GetTextStreaming())
                {
                    yield return text;
                }
            }
        }
    }
}

public record CompletionResult
{
    public string Text { get; init; } = string.Empty;
    public string FinishReason { get; init; } = string.Empty;
    public int PromptTokens { get; init; }
    public int CompletionTokens { get; init; }
    public int TotalTokens { get; init; }
}
```

## Chat Completions

```csharp
public class ChatService
{
    private readonly OpenAIClient _client;
    private readonly string _deploymentName;

    public ChatService(OpenAIClient client, string deploymentName)
    {
        _client = client;
        _deploymentName = deploymentName;
    }

    public async Task<string> ChatAsync(
        IEnumerable<ChatMessage> messages,
        int maxTokens = 500,
        float temperature = 0.7f)
    {
        var options = new ChatCompletionsOptions
        {
            MaxTokens = maxTokens,
            Temperature = temperature
        };

        foreach (var message in messages)
        {
            options.Messages.Add(message);
        }

        Response<ChatCompletions> response = await _client.GetChatCompletionsAsync(
            _deploymentName,
            options
        );

        return response.Value.Choices[0].Message.Content;
    }

    public async Task<ChatResult> ChatWithMetadataAsync(
        IEnumerable<ChatMessage> messages,
        ChatCompletionsOptions? options = null)
    {
        options ??= new ChatCompletionsOptions();

        foreach (var message in messages)
        {
            if (!options.Messages.Contains(message))
            {
                options.Messages.Add(message);
            }
        }

        Response<ChatCompletions> response = await _client.GetChatCompletionsAsync(
            _deploymentName,
            options
        );

        var choice = response.Value.Choices[0];
        var usage = response.Value.Usage;

        return new ChatResult
        {
            Message = choice.Message,
            FinishReason = choice.FinishReason.ToString(),
            PromptTokens = usage.PromptTokens,
            CompletionTokens = usage.CompletionTokens,
            TotalTokens = usage.TotalTokens
        };
    }

    public async IAsyncEnumerable<string> StreamChatAsync(
        IEnumerable<ChatMessage> messages,
        int maxTokens = 500)
    {
        var options = new ChatCompletionsOptions
        {
            MaxTokens = maxTokens
        };

        foreach (var message in messages)
        {
            options.Messages.Add(message);
        }

        await foreach (StreamingChatCompletions streaming in
            _client.GetChatCompletionsStreamingAsync(_deploymentName, options))
        {
            await foreach (StreamingChatChoice choice in streaming.GetChoicesStreaming())
            {
                await foreach (ChatMessage msg in choice.GetMessageStreaming())
                {
                    if (!string.IsNullOrEmpty(msg.Content))
                    {
                        yield return msg.Content;
                    }
                }
            }
        }
    }
}

public record ChatResult
{
    public ChatMessage Message { get; init; } = null!;
    public string FinishReason { get; init; } = string.Empty;
    public int PromptTokens { get; init; }
    public int CompletionTokens { get; init; }
    public int TotalTokens { get; init; }
}
```

## Conversation Manager

```csharp
public class ConversationManager
{
    private readonly ChatService _chatService;
    private readonly List<ChatMessage> _messages = new();
    private readonly string? _systemPrompt;

    public ConversationManager(
        ChatService chatService,
        string? systemPrompt = null)
    {
        _chatService = chatService;
        _systemPrompt = systemPrompt;

        if (!string.IsNullOrEmpty(systemPrompt))
        {
            _messages.Add(new ChatMessage(ChatRole.System, systemPrompt));
        }
    }

    public async Task<string> SendMessageAsync(string userMessage)
    {
        _messages.Add(new ChatMessage(ChatRole.User, userMessage));

        var result = await _chatService.ChatWithMetadataAsync(_messages);

        _messages.Add(result.Message);

        return result.Message.Content;
    }

    public async IAsyncEnumerable<string> StreamMessageAsync(string userMessage)
    {
        _messages.Add(new ChatMessage(ChatRole.User, userMessage));

        var fullResponse = new StringBuilder();

        await foreach (var token in _chatService.StreamChatAsync(_messages))
        {
            fullResponse.Append(token);
            yield return token;
        }

        _messages.Add(new ChatMessage(ChatRole.Assistant, fullResponse.ToString()));
    }

    public IReadOnlyList<ChatMessage> GetHistory() => _messages.AsReadOnly();

    public void ClearHistory()
    {
        _messages.Clear();
        if (!string.IsNullOrEmpty(_systemPrompt))
        {
            _messages.Add(new ChatMessage(ChatRole.System, _systemPrompt));
        }
    }
}

// Usage
var conversation = new ConversationManager(
    chatService,
    "You are a helpful Azure solutions architect."
);

var response1 = await conversation.SendMessageAsync("What database should I use?");
Console.WriteLine($"Bot: {response1}");

var response2 = await conversation.SendMessageAsync("How do I set that up?");
Console.WriteLine($"Bot: {response2}");
```

## Embeddings

```csharp
public class EmbeddingService
{
    private readonly OpenAIClient _client;
    private readonly string _deploymentName;

    public EmbeddingService(OpenAIClient client, string deploymentName = "text-embedding-ada-002")
    {
        _client = client;
        _deploymentName = deploymentName;
    }

    public async Task<float[]> GetEmbeddingAsync(string text)
    {
        var response = await _client.GetEmbeddingsAsync(
            _deploymentName,
            new EmbeddingsOptions(text)
        );

        return response.Value.Data[0].Embedding.ToArray();
    }

    public async Task<IList<float[]>> GetEmbeddingsAsync(IEnumerable<string> texts)
    {
        var options = new EmbeddingsOptions();
        foreach (var text in texts)
        {
            options.Input.Add(text);
        }

        var response = await _client.GetEmbeddingsAsync(_deploymentName, options);

        return response.Value.Data
            .Select(e => e.Embedding.ToArray())
            .ToList();
    }

    public static double CosineSimilarity(float[] a, float[] b)
    {
        if (a.Length != b.Length)
            throw new ArgumentException("Vectors must have same length");

        double dotProduct = 0;
        double normA = 0;
        double normB = 0;

        for (int i = 0; i < a.Length; i++)
        {
            dotProduct += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }

        return dotProduct / (Math.Sqrt(normA) * Math.Sqrt(normB));
    }

    public async Task<IEnumerable<(string Document, double Similarity)>> FindSimilarAsync(
        string query,
        IEnumerable<string> documents,
        int topK = 5)
    {
        var queryEmbedding = await GetEmbeddingAsync(query);
        var docEmbeddings = await GetEmbeddingsAsync(documents);

        var similarities = documents
            .Zip(docEmbeddings, (doc, emb) => (
                Document: doc,
                Similarity: CosineSimilarity(queryEmbedding, emb)
            ))
            .OrderByDescending(x => x.Similarity)
            .Take(topK);

        return similarities;
    }
}
```

## Dependency Injection Setup

```csharp
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Configuration;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddAzureOpenAI(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        var endpoint = configuration["AzureOpenAI:Endpoint"]
            ?? throw new InvalidOperationException("AzureOpenAI:Endpoint not configured");

        var apiKey = configuration["AzureOpenAI:ApiKey"];

        // Register OpenAIClient
        if (!string.IsNullOrEmpty(apiKey))
        {
            services.AddSingleton(sp => new OpenAIClient(
                new Uri(endpoint),
                new AzureKeyCredential(apiKey)
            ));
        }
        else
        {
            // Use Azure AD
            services.AddSingleton(sp => new OpenAIClient(
                new Uri(endpoint),
                new DefaultAzureCredential()
            ));
        }

        // Register services
        services.AddSingleton(sp =>
        {
            var client = sp.GetRequiredService<OpenAIClient>();
            var deployment = configuration["AzureOpenAI:CompletionDeployment"] ?? "text-davinci-003";
            return new CompletionService(client, deployment);
        });

        services.AddSingleton(sp =>
        {
            var client = sp.GetRequiredService<OpenAIClient>();
            var deployment = configuration["AzureOpenAI:ChatDeployment"] ?? "gpt-35-turbo";
            return new ChatService(client, deployment);
        });

        services.AddSingleton(sp =>
        {
            var client = sp.GetRequiredService<OpenAIClient>();
            var deployment = configuration["AzureOpenAI:EmbeddingDeployment"] ?? "text-embedding-ada-002";
            return new EmbeddingService(client, deployment);
        });

        return services;
    }
}

// In Program.cs or Startup.cs
builder.Services.AddAzureOpenAI(builder.Configuration);
```

## Error Handling

```csharp
using Azure;
using Polly;
using Polly.Retry;

public class ResilientChatService
{
    private readonly ChatService _chatService;
    private readonly AsyncRetryPolicy _retryPolicy;

    public ResilientChatService(ChatService chatService)
    {
        _chatService = chatService;

        _retryPolicy = Policy
            .Handle<RequestFailedException>(ex =>
                ex.Status == 429 || ex.Status >= 500)
            .WaitAndRetryAsync(
                retryCount: 3,
                sleepDurationProvider: attempt =>
                    TimeSpan.FromSeconds(Math.Pow(2, attempt)),
                onRetry: (exception, timeSpan, retryCount, context) =>
                {
                    Console.WriteLine($"Retry {retryCount} after {timeSpan.TotalSeconds}s");
                }
            );
    }

    public async Task<string> ChatAsync(
        IEnumerable<ChatMessage> messages,
        int maxTokens = 500)
    {
        return await _retryPolicy.ExecuteAsync(async () =>
            await _chatService.ChatAsync(messages, maxTokens)
        );
    }
}

// Custom exception handling
public class AzureOpenAIException : Exception
{
    public int? StatusCode { get; }
    public string? ErrorCode { get; }

    public AzureOpenAIException(string message, int? statusCode = null, string? errorCode = null)
        : base(message)
    {
        StatusCode = statusCode;
        ErrorCode = errorCode;
    }

    public static AzureOpenAIException FromRequestFailed(RequestFailedException ex)
    {
        return new AzureOpenAIException(
            ex.Message,
            ex.Status,
            ex.ErrorCode
        );
    }
}
```

## ASP.NET Core Integration

```csharp
[ApiController]
[Route("api/[controller]")]
public class ChatController : ControllerBase
{
    private readonly ChatService _chatService;
    private readonly ILogger<ChatController> _logger;

    public ChatController(ChatService chatService, ILogger<ChatController> logger)
    {
        _chatService = chatService;
        _logger = logger;
    }

    [HttpPost]
    public async Task<ActionResult<ChatResponse>> Chat([FromBody] ChatRequest request)
    {
        try
        {
            var messages = new List<ChatMessage>
            {
                new ChatMessage(ChatRole.System, request.SystemPrompt ?? "You are a helpful assistant."),
                new ChatMessage(ChatRole.User, request.Message)
            };

            var result = await _chatService.ChatWithMetadataAsync(messages);

            return Ok(new ChatResponse
            {
                Message = result.Message.Content,
                TokensUsed = result.TotalTokens
            });
        }
        catch (RequestFailedException ex) when (ex.Status == 429)
        {
            _logger.LogWarning("Rate limit exceeded");
            return StatusCode(429, "Rate limit exceeded. Please try again later.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing chat request");
            return StatusCode(500, "An error occurred processing your request.");
        }
    }

    [HttpPost("stream")]
    public async Task StreamChat([FromBody] ChatRequest request)
    {
        Response.ContentType = "text/event-stream";

        var messages = new List<ChatMessage>
        {
            new ChatMessage(ChatRole.System, request.SystemPrompt ?? "You are a helpful assistant."),
            new ChatMessage(ChatRole.User, request.Message)
        };

        await foreach (var token in _chatService.StreamChatAsync(messages))
        {
            await Response.WriteAsync($"data: {token}\n\n");
            await Response.Body.FlushAsync();
        }

        await Response.WriteAsync("data: [DONE]\n\n");
    }
}

public record ChatRequest
{
    public string Message { get; init; } = string.Empty;
    public string? SystemPrompt { get; init; }
}

public record ChatResponse
{
    public string Message { get; init; } = string.Empty;
    public int TokensUsed { get; init; }
}
```

## Best Practices

1. **Use Azure AD authentication** for production
2. **Implement retry policies** with Polly
3. **Use dependency injection** for service management
4. **Stream responses** for better UX
5. **Track token usage** for cost management
6. **Handle errors gracefully** with proper status codes

## Resources

- [Azure.AI.OpenAI NuGet](https://www.nuget.org/packages/Azure.AI.OpenAI)
- [Azure SDK for .NET](https://github.com/Azure/azure-sdk-for-net)
- [Samples Repository](https://github.com/Azure/azure-sdk-for-net/tree/main/sdk/openai)
