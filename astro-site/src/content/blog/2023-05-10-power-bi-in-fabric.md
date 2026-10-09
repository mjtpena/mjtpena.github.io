---
title: "Power BI in Microsoft Fabric: Unified Business Intelligence"
description: "Power BI in Fabric provides seamless BI capabilities that connect directly to your unified data layer. Tomorrow, I will cover Fabric Capacities and pricing."
author: Michael John Peña
draft: false
date: 2023-05-10
tags:
  - Microsoft Fabric
  - Power BI
  - Business Intelligence
  - Data Visualization
  - Direct Lake
---

## Power BI in Fabric

Power BI in Fabric includes:
- **Reports**: Interactive visualizations
- **Semantic Models**: Data models for analytics (formerly datasets)
- **Paginated Reports**: Pixel-perfect formatted reports
- **Dashboards**: Pinned visualizations
- **Metrics**: Business KPIs

```
┌─────────────────────────────────────────────────────┐
│                Power BI in Fabric                    │
├─────────────────────────────────────────────────────┤
│  ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│  │ Reports  │ │Semantic  │ │Paginated │            │
│  │          │ │ Models   │ │ Reports  │            │
│  └────┬─────┘ └────┬─────┘ └──────────┘            │
│       │            │                               │
│       └──────┬─────┘                               │
│              ▼                                      │
│  ┌────────────────────────────────────────────────┐│
│  │            Data Connectivity                    ││
│  ├──────────┬──────────┬──────────┬──────────────┤│
│  │ Import   │DirectQuery│Direct   │ Live         ││
│  │          │          │ Lake    │ Connection   ││
│  └──────────┴──────────┴──────────┴──────────────┘│
│                        │                           │
│                        ▼                           │
│  ┌────────────────────────────────────────────────┐│
│  │     Lakehouse / Warehouse / KQL Database       ││
│  └────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────┘
```

## Direct Lake Mode

Direct Lake is a new connectivity mode exclusive to Fabric that combines the best of Import and DirectQuery:

| Mode | Data Location | Performance | Data Freshness |
|------|---------------|-------------|----------------|
| Import | In-memory | Fastest | Scheduled refresh |
| DirectQuery | Source | Slower | Real-time |
| **Direct Lake** | OneLake | Fast | Near real-time |

```python
# How Direct Lake works:
# 1. Data stays in Delta Lake format in OneLake
# 2. Power BI reads Parquet files directly
# 3. No data copy or scheduled import refresh
# 4. Changes to Lakehouse tables reflect immediately

# Direct Lake is automatically enabled when:
# - Semantic model is created from Lakehouse or Warehouse
# - Data is in Delta format
# - Within Fabric workspace
```

## Creating Semantic Models

### From Lakehouse SQL Endpoint

```sql
-- Tables in your Lakehouse automatically appear in SQL endpoint
-- Power BI connects to SQL endpoint for semantic model

-- Example: Sales data model tables
-- fact_sales, dim_customer, dim_product, dim_date
-- These are accessible via SQL endpoint for Power BI
```

### Using DAX for Calculations

```dax
// Measures for sales analysis

// Total Sales
Total Sales = SUM(fact_sales[sales_amount])

// Total Cost
Total Cost = SUM(fact_sales[cost_amount])

// Profit
Profit = [Total Sales] - [Total Cost]

// Profit Margin
Profit Margin = DIVIDE([Profit], [Total Sales], 0)

// Year-to-Date Sales
YTD Sales = TOTALYTD([Total Sales], dim_date[full_date])

// Prior Year Sales
PY Sales = CALCULATE([Total Sales], SAMEPERIODLASTYEAR(dim_date[full_date]))

// Year-over-Year Growth
YoY Growth = DIVIDE([Total Sales] - [PY Sales], [PY Sales], 0)

// Moving Average (3 months)
Sales MA 3M =
AVERAGEX(
    DATESINPERIOD(dim_date[full_date], LASTDATE(dim_date[full_date]), -3, MONTH),
    [Total Sales]
)

// Running Total
Running Total =
CALCULATE(
    [Total Sales],
    FILTER(
        ALL(dim_date),
        dim_date[full_date] <= MAX(dim_date[full_date])
    )
)
```

### Time Intelligence

```dax
// Previous Month
PM Sales = CALCULATE([Total Sales], PREVIOUSMONTH(dim_date[full_date]))

// Month-over-Month Change
MoM Change = [Total Sales] - [PM Sales]

// MoM % Change
MoM % = DIVIDE([MoM Change], [PM Sales], 0)

// Quarter-to-Date
QTD Sales = TOTALQTD([Total Sales], dim_date[full_date])

// Same Period Last Year
SPLY Sales = CALCULATE([Total Sales], DATEADD(dim_date[full_date], -1, YEAR))

// Trailing 12 Months
TTM Sales =
CALCULATE(
    [Total Sales],
    DATESINPERIOD(dim_date[full_date], MAX(dim_date[full_date]), -12, MONTH)
)
```

## Semantic Model Refresh

```python
# With Direct Lake, you typically don't need scheduled refreshes
# But you can trigger refresh via API or pipelines

# Python example: Trigger semantic model refresh
import requests

workspace_id = "your-workspace-id"
dataset_id = "your-dataset-id"
access_token = "your-access-token"

url = f"https://api.powerbi.com/v1.0/myorg/groups/{workspace_id}/datasets/{dataset_id}/refreshes"

headers = {
    "Authorization": f"Bearer {access_token}",
    "Content-Type": "application/json"
}

response = requests.post(url, headers=headers)
print(f"Refresh triggered: {response.status_code}")
```

### Refresh from Pipeline

```json
{
  "name": "RefreshReportsPipeline",
  "activities": [
    {
      "name": "LoadData",
      "type": "NotebookActivity",
      "typeProperties": {
        "notebook": "TransformSalesData"
      }
    },
    {
      "name": "RefreshSemanticModel",
      "type": "SemanticModelRefresh",
      "dependsOn": [
        {"activity": "LoadData", "dependencyConditions": ["Succeeded"]}
      ],
      "typeProperties": {
        "semanticModel": "Sales Analytics"
      }
    }
  ]
}
```

## Row-Level Security

```dax
// Define RLS in semantic model

// Table: SalesRegionSecurity (user_email, region)

// RLS Filter on fact_sales
[Region] = LOOKUPVALUE(
    SalesRegionSecurity[region],
    SalesRegionSecurity[user_email],
    USERPRINCIPALNAME()
)

// Or use roles defined in the model
// Role: RegionalManagers
// DAX Filter on dim_region table:
[region_manager_email] = USERPRINCIPALNAME()
```

## Embedding Power BI Reports

```typescript
// Embed Power BI report in custom application
import * as pbi from 'powerbi-client';

const embedConfig = {
    type: 'report',
    id: 'report-id',
    embedUrl: 'https://app.powerbi.com/reportEmbed?reportId=...',
    accessToken: 'embed-token',
    tokenType: pbi.models.TokenType.Embed,
    settings: {
        filterPaneEnabled: false,
        navContentPaneEnabled: false
    }
};

const reportContainer = document.getElementById('report-container');
const powerbi = new pbi.service.Service(
    pbi.factories.hpmFactory,
    pbi.factories.wpmpFactory,
    pbi.factories.routerFactory
);

const report = powerbi.embed(reportContainer, embedConfig);

// Handle events
report.on('loaded', () => {
    console.log('Report loaded');
});

report.on('error', (event) => {
    console.error('Report error:', event.detail);
});
```

## Best Practices

```python
# 1. Use Direct Lake when possible
# - No data copy overhead
# - Near real-time data
# - Best performance for Fabric data

# 2. Optimize semantic models
# - Remove unused columns
# - Use appropriate data types
# - Create relationships properly
# - Add key measures, not too many

# 3. Design for performance
# - Star schema design
# - Proper relationships
# - Calculated columns vs measures (prefer measures)
# - Avoid complex DAX in visuals

# 4. Implement security
# - Use RLS for data access control
# - Leverage workspace roles
# - Audit usage with activity logs
```

Power BI in Fabric provides seamless BI capabilities that connect directly to your unified data layer. Tomorrow, I will cover Fabric Capacities and pricing.

## Resources

- [Power BI in Fabric](https://learn.microsoft.com/en-us/fabric/data-warehouse/datasets)
- [Direct Lake Mode](https://learn.microsoft.com/en-us/power-bi/enterprise/directlake-overview)
- [DAX Reference](https://learn.microsoft.com/en-us/dax/)
