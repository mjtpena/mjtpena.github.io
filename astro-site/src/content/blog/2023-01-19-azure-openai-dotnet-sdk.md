---
title: "Calling Azure OpenAI from C# Before There's an Official .NET SDK"
description: "Azure OpenAI is GA but has no official .NET SDK yet. How I'd build a thin, typed C# client over the 2022-12-01 REST API that is easy to delete later."
author: Michael John Peña
draft: false
date: 2023-01-19
tags:
  - Azure OpenAI
  - .NET
  - C#
  - REST API
  - Azure AD
  - Resilience
---

Azure OpenAI Service went generally available on 16 January, and the obvious first question for a .NET team is which NuGet package to install. Right now the honest answer is none. Python developers have the `openai` package with `api_type = "azure"`, but there is no official Azure SDK for .NET for Azure OpenAI yet, so C# shops are calling the REST API themselves. How you wrap that API this month decides how painful your migration is when an official library does arrive.

## What actually exists on 19 January 2023

Before writing any code, it helps to be precise about the surface you're targeting. A lot of the C# samples doing the rounds are written against the public OpenAI API, and they don't map one-to-one.

| Area | State today |
|---|---|
| Service status | Generally available (announced 16 January 2023), access still gated by an application form |
| Stable REST version | `api-version=2022-12-01` |
| Operations in that version | Completions and embeddings only. There is no chat endpoint |
| ChatGPT | Microsoft has said it is coming to the service "soon"; it isn't available today |
| Official .NET client | None. You write the HTTP calls |
| Authentication | `api-key` header, or an Azure Active Directory bearer token |
| Embeddings models | The first-generation families. Microsoft hasn't given a date for `text-embedding-ada-002` on Azure |

The January 2023 entry in [What's new in Azure OpenAI Service](https://learn.microsoft.com/en-us/azure/ai-services/openai/whats-new) records the GA release, and the [GA announcement](https://azure.microsoft.com/en-us/blog/general-availability-of-azure-openai-service-expands-access-to-large-advanced-ai-models-with-added-enterprise-benefits/) covers the commercial side. For the wire format, the [Azure OpenAI REST API reference](https://learn.microsoft.com/en-us/azure/ai-services/openai/reference) is what matters. The Azure-specific differences are the ones that break copied OpenAI samples: the URL contains your resource name and a **deployment** name rather than a model name, every call needs an `api-version` query string, and the key goes in an `api-key` header rather than `Authorization: Bearer sk-...`.

On embeddings, Microsoft hasn't given a date for `text-embedding-ada-002` on Azure; a [Microsoft Q&A thread](https://learn.microsoft.com/en-us/answers/questions/1163659/text-embedding-ada-002-model-availability-in-azure) suggests early 2023. Until then you're on the older `text-search-*` and `text-similarity-*` models, which use separate document and query models. Don't build a vector index you'll have to re-embed once ada-002 arrives without deciding that's acceptable.

## Why I wouldn't reach for a community OpenAI library

There are community .NET libraries for the public OpenAI API, and some are well made. My problem with using them against Azure is that they were designed for a different URL shape, a different auth model and a model-name-first mental model. You end up depending on how well a third party has bolted Azure on, for a service where the security story (private endpoints, Azure AD, your own resource) is the reason you chose Azure in the first place.

The REST surface is small: two POST operations. A client you own is a few hundred lines, has no surprise dependencies, and you can delete it in an afternoon when Microsoft ships a supported package. That last property is the design goal.

The other obvious route is to generate a client from the published [2022-12-01 OpenAPI spec](https://github.com/Azure/azure-rest-api-specs/blob/main/specification/cognitiveservices/data-plane/OpenAIInference/stable/2022-12-01/inference.json) with AutoRest or NSwag. For a two-operation surface I wouldn't. Generated code is more of it, it's harder to read and harder to delete cleanly, and neither generator gives you anything useful for the server-sent events that `stream: true` returns, which is the part you'd most want help with.

## Design rules for a client you plan to throw away

My rule of thumb is to model the wire format and nothing else. That means:

- **Records that mirror the JSON**, using the API's own field names. No "AI provider" interfaces, no generic `IChatBot` abstraction. When the official SDK lands, you want a search-and-replace job, not an architectural debate.
- **Deployment name as a parameter on every call.** Deployments are how you swap `text-davinci-003` for whatever comes next without code changes, and different features will want different deployments for quota reasons.
- **`api-version` pinned as a single constant.** Bumping it should be a deliberate, reviewed change, not something that drifts with a config file.
- **Authentication swappable at construction time.** Keys in a developer's user secrets, Azure AD everywhere else.

The examples below target .NET 7 and C# 11. The only package is `Azure.Identity` (1.8.1 at the time of writing) for Azure AD tokens. Together, the three files make a complete console app.

```bash
dotnet new console -n AoaiRest -f net7.0
cd AoaiRest
dotnet add package Azure.Identity --version 1.8.1
```

### The request and response types

`System.Text.Json` in .NET 7 has no snake_case naming policy, so each property carries its JSON name explicitly. Nullable optional fields plus `WhenWritingNull` mean you only send what you set, which keeps you on the service's defaults.

```csharp
// Models.cs
using System.Text.Json.Serialization;

public sealed record CompletionRequest(
    [property: JsonPropertyName("prompt")] string Prompt,
    [property: JsonPropertyName("max_tokens")] int MaxTokens = 256,
    [property: JsonPropertyName("temperature")] double? Temperature = null,
    [property: JsonPropertyName("stop")] string[]? Stop = null,
    [property: JsonPropertyName("user")] string? User = null,
    [property: JsonPropertyName("stream")] bool? Stream = null);

public sealed record CompletionResponse(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("choices")] IReadOnlyList<CompletionChoice> Choices,
    [property: JsonPropertyName("usage")] CompletionUsage? Usage);

public sealed record CompletionChoice(
    [property: JsonPropertyName("text")] string Text,
    [property: JsonPropertyName("index")] int Index,
    [property: JsonPropertyName("finish_reason")] string? FinishReason);

public sealed record CompletionUsage(
    [property: JsonPropertyName("prompt_tokens")] int PromptTokens,
    [property: JsonPropertyName("completion_tokens")] int CompletionTokens,
    [property: JsonPropertyName("total_tokens")] int TotalTokens);

public sealed record EmbeddingRequest(
    [property: JsonPropertyName("input")] string Input);

public sealed record EmbeddingResponse(
    [property: JsonPropertyName("data")] IReadOnlyList<EmbeddingItem> Data);

public sealed record EmbeddingItem(
    [property: JsonPropertyName("index")] int Index,
    [property: JsonPropertyName("embedding")] float[] Embedding);
```

### The client

```csharp
// AzureOpenAIRestClient.cs
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using Azure.Core;

public sealed class AzureOpenAIRestClient
{
    private const string ApiVersion = "2022-12-01";
    private const int MaxAttempts = 4;
    private static readonly string[] Scopes = { "https://cognitiveservices.azure.com/.default" };
    private static readonly JsonSerializerOptions JsonOptions =
        new() { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };

    private readonly HttpClient _http;
    private readonly TokenCredential? _credential;
    private readonly string? _apiKey;
    private readonly SemaphoreSlim _tokenLock = new(1, 1);
    private AccessToken _token;

    // BaseAddress must be https://<your-resource-name>.openai.azure.com/openai/ (with the trailing slash).
    public AzureOpenAIRestClient(HttpClient http, TokenCredential credential)
    {
        _http = http;
        _credential = credential;
    }

    public AzureOpenAIRestClient(HttpClient http, string apiKey)
    {
        _http = http;
        _apiKey = apiKey;
    }

    public async Task<CompletionResponse> CompleteAsync(
        string deployment, CompletionRequest request, CancellationToken ct = default)
    {
        using var response = await SendAsync(deployment, "completions",
            request with { Stream = null }, HttpCompletionOption.ResponseContentRead, ct);
        return (await response.Content.ReadFromJsonAsync<CompletionResponse>(JsonOptions, ct))!;
    }

    public async IAsyncEnumerable<string> StreamCompletionAsync(
        string deployment, CompletionRequest request,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        using var response = await SendAsync(deployment, "completions",
            request with { Stream = true }, HttpCompletionOption.ResponseHeadersRead, ct);
        using var reader = new StreamReader(await response.Content.ReadAsStreamAsync(ct));

        while (await reader.ReadLineAsync(ct) is { } line)
        {
            if (!line.StartsWith("data: ", StringComparison.Ordinal)) continue;
            var payload = line["data: ".Length..];
            if (payload == "[DONE]") yield break;

            var chunk = JsonSerializer.Deserialize<CompletionResponse>(payload, JsonOptions);
            var text = chunk?.Choices.FirstOrDefault()?.Text;
            if (!string.IsNullOrEmpty(text)) yield return text;
        }
    }

    public async Task<float[]> EmbedAsync(
        string deployment, string input, CancellationToken ct = default)
    {
        // The API reference recommends replacing newlines with spaces unless you're embedding code.
        var request = new EmbeddingRequest(input.Replace('\n', ' '));
        using var response = await SendAsync(deployment, "embeddings",
            request, HttpCompletionOption.ResponseContentRead, ct);
        var result = await response.Content.ReadFromJsonAsync<EmbeddingResponse>(JsonOptions, ct);
        return result!.Data[0].Embedding;
    }

    private async Task<HttpResponseMessage> SendAsync(
        string deployment, string operation, object body,
        HttpCompletionOption completionOption, CancellationToken ct)
    {
        for (var attempt = 1; ; attempt++)
        {
            // A request message can only be sent once, so build a fresh one per attempt.
            using var request = await CreateRequestAsync(deployment, operation, body, ct);
            var response = await _http.SendAsync(request, completionOption, ct);

            if (response.IsSuccessStatusCode) return response;

            var status = response.StatusCode;
            var transient = status == HttpStatusCode.TooManyRequests || (int)status >= 500;
            if (!transient || attempt == MaxAttempts)
            {
                var error = await response.Content.ReadAsStringAsync(ct);
                response.Dispose();
                throw new HttpRequestException(
                    $"Azure OpenAI returned {(int)status}: {error}", null, status);
            }

            // Capped exponential backoff with jitter, so parallel callers don't retry in lockstep.
            var delay = response.Headers.RetryAfter?.Delta
                ?? TimeSpan.FromSeconds(Math.Min(30, Math.Pow(2, attempt)) + Random.Shared.NextDouble());
            response.Dispose();
            await Task.Delay(delay, ct);
        }
    }

    private async Task<HttpRequestMessage> CreateRequestAsync(
        string deployment, string operation, object body, CancellationToken ct)
    {
        var request = new HttpRequestMessage(HttpMethod.Post,
            $"deployments/{Uri.EscapeDataString(deployment)}/{operation}?api-version={ApiVersion}")
        {
            Content = JsonContent.Create(body, body.GetType(), options: JsonOptions)
        };

        if (_apiKey is not null)
        {
            request.Headers.Add("api-key", _apiKey);
        }
        else
        {
            request.Headers.Authorization =
                new AuthenticationHeaderValue("Bearer", await GetTokenAsync(ct));
        }

        return request;
    }

    private async Task<string> GetTokenAsync(CancellationToken ct)
    {
        await _tokenLock.WaitAsync(ct);
        try
        {
            // Refresh five minutes early so a request never leaves with an expiring token.
            if (_token.ExpiresOn <= DateTimeOffset.UtcNow.AddMinutes(5))
            {
                _token = await _credential!.GetTokenAsync(new TokenRequestContext(Scopes), ct);
            }
            return _token.Token;
        }
        finally
        {
            _tokenLock.Release();
        }
    }
}
```

## How the client behaves

The design rules decide the shape of the code. These are the behaviours that matter once it's running.

### Authentication: use the key to get started, Azure AD to ship

The API accepts either an `api-key` header or an Azure AD bearer token. Keys are the quickest way to a first response. They're also a shared secret that grants full data-plane access to the resource, and anyone who can list keys in the portal has it. For anything beyond a prototype, I'd use Azure AD: give the app's managed identity (or your developer account) the Cognitive Services User role on the resource, and request a token for the `https://cognitiveservices.azure.com/.default` scope.

[`DefaultAzureCredential`](https://learn.microsoft.com/en-us/dotnet/api/azure.identity.defaultazurecredential) lets the same code use your Visual Studio or Azure CLI sign-in locally and the managed identity in Azure. The client caches the token because the official Azure SDK clients normally do that for you through their pipeline, and you don't have that pipeline here. Calling the credential on every request adds latency, and with some credential types it adds a call to Azure AD each time.

### Retries: 429 is normal, 400 is your problem

Throttling is part of normal operation for this service, not an outage. Quotas are per deployment, and a burst of requests will get `429 Too Many Requests`. The client retries 429s and 5xx responses, honours `Retry-After` when the service sends it, and otherwise backs off exponentially with a 30-second cap and up to a second of random jitter. Without the jitter, every caller that hit the same 429 retries at 2, 4 and 8 seconds together and gets throttled again. It deliberately does not retry anything else. A 400 means the request is wrong, the prompt plus `max_tokens` exceeded the model's context, or the content filter rejected it, and sending it again only burns quota. I covered pacing and scale-out in more depth in [throttling in the Azure OpenAI preview](/blog/2023-01-10-rate-limiting-azure-openai/).

If you already use Polly through `Microsoft.Extensions.Http.Polly`, move the retry loop into a policy on the `HttpClient` instead. Just make sure you don't end up with both, or four attempts quietly become sixteen.

### Streaming and what you lose with it

Setting `stream: true` makes the service send data-only server-sent events, ending with `data: [DONE]`. Reading with `HttpCompletionOption.ResponseHeadersRead` matters here: without it, `HttpClient` buffers the whole body and you get no streaming at all.

Streaming improves how fast a reply feels in a UI, but the chunks don't carry a `usage` block. If you charge back or cap spend per user, you'll need to count tokens yourself for streamed calls. The approach in [counting and capping tokens](/blog/2023-01-11-token-management-azure-openai/) applies, even though `tiktoken` is a Python library and you'll be estimating on the .NET side. There's a second cost: the retry loop only covers the initial response, so once the headers are back it has already returned success, and a stream that fails part-way or is cut short by the content filter has to be handled by the caller, by checking `finish_reason` on the last chunk. The sketch above yields text only, so return the whole choice instead if you need that check. For back-end jobs nobody is watching, I'd skip streaming entirely and keep the exact usage numbers.

### Embeddings: one input per call, for now

The 2022-12-01 contract describes the `input` field as a string or an array, and limits each input to 2,048 tokens. I keep `EmbedAsync` to a single string per request and add batching once the newer embeddings model arrives and I can test it against a real deployment. Embeddings deployments are throttled per deployment in the same way as completions (requests per second), so a bulk indexing job should go through the same retry path at a controlled level of parallelism.

## Putting it together

```csharp
// Program.cs
using Azure.Identity;

var http = new HttpClient
{
    BaseAddress = new Uri("https://<your-resource-name>.openai.azure.com/openai/"),
    Timeout = TimeSpan.FromSeconds(100)
};
var client = new AzureOpenAIRestClient(http, new DefaultAzureCredential());

var result = await client.CompleteAsync("<your-text-davinci-003-deployment>",
    new CompletionRequest(
        "Summarise in two sentences why API keys are risky in shared environments:",
        MaxTokens: 150,
        Temperature: 0.2));

Console.WriteLine(result.Choices[0].Text.Trim());
Console.WriteLine($"Tokens used: {result.Usage?.TotalTokens}");

await foreach (var token in client.StreamCompletionAsync("<your-text-davinci-003-deployment>",
    new CompletionRequest("Write a haiku about cloud quotas:", MaxTokens: 60)))
{
    Console.Write(token);
}
Console.WriteLine();

var vector = await client.EmbedAsync("<your-text-search-doc-deployment>",
    "Azure OpenAI Service is generally available.");
Console.WriteLine($"Embedding dimensions: {vector.Length}");
```

In an ASP.NET Core app, register the `TokenCredential` as a singleton and create the client from `IHttpClientFactory` rather than holding one `HttpClient` you created yourself. Keep the deployment names in configuration, one per feature, so moving a feature to a new model is a config change.

## Prompts are Completions-shaped, so keep them that way

Everything above is written for the Completions API because that's all the stable version offers. When chat models arrive, the request shape will change from a single `prompt` string to something message-based. I made the case for keeping prompt construction separate from transport in [completions now, chat later](/blog/2023-01-17-completion-vs-chat-apis/). In C# terms, that means the code that assembles a prompt shouldn't know about `HttpClient`, and this client shouldn't know about your prompts.

## When this isn't the right call

- **Your team writes Python.** Use the `openai` package with Azure configuration, as in my [Python walkthrough](/blog/2023-01-18-azure-openai-python-sdk/). It's the best-trodden path today.
- **You need one call from a workflow.** A Logic App or Power Automate HTTP action against the same endpoint is less code to own than a .NET service.
- **You're tempted to build a provider-agnostic AI layer.** Don't, not yet. The APIs will change shape this year, and abstractions written now will encode today's limits.

## The decision

If you're a .NET shop with Azure OpenAI access, don't wait for an SDK to start. Write a thin client against `2022-12-01` that mirrors the JSON, pins the version, uses Azure AD, retries only what's transient, and keeps your prompts out of it. Treat it as temporary scaffolding. The less clever it is, the quicker you can swap in the official package when it ships.
