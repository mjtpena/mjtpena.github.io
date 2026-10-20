---
title: "Azure Functions v3 on .NET Core 3.1: The Setup I Actually Use"
description: "A practical Azure Functions v3 and .NET Core 3.1 setup: pinned packages, dependency injection, Polly retries, deployment, and the plan limits that bite."
author: Michael John Peña
draft: false
date: 2020-08-01
tags:
  - Azure
  - Azure Functions
  - .NET Core
  - Serverless
  - C#
---

This year a lot of teams have needed small pieces in the cloud, fast. For the small, event-driven pieces (scheduled jobs, webhook receivers, the unglamorous glue between systems) Azure Functions on .NET Core 3.1 is my default answer. The quick-start template gets you a running function in five minutes, but it leaves out the choices that determine whether that function is still healthy a year later.

## Where Functions v3 stands right now

The Functions 3.0 runtime had its go-live release in December 2019. Microsoft [announced general availability on 23 January 2020](https://azure.microsoft.com/updates/azure-functions-runtime-30-is-now-available/), and new apps can target 3.0 in production. The headline change for C# developers is that v3 runs on .NET Core 3.1. The Functions 2.x host runs on .NET Core 2.2, which went out of support on 23 December 2019, while 2.x C# projects usually target `netcoreapp2.1`. Microsoft still patches 2.x, but v3 on .NET Core 3.1 is where new work should go.

.NET Core 3.1 is a Long Term Support release, supported until December 2022. For code I expect to forget about and leave running for a couple of years, I want LTS. The [runtime versions overview](https://learn.microsoft.com/azure/azure-functions/functions-versions) explains how to target a version. For most C# apps, migrating is a target framework change and a package bump.

One thing to understand early: C# functions in v3 run **in-process** with the Functions host. Your code loads into the same process as the runtime, which is why binding to `HttpRequest` and `IActionResult` feels so natural. It also means your app runs on the .NET version and `Microsoft.Extensions.*` package versions the host runs, not whichever ones you would prefer. That trade-off comes back later.

## Scaffolding the project

Core Tools 3.x handles the scaffolding. I use the CLI rather than the Visual Studio wizard so the same steps work in a pipeline and on a colleague's Mac. The `--unsafe-perm true` flag is what the install docs specify; without it, a global install on Linux or macOS can fail while the package downloads the host binaries after install.

```bash
npm install -g azure-functions-core-tools@3 --unsafe-perm true

func init MyFunctionApp --dotnet
cd MyFunctionApp
func new --name GetRate --template "HTTP trigger"
```

The template's function is a static class with a static `Run` method. That's fine for hello world, but it gets in the way the moment you need a shared `HttpClient` or a database client. I change it to an instance class straight away and pin the package versions in the project file:

```xml
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>netcoreapp3.1</TargetFramework>
    <AzureFunctionsVersion>v3</AzureFunctionsVersion>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Microsoft.Azure.Functions.Extensions" Version="1.0.0" />
    <PackageReference Include="Microsoft.Extensions.Http.Polly" Version="3.1.6" />
    <PackageReference Include="Microsoft.NET.Sdk.Functions" Version="3.0.9" />
  </ItemGroup>
  <ItemGroup>
    <None Update="host.json">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
    </None>
    <None Update="local.settings.json">
      <CopyToOutputDirectory>PreserveNewest</CopyToOutputDirectory>
      <CopyToPublishDirectory>Never</CopyToPublishDirectory>
    </None>
  </ItemGroup>
</Project>
```

Notice that `Microsoft.Extensions.Http.Polly` is a 3.1.x package. This is the in-process trade-off in practice: the host already loads its own 3.1 versions of the `Microsoft.Extensions` libraries, and referencing a newer major version is a reliable way to get assembly-load errors that only show up at runtime.

## Dependency injection from day one

[Dependency injection support](https://learn.microsoft.com/azure/azure-functions/functions-dotnet-dependency-injection) arrived with `Microsoft.Azure.Functions.Extensions` and works on v3. This is the piece I always wish I'd added on day one, because retrofitting it means rewriting every function's signature. Once two functions share an outbound API, you want one registration point.

`Startup.cs` (the `assembly` attribute sits outside the namespace):

```csharp
using System;
using System.Net.Http;
using Microsoft.Azure.Functions.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection;
using Polly;
using Polly.Extensions.Http;
using Polly.Timeout;

[assembly: FunctionsStartup(typeof(MyFunctionApp.Startup))]

namespace MyFunctionApp
{
    public class Startup : FunctionsStartup
    {
        public override void Configure(IFunctionsHostBuilder builder)
        {
            builder.Services
                .AddHttpClient<IRatesClient, RatesClient>(client =>
                {
                    var baseUrl = Environment.GetEnvironmentVariable("RatesApiBaseUrl")
                        ?? throw new InvalidOperationException("RatesApiBaseUrl app setting is missing.");
                    client.BaseAddress = new Uri(baseUrl);
                    // Overall budget for the call, retries included.
                    client.Timeout = TimeSpan.FromSeconds(30);
                })
                .AddPolicyHandler(HttpPolicyExtensions
                    .HandleTransientHttpError()
                    .Or<TimeoutRejectedException>()
                    .WaitAndRetryAsync(3, attempt =>
                        TimeSpan.FromMilliseconds(200 * Math.Pow(2, attempt))))
                // Per-attempt timeout, inside the retry.
                .AddPolicyHandler(Policy.TimeoutAsync<HttpResponseMessage>(TimeSpan.FromSeconds(5)));
        }
    }
}
```

`AddHttpClient` matters more in Functions than in a long-running web app. Under load the platform scales out and each instance handles many concurrent executions; newing up an `HttpClient` per execution is the classic way to exhaust sockets on the sandbox. The typed client also gives the Polly retry policy one obvious home. Functions scale out quickly, which means transient failures from a downstream API also arrive at scale, so every outbound call gets a bounded retry with backoff.

The order of the handlers matters. Policies added first sit on the outside, so the retry wraps the 5-second per-attempt timeout: a hung attempt is cancelled with a `TimeoutRejectedException`, and because the retry policy handles that exception alongside the usual transient errors (`HandleTransientHttpError` covers network failures, 5xx, and 408), the next attempt runs. `AddTransientHttpErrorPolicy` on its own wouldn't retry a timeout, which is why I build the policy explicitly. `HttpClient.Timeout` wraps the whole pipeline, so it has to be the overall budget. Set it to 5 seconds and one hung attempt uses it up before any retry gets a chance.

The client and the function itself, in `GetRate.cs` (client and function together, for brevity):

```csharp
using System;
using System.Net.Http;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.Extensions.Logging;

namespace MyFunctionApp
{
    public interface IRatesClient
    {
        Task<string> GetRateJsonAsync(string currency);
    }

    public class RatesClient : IRatesClient
    {
        private readonly HttpClient _http;

        public RatesClient(HttpClient http) => _http = http;

        public async Task<string> GetRateJsonAsync(string currency)
        {
            var response = await _http.GetAsync($"rates/{Uri.EscapeDataString(currency)}");
            response.EnsureSuccessStatusCode();
            return await response.Content.ReadAsStringAsync();
        }
    }

    public class GetRate
    {
        private readonly IRatesClient _rates;

        public GetRate(IRatesClient rates) => _rates = rates;

        [FunctionName("GetRate")]
        public async Task<IActionResult> Run(
            [HttpTrigger(AuthorizationLevel.Function, "get", Route = "rates/{currency}")] HttpRequest req,
            string currency,
            ILogger log)
        {
            log.LogInformation("Rate requested for {Currency}", currency);
            // Downstream failures (including a 404 for an unknown currency) surface as a 500.
            var json = await _rates.GetRateJsonAsync(currency);
            return new ContentResult { Content = json, ContentType = "application/json", StatusCode = 200 };
        }
    }
}
```

The sample deliberately lets any downstream failure, including a 404 for a currency the rates API doesn't know, throw out of `EnsureSuccessStatusCode` and reach the caller as a 500. In a real API I'd catch that case and return `NotFoundResult`, but I didn't want the error mapping to bury the DI wiring.

One DI gotcha: if you inject `ILogger<T>` instead of taking the `ILogger` parameter, the host filters those log entries out unless you add your namespace under `logging.logLevel` in `host.json`. The method-parameter `ILogger` just works, so I use that in functions and save `ILogger<T>` for services.

## Running it locally

Add `RatesApiBaseUrl` to the `Values` section of `local.settings.json` first. `UseDevelopmentStorage=true` points the host at the local Azure Storage Emulator (Windows), or Azurite on macOS/Linux for blob and queue only, which needs to be running:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet",
    "RatesApiBaseUrl": "https://<rates-api-host>/"
  }
}
```

Then start the host and call the function:

```bash
func start
curl http://localhost:7071/api/rates/AUD
```

Function-level keys aren't enforced when running locally, which is convenient but also means you won't notice a wrong `AuthorizationLevel` until you deploy. Keep `local.settings.json` out of source control; the template's `.gitignore` already excludes it.

## Deploying to Azure

```bash
az group create --name <resource-group> --location australiaeast

az storage account create \
    --name <storageaccountname> \
    --location australiaeast \
    --resource-group <resource-group> \
    --sku Standard_LRS

az monitor app-insights component create \
    --app <app-insights-name> \
    --location australiaeast \
    --resource-group <resource-group> \
    --application-type web

az functionapp create \
    --resource-group <resource-group> \
    --consumption-plan-location australiaeast \
    --runtime dotnet \
    --functions-version 3 \
    --name <function-app-name> \
    --storage-account <storageaccountname> \
    --app-insights <app-insights-name>

az functionapp config appsettings set \
    --resource-group <resource-group> \
    --name <function-app-name> \
    --settings "RatesApiBaseUrl=https://<rates-api-host>/"

func azure functionapp publish <function-app-name>
```

The `az monitor app-insights` commands come from the `application-insights` CLI extension, which the CLI offers to install the first time you run one.

Pass `--functions-version 3` explicitly. Being explicit in scripts protects you from defaults changing underneath you, and it documents intent for whoever reads the pipeline next.

## Choosing the plan

The Consumption plan is the right default for glue work, but know its limits before you commit. These figures come from the [Functions hosting plan documentation](https://learn.microsoft.com/azure/azure-functions/functions-scale):

| Concern | Consumption | Premium | Dedicated (App Service) |
|---|---|---|---|
| Default / max timeout | 5 min / 10 min | 30 min / unlimited (guaranteed up to 60 min) | 30 min / unlimited (with Always On) |
| Cold start | Yes, after idle | Minimum (always-warm) instances, plus pre-warmed instances as a buffer when scaling out | None with Always On enabled |
| VNet integration | No | Yes | Yes |
| Billing | Per execution and GB-s | Per instance, always at least one running | Per App Service plan instance |

Whatever the plan, an HTTP-triggered function has to respond within 230 seconds because of the front-end load balancer. If your work takes longer than that, an HTTP function is the wrong shape: accept the request, drop a message on a queue, and process it in a queue-triggered function.

If the long-running work is really several steps with state between them (fan-out and fan-in, waiting on an approval, retrying one step without redoing the others), use Durable Functions 2.0, GA since November 2019, instead of chaining queues by hand. It works on v3. My rule: one hand-off from HTTP to background work is a queue; anything with a sequence, checkpoints, or a human in the loop is an orchestration.

Start on Consumption, and move to Premium (GA since late 2019) when you need VNet access to private resources or a cold start would breach an SLA. That fix has a price: Premium bills for at least one EP1 instance running around the clock, whether or not anything executes, so you are paying a fixed monthly floor to avoid the cold start that Consumption charges you nothing for. If you already pay for an App Service plan with spare capacity, running the function app there with Always On beats Premium: you get no cold start and VNet integration for no extra cost, as long as you can live with manual or rule-based scaling instead of event-driven scale-out. Keep dependencies modest regardless; package size and startup work are most of what you feel on a cold start.

## Defaults I set on every Function app

- **Turn on Application Insights when you create the app.** Passing `--app-insights` to `az functionapp create`, as the deploy script does, wires the instrumentation key into the app settings so telemetry flows from the first deployment. You can't diagnose a production failure with telemetry you didn't collect. The default adaptive sampling is fine for most apps.
- **One function, one job.** Combining responsibilities in one function couples their scaling, timeouts and deployments, so a change to one job risks the other. Keep one trigger, one job.
- **Get secrets out of app settings.** Turn on the app's system-assigned managed identity and use [Key Vault references](https://learn.microsoft.com/azure/app-service/app-service-key-vault-references) for API keys and connection strings. For now a reference has to include the secret version, so rotation means updating the setting. The `AzureWebJobsStorage` connection the host itself uses still has to be a storage connection string, so treat that storage account as sensitive: anyone with that connection string can read your function keys and trigger state in the `azure-webjobs-secrets` and `azure-webjobs-hosts` containers. Keep your application data in a separate account with its own access.
- **Don't fight the in-process model.** Match `Microsoft.Extensions.*` to the host's 3.1 versions and stay on LTS. Upgrade when the Functions host supports the next .NET version, not before.

## When I wouldn't use this

Functions are a poor fit for long-running CPU-heavy work, for anything that needs a persistent connection, or for an API with dozens of endpoints that share middleware. That last one is just an ASP.NET Core app with extra steps, and App Service will serve you better. For the small, independent, event-driven pieces, though, Functions v3 on .NET Core 3.1 is the stack I trust to keep running six months from now without me thinking about it. If a piece needs more babysitting than that, it probably isn't a function.
