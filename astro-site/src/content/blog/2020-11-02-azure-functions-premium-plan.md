---
title: "Azure Functions Premium Plan: Enterprise Serverless"
description: "Cold starts on Consumption plan kill credibility. I've watched a perfectly good HTTP-triggered function get blamed for \"the API being slow\" because the…"
author: Michael John Peña
draft: false
date: 2020-11-02
tags:
  - Azure
  - Functions
  - Serverless
  - Enterprise
---

Cold starts on Consumption plan kill credibility. I've watched a perfectly good HTTP-triggered function get blamed for "the API being slow" because the first request after idle took eight seconds. The fix isn't always to abandon serverless—Premium plan exists for exactly this. Pre-warmed instances, VNet integration, no 10-minute timeout. You pay for the floor, but you stop apologising for cold starts.

## Premium vs Consumption

| Feature | Consumption | Premium |
|---------|-------------|---------|
| Cold starts | Yes | No (pre-warmed) |
| Max timeout | 10 min | Unlimited |
| VNet integration | No | Yes |
| Min instances | 0 | 1+ (configurable) |
| Scaling | Event-driven | Event-driven |
| Billing | Per execution | Per vCPU-second |

## Creating Premium Plan

```bash
# Create premium plan
az functionapp plan create \
    --name my-premium-plan \
    --resource-group myRG \
    --location eastus \
    --sku EP1 \
    --min-instances 1 \
    --max-burst 10

# Create function app on premium
az functionapp create \
    --name my-premium-func \
    --resource-group myRG \
    --plan my-premium-plan \
    --storage-account mystorageaccount \
    --runtime dotnet
```

## SKU Options

| SKU | vCPU | Memory | Price |
|-----|------|--------|-------|
| EP1 | 1 | 3.5 GB | $0.173/hr |
| EP2 | 2 | 7 GB | $0.346/hr |
| EP3 | 4 | 14 GB | $0.692/hr |

## Pre-Warmed Instances

```bash
# Set minimum instances (always warm)
az functionapp config set \
    --name my-premium-func \
    --resource-group myRG \
    --min-instances 2

# View current instance count
az functionapp show \
    --name my-premium-func \
    --resource-group myRG \
    --query "siteConfig.preWarmedInstanceCount"
```

## VNet Integration

```bash
# Integrate with VNet
az functionapp vnet-integration add \
    --name my-premium-func \
    --resource-group myRG \
    --vnet myVNet \
    --subnet functions-subnet
```

## Private Endpoints

```bash
# Create private endpoint
az network private-endpoint create \
    --name func-private-endpoint \
    --resource-group myRG \
    --vnet-name myVNet \
    --subnet private-endpoints \
    --private-connection-resource-id $(az functionapp show --name my-premium-func -g myRG --query id -o tsv) \
    --group-id sites \
    --connection-name func-connection
```

## Scale Configuration

```json
// host.json
{
    "extensions": {
        "http": {
            "maxConcurrentRequests": 200
        }
    },
    "functionTimeout": "00:30:00"  // 30 minutes
}
```

## Long-Running Functions

```csharp
// Unlimited execution time with Premium
[FunctionName("LongRunningProcess")]
public static async Task<IActionResult> Run(
    [HttpTrigger] HttpRequest req,
    ILogger log)
{
    // Process for hours if needed
    await ProcessLargeDataset();  // No timeout
    return new OkResult();
}
```

## Accessing Private Resources

```csharp
// Connect to SQL in private VNet
[FunctionName("QueryPrivateSQL")]
public static async Task<IActionResult> Run(
    [HttpTrigger] HttpRequest req)
{
    // Connection goes through VNet integration
    var connectionString = "Server=private-sql.database.windows.net;...";
    using var connection = new SqlConnection(connectionString);
    await connection.OpenAsync();
    // Query data...
}
```

## Monitoring Instances

```kusto
// App Insights query - check instance distribution
FunctionAppLogs
| where TimeGenerated > ago(1h)
| summarize count() by RoleInstance
| render piechart
```

## Cost Optimization

```bash
# Scale to zero during off-hours (loses pre-warming)
az functionapp config set \
    --name my-premium-func \
    --resource-group myRG \
    --min-instances 0

# Use slots for dev/test on same plan
az functionapp deployment slot create \
    --name my-premium-func \
    --resource-group myRG \
    --slot staging
```

Premium plan: production-grade serverless without compromises.
