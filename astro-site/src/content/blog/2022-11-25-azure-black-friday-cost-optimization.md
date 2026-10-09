---
title: "Black Friday Azure Tips: Cost Optimization for Peak Traffic"
author: Michael John Peña
draft: false
date: 2022-11-25
tags:
  - Azure
  - Cost Optimization
  - Scaling
  - Performance
  - Best Practices
---

## Pre-Scale Critical Resources

Don't wait for auto-scaling to catch up during traffic spikes:

```bicep
// Pre-scale App Service for expected traffic
resource appServicePlan 'Microsoft.Web/serverfarms@2022-03-01' = {
  name: 'asp-blackfriday'
  location: location
  sku: {
    name: 'P3v3'
    tier: 'PremiumV3'
    capacity: 10  // Pre-scale to 10 instances
  }
  kind: 'linux'
}

// Configure aggressive auto-scaling
resource autoscale 'Microsoft.Insights/autoscalesettings@2022-10-01' = {
  name: 'autoscale-blackfriday'
  location: location
  properties: {
    targetResourceUri: appServicePlan.id
    enabled: true
    profiles: [
      {
        name: 'BlackFriday'
        capacity: {
          minimum: '10'
          maximum: '50'
          default: '10'
        }
        rules: [
          {
            metricTrigger: {
              metricName: 'CpuPercentage'
              metricResourceUri: appServicePlan.id
              timeGrain: 'PT1M'
              statistic: 'Average'
              timeWindow: 'PT5M'
              timeAggregation: 'Average'
              operator: 'GreaterThan'
              threshold: 60
            }
            scaleAction: {
              direction: 'Increase'
              type: 'ChangeCount'
              value: '5'  // Add 5 instances at a time
              cooldown: 'PT3M'
            }
          }
        ]
        recurrence: {
          frequency: 'Week'
          schedule: {
            timeZone: 'Eastern Standard Time'
            days: ['Friday']
            hours: [0]
            minutes: [0]
          }
        }
      }
    ]
  }
}
```

## Cache Aggressively

Reduce database load with intelligent caching:

```csharp
public class ProductCacheService
{
    private readonly IDistributedCache _cache;
    private readonly IProductRepository _repository;
    private readonly TimeSpan _blackFridayCacheDuration = TimeSpan.FromMinutes(15);

    public async Task<Product> GetProductAsync(string productId)
    {
        var cacheKey = $"product:{productId}";

        // Try cache first
        var cached = await _cache.GetStringAsync(cacheKey);
        if (cached != null)
        {
            return JsonSerializer.Deserialize<Product>(cached);
        }

        // Cache miss - get from database
        var product = await _repository.GetByIdAsync(productId);

        if (product != null)
        {
            await _cache.SetStringAsync(
                cacheKey,
                JsonSerializer.Serialize(product),
                new DistributedCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = _blackFridayCacheDuration
                });
        }

        return product;
    }

    // Pre-warm cache before traffic hits
    public async Task PreWarmCacheAsync()
    {
        var topProducts = await _repository.GetTopSellingProductsAsync(1000);

        foreach (var product in topProducts)
        {
            var cacheKey = $"product:{product.Id}";
            await _cache.SetStringAsync(
                cacheKey,
                JsonSerializer.Serialize(product),
                new DistributedCacheEntryOptions
                {
                    AbsoluteExpirationRelativeToNow = TimeSpan.FromHours(4)
                });
        }
    }
}
```

## Optimize Database Queries

Use read replicas and query optimization:

```sql
-- Create read replica for reporting queries
-- Route read traffic to replica

-- Optimize critical queries
CREATE NONCLUSTERED INDEX IX_Orders_BlackFriday
ON Orders (OrderDate, CustomerId)
INCLUDE (TotalAmount, Status)
WHERE OrderDate >= '2022-11-25' AND OrderDate < '2022-11-26';

-- Use query store to identify slow queries
SELECT TOP 10
    qt.query_sql_text,
    rs.avg_duration,
    rs.count_executions,
    rs.avg_cpu_time
FROM sys.query_store_query_text qt
JOIN sys.query_store_query q ON qt.query_text_id = q.query_text_id
JOIN sys.query_store_plan p ON q.query_id = p.query_id
JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
ORDER BY rs.avg_duration * rs.count_executions DESC;
```

## Use CDN for Static Assets

Offload static content to Azure CDN:

```bicep
resource cdnProfile 'Microsoft.Cdn/profiles@2021-06-01' = {
  name: 'cdn-blackfriday'
  location: 'global'
  sku: {
    name: 'Standard_Microsoft'
  }
}

resource cdnEndpoint 'Microsoft.Cdn/profiles/endpoints@2021-06-01' = {
  parent: cdnProfile
  name: 'static-assets'
  location: 'global'
  properties: {
    originHostHeader: storageAccount.properties.primaryEndpoints.web
    origins: [
      {
        name: 'storage-origin'
        properties: {
          hostName: replace(replace(storageAccount.properties.primaryEndpoints.web, 'https://', ''), '/', '')
        }
      }
    ]
    isCompressionEnabled: true
    contentTypesToCompress: [
      'text/html'
      'text/css'
      'application/javascript'
      'application/json'
      'image/svg+xml'
    ]
    deliveryPolicy: {
      rules: [
        {
          name: 'CacheStatic'
          order: 1
          conditions: [
            {
              name: 'UrlFileExtension'
              parameters: {
                operator: 'Equal'
                matchValues: ['js', 'css', 'png', 'jpg', 'gif', 'woff2']
              }
            }
          ]
          actions: [
            {
              name: 'CacheExpiration'
              parameters: {
                cacheBehavior: 'Override'
                cacheType: 'All'
                cacheDuration: '30.00:00:00'  // 30 days
              }
            }
          ]
        }
      ]
    }
  }
}
```

## Queue Non-Critical Operations

Don't let inventory updates block checkout:

```csharp
public class OrderService
{
    private readonly IQueueClient _queueClient;
    private readonly IOrderRepository _orderRepository;

    public async Task<OrderResult> ProcessOrderAsync(Order order)
    {
        // Critical path: validate and create order
        var validation = await ValidateOrderAsync(order);
        if (!validation.IsValid)
        {
            return OrderResult.Failed(validation.Errors);
        }

        // Create order synchronously
        var createdOrder = await _orderRepository.CreateAsync(order);

        // Queue non-critical operations
        await _queueClient.SendMessageAsync(new OrderCreatedMessage
        {
            OrderId = createdOrder.Id,
            CustomerId = order.CustomerId,
            Items = order.Items
        });

        // Return immediately - don't wait for:
        // - Email confirmation
        // - Inventory update
        // - Analytics tracking
        // - Loyalty points calculation

        return OrderResult.Success(createdOrder.Id);
    }
}

// Background processor handles queued work
public class OrderBackgroundProcessor
{
    [Function("ProcessOrderQueue")]
    public async Task ProcessAsync(
        [QueueTrigger("orders")] OrderCreatedMessage message)
    {
        // Send confirmation email
        await _emailService.SendOrderConfirmationAsync(message.OrderId);

        // Update inventory
        await _inventoryService.DecrementStockAsync(message.Items);

        // Track analytics
        await _analyticsService.TrackPurchaseAsync(message);

        // Calculate loyalty points
        await _loyaltyService.AddPointsAsync(message.CustomerId, message.OrderId);
    }
}
```

## Monitor in Real-Time

Set up dashboards for the big day:

```kusto
// Application Insights query for real-time monitoring
requests
| where timestamp > ago(5m)
| summarize
    RequestCount = count(),
    AvgDuration = avg(duration),
    P95Duration = percentile(duration, 95),
    FailureRate = 100.0 * countif(success == false) / count()
    by bin(timestamp, 1m)
| render timechart

// Alert on degradation
requests
| where timestamp > ago(5m)
| where duration > 2000 or success == false
| summarize count() by bin(timestamp, 1m), operation_Name
| where count_ > 100
```

## Cost Monitoring

Keep track of spending during the event:

```python
from azure.mgmt.costmanagement import CostManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
client = CostManagementClient(credential)

# Get real-time cost for Black Friday
query = {
    "type": "Usage",
    "timeframe": "Custom",
    "timePeriod": {
        "from": "2022-11-25T00:00:00Z",
        "to": "2022-11-25T23:59:59Z"
    },
    "dataset": {
        "granularity": "Hourly",
        "aggregation": {
            "totalCost": {
                "name": "Cost",
                "function": "Sum"
            }
        },
        "grouping": [
            {"type": "Dimension", "name": "ServiceName"}
        ]
    }
}

scope = f"/subscriptions/{subscription_id}"
result = client.query.usage(scope, query)

for row in result.rows:
    print(f"{row[0]}: ${row[1]:.2f}")
```

## Post-Event: Scale Down

After the rush, reduce resources:

```powershell
# Schedule scale-down for Saturday morning
$webhook = "https://management.azure.com/..."

$body = @{
    sku = @{
        name = "P1v3"
        tier = "PremiumV3"
        capacity = 2
    }
} | ConvertTo-Json

# Create scheduled task or use Azure Automation
$scheduleTime = [DateTime]::Parse("2022-11-26T06:00:00Z")

New-AzAutomationSchedule `
    -AutomationAccountName "automation-account" `
    -Name "ScaleDown-PostBlackFriday" `
    -StartTime $scheduleTime `
    -OneTime `
    -ResourceGroupName "rg-production"
```

## Conclusion

Black Friday success comes from preparation. Pre-scale resources, cache aggressively, queue non-critical work, and monitor closely. After the event, don't forget to scale back down. These patterns apply to any high-traffic event - not just Black Friday.

## Checklist

- [ ] Pre-scale compute resources
- [ ] Configure aggressive auto-scaling
- [ ] Pre-warm caches
- [ ] Enable read replicas
- [ ] Set up CDN for static content
- [ ] Queue non-critical operations
- [ ] Create monitoring dashboards
- [ ] Set up cost alerts
- [ ] Plan post-event scale-down
- [ ] Test failover procedures

## Resources

- [Azure Well-Architected Framework](https://docs.microsoft.com/en-us/azure/architecture/framework/)
- [Auto-scaling Best Practices](https://docs.microsoft.com/en-us/azure/architecture/best-practices/auto-scaling)
- [Azure CDN](https://docs.microsoft.com/en-us/azure/cdn/)
- [Cost Management](https://docs.microsoft.com/en-us/azure/cost-management-billing/)
