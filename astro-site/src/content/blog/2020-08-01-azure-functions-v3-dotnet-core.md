---
title: "Getting Started with Azure Functions v3 and .NET Core 3.1"
description: "A lot of the work landing on my desk this year has been \"we suddenly need this in the cloud, and we needed it last week.\" Azure Functions on .NET Core 3.1…"
author: Michael John Peña
draft: false
date: 2020-08-01
tags:
  - Azure
  - Azure Functions
  - .NET Core
  - Serverless
---

A lot of the work landing on my desk this year has been "we suddenly need this in the cloud, and we needed it last week." Azure Functions on .NET Core 3.1 has been my default answer for the small, event-driven pieces — billing reconciliations, webhook receivers, the unglamorous glue. Functions v3 has been GA since December 2019, the tooling has finally caught up, and the cold-start situation on the Consumption plan is bearable now if you keep your dependencies modest.

This is the setup I keep reaching for.

## Why .NET Core 3.1?

3.1 is the current LTS, supported until December 2022. For anything I expect to forget about and have running in production for a couple of years, I want LTS. You also pick up the Span/Memory APIs and the System.Text.Json improvements over 2.1, which matter when you're billed per execution.

## Creating Your First Function

```bash
# Install or update Azure Functions Core Tools
npm install -g azure-functions-core-tools@3

# Create a new function app
func init MyFunctionApp --dotnet

# Navigate to the project
cd MyFunctionApp

# Create an HTTP-triggered function
func new --name HttpTriggerFunction --template "HTTP trigger"
```

## The Function Code

A minimal HTTP trigger — the shape almost every API-style function starts with for me:

```csharp
using System.IO;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Azure.WebJobs;
using Microsoft.Azure.WebJobs.Extensions.Http;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json;

public static class HttpTriggerFunction
{
    [FunctionName("HttpTriggerFunction")]
    public static async Task<IActionResult> Run(
        [HttpTrigger(AuthorizationLevel.Function, "get", "post", Route = null)]
        HttpRequest req,
        ILogger log)
    {
        log.LogInformation("C# HTTP trigger function processed a request.");

        string name = req.Query["name"];

        string requestBody = await new StreamReader(req.Body).ReadToEndAsync();
        dynamic data = JsonConvert.DeserializeObject(requestBody);
        name = name ?? data?.name;

        return name != null
            ? (ActionResult)new OkObjectResult($"Hello, {name}")
            : new BadRequestObjectResult("Please pass a name on the query string or in the request body");
    }
}
```

## Dependency Injection

The piece I always wish I'd added on day one. Once you have more than two functions sharing an `HttpClient` or a database connection, you want this in place rather than retrofitting it. Add a `Startup.cs`:

```csharp
using Microsoft.Azure.Functions.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection;

[assembly: FunctionsStartup(typeof(MyFunctionApp.Startup))]

namespace MyFunctionApp
{
    public class Startup : FunctionsStartup
    {
        public override void Configure(IFunctionsHostBuilder builder)
        {
            builder.Services.AddHttpClient();
            builder.Services.AddSingleton<IMyService, MyService>();
        }
    }
}
```

## Local Development

```bash
# Run locally
func start

# Test the function
curl http://localhost:7071/api/HttpTriggerFunction?name=World
```

## Deploying to Azure

```bash
# Create a resource group
az group create --name rg-functions --location australiaeast

# Create a storage account
az storage account create \
    --name stfuncapp2020 \
    --location australiaeast \
    --resource-group rg-functions \
    --sku Standard_LRS

# Create the function app
az functionapp create \
    --resource-group rg-functions \
    --consumption-plan-location australiaeast \
    --runtime dotnet \
    --functions-version 3 \
    --name my-func-app-2020 \
    --storage-account stfuncapp2020

# Deploy
func azure functionapp publish my-func-app-2020
```

## Things I Wish I'd Known Sooner

- **Turn on Application Insights from day one.** Retroactively adding it to a function that's already misbehaving in production is a bad time. The sampling defaults are fine; just enable it.
- **Wrap external calls in Polly.** Functions are easy to scale out, which means transient failures hit you at scale too. Retry-with-jitter on every outbound HTTP and SDK call.
- **One function, one job.** I keep trying to be clever and combining triggers. It always ends with a deployment that I'm afraid to touch.
- **Managed identity over connection strings.** Even for the storage account that backs the Function App. The first time you rotate a key by accident in production you'll agree.

Functions v3 on .NET Core 3.1 is not a flashy stack, but it's the one I trust to be quietly running six months from now without me thinking about it. Which, for serverless, is exactly the bar.
