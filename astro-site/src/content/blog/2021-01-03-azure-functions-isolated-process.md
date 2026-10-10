---
title: "Azure Functions on .NET 5: A First Look at the Isolated Worker Preview"
description: "What the .NET 5 isolated worker preview for Azure Functions looks like in January 2021, what it costs you today, and when to stay on .NET Core 3.1."
author: Michael John Peña
draft: false
date: 2021-01-03
tags:
  - Azure
  - Azure Functions
  - .NET
  - Serverless
  - C#
---

.NET 5 shipped in November, and the obvious question for any team on Azure Functions is "can we move to it?" The honest answer is "not the way you're used to". The Functions v3 host runs on .NET Core 3.1, and a class library loaded into that host can't target a newer runtime than the host itself. Microsoft's answer is a new out-of-process model, the .NET isolated worker. It's in early preview right now, and you should understand its trade-offs before you put it on a roadmap.

## Why .NET 5 needs a different model

Today's C# functions are class libraries. The Functions host loads your assembly into its own process, which is why you get rich bindings like `IAsyncCollector<T>` and `CloudBlockBlob`. It's also why your dependency graph has to fit around the host's. If you've ever fought a `Newtonsoft.Json` or `Microsoft.Extensions.*` version conflict in a function app, you've met the downside of sharing a process.

The isolated model turns .NET into an ordinary language worker, the way Node.js, Python and Java already work. Your app is a console executable with its own `Main`. The host starts it as a separate process and talks to it over gRPC. The host stays on .NET Core 3.1, and your code runs on .NET 5 because it's a different process.

Here is where things stand on 3 January 2021:

| | In-process class library | .NET isolated worker |
|---|---|---|
| Target framework | `netcoreapp3.1` | `net5.0` |
| Status | GA, the production default on Functions v3 | Early preview |
| SDK package | `Microsoft.NET.Sdk.Functions` 3.0.11 | `Microsoft.Azure.Functions.Worker` and `.Sdk` 1.0.0-preview1 |
| `FUNCTIONS_WORKER_RUNTIME` | `dotnet` | `dotnet-isolated` |
| Bindings | Full binding model, rich SDK types | Strings, JSON POCOs, `HttpRequestData`/`HttpResponseData` and `OutputBinding<T>` |
| Durable Functions | Supported | Not supported |
| Tooling | Visual Studio, VS Code, Core Tools | Core Tools 3.0.3160 or later |

The worker packages first appeared on NuGet on 10 December 2020 as [1.0.0-preview1](https://www.nuget.org/packages/Microsoft.Azure.Functions.Worker/1.0.0-preview1). Azure Functions [Core Tools 3.0.3160](https://github.com/Azure/azure-functions-core-tools/releases/tag/3.0.3160), released in early December, added the worker runtime; its release note reads "Add support for dotnet-isolated Functions runtime". The code lives in the open in the [azure-functions-dotnet-worker](https://github.com/Azure/azure-functions-dotnet-worker) repo, which is the best place to track what's changing. Expect breaking changes between previews. The API below is the preview1 surface, and I'd be surprised if it survives to GA unchanged.

## What an isolated function app looks like

The project is a console app. Note `OutputType` set to `Exe`. Bindings still come from the WebJobs extension packages, because the host is what actually talks to Storage, HTTP and the rest. This is an excerpt, reduced from the sample in Microsoft's worker repo: I've left out the usual `host.json` and `local.settings.json` copy-to-output items. `ExtensionsMetadataGenerator` isn't optional. It writes the `extensions.json` the host reads to find the Storage extension and the startup class the SDK generates in your assembly. `System.Net.NameResolution` is a workaround the official sample carries, and I'd keep it until a later preview drops it.

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net5.0</TargetFramework>
    <AzureFunctionsVersion>v3</AzureFunctionsVersion>
    <OutputType>Exe</OutputType>
    <_FunctionsSkipCleanOutput>true</_FunctionsSkipCleanOutput>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Azure.Functions.Worker" Version="1.0.0-preview1" />
    <PackageReference Include="Microsoft.Azure.Functions.Worker.Sdk" Version="1.0.0-preview1" />
    <PackageReference Include="Microsoft.Azure.WebJobs.Extensions.Http" Version="3.0.2" />
    <PackageReference Include="Microsoft.Azure.WebJobs.Extensions.Storage" Version="4.0.3" />
    <PackageReference Include="Microsoft.Azure.WebJobs.Script.ExtensionsMetadataGenerator" Version="1.2.0" />
    <PackageReference Include="System.Net.NameResolution" Version="4.3.0" />
  </ItemGroup>
</Project>
```

`local.settings.json` tells the host which worker to start:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated"
  }
}
```

### You own the host now

This is the part I like most. `Program.cs` is a standard .NET Generic Host. Configuration, logging and DI are the same `HostBuilder` you'd use in a worker service. You don't need the separate `FunctionsStartup` abstraction from the in-process model, which I covered in [Azure Functions Dependency Injection](/blog/2020-11-06-azure-functions-dependency-injection/).

```csharp
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker.Configuration;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

namespace OrdersApp
{
    public class Program
    {
        public static async Task Main(string[] args)
        {
            var host = new HostBuilder()
                .ConfigureAppConfiguration(config =>
                {
                    config.AddCommandLine(args);
                    config.AddEnvironmentVariables();
                })
                .ConfigureFunctionsWorker((context, worker) =>
                {
                    worker.UseFunctionExecutionMiddleware();
                })
                .ConfigureServices(services =>
                {
                    services.AddSingleton<IOrderValidator, OrderValidator>();
                })
                .Build();

            await host.RunAsync();
        }
    }
}
```

`UseFunctionExecutionMiddleware()` registers the step that actually invokes your function. The worker builder runs a middleware pipeline, so cross-cutting work like correlation or exception handling has a home that isn't copy-pasted into every function. In preview1 this pipeline is still bare, so I wouldn't build anything elaborate on it yet.

### An HTTP function with a queue output

Two things look different from the in-process model. HTTP uses the worker's own `HttpRequestData` and `HttpResponseData` types instead of ASP.NET Core's `HttpRequest` and `IActionResult`. Output bindings are `OutputBinding<T>` parameters you call `SetValue` on, instead of `IAsyncCollector<T>`.

```csharp
using System.Net;
using System.Text.Json;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Pipeline;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.Extensions.Logging;

namespace OrdersApp
{
    public class SubmitOrder
    {
        private static readonly JsonSerializerOptions JsonOptions =
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true };

        private readonly IOrderValidator _validator;

        public SubmitOrder(IOrderValidator validator)
        {
            _validator = validator;
        }

        [FunctionName("SubmitOrder")]
        public HttpResponseData Run(
            [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequestData req,
            [Queue("orders", Connection = "AzureWebJobsStorage")] OutputBinding<Order> orderQueue,
            FunctionExecutionContext executionContext)
        {
            var logger = executionContext.Logger;

            if (string.IsNullOrWhiteSpace(req.Body))
            {
                return new HttpResponseData(HttpStatusCode.BadRequest, "Body required.");
            }

            Order order;
            try
            {
                order = JsonSerializer.Deserialize<Order>(req.Body, JsonOptions);
            }
            catch (JsonException)
            {
                return new HttpResponseData(HttpStatusCode.BadRequest, "Malformed JSON.");
            }

            if (order == null || !_validator.IsValid(order))
            {
                return new HttpResponseData(HttpStatusCode.BadRequest, "Invalid order.");
            }

            orderQueue.SetValue(order);
            logger.LogInformation($"Queued order {order.Id}");

            return new HttpResponseData(HttpStatusCode.Accepted, $"Order {order.Id} accepted.");
        }
    }

    public class Order
    {
        public string Id { get; set; }
        public decimal Total { get; set; }
    }

    public interface IOrderValidator
    {
        bool IsValid(Order order);
    }

    public class OrderValidator : IOrderValidator
    {
        public bool IsValid(Order order) => !string.IsNullOrEmpty(order.Id) && order.Total > 0;
    }
}
```

`[FunctionName]`, `[HttpTrigger]` and `[Queue]` still come from the WebJobs namespaces in this preview. In preview1 the SDK includes a Roslyn source generator that reads these attributes at compile time and emits a function-metadata provider into your assembly; the host loads it to wire up triggers and bindings. You won't find `function.json` files in the output. Your code never touches the Storage SDK. The host does the I/O and hands you a deserialised string or POCO across gRPC. `req.Body` is a string in preview1, so streaming large request bodies isn't on the table yet.

Note the case-insensitive serialiser options: `System.Text.Json` is case-sensitive by default, so a camelCase body like `{"id":"1","total":10}` would otherwise bind to an empty `Order` and fail validation. The empty-body guard and the `JsonException` catch turn bad input into a 400 instead of an unhandled 500.

Run it locally with `func start` from the build output, using Core Tools 3.0.3160 or later. Publish with `func azure functionapp publish <your-function-app-name>`, which in that release sets the isolated worker settings for you.

## What you give up today

The preview is real and it works. Here's what's missing as of this week:

- **No Durable Functions.** The Durable extension depends on running inside the host. If your app orchestrates with Durable, it stays in-process.
- **Thin bindings.** No `IAsyncCollector<T>`, no binding to `CloudBlockBlob` or `CloudQueueMessage`, no `ICollector<T>` for multiple outputs. You get strings and POCOs. For many HTTP and queue functions that's fine. For anything that needs blob leases or message metadata, it's a step back.
- **Rough tooling.** Visual Studio doesn't have a template or F5 experience for isolated apps yet. Microsoft's own sample in the [worker repo](https://github.com/Azure/azure-functions-dotnet-worker) calls `Debugger.Launch()` in `Main` to attach a debugger. That tells you where the tooling is.
- **Extra hop per invocation.** Every trigger payload and every output crosses a process boundary over gRPC. For chatty, high-throughput functions, measure before you assume the overhead doesn't matter.
- **A short-lived runtime.** .NET 5 is a "Current" release, not LTS. Under the [.NET support policy](https://dotnet.microsoft.com/en-us/platform/support/policy/dotnet-core) it's supported for three months after .NET 6 ships, and .NET 6 is planned for November 2021 as the next LTS. Moving a production app to .NET 5 means signing up for another upgrade within roughly a year.

## When I'd use it, and when I wouldn't

My position: **keep production Functions on .NET Core 3.1 in-process for now.** It's GA, it's LTS until December 2022, the tooling is mature, and every binding and Durable Functions work. If you need a refresher on that setup, my [v3 on .NET Core 3.1 post](/blog/2020-08-01-azure-functions-v3-dotnet-core/) has the configuration I use.

Use the isolated preview when:

- You're building a new, non-critical function app and want to learn the model before it reaches GA.
- You have a library that genuinely needs .NET 5 or C# 9 runtime features and can't be isolated behind a 3.1-compatible facade.
- You've been burned by host dependency conflicts and want to prove the isolated model removes them for your codebase.

Don't use it when:

- The app uses Durable Functions, or bindings richer than strings, POCOs and HTTP request/response data.
- The team relies on Visual Studio debugging and templates.
- You can't absorb breaking changes between preview releases.

The direction matters more than the preview, though. Decoupling the worker from the host is how Functions stops holding .NET versions hostage, and it's the same shape every other language worker already uses. My advice for this quarter: write new function code against small, testable services and keep the function classes thin. Whichever model you end up on, the migration is then mostly `Program.cs` and attribute plumbing, not your business logic.
