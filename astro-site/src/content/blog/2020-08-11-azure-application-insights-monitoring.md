---
title: "Application Insights for ASP.NET Core: Telemetry Worth Paying For"
description: "Instrumenting an ASP.NET Core 3.1 API with Application Insights: connection strings, sampling, custom metrics and alerts, without paying for noise."
author: Michael John Peña
draft: false
date: 2020-08-11
tags:
  - Azure
  - Application Insights
  - Monitoring
  - .NET Core
  - Cost Optimization
---

First thing I do on any new Azure-hosted application I'm asked to look at: open Application Insights and see what's actually happening. More often than not, "the app is slow" turns out to be one SQL query missing an index. Without instrumentation you're guessing, and guessing during an outage is expensive. The setup is cheap enough that I don't treat enabling it as a debate.

The harder question isn't whether to turn it on. It's how to set it up so the data you collect answers real questions without becoming the biggest line on the bill. This post is the server-side setup I use for an ASP.NET Core 3.1 API, using `Microsoft.ApplicationInsights.AspNetCore` 2.14.0, which is the current stable SDK as of August 2020.

## Create the resource and use a connection string

The `az monitor app-insights` commands live in the `application-insights` CLI extension. Install it first with `az extension add --name application-insights`.

```bash
az extension add --name application-insights

az monitor app-insights component create \
    --app <your-app-insights-name> \
    --location australiaeast \
    --resource-group <your-resource-group> \
    --kind web \
    --application-type web
```

Most samples still show an `InstrumentationKey` in `appsettings.json`. I'd use a connection string instead. The ASP.NET Core SDK has supported them since 2.12, they carry the ingestion endpoint as well as the key, and Microsoft's [connection strings documentation](https://learn.microsoft.com/en-us/azure/azure-monitor/app/connection-strings) is clear that new Azure regions need them. The portal's Overview blade for the resource shows the full connection string; copy it from there rather than assembling one by hand from the instrumentation key the CLI returns.

```json
{
  "ApplicationInsights": {
    "ConnectionString": "InstrumentationKey=<your-instrumentation-key>;IngestionEndpoint=<your-ingestion-endpoint>"
  }
}
```

In App Service, I set it as the `APPLICATIONINSIGHTS_CONNECTION_STRING` app setting instead. The SDK reads that environment variable ahead of `appsettings.json`, so the same build moves between environments without a config change. Don't set both a key and a connection string in different places; you'll spend an afternoon working out which one won.

A side note on resource type: workspace-based Application Insights, which stores telemetry in a Log Analytics workspace alongside your other logs, is in public preview right now. It's worth trying in a non-production subscription, but I'm keeping production on classic resources until it reaches GA.

## Wire up the SDK

```bash
dotnet add package Microsoft.ApplicationInsights.AspNetCore --version 2.14.0
```

`AddApplicationInsightsTelemetry()` with no arguments gets you requests, dependencies (HttpClient, SQL, Azure SDK calls), exceptions, performance counters, Live Metrics, and `ILogger` warnings and above. That default is good. The settings I set explicitly on almost every project are below.

```csharp
using Microsoft.ApplicationInsights.AspNetCore.Extensions;
using Microsoft.ApplicationInsights.DependencyCollector;
using Microsoft.ApplicationInsights.Extensibility;
using Microsoft.Extensions.DependencyInjection;

public class Startup
{
    public void ConfigureServices(IServiceCollection services)
    {
        services.AddControllers();

        services.AddApplicationInsightsTelemetry(new ApplicationInsightsServiceOptions
        {
            // Adaptive sampling is on by default; set explicitly so nobody "optimises" it away.
            EnableAdaptiveSampling = true
        });

        // SQL command text is opt-in from 2.14.0. Turn it on to see *which* query is slow.
        services.ConfigureTelemetryModule<DependencyTrackingTelemetryModule>(
            (module, options) => module.EnableSqlCommandTextInstrumentation = true);

        services.AddSingleton<ITelemetryInitializer, CloudRoleInitializer>();
    }

    // Configure() unchanged
}
```

The SQL command text flag matters more than it looks. Since 2.14.0 the SDK no longer captures the query text by default, so a slow dependency shows up as the database name and nothing else. That's the right default for privacy, but if your queries are parameterised (and they should be), the text won't contain customer data and it's the single most useful field when chasing a slow endpoint. If you build SQL by concatenating values, leave the flag off and fix that first. This is also why the SDK's [release history](https://github.com/microsoft/ApplicationInsights-dotnet/blob/main/CHANGELOG.md) is worth a skim before each upgrade: defaults like this one do change between versions.

### Name your services

Once you have more than one service reporting to a resource, the Application Map and every query need a reliable way to tell them apart. A telemetry initializer sets the cloud role name on everything the app sends:

```csharp
using Microsoft.ApplicationInsights.Channel;
using Microsoft.ApplicationInsights.DataContracts;
using Microsoft.ApplicationInsights.Extensibility;
using Microsoft.AspNetCore.Hosting;

public class CloudRoleInitializer : ITelemetryInitializer
{
    private readonly string _environmentName;

    public CloudRoleInitializer(IWebHostEnvironment environment)
    {
        _environmentName = environment.EnvironmentName;
    }

    public void Initialize(ITelemetry telemetry)
    {
        telemetry.Context.Cloud.RoleName = "orders-api";

        if (telemetry is ISupportProperties item && !item.Properties.ContainsKey("Environment"))
        {
            item.Properties["Environment"] = _environmentName;
        }
    }
}
```

Keep initializers cheap: they run on every telemetry item. And resist the urge to stamp user emails or names onto every item. Telemetry gets exported, shared in screenshots and queried by people who would never get access to the production database.

## Custom telemetry: events versus metrics

The auto-collected data tells you whether the app is healthy. Custom telemetry tells you whether the business process is. The mistake I see most often is using `TrackEvent` for things that are really numbers.

Here's the trap. With adaptive sampling on, the ASP.NET Core SDK samples custom events too, in their own stream with a target of five events per second. Count `OrderCreated` events in a busy hour and you'll get an estimate reconstructed from a sample, not an exact count; fine for trends, wrong for reconciling against the orders table. `GetMetric()` avoids that: it pre-aggregates values in the process and sends a summary each minute, so the numbers are complete and the volume stays tiny regardless of traffic.

This is a fragment from an order service; `Order`, `OrderRequest` and `ProcessOrderAsync` are your own types.

```csharp
using System.Collections.Generic;
using System.Threading.Tasks;
using Microsoft.ApplicationInsights;

public class OrderService
{
    private readonly TelemetryClient _telemetry;

    public OrderService(TelemetryClient telemetry)
    {
        _telemetry = telemetry;
    }

    public async Task<Order> CreateOrderAsync(OrderRequest request)
    {
        var order = await ProcessOrderAsync(request);

        // Complete, pre-aggregated numbers: not affected by sampling.
        _telemetry.GetMetric("OrderValue", "PaymentMethod")
            .TrackValue((double)order.TotalAmount, request.PaymentMethod);

        // A sampled breadcrumb you can correlate with the request that produced it.
        _telemetry.TrackEvent("OrderCreated", new Dictionary<string, string>
        {
            ["OrderId"] = order.Id.ToString(),
            ["ItemCount"] = request.Items.Count.ToString()
        });

        return order;
    }
}
```

Two things I deliberately left out. There's no `try/catch` calling `TrackException`, because unhandled exceptions in a request are already collected and correlated with that request; catching just to log and rethrow gives you duplicates. And there's no manual `StartOperation<DependencyTelemetry>` around `HttpClient` calls. The SDK already tracks outgoing HTTP, and wrapping it yourself produces two dependencies per call. Manual dependency tracking is for things the SDK can't see, like a proprietary TCP protocol or a third-party client that doesn't use `HttpClient`.

My rule of thumb: if you'd put it on a chart or alert on it, it's a metric. If you'd want to find the specific occurrence and see what happened around it, it's an event or a trace.

## Sampling and cost

A chatty service that logs every cache hit can quietly run up a bill that exceeds the compute it monitors, so sampling is the first lever.

Adaptive sampling is the default for good reason. It keeps volume near a target rate and samples whole operations together, so a sampled request keeps its dependencies and exceptions. Live Metrics still sees everything, because it runs before sampling. For most APIs I leave it on.

Fixed-rate sampling makes sense when you need a predictable percentage, for example when a front end and back end must keep the same operations so end-to-end traces line up. With the 2.14 SDK, turn adaptive sampling off and add fixed-rate sampling to the processor chain in `Configure`:

```csharp
using Microsoft.ApplicationInsights.AspNetCore.Extensions;
using Microsoft.ApplicationInsights.Extensibility;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;

public class Startup
{
    public void ConfigureServices(IServiceCollection services)
    {
        services.AddControllers();
        services.AddApplicationInsightsTelemetry(new ApplicationInsightsServiceOptions
        {
            EnableAdaptiveSampling = false
        });
    }

    public void Configure(IApplicationBuilder app, TelemetryConfiguration telemetryConfiguration)
    {
        var builder = telemetryConfiguration.DefaultTelemetrySink.TelemetryProcessorChainBuilder;
        builder.UseSampling(25); // keep 25% of operations
        builder.Build();

        app.UseRouting();
        app.UseEndpoints(endpoints => endpoints.MapControllers());
    }
}
```

Don't leave adaptive sampling on and add `UseSampling` on top, which is a pattern I've seen copied around. You end up sampling the sample and the item counts get hard to reason about.

### Cap the bill

Whichever sampling you choose, set a [daily cap](https://learn.microsoft.com/en-us/azure/azure-monitor/logs/daily-cap) as a circuit breaker, not a budget. It stops a logging bug from costing thousands overnight, but when it trips you lose telemetry for the rest of the day, usually right when you need it. Set it well above normal volume and alert when you approach it.

The cap matters because Application Insights bills on data ingested. The first 5 GB per billing account each month is free; after that, every gigabyte counts, and a single noisy deployment can burn through the allowance in a day.

## Queries that respect sampling

Sampled records carry an `itemCount` field saying how many original items each one represents. Use `sum(itemCount)` instead of `count()` or your numbers will be low by exactly your sampling rate.

```kusto
// Failed requests by operation, corrected for sampling
requests
| where timestamp > ago(24h)
| where success == false
| summarize failures = sum(itemCount) by name, resultCode
| order by failures desc
```

```kusto
// Slowest dependencies: where "the app is slow" usually ends up
dependencies
| where timestamp > ago(24h)
| summarize calls = sum(itemCount), p95_ms = percentile(duration, 95) by type, target, name, data
| where p95_ms > 500
| order by p95_ms desc
```

The second query is the one that finds the slow SQL statement. With command text collection on, the `data` column holds the statement itself (`name` is just server and database unless it's a stored procedure), which is why it's in the `by` clause. Without `data`, every ad-hoc statement against a database collapses into a single row.

## Alert on what users feel

Alert on symptoms, not causes. A failed-request count is a symptom; CPU at 80% might be fine. A metric alert on the built-in failed requests metric:

```bash
az monitor metrics alert create \
    --name "orders-api-failed-requests" \
    --resource-group <your-resource-group> \
    --scopes "/subscriptions/<subscription-id>/resourceGroups/<your-resource-group>/providers/microsoft.insights/components/<your-app-insights-name>" \
    --condition "count requests/failed > 10" \
    --window-size 5m \
    --evaluation-frequency 1m \
    --action "/subscriptions/<subscription-id>/resourceGroups/<your-resource-group>/providers/microsoft.insights/actionGroups/<your-action-group>"
```

A static `count > 10` threshold suits an API with steady traffic, where ten failures in five minutes is genuinely unusual. On a low-traffic service it either never fires or fires on a handful of bad requests overnight; there I'd alert on failure rate through a log query, or use a dynamic threshold so the baseline comes from the service's own history.

Pair it with a URL ping [availability test](https://learn.microsoft.com/en-us/azure/azure-monitor/app/availability) from a few regions. Your own telemetry can't tell you the app is unreachable, because an unreachable app sends nothing. Test frequency and the number of locations both drive volume, so I'd start with five-minute tests from three to five regions rather than every location on the list. Multi-step web tests carry their own separate charge, so I'd keep those for the one user journey that genuinely needs them. They also depend on Visual Studio web test tooling that ends with Visual Studio 2019, so for new journeys I'd write a custom `TrackAvailability` test instead.

## When not to bother

Not everything needs this setup. A batch job that runs once a night is better served by structured logs and a failure alert than by request telemetry and Application Maps. And a service handling thousands of requests per second may find that even sampled telemetry costs more than it's worth; there, aggregated metrics plus targeted tracing on the paths you care about is the better trade.

For a typical ASP.NET Core API, though, my default is: connection string from an app setting, adaptive sampling left on, SQL command text on if queries are parameterised, a cloud role name on every service, business numbers through `GetMetric()`, and alerts on failed requests and availability. That gets you the visibility to answer "why is it slow?" in minutes, and an ingestion bill you can explain. If you're running Functions instead of App Service, the same principles apply; I covered the setup in [Azure Functions v3 on .NET Core 3.1](/blog/2020-08-01-azure-functions-v3-dotnet-core/).
