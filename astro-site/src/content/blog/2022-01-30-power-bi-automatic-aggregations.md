---
title: "Power BI Automatic Aggregations: AI-Powered Query Optimization"
author: Michael John Peña
draft: false
date: 2022-01-30
url: /blog/power-bi-automatic-aggregations/
tags:
  - power-bi
  - performance
  - analytics
  - ai

---

I wrote "Power BI Automatic Aggregations: AI-Powered Query Optimization" to share practical, production-minded guidance on this topic.

## How Automatic Aggregations Work

Power BI analyzes query patterns and automatically:
1. Identifies frequently used groupings and measures
2. Creates optimized aggregation tables
3. Routes queries to aggregations when possible
4. Maintains aggregations during refresh

## Enabling Automatic Aggregations

In Power BI Desktop or Service (Premium):

```json
{
  "table": "FactSales",
  "storageMode": "DirectQuery",
  "automaticAggregations": {
    "enabled": true,
    "training": {
      "trainingWindow": "30 days",
      "sampleQueries": true
    },
    "aggregationTables": {
      "maxCount": 10,
      "maxRows": 10000000
    }
  }
}
```

## Configuration via XMLA

```xml
<Alter xmlns="http://schemas.microsoft.com/analysisservices/2003/engine">
  <Object>
    <DatabaseID>SalesAnalytics</DatabaseID>
  </Object>
  <ObjectDefinition>
    <Database>
      <AutomaticAggregation>
        <Enabled>true</Enabled>
        <TrainingDays>30</TrainingDays>
        <MaxTableCount>10</MaxTableCount>
        <MaxTableRows>10000000</MaxTableRows>
      </AutomaticAggregation>
    </Database>
  </ObjectDefinition>
</Alter>
```

## Monitoring Aggregation Usage

```dax
// Check aggregation cache hits
EVALUATE
SUMMARIZE(
    INFO.AUTOMANAGGREGATIONS(),
    [TableName],
    [AggTableName],
    [QueryCount],
    [HitCount],
    [HitRatio]
)
ORDER BY [QueryCount] DESC
```

## Query Performance Analysis

```kusto
// Log Analytics query for aggregation effectiveness
PowerBIDatasetQuery
| where DatasetId == "dataset-guid"
| extend
    UsedAggregation = tostring(parse_json(Properties).["AggregationUsed"]),
    QueryDuration = DurationMs
| summarize
    TotalQueries = count(),
    AggregationHits = countif(UsedAggregation == "true"),
    AvgDurationWithAgg = avgif(QueryDuration, UsedAggregation == "true"),
    AvgDurationWithoutAgg = avgif(QueryDuration, UsedAggregation != "true")
    by bin(TimeGenerated, 1h)
| extend HitRatio = todouble(AggregationHits) / TotalQueries * 100
```

## Training Period Considerations

```python
class AggregationTrainer:
    def __init__(self, dataset_connection):
        self.connection = dataset_connection

    def analyze_query_patterns(self):
        """Analyze query patterns to understand aggregation opportunities."""
        query = """
        SELECT
            [Query],
            [StartTime],
            [EndTime],
            [Duration],
            [User]
        FROM $SYSTEM.DISCOVER_QUERIES
        WHERE [Duration] > 1000  -- Long-running queries
        """
        return self.connection.execute(query)

    def identify_aggregation_candidates(self, queries):
        """Identify columns and measures for aggregation."""
        candidates = {}

        for query in queries:
            # Parse query to extract grouping columns
            columns = self._extract_group_by_columns(query)
            measures = self._extract_measures(query)

            key = frozenset(columns)
            if key not in candidates:
                candidates[key] = {
                    "columns": columns,
                    "measures": measures,
                    "frequency": 0,
                    "total_duration": 0
                }

            candidates[key]["frequency"] += 1
            candidates[key]["total_duration"] += query["Duration"]

        # Rank by impact
        ranked = sorted(
            candidates.values(),
            key=lambda x: x["frequency"] * x["total_duration"],
            reverse=True
        )

        return ranked[:10]  # Top 10 candidates
```

## Manual Aggregation Hints

While automatic aggregations are managed by AI, you can provide hints:

```dax
// Create a calculated table that hints at useful aggregations
EVALUATE
SUMMARIZECOLUMNS(
    'Date'[Year],
    'Date'[Quarter],
    'Product'[Category],
    'Geography'[Region],
    "TotalSales", SUM('Sales'[Amount]),
    "TotalQuantity", SUM('Sales'[Quantity]),
    "DistinctCustomers", DISTINCTCOUNT('Sales'[CustomerID])
)
```

## Comparing with User-Defined Aggregations

| Feature | Automatic | User-Defined |
|---------|-----------|--------------|
| Setup | Automatic | Manual |
| Optimization | AI-driven | Human expertise |
| Maintenance | Self-maintaining | Requires updates |
| Flexibility | Query-based | Custom logic |
| Transparency | Less visible | Fully documented |

## Best Practices

```bicep
// Premium capacity configuration for optimal aggregations
resource premiumCapacity 'Microsoft.PowerBIDedicated/capacities@2021-01-01' = {
  name: 'premium-capacity'
  location: location
  sku: {
    name: 'P1'
  }
  properties: {
    administration: {
      members: ['admin@company.com']
    }
  }
}
```

Workload settings:

```json
{
  "workloadSettings": {
    "dataflows": {
      "maxMemoryPercentage": 20
    },
    "paginated": {
      "maxMemoryPercentage": 10
    },
    "automaticAggregations": {
      "maxMemoryPercentage": 25,
      "maxCacheSize": "50GB"
    }
  }
}
```

## Troubleshooting

```dax
// Check why aggregation wasn't used
EVALUATE
ROW(
    "DetailRowCount", COUNTROWS(FactSales),
    "AggregationAvailable", INFO.AUTOMANAGGREGATIONS.EXISTS(),
    "QueryComplexity", "Check if query is too complex for aggregation"
)
```

Automatic aggregations bring AI-powered optimization to Power BI, making it easier than ever to achieve excellent query performance on large datasets.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
