---
title: Power BI Premium Gen2 - Enhanced Performance and New Capabilities
author: Michael John Peña
draft: false
date: 2021-07-04
url: /blog/power-bi-premium-gen2/
tags:
  - Azure
  - Power BI
  - Analytics
  - Data
  - Business Intelligence

---

I wrote "2021-07-04-power-bi-premium-gen2" to share practical, production-minded guidance on this topic.

# Key Improvements in Gen2

Premium Gen2 introduces several architectural improvements:

- Autoscale compute resources based on demand
- No need for capacity management or monitoring v-cores
- Improved query performance with optimized engine
- Better handling of concurrent users
- Enhanced dataflow performance
- Paginated reports integration

# Migrating to Premium Gen2

Check and enable Gen2 in the Admin portal:

```powershell
# Connect to Power BI service
Connect-PowerBIServiceAccount

# Get current capacity settings
$capacity = Get-PowerBICapacity -Scope Organization

# Check Gen2 status
foreach ($cap in $capacity) {
    Write-Host "Capacity: $($cap.DisplayName)"
    Write-Host "SKU: $($cap.Sku)"
    Write-Host "State: $($cap.State)"
    Write-Host "Region: $($cap.Region)"
}

# Enable Gen2 through REST API
$capacityId = "your-capacity-id"
$body = @{
    properties = @{
        mode = "Gen2"
    }
} | ConvertTo-Json

Invoke-PowerBIRestMethod -Url "capacities/$capacityId" -Method Patch -Body $body
```

# Optimizing Datasets for Gen2

Take advantage of Gen2's improved engine:

```dax
// Measure optimized for Gen2's enhanced calculation engine
Sales Growth % =
VAR CurrentPeriodSales = [Total Sales]
VAR PreviousPeriodSales =
    CALCULATE(
        [Total Sales],
        DATEADD('Date'[Date], -1, YEAR)
    )
RETURN
    DIVIDE(
        CurrentPeriodSales - PreviousPeriodSales,
        PreviousPeriodSales,
        BLANK()
    )

// Large table aggregation - Gen2 handles these more efficiently
Total Sales by Region =
SUMMARIZECOLUMNS(
    Geography[Region],
    Geography[Country],
    Product[Category],
    "Total Sales", [Total Sales],
    "Order Count", [Order Count],
    "Avg Order Value", [Avg Order Value],
    "YoY Growth", [Sales Growth %]
)
```

# Enhanced Dataflows

Premium Gen2 improves dataflow performance:

```m
// Power Query M - Complex transformation leveraging Gen2
let
    // Source from Azure SQL
    Source = Sql.Database("server.database.windows.net", "salesdb"),

    // Large table with millions of rows
    Sales = Source{[Schema="dbo", Item="FactSales"]}[Data],

    // Apply transformations - Gen2 handles these in parallel
    FilteredSales = Table.SelectRows(Sales, each [OrderDate] >= #date(2021, 1, 1)),

    // Add calculated columns
    WithCalculations = Table.AddColumn(FilteredSales, "Profit",
        each [Revenue] - [Cost], type number),

    // Group and aggregate
    Aggregated = Table.Group(WithCalculations,
        {"ProductID", "CustomerID", "OrderDate"},
        {
            {"TotalRevenue", each List.Sum([Revenue]), type number},
            {"TotalProfit", each List.Sum([Profit]), type number},
            {"OrderCount", each Table.RowCount(_), Int64.Type}
        }
    ),

    // Join with dimension tables
    WithProduct = Table.NestedJoin(Aggregated, {"ProductID"},
        Products, {"ProductID"}, "ProductDetails", JoinKind.LeftOuter),

    Expanded = Table.ExpandTableColumn(WithProduct, "ProductDetails",
        {"ProductName", "Category", "SubCategory"})
in
    Expanded
```

# Composite Models with DirectQuery

Gen2 supports enhanced composite models:

```json
{
  "name": "SalesAnalytics",
  "tables": [
    {
      "name": "FactSales",
      "mode": "DirectQuery",
      "source": {
        "type": "AzureSynapseAnalytics",
        "connectionString": "Data Source=synapse.sql.azuresynapse.net;Initial Catalog=salespool"
      }
    },
    {
      "name": "DimProduct",
      "mode": "Import",
      "refreshPolicy": {
        "incrementalRefresh": true,
        "refreshPeriod": "1 Day"
      }
    },
    {
      "name": "AggregatedSales",
      "mode": "Import",
      "isAggregation": true,
      "aggregations": [
        {
          "column": "ProductCategory",
          "sourceColumn": "FactSales.ProductCategory",
          "summarization": "GroupBy"
        },
        {
          "column": "TotalSales",
          "sourceColumn": "FactSales.SalesAmount",
          "summarization": "Sum"
        }
      ]
    }
  ]
}
```

# Autoscale Configuration

Configure autoscale for Gen2 capacity:

```powershell
# Azure PowerShell - Configure autoscale
$resourceGroup = "rg-powerbi"
$capacityName = "pbi-premium-capacity"

# Get current autoscale settings
$autoscale = Get-AzPowerBIEmbeddedCapacity -ResourceGroupName $resourceGroup -Name $capacityName

# Configure autoscale rules
$scaleUpRule = New-AzAutoscaleRule -MetricName "QueryDuration" `
    -MetricResourceId $autoscale.Id `
    -Operator GreaterThan `
    -MetricStatistic Average `
    -Threshold 5000 `
    -TimeGrain 00:01:00 `
    -TimeWindow 00:05:00 `
    -ScaleActionCooldown 00:10:00 `
    -ScaleActionDirection Increase `
    -ScaleActionValue 1

$scaleDownRule = New-AzAutoscaleRule -MetricName "QueryDuration" `
    -MetricResourceId $autoscale.Id `
    -Operator LessThan `
    -MetricStatistic Average `
    -Threshold 1000 `
    -TimeGrain 00:01:00 `
    -TimeWindow 00:10:00 `
    -ScaleActionCooldown 00:15:00 `
    -ScaleActionDirection Decrease `
    -ScaleActionValue 1

# Create autoscale profile
$profile = New-AzAutoscaleProfile -DefaultCapacity 2 `
    -MaximumCapacity 8 `
    -MinimumCapacity 1 `
    -Rule $scaleUpRule, $scaleDownRule `
    -Name "AutoscaleProfile"
```

# Monitoring Premium Gen2

Use the Premium Capacity Metrics app:

```powershell
# Query capacity metrics via REST API
$token = Get-PowerBIAccessToken

$headers = @{
    "Authorization" = "Bearer $($token.AccessToken)"
    "Content-Type" = "application/json"
}

# Get capacity metrics
$metricsUrl = "https://api.powerbi.com/v1.0/myorg/capacities/$capacityId/refreshables"
$metrics = Invoke-RestMethod -Uri $metricsUrl -Headers $headers -Method Get

# Display refresh statistics
foreach ($dataset in $metrics.value) {
    Write-Host "Dataset: $($dataset.name)"
    Write-Host "  Last Refresh: $($dataset.lastRefresh.endTime)"
    Write-Host "  Refresh Duration: $($dataset.lastRefresh.duration) ms"
    Write-Host "  Status: $($dataset.lastRefresh.status)"
    Write-Host ""
}

# Export metrics to Azure Monitor
$workspaceId = "log-analytics-workspace-id"
$logType = "PowerBICapacityMetrics"

foreach ($metric in $metrics.value) {
    $logEntry = @{
        TimeGenerated = (Get-Date).ToUniversalTime().ToString("o")
        CapacityId = $capacityId
        DatasetName = $metric.name
        RefreshDuration = $metric.lastRefresh.duration
        RefreshStatus = $metric.lastRefresh.status
    } | ConvertTo-Json

    # Send to Log Analytics
    Post-LogAnalyticsData -WorkspaceId $workspaceId -LogType $logType -Body $logEntry
}
```

# Best Practices for Gen2

Configure datasets for optimal Gen2 performance:

```dax
// Use variables to avoid repeated calculations
Customer Lifetime Value =
VAR CustomerOrders =
    CALCULATETABLE(
        Sales,
        ALLEXCEPT(Sales, Customer[CustomerID])
    )
VAR TotalRevenue = SUMX(CustomerOrders, [SalesAmount])
VAR TotalOrders = COUNTROWS(CustomerOrders)
VAR AvgOrderValue = DIVIDE(TotalRevenue, TotalOrders)
VAR CustomerTenure =
    DATEDIFF(
        MIN(CustomerOrders[OrderDate]),
        TODAY(),
        MONTH
    )
RETURN
    DIVIDE(TotalRevenue, MAX(CustomerTenure, 1))

// Optimize relationship queries
Sales With Context =
SUMX(
    KEEPFILTERS(VALUES(Product[ProductID])),
    CALCULATE([Total Sales])
)
```

# Conclusion

Power BI Premium Gen2 delivers significant improvements in performance, scalability, and manageability. The autoscale architecture means you no longer need to carefully manage capacity utilization, and the enhanced engine provides faster query responses for your users.

If you are running Premium workloads, migrating to Gen2 is a straightforward process that delivers immediate benefits. Take advantage of the improved dataflow performance, enhanced composite models, and better concurrent user handling to build more sophisticated BI solutions.

