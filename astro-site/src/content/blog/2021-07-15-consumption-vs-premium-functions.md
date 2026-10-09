---
title: Consumption vs Premium Azure Functions - Making the Right Choice
author: Michael John Peña
draft: false
date: 2021-07-15
url: /blog/consumption-vs-premium-functions/
tags:
  - Azure
  - Serverless
  - Azure Functions
  - Architecture
  - Cost Optimization
---

## Plan Comparison Overview

| Feature | Consumption | Premium |
|---------|-------------|---------|
| Scaling | 0 to 200 instances | 1 to 100 instances |
| Cold starts | Yes | No (pre-warmed) |
| Max timeout | 10 min (default 5) | 60 min (default 30) |
| VNet integration | No | Yes |
| Max memory | 1.5 GB | 14 GB |
| Pricing | Per execution + GB-s | Per core-hour |

## Consumption Plan Details

The Consumption plan is ideal for:

- Variable or unpredictable workloads
- Development and testing environments
- Low-volume applications
- Cost-sensitive projects

```csharp
// Consumption plan function example
// Designed for short, stateless operations
public class ConsumptionFunctions
{
    [Function("ProcessWebhook")]
    public async Task<IActionResult> ProcessWebhook(
        [HttpTrigger(AuthorizationLevel.Function, "post")] HttpRequest req)
    {
        // Quick processing - ideal for Consumption
        var body = await new StreamReader(req.Body).ReadToEndAsync();
        var payload = JsonSerializer.Deserialize<WebhookPayload>(body);

        // Process and respond quickly
        await _messageQueue.SendAsync(payload);

        return new OkResult();
    }

    [Function("ProcessQueueMessage")]
    public async Task ProcessQueueMessage(
        [QueueTrigger("messages")] string message)
    {
        // Stateless processing
        var data = JsonSerializer.Deserialize<MessageData>(message);
        await _processor.ProcessAsync(data);
    }
}
```

## Cold Start Impact

Cold starts affect Consumption plan performance:

```python
# Measure cold start impact
import time
import requests
from statistics import mean, stdev

def measure_cold_start(function_url, samples=50):
    """Measure function response times including cold starts."""

    results = {
        "cold_starts": [],
        "warm_responses": []
    }

    for i in range(samples):
        # Wait enough to trigger cold start
        if i % 10 == 0:
            time.sleep(600)  # 10 minutes

        start = time.time()
        response = requests.get(function_url)
        duration = (time.time() - start) * 1000  # ms

        if i % 10 == 0:
            results["cold_starts"].append(duration)
        else:
            results["warm_responses"].append(duration)

    print("Cold Start Analysis:")
    print(f"  Cold starts: avg={mean(results['cold_starts']):.0f}ms, "
          f"stdev={stdev(results['cold_starts']):.0f}ms")
    print(f"  Warm responses: avg={mean(results['warm_responses']):.0f}ms, "
          f"stdev={stdev(results['warm_responses']):.0f}ms")

    return results

# Typical results:
# Cold starts: avg=3500ms, stdev=800ms
# Warm responses: avg=50ms, stdev=15ms
```

## Premium Plan Details

Premium plan is ideal for:

- Production workloads requiring consistent performance
- Long-running functions (>10 minutes)
- VNet integration requirements
- High memory workloads

```csharp
// Premium plan function example
// Designed for complex, long-running operations
public class PremiumFunctions
{
    [Function("ProcessLargeDataset")]
    public async Task ProcessLargeDataset(
        [BlobTrigger("data/{name}")] Stream blob,
        string name)
    {
        // Long-running processing - takes advantage of Premium
        _logger.LogInformation("Processing large file: {Name}", name);

        // Can run for up to 60 minutes
        var records = await ParseLargeFileAsync(blob);

        foreach (var batch in records.Chunk(1000))
        {
            await ProcessBatchAsync(batch);
        }
    }

    [Function("AccessPrivateResource")]
    public async Task<IActionResult> AccessPrivateResource(
        [HttpTrigger(AuthorizationLevel.Function, "get")] HttpRequest req)
    {
        // Access private resources via VNet integration
        var sqlConnection = new SqlConnection(_privateSqlConnectionString);
        await sqlConnection.OpenAsync();

        var data = await QueryPrivateDatabaseAsync(sqlConnection);

        return new OkObjectResult(data);
    }
}
```

## Cost Comparison Calculator

Calculate costs for different scenarios:

```python
def calculate_monthly_costs(executions, avg_duration_ms, memory_gb=1.5):
    """
    Calculate monthly costs for Consumption vs Premium plans.
    """

    # Consumption pricing (as of 2021)
    consumption = {
        "free_executions": 1_000_000,
        "free_gb_seconds": 400_000,
        "execution_price": 0.20 / 1_000_000,  # per execution
        "gb_second_price": 0.000016  # per GB-second
    }

    # Premium pricing (EP1)
    premium = {
        "base_price_per_hour": 0.169,  # EP1 hourly rate
        "min_instances": 1,
        "hours_per_month": 730
    }

    # Calculate Consumption cost
    billable_executions = max(0, executions - consumption["free_executions"])
    total_gb_seconds = (executions * avg_duration_ms / 1000) * memory_gb
    billable_gb_seconds = max(0, total_gb_seconds - consumption["free_gb_seconds"])

    consumption_cost = (
        billable_executions * consumption["execution_price"] +
        billable_gb_seconds * consumption["gb_second_price"]
    )

    # Calculate Premium cost (assuming constant 1 instance)
    premium_cost = (
        premium["base_price_per_hour"] *
        premium["hours_per_month"] *
        premium["min_instances"]
    )

    # Estimate scaling needs for Premium
    # Assume 1 instance handles 100 req/sec sustained
    peak_rps = (executions / (30 * 24 * 3600)) * 10  # Assume 10x peak
    estimated_instances = max(1, int(peak_rps / 100) + 1)
    premium_scaled_cost = (
        premium["base_price_per_hour"] *
        premium["hours_per_month"] *
        estimated_instances
    )

    return {
        "consumption": {
            "total": round(consumption_cost, 2),
            "per_execution": round(consumption_cost / executions * 1000, 4)
        },
        "premium": {
            "base": round(premium_cost, 2),
            "estimated_scaled": round(premium_scaled_cost, 2),
            "instances_needed": estimated_instances
        },
        "recommendation": "Consumption" if consumption_cost < premium_cost else "Premium"
    }

# Test different scenarios
scenarios = [
    ("Low volume", 100_000, 200),
    ("Medium volume", 5_000_000, 300),
    ("High volume", 50_000_000, 100),
    ("Long running", 1_000_000, 30000),
]

for name, executions, duration in scenarios:
    result = calculate_monthly_costs(executions, duration)
    print(f"\n{name}: {executions:,} executions, {duration}ms avg")
    print(f"  Consumption: ${result['consumption']['total']}")
    print(f"  Premium: ${result['premium']['base']} (base)")
    print(f"  Recommendation: {result['recommendation']}")
```

## Decision Framework

Use this decision tree:

```python
def recommend_plan(requirements):
    """Recommend Consumption or Premium based on requirements."""

    # Must-have Premium scenarios
    if requirements.get("vnet_required"):
        return "Premium", "VNet integration required"

    if requirements.get("max_duration_minutes", 5) > 10:
        return "Premium", f"Execution time exceeds Consumption limit"

    if requirements.get("memory_gb", 1.5) > 1.5:
        return "Premium", "Memory requirements exceed Consumption limit"

    if requirements.get("cold_start_sensitive") and requirements.get("consistent_traffic"):
        return "Premium", "Cold starts unacceptable for consistent traffic"

    # Favor Consumption scenarios
    if requirements.get("monthly_executions", 0) < 1_000_000:
        return "Consumption", "Low volume fits in free tier"

    if requirements.get("highly_variable"):
        return "Consumption", "Scale-to-zero benefits for variable load"

    if requirements.get("dev_environment"):
        return "Consumption", "Development workload"

    # Cost-based decision
    cost = calculate_monthly_costs(
        requirements.get("monthly_executions", 1_000_000),
        requirements.get("avg_duration_ms", 200)
    )

    if cost["consumption"]["total"] < cost["premium"]["base"]:
        return "Consumption", f"Lower cost (${cost['consumption']['total']} vs ${cost['premium']['base']})"

    return "Premium", f"Better value at scale (${cost['premium']['base']})"

# Example usage
requirements = {
    "monthly_executions": 10_000_000,
    "avg_duration_ms": 500,
    "vnet_required": True,
    "cold_start_sensitive": True,
    "consistent_traffic": True
}

plan, reason = recommend_plan(requirements)
print(f"Recommended: {plan}")
print(f"Reason: {reason}")
```

## Hybrid Approach

Use both plans for different workloads:

```hcl
# Terraform configuration for hybrid deployment

# Consumption plan for lightweight, variable workloads
resource "azurerm_function_app" "consumption" {
  name                       = "func-webhooks-consumption"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  app_service_plan_id        = azurerm_app_service_plan.consumption.id
  storage_account_name       = azurerm_storage_account.functions.name
  storage_account_access_key = azurerm_storage_account.functions.primary_access_key

  app_settings = {
    "FUNCTIONS_WORKER_RUNTIME" = "dotnet"
    # Routes heavy processing to Premium
    "PremiumFunctionUrl" = "https://${azurerm_function_app.premium.default_hostname}"
  }
}

resource "azurerm_app_service_plan" "consumption" {
  name                = "asp-consumption"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  kind                = "FunctionApp"

  sku {
    tier = "Dynamic"
    size = "Y1"
  }
}

# Premium plan for consistent, complex workloads
resource "azurerm_function_app" "premium" {
  name                       = "func-processing-premium"
  resource_group_name        = azurerm_resource_group.main.name
  location                   = azurerm_resource_group.main.location
  app_service_plan_id        = azurerm_app_service_plan.premium.id
  storage_account_name       = azurerm_storage_account.functions.name
  storage_account_access_key = azurerm_storage_account.functions.primary_access_key

  app_settings = {
    "FUNCTIONS_WORKER_RUNTIME" = "dotnet"
  }

  site_config {
    pre_warmed_instance_count = 1
    elastic_instance_minimum  = 1
  }
}

resource "azurerm_app_service_plan" "premium" {
  name                = "asp-premium"
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  kind                = "elastic"

  sku {
    tier     = "ElasticPremium"
    size     = "EP1"
    capacity = 1
  }

  maximum_elastic_worker_count = 10
}
```

## Migration Strategies

Moving between plans:

```csharp
// Design for plan portability
public interface IFunctionConfiguration
{
    TimeSpan ExecutionTimeout { get; }
    bool SupportsVNet { get; }
    int MaxMemoryMB { get; }
}

public class ConsumptionConfiguration : IFunctionConfiguration
{
    public TimeSpan ExecutionTimeout => TimeSpan.FromMinutes(10);
    public bool SupportsVNet => false;
    public int MaxMemoryMB => 1536;
}

public class PremiumConfiguration : IFunctionConfiguration
{
    public TimeSpan ExecutionTimeout => TimeSpan.FromMinutes(60);
    public bool SupportsVNet => true;
    public int MaxMemoryMB => 14336;
}

// Code that adapts to plan capabilities
public class AdaptiveProcessor
{
    private readonly IFunctionConfiguration _config;

    public async Task ProcessAsync(WorkItem item)
    {
        if (IsLongRunning(item) && _config.ExecutionTimeout < TimeSpan.FromMinutes(30))
        {
            // Break into smaller chunks for Consumption
            await ProcessInChunksAsync(item);
        }
        else
        {
            // Process directly on Premium
            await ProcessFullyAsync(item);
        }
    }
}
```

## Conclusion

Choosing between Consumption and Premium plans depends on your specific requirements around cost, performance, and capabilities. Consumption is ideal for variable workloads and cost optimization, while Premium excels for consistent performance, VNet connectivity, and long-running processes.

Many organizations benefit from a hybrid approach, using Consumption for lightweight, variable workloads and Premium for critical, performance-sensitive functions. Design your code for portability between plans, and regularly review your usage patterns to optimize costs.
