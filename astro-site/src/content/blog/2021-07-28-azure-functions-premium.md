---
title: Azure Functions Premium Plan - When and Why
description: "The Azure Functions Premium plan is the hosting option I reach for as soon as two of these three conditions are true: the function needs to connect to a…"
author: Michael John Peña
draft: false
date: 2021-07-28
url: /blog/azure-functions-premium/
tags:
  - Azure
  - Serverless
  - Azure Functions
  - Architecture
  - Cloud
---

The Azure Functions Premium plan is the hosting option I reach for as soon as two of these three conditions are true: the function needs to connect to a resource in a private VNet (Storage Account or SQL Server with no public endpoint, Key Vault on a private endpoint), the function is user-facing and cold starts would degrade the experience, or the execution model requires more than 10 minutes per invocation. Premium keeps at least one always-warm instance that eliminates the cold start, provides VNet integration for private resource access, and removes the execution time cap. The cost model is different: you pay for instance-hours rather than per-execution, so the economics make sense when your function runs frequently enough that pre-warmed instances are utilised most of the time. For sporadic workloads with generous latency budgets, Consumption is still the better choice.

## Premium Plan Features

The Premium plan offers several advantages:

- **Pre-warmed instances**: Eliminate cold starts
- **VNet integration**: Connect to private resources
- **Unlimited execution time**: No 5/10 minute timeout
- **More powerful instances**: Up to 14GB memory
- **Premium storage**: Faster storage performance

## Creating a Premium Function App

Deploy a Premium function app:

```bash
# Create Premium App Service Plan
az functionapp plan create \
    --resource-group rg-functions \
    --name premium-plan \
    --location eastus \
    --sku EP1 \
    --min-instances 1 \
    --max-burst 10

# Create Function App on Premium plan
az functionapp create \
    --resource-group rg-functions \
    --name myfunc-premium \
    --storage-account funcstorageaccount \
    --plan premium-plan \
    --runtime dotnet \
    --runtime-version 6 \
    --functions-version 4

# Configure VNet integration
az functionapp vnet-integration add \
    --resource-group rg-functions \
    --name myfunc-premium \
    --vnet vnet-main \
    --subnet subnet-functions
```

## Terraform Configuration

Complete Premium function app setup:

```hcl
# Premium App Service Plan
resource "azurerm_service_plan" "premium" {
  name                = "premium-functions-plan"
  resource_group_name = azurerm_resource_group.functions.name
  location            = azurerm_resource_group.functions.location
  os_type             = "Linux"
  sku_name            = "EP1"

  tags = {
    Environment = "Production"
  }
}

# Function App
resource "azurerm_linux_function_app" "premium" {
  name                = "myfunc-premium"
  resource_group_name = azurerm_resource_group.functions.name
  location            = azurerm_resource_group.functions.location

  storage_account_name       = azurerm_storage_account.functions.name
  storage_account_access_key = azurerm_storage_account.functions.primary_access_key
  service_plan_id            = azurerm_service_plan.premium.id

  site_config {
    always_on = true

    application_stack {
      dotnet_version = "6.0"
    }

    # Pre-warmed instances
    pre_warmed_instance_count = 1

    # Elastic scale settings
    elastic_instance_minimum = 1

    # VNet integration
    vnet_route_all_enabled = true
  }

  app_settings = {
    "FUNCTIONS_WORKER_RUNTIME"       = "dotnet"
    "WEBSITE_RUN_FROM_PACKAGE"       = "1"
    "APPINSIGHTS_INSTRUMENTATIONKEY" = azurerm_application_insights.functions.instrumentation_key

    # Connection strings for private resources
    "SqlConnectionString" = "@Microsoft.KeyVault(VaultName=${azurerm_key_vault.main.name};SecretName=sql-connection-string)"
  }

  identity {
    type = "SystemAssigned"
  }

  virtual_network_subnet_id = azurerm_subnet.functions.id

  tags = {
    Environment = "Production"
  }
}

# VNet integration subnet
resource "azurerm_subnet" "functions" {
  name                 = "subnet-functions"
  resource_group_name  = azurerm_resource_group.networking.name
  virtual_network_name = azurerm_virtual_network.main.name
  address_prefixes     = ["10.0.10.0/24"]

  delegation {
    name = "functions-delegation"

    service_delegation {
      name = "Microsoft.Web/serverFarms"
      actions = [
        "Microsoft.Network/virtualNetworks/subnets/action"
      ]
    }
  }
}

# Private endpoints for storage
resource "azurerm_private_endpoint" "storage_blob" {
  name                = "pe-storage-blob"
  resource_group_name = azurerm_resource_group.functions.name
  location            = azurerm_resource_group.functions.location
  subnet_id           = azurerm_subnet.privatelink.id

  private_service_connection {
    name                           = "storage-blob-connection"
    private_connection_resource_id = azurerm_storage_account.functions.id
    is_manual_connection           = false
    subresource_names              = ["blob"]
  }

  private_dns_zone_group {
    name                 = "storage-dns-group"
    private_dns_zone_ids = [azurerm_private_dns_zone.blob.id]
  }
}
```

## Comparing Premium vs Consumption

Code to analyze when Premium makes sense:

```python
def calculate_cost_comparison(monthly_executions, avg_duration_ms, memory_gb=1.5):
    """
    Compare costs between Consumption and Premium plans.
    """

    # Consumption pricing (approximate)
    consumption_free_executions = 1_000_000
    consumption_free_gb_seconds = 400_000

    consumption_exec_cost = 0.20 / 1_000_000  # $0.20 per million executions
    consumption_gb_second_cost = 0.000016  # $0.000016 per GB-second

    # Premium pricing (EP1)
    premium_base_cost = 173  # Monthly base for EP1 (1 instance)
    premium_additional_instance = 173  # Per additional instance

    # Calculate Consumption cost
    billable_executions = max(0, monthly_executions - consumption_free_executions)
    total_gb_seconds = (monthly_executions * avg_duration_ms / 1000) * memory_gb
    billable_gb_seconds = max(0, total_gb_seconds - consumption_free_gb_seconds)

    consumption_cost = (billable_executions * consumption_exec_cost) + \
                      (billable_gb_seconds * consumption_gb_second_cost)

    # Calculate Premium cost (assume 1-2 instances average)
    avg_instances = 1.5  # Assume some scaling
    premium_cost = premium_base_cost * avg_instances

    # Cold start impact (estimated lost revenue/productivity)
    cold_start_rate = 0.1  # 10% of requests hit cold start on Consumption
    cold_start_delay_seconds = 3
    cold_start_cost_per_second = 0.001  # Business cost of delay

    consumption_cold_start_cost = monthly_executions * cold_start_rate * \
                                  cold_start_delay_seconds * cold_start_cost_per_second

    return {
        "consumption": {
            "compute_cost": round(consumption_cost, 2),
            "cold_start_cost": round(consumption_cold_start_cost, 2),
            "total_cost": round(consumption_cost + consumption_cold_start_cost, 2)
        },
        "premium": {
            "compute_cost": round(premium_cost, 2),
            "cold_start_cost": 0,
            "total_cost": round(premium_cost, 2)
        },
        "recommendation": "Premium" if premium_cost < (consumption_cost + consumption_cold_start_cost) else "Consumption",
        "savings": round(abs(premium_cost - (consumption_cost + consumption_cold_start_cost)), 2)
    }

# Analyze different scenarios
scenarios = [
    {"name": "Low volume", "executions": 100_000, "duration": 500},
    {"name": "Medium volume", "executions": 5_000_000, "duration": 500},
    {"name": "High volume", "executions": 50_000_000, "duration": 200},
    {"name": "Long running", "executions": 1_000_000, "duration": 5000},
]

print("Cost Comparison Analysis")
print("=" * 60)

for scenario in scenarios:
    result = calculate_cost_comparison(
        scenario["executions"],
        scenario["duration"]
    )

    print(f"\n{scenario['name']}:")
    print(f"  Monthly executions: {scenario['executions']:,}")
    print(f"  Avg duration: {scenario['duration']}ms")
    print(f"  Consumption: ${result['consumption']['total_cost']}")
    print(f"  Premium: ${result['premium']['total_cost']}")
    print(f"  Recommendation: {result['recommendation']}")
```

## VNet-Connected Function

Access private resources from Premium functions:

```csharp
using System;
using System.Data.SqlClient;
using System.Threading.Tasks;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

public class PrivateResourceFunction
{
    private readonly ILogger<PrivateResourceFunction> _logger;
    private readonly string _sqlConnectionString;

    public PrivateResourceFunction(
        ILogger<PrivateResourceFunction> logger,
        IConfiguration configuration)
    {
        _logger = logger;
        _sqlConnectionString = configuration["SqlConnectionString"];
    }

    [Function("ProcessPrivateData")]
    public async Task<string> Run(
        [QueueTrigger("private-queue", Connection = "StorageConnection")] string message)
    {
        _logger.LogInformation("Processing message from private queue");

        // Connect to private SQL Server via VNet
        using var connection = new SqlConnection(_sqlConnectionString);
        await connection.OpenAsync();

        using var command = new SqlCommand(
            "INSERT INTO ProcessedMessages (Content, ProcessedAt) VALUES (@Content, @ProcessedAt)",
            connection);

        command.Parameters.AddWithValue("@Content", message);
        command.Parameters.AddWithValue("@ProcessedAt", DateTime.UtcNow);

        await command.ExecuteNonQueryAsync();

        _logger.LogInformation("Message processed and stored in private SQL");

        return "Processed";
    }
}
```

## Scaling Configuration

Configure Premium plan scaling:

```python
from azure.mgmt.web import WebSiteManagementClient

web_client = WebSiteManagementClient(credential, subscription_id)

def configure_premium_scaling(resource_group, function_app_name, min_instances, max_burst):
    """Configure scaling for Premium function app."""

    # Get current site config
    site_config = web_client.web_apps.get_configuration(
        resource_group,
        function_app_name
    )

    # Update scaling settings
    site_config.pre_warmed_instance_count = min_instances
    site_config.minimum_elastic_instance_count = min_instances

    web_client.web_apps.update_configuration(
        resource_group,
        function_app_name,
        site_config
    )

    # Configure auto-scale rules
    from azure.mgmt.monitor import MonitorManagementClient

    monitor_client = MonitorManagementClient(credential, subscription_id)

    autoscale_setting = {
        "location": "eastus",
        "profiles": [{
            "name": "DefaultProfile",
            "capacity": {
                "minimum": str(min_instances),
                "maximum": str(max_burst),
                "default": str(min_instances)
            },
            "rules": [
                {
                    "metricTrigger": {
                        "metricName": "FunctionExecutionCount",
                        "metricResourceUri": f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Web/sites/{function_app_name}",
                        "timeGrain": "PT1M",
                        "statistic": "Average",
                        "timeWindow": "PT5M",
                        "timeAggregation": "Average",
                        "operator": "GreaterThan",
                        "threshold": 1000
                    },
                    "scaleAction": {
                        "direction": "Increase",
                        "type": "ChangeCount",
                        "value": "1",
                        "cooldown": "PT5M"
                    }
                },
                {
                    "metricTrigger": {
                        "metricName": "FunctionExecutionCount",
                        "metricResourceUri": f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Web/sites/{function_app_name}",
                        "timeGrain": "PT1M",
                        "statistic": "Average",
                        "timeWindow": "PT10M",
                        "timeAggregation": "Average",
                        "operator": "LessThan",
                        "threshold": 100
                    },
                    "scaleAction": {
                        "direction": "Decrease",
                        "type": "ChangeCount",
                        "value": "1",
                        "cooldown": "PT10M"
                    }
                }
            ]
        }],
        "enabled": True,
        "targetResourceUri": f"/subscriptions/{subscription_id}/resourceGroups/{resource_group}/providers/Microsoft.Web/serverFarms/{plan_name}"
    }

    monitor_client.autoscale_settings.create_or_update(
        resource_group,
        f"{function_app_name}-autoscale",
        autoscale_setting
    )

    print(f"Configured scaling: min={min_instances}, max={max_burst}")

# Configure scaling
configure_premium_scaling("rg-functions", "myfunc-premium", min_instances=2, max_burst=10)
```

## When to Choose Premium

Decision criteria for Premium plan:

```python
def recommend_plan(requirements):
    """Recommend Consumption or Premium based on requirements."""

    reasons_for_premium = []
    reasons_for_consumption = []

    # VNet connectivity required
    if requirements.get("vnet_required"):
        reasons_for_premium.append("VNet integration needed for private resources")

    # Cold start sensitivity
    if requirements.get("cold_start_sensitive"):
        reasons_for_premium.append("Application requires consistent response times (no cold starts)")

    # Long running functions
    if requirements.get("max_duration_minutes", 5) > 10:
        reasons_for_premium.append(f"Functions run longer than 10 minutes ({requirements['max_duration_minutes']} min)")

    # High memory requirements
    if requirements.get("memory_gb", 1.5) > 1.5:
        reasons_for_premium.append(f"Requires more than 1.5GB memory ({requirements['memory_gb']}GB)")

    # Predictable workload
    if requirements.get("predictable_baseline"):
        reasons_for_premium.append("Predictable baseline workload benefits from reserved capacity")

    # Low volume
    if requirements.get("monthly_executions", 0) < 1_000_000:
        reasons_for_consumption.append("Low volume workload fits within free tier")

    # Highly variable
    if requirements.get("highly_variable") and not requirements.get("cold_start_sensitive"):
        reasons_for_consumption.append("Highly variable workload benefits from scale-to-zero")

    # Cost sensitive
    if requirements.get("cost_sensitive") and not reasons_for_premium:
        reasons_for_consumption.append("Consumption plan has lower baseline cost")

    recommendation = "Premium" if len(reasons_for_premium) > len(reasons_for_consumption) else "Consumption"

    return {
        "recommendation": recommendation,
        "premium_reasons": reasons_for_premium,
        "consumption_reasons": reasons_for_consumption
    }

# Example evaluation
requirements = {
    "vnet_required": True,
    "cold_start_sensitive": True,
    "max_duration_minutes": 15,
    "memory_gb": 2,
    "monthly_executions": 5_000_000,
    "predictable_baseline": True
}

result = recommend_plan(requirements)
print(f"Recommendation: {result['recommendation']}")
print(f"Premium reasons: {result['premium_reasons']}")
print(f"Consumption reasons: {result['consumption_reasons']}")
```

## Conclusion

Azure Functions Premium plan is the right choice when you need VNet connectivity, cannot tolerate cold starts, have long-running functions, or require more powerful instances. While it has a higher baseline cost than Consumption, the predictable pricing and enhanced capabilities often justify the investment for production workloads.

Evaluate your specific requirements around latency, connectivity, execution time, and cost to determine the best plan. Many organizations use both plans: Consumption for low-priority background tasks and Premium for customer-facing, latency-sensitive functions.
