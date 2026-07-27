---
title: "Azure Data Factory Mapping Data Flows: ETL Patterns for the Modern Data Platform"
author: Michael John Peña
draft: false
date: 2022-03-15
tags:
  - Azure
  - Data Factory
  - ETL
  - Data Engineering
  - Spark

---

I wrote "Azure Data Factory Mapping Data Flows: ETL Patterns for the Modern Data Platform" to share practical, production-minded guidance on this topic.

## What Are Mapping Data Flows?

Mapping Data Flows provide a visual, code-free way to design data transformations. Behind the scenes, ADF generates Spark code and runs it on managed clusters. You get:
- Spark's processing power
- Visual debugging and data preview
- Integration with ADF's orchestration

Think of it as the best of both worlds: visual design for maintainability, Spark for scale.

## Pattern 1: Slowly Changing Dimension Type 2

SCD Type 2 is one of the most common requirements in data warehousing. Here's how to implement it visually in Data Flows:

**Source**: Your incoming dimension data
**Lookup**: Join to existing dimension table on business key
**Alter Row**: Mark rows for insert (new) or update (changed)
**Sink**: Write to dimension table with surrogate key generation

```
// Expression for detecting changes
!equals(source.Name, lookup.Name) ||
!equals(source.Address, lookup.Address) ||
!equals(source.Category, lookup.Category)
```

The key insight: use a Lookup transformation with a Left Outer join, then use Conditional Split to separate new records from existing ones. For changes, you expire the old record and insert the new one.

## Pattern 2: Late-Arriving Facts

When fact records reference dimension keys that don't exist yet, you need to handle them gracefully:

1. **Lookup** dimension tables for each foreign key
2. **Conditional Split** to separate matched from unmatched
3. **Sink unmatched** to an error/holding table
4. **Sink matched** to the fact table

```
// Conditional split expression
MatchedRecords: !isNull(DimProduct_Key) && !isNull(DimCustomer_Key) && !isNull(DimDate_Key)
UnmatchedRecords: true()
```

The unmatched records can be reprocessed after the dimension data arrives - typically via a scheduled retry pipeline.

## Pattern 3: Delta Processing with Watermarks

Processing only changed data is crucial for performance. The pattern:

1. **Parameter**: Pass the high watermark from the last run
2. **Source Filter**: Only select records newer than the watermark
3. **Processing**: Your normal transformations
4. **Aggregate**: Calculate the new high watermark
5. **Update Metadata**: Store the new watermark for next run

```sql
-- Source query with watermark
SELECT * FROM sales
WHERE modified_date > '@{pipeline().parameters.LastWatermark}'
AND modified_date <= '@{pipeline().parameters.CurrentWatermark}'
```

Store watermarks in a metadata table and retrieve them at the start of each pipeline run.

## Pattern 4: Data Quality Rules

Implementing data quality checks inline:

```
// Derived Column: Add quality flags
DQ_EmailValid: regexMatch(Email, '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$')
DQ_AmountPositive: Amount > 0
DQ_DateValid: OrderDate <= currentDate()
DQ_Passed: DQ_EmailValid && DQ_AmountPositive && DQ_DateValid
```

Use Conditional Split to route failed records to an error sink, and passed records to your target.

## Pattern 5: Pivoting Time Series Data

Converting rows to columns (or vice versa) is common with time series:

```
// Pivot expression
Group By: ProductID, Region
Pivot Column: Month
Pivot Values: Sum(Revenue)
```

This transforms:
| ProductID | Month | Revenue |
|-----------|-------|---------|
| P1 | Jan | 1000 |
| P1 | Feb | 1500 |

Into:
| ProductID | Jan | Feb |
|-----------|-----|-----|
| P1 | 1000 | 1500 |

## Performance Optimization Tips

**1. Partition Appropriately**
Use hash partitioning on your join keys for large datasets:
```
Optimize > Partitioning: Hash
Key Columns: CustomerID
Number of Partitions: 100
```

**2. Enable Data Flow Staging**
For large data movements, enable staging to leverage PolyBase/COPY:
```json
{
  "type": "staging",
  "linkedService": "ADLSStaging",
  "folderPath": "staging/dataflow"
}
```

**3. Minimize Source Columns**
Select only the columns you need at the source. Don't transform columns you won't use.

**4. Use Native SQL When Possible**
If your source supports query folding, push filters to the source:
```sql
SELECT Id, Name, Amount
FROM Orders
WHERE OrderDate >= '2022-01-01'
```

**5. Monitor TTL Clusters**
Data Flow clusters have a time-to-live setting. Set it appropriately to balance cost vs. warm start times:
```json
{
  "dataFlow": {
    "computeType": "General",
    "coreCount": 8,
    "timeToLive": 10
  }
}
```

## When Not to Use Data Flows

Data Flows aren't always the answer:

- **Simple copy operations**: Use Copy Activity instead - it's cheaper and faster for straight data movement
- **Complex custom logic**: If you need libraries not available in Spark, use Azure Databricks
- **Real-time streaming**: Data Flows are batch-oriented; use Stream Analytics or Event Hubs for streaming
- **Very small datasets**: The overhead of Spark isn't worth it for megabyte-scale data

## Debugging Tips

1. **Data Preview**: Always test with data preview before running - it uses a debug cluster and gives immediate feedback
2. **Row Count Validation**: Add a rowCount aggregate and compare source to sink counts
3. **Debug Mode**: Enable for step-by-step execution during development
4. **Expression Builder**: Use the visual expression builder - autocomplete saves time and catches errors

## Conclusion

Mapping Data Flows have become a genuine alternative to writing Spark code for many ETL scenarios. The visual debugging, automatic optimization, and ADF integration make them particularly valuable when:
- Your team has varied skill levels
- Transformations are complex but not exotic
- You want to minimize operational overhead

The patterns above cover probably 80% of what most data platforms need. Master these, and you'll be productive quickly.

## Resources

- [Mapping Data Flows Documentation](https://docs.microsoft.com/en-us/azure/data-factory/concepts-data-flow-overview)
- [Data Flow Performance Guide](https://docs.microsoft.com/en-us/azure/data-factory/concepts-data-flow-performance)
- [Mark Kromer's Book on Mapping Data Flows](https://www.amazon.com/Mapping-Data-Flows-Azure-Factory/dp/1484286111)

