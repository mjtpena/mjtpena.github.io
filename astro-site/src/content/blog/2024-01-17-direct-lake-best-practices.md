---
title: "Direct Lake Best Practices: Getting Import-Mode Performance Without the Import"
description: "Direct Lake can feel like magic until you hit its limits. In production I've learnt which constraints matter and how to tune tables and reports to stay in…"
author: Michael John Peña
draft: false
date: 2024-01-17
tags:
  - Direct Lake
  - Microsoft Fabric
  - Power BI
  - Performance
  - Semantic Models
---

Direct Lake can feel like magic until you hit its limits. In production I've learnt which constraints matter and how to tune tables and reports to stay in the fast path.

## How Direct Lake Works

Direct Lake bypasses the traditional import process by:
1. Reading columnar data directly from Delta Parquet files
2. Loading data into memory on-demand during queries
3. Caching frequently accessed columns

```
Traditional Import:
  Delta Table → Import Process → VertiPaq → Queries

Direct Lake:
  Delta Table → Direct Read → Memory Cache → Queries
```

## When Direct Lake Falls Back to DirectQuery

Understanding fallback is critical:

```python
# Conditions that trigger fallback to DirectQuery

fallback_conditions = {
    "table_limits": {
        "max_rows_per_table": 1_500_000_000,  # 1.5 billion
        "max_tables": 1000,
        "max_columns_per_table": 1500
    },
    "unsupported_features": [
        "Calculated tables",
        "Row-level security with CUSTOMDATA()",
        "Some DAX functions on large data",
        "Complex many-to-many relationships"
    ],
    "delta_table_issues": [
        "Incompatible data types",
        "Too many small files",
        "Nested complex types",
        "Missing statistics"
    ]
}
```

### Monitoring Fallbacks

```python
# Monitor Direct Lake performance via DMVs
import pandas as pd

def check_direct_lake_status(workspace_id: str, dataset_id: str):
    """Check Direct Lake mode status and fallback events."""

    # Query via XMLA endpoint
    query = """
    SELECT
        [TableName],
        [ColumnName],
        [DirectLakeStatus],
        [FallbackReason],
        [LastRefresh]
    FROM $SYSTEM.DISCOVER_STORAGE_TABLE_COLUMNS
    WHERE [DirectLakeStatus] IS NOT NULL
    """

    # Execute via XMLA
    # results = execute_xmla_query(workspace_id, dataset_id, query)

    return results

def analyze_fallback_reasons(results: pd.DataFrame) -> dict:
    """Analyze fallback patterns."""

    analysis = {
        "total_columns": len(results),
        "direct_lake_columns": len(results[results["DirectLakeStatus"] == "Active"]),
        "fallback_columns": len(results[results["DirectLakeStatus"] == "Fallback"]),
        "fallback_reasons": results[results["FallbackReason"].notna()]["FallbackReason"].value_counts().to_dict()
    }

    return analysis
```

## Optimizing Delta Tables for Direct Lake

### 1. File Size Optimization

```python
from delta.tables import DeltaTable

def optimize_for_direct_lake(table_name: str):
    """Optimize Delta table for Direct Lake performance."""

    delta_table = DeltaTable.forName(spark, table_name)

    # Target 128MB - 1GB files for optimal Direct Lake performance
    spark.conf.set("spark.databricks.delta.optimize.maxFileSize", "1073741824")  # 1GB

    # Run optimization
    delta_table.optimize().executeCompaction()

    # Update statistics for query optimization
    spark.sql(f"ANALYZE TABLE {table_name} COMPUTE STATISTICS FOR ALL COLUMNS")

    # Verify file sizes
    files = delta_table.toDF().inputFiles()
    print(f"Table {table_name}: {len(files)} files after optimization")

    return len(files)

# Optimize all gold tables
gold_tables = ["gold_sales", "gold_customers", "gold_products"]
for table in gold_tables:
    optimize_for_direct_lake(table)
```

### 2. Data Type Optimization

```python
# Direct Lake works best with these data types
optimal_types = {
    "integers": ["INT", "BIGINT", "SMALLINT", "TINYINT"],
    "decimals": ["DECIMAL(18,2)", "DOUBLE", "FLOAT"],
    "strings": ["STRING"],  # Avoid very long strings
    "dates": ["DATE", "TIMESTAMP"],
    "boolean": ["BOOLEAN"]
}

# Types to avoid or convert
problematic_types = {
    "BINARY": "Convert to STRING if possible",
    "ARRAY": "Flatten to separate columns",
    "MAP": "Flatten to separate columns",
    "STRUCT": "Flatten to separate columns"
}

def check_column_types(table_name: str):
    """Check column types for Direct Lake compatibility."""

    df = spark.read.table(table_name)
    issues = []

    for field in df.schema.fields:
        type_str = field.dataType.simpleString()

        if type_str in problematic_types:
            issues.append({
                "column": field.name,
                "type": type_str,
                "recommendation": problematic_types[type_str]
            })

        # Check string length
        if type_str == "string":
            max_len = df.agg({field.name: "max"}).collect()[0][0]
            if max_len and len(str(max_len)) > 32000:
                issues.append({
                    "column": field.name,
                    "type": type_str,
                    "recommendation": f"Very long strings (max: {len(str(max_len))})"
                })

    return issues
```

### 3. Cardinality Management

```python
def analyze_cardinality(table_name: str):
    """Analyze column cardinality for Direct Lake optimization."""

    df = spark.read.table(table_name)
    row_count = df.count()

    cardinality_report = []

    for col in df.columns:
        distinct_count = df.select(col).distinct().count()
        cardinality_ratio = distinct_count / row_count

        cardinality_report.append({
            "column": col,
            "distinct_values": distinct_count,
            "cardinality_ratio": cardinality_ratio,
            "recommendation": get_cardinality_recommendation(distinct_count, cardinality_ratio)
        })

    return cardinality_report

def get_cardinality_recommendation(distinct: int, ratio: float) -> str:
    """Get recommendation based on cardinality."""

    if distinct > 100_000_000:
        return "VERY HIGH - Consider aggregating or removing"
    elif distinct > 10_000_000:
        return "HIGH - Monitor performance"
    elif ratio > 0.9:
        return "NEAR UNIQUE - Good for filtering, expensive for grouping"
    elif ratio < 0.01:
        return "LOW - Excellent for Direct Lake"
    else:
        return "MODERATE - Acceptable"
```

## Semantic Model Design for Direct Lake

### 1. Relationship Configuration

```python
# Best practices for relationships in Direct Lake models

relationship_guidelines = """
1. Prefer single-direction relationships (One → Many)
2. Avoid bi-directional relationships where possible
3. Use integer keys for relationships when possible
4. Keep relationship columns as surrogate keys, not natural keys

Example Star Schema:
- dim_date (DateKey INT) → fact_sales (DateKey INT)
- dim_customer (CustomerKey INT) → fact_sales (CustomerKey INT)
- dim_product (ProductKey INT) → fact_sales (ProductKey INT)
"""

def create_star_schema_tables():
    """Create properly structured star schema for Direct Lake."""

    # Dimension with surrogate key
    dim_customer = spark.sql("""
        SELECT
            ROW_NUMBER() OVER (ORDER BY customer_id) as CustomerKey,
            customer_id as CustomerID,
            customer_name as CustomerName,
            segment as Segment,
            region as Region
        FROM silver_customers
    """)
    dim_customer.write.format("delta").mode("overwrite").saveAsTable("gold_dim_customer")

    # Fact table with foreign keys
    fact_sales = spark.sql("""
        SELECT
            s.sale_id as SaleID,
            c.CustomerKey,
            d.DateKey,
            p.ProductKey,
            s.quantity as Quantity,
            s.amount as Amount
        FROM silver_sales s
        JOIN gold_dim_customer c ON s.customer_id = c.CustomerID
        JOIN gold_dim_date d ON s.sale_date = d.Date
        JOIN gold_dim_product p ON s.product_id = p.ProductID
    """)
    fact_sales.write.format("delta").mode("overwrite").saveAsTable("gold_fact_sales")
```

### 2. Measure Design

```dax
// Measures that work well with Direct Lake

// Simple aggregations - optimal
Total Sales = SUM(fact_sales[Amount])

Quantity Sold = SUM(fact_sales[Quantity])

// Calculated ratios - good
Avg Sale Value =
DIVIDE(
    SUM(fact_sales[Amount]),
    COUNT(fact_sales[SaleID])
)

// Time intelligence - good with proper date table
YTD Sales =
TOTALYTD(
    SUM(fact_sales[Amount]),
    dim_date[Date]
)

// Avoid heavy iterations on large tables
// BAD: Row-by-row calculation
Bad Measure =
SUMX(
    fact_sales,
    fact_sales[Quantity] * RELATED(dim_product[Price])
)

// GOOD: Pre-calculate in Delta table
Good Measure = SUM(fact_sales[LineTotal])
```

## Refresh Strategy

### 1. Delta Table Refresh

```python
def incremental_refresh_pattern(
    source_table: str,
    target_table: str,
    watermark_column: str,
    last_watermark: str
):
    """Incremental refresh pattern for Direct Lake tables."""

    # Read only new/changed records
    incremental_df = spark.sql(f"""
        SELECT *
        FROM {source_table}
        WHERE {watermark_column} > '{last_watermark}'
    """)

    if incremental_df.count() == 0:
        print("No new records to process")
        return

    # Merge into target
    from delta.tables import DeltaTable

    target = DeltaTable.forName(spark, target_table)

    # Define merge logic
    target.alias("target").merge(
        incremental_df.alias("source"),
        "target.id = source.id"
    ).whenMatchedUpdateAll() \
     .whenNotMatchedInsertAll() \
     .execute()

    # Optimize after merge
    target.optimize().executeCompaction()

    print(f"Merged {incremental_df.count()} records")
```

### 2. Semantic Model Refresh

```python
# Trigger Direct Lake model refresh via REST API
import requests

def refresh_direct_lake_model(
    workspace_id: str,
    dataset_id: str,
    token: str
):
    """Refresh a Direct Lake semantic model."""

    url = f"https://api.powerbi.com/v1.0/myorg/groups/{workspace_id}/datasets/{dataset_id}/refreshes"

    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }

    payload = {
        "type": "Full",
        "commitMode": "transactional",
        "notifyOption": "MailOnFailure"
    }

    response = requests.post(url, headers=headers, json=payload)

    if response.status_code == 202:
        print("Refresh triggered successfully")
    else:
        print(f"Refresh failed: {response.text}")

    return response.status_code
```

## Troubleshooting

### Common Issues and Solutions

```python
troubleshooting_guide = {
    "Slow queries despite Direct Lake": [
        "Check if falling back to DirectQuery (use DMVs)",
        "Verify Delta files are optimized (not too small)",
        "Check column cardinality",
        "Review DAX measure complexity"
    ],
    "Frequent fallbacks": [
        "Check table size limits",
        "Verify data types are compatible",
        "Remove calculated tables",
        "Simplify complex relationships"
    ],
    "Refresh failures": [
        "Check Delta table health",
        "Verify no schema changes",
        "Check OneLake connectivity",
        "Review capacity limits"
    ],
    "Memory pressure": [
        "Reduce number of columns",
        "Remove unused tables",
        "Optimize high-cardinality columns",
        "Consider partitioning"
    ]
}
```

## Conclusion

Direct Lake best practices:

1. **Optimize Delta tables** - Right file sizes, proper types
2. **Manage cardinality** - Avoid very high cardinality columns
3. **Design for star schema** - Clean relationships with integer keys
4. **Write efficient DAX** - Avoid row-by-row calculations
5. **Monitor fallbacks** - Use DMVs to track performance
6. **Refresh incrementally** - Keep Delta tables current efficiently

Direct Lake is powerful but requires attention to detail. Get these fundamentals right and you'll enjoy import-mode speed with real-time data freshness.
