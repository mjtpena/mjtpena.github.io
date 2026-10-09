---
title: "Microsoft Fabric Data Engineering: Best Practices After 6 Months in Production"
description: "Avoid over-partitioning. If partitions have < 1GB of data, consolidate. Use Data Pipelines, Not Just Notebooks"
author: Michael John Peña
draft: false
date: 2024-02-15
tags:
  - Microsoft Fabric
  - Data Engineering
  - Spark
  - Lakehouse
  - Best Practices
---

## Notebook Development Patterns

**Environment Management**

Fabric environments let you package Python dependencies and Spark configurations. Always create a dedicated environment for production workloads:

```yaml
# environment.yml
name: production-data-eng
dependencies:
  - delta-spark==2.4.0
  - great-expectations==0.18.0
  - azure-identity==1.15.0
variables:
  ENVIRONMENT: production
  LOG_LEVEL: INFO
sparkConfiguration:
  spark.sql.shuffle.partitions: 200
  spark.databricks.delta.optimizeWrite.enabled: true
  spark.databricks.delta.autoCompact.enabled: true
```

**Modular Notebook Design**

Don't put everything in one notebook. Use the `%run` magic to build modular, testable code:

```python
# utilities/transformations.py
def standardize_dates(df, date_columns):
    """Standardize date columns to consistent format."""
    from pyspark.sql.functions import to_date, coalesce

    for col_name in date_columns:
        df = df.withColumn(
            col_name,
            coalesce(
                to_date(col(col_name), "yyyy-MM-dd"),
                to_date(col(col_name), "MM/dd/yyyy"),
                to_date(col(col_name), "dd-MM-yyyy")
            )
        )
    return df

def add_audit_columns(df):
    """Add standard audit columns."""
    from pyspark.sql.functions import current_timestamp, lit

    return df \
        .withColumn("_ingested_at", current_timestamp()) \
        .withColumn("_source_system", lit("fabric_pipeline"))
```

```python
# Main notebook
%run utilities/transformations

# Now use the functions
df = spark.read.format("delta").load("Tables/raw_sales")
df = standardize_dates(df, ["order_date", "ship_date"])
df = add_audit_columns(df)
```

## Delta Lake Optimization

**Table Maintenance**

Delta tables need maintenance. Schedule regular optimization:

```python
from delta.tables import DeltaTable

def optimize_table(table_name, z_order_columns=None):
    """Run OPTIMIZE and optionally Z-ORDER."""
    delta_table = DeltaTable.forName(spark, table_name)

    if z_order_columns:
        delta_table.optimize().executeZOrderBy(z_order_columns)
    else:
        delta_table.optimize().executeCompaction()

    # Vacuum old files (retain 7 days for time travel)
    delta_table.vacuum(168)  # hours

# Schedule weekly
optimize_table("sales_curated", z_order_columns=["customer_id", "order_date"])
```

**Partitioning Strategy**

Partition by columns you frequently filter on:

```python
# Good: Partition by date for time-range queries
df.write \
    .format("delta") \
    .partitionBy("year", "month") \
    .mode("overwrite") \
    .saveAsTable("Tables/sales_partitioned")

# Query efficiency
spark.sql("""
    SELECT * FROM sales_partitioned
    WHERE year = 2024 AND month = 1
""")  # Only reads January 2024 partition
```

Avoid over-partitioning. If partitions have < 1GB of data, consolidate.

## Pipeline Orchestration

**Use Data Pipelines, Not Just Notebooks**

While notebooks can call notebooks, Data Pipelines provide:
- Retry logic
- Alerting
- Parameter passing
- Dependency management
- Monitoring dashboard

```json
{
  "name": "DailyIngestion",
  "activities": [
    {
      "name": "Extract",
      "type": "Notebook",
      "notebookReference": "notebooks/extract_source_data",
      "parameters": {
        "execution_date": "@pipeline().parameters.execution_date"
      },
      "retryPolicy": {
        "count": 3,
        "intervalInSeconds": 300
      }
    },
    {
      "name": "Transform",
      "type": "Notebook",
      "dependsOn": ["Extract"],
      "notebookReference": "notebooks/transform_data",
      "parameters": {
        "execution_date": "@pipeline().parameters.execution_date"
      }
    }
  ]
}
```

**Idempotent Pipelines**

Design pipelines that can be safely re-run:

```python
def upsert_to_lakehouse(source_df, target_table, key_columns):
    """Merge source into target using Delta MERGE."""
    from delta.tables import DeltaTable

    delta_table = DeltaTable.forName(spark, target_table)

    merge_condition = " AND ".join([f"target.{k} = source.{k}" for k in key_columns])

    delta_table.alias("target") \
        .merge(source_df.alias("source"), merge_condition) \
        .whenMatchedUpdateAll() \
        .whenNotMatchedInsertAll() \
        .execute()

# This can be run multiple times safely
upsert_to_lakehouse(sales_df, "Tables/dim_customer", ["customer_id"])
```

## Error Handling and Monitoring

**Structured Logging**

Use consistent logging for pipeline monitoring:

```python
import logging
from datetime import datetime

class PipelineLogger:
    def __init__(self, pipeline_name):
        self.pipeline_name = pipeline_name
        self.run_id = datetime.now().strftime("%Y%m%d_%H%M%S")
        self.logger = logging.getLogger(pipeline_name)

    def log_step(self, step_name, status, row_count=None, details=None):
        log_record = {
            "pipeline": self.pipeline_name,
            "run_id": self.run_id,
            "step": step_name,
            "status": status,
            "row_count": row_count,
            "details": details,
            "timestamp": datetime.utcnow().isoformat()
        }

        # Write to logging table
        spark.createDataFrame([log_record]).write \
            .format("delta") \
            .mode("append") \
            .saveAsTable("Tables/_pipeline_logs")

        self.logger.info(str(log_record))

# Usage
logger = PipelineLogger("daily_sales_pipeline")
logger.log_step("extract", "started")
df = extract_sales_data()
logger.log_step("extract", "completed", row_count=df.count())
```

**Data Quality Checks**

Integrate quality checks into your pipelines:

```python
def validate_dataframe(df, table_name, checks):
    """Run data quality checks and fail pipeline if critical issues found."""
    results = []

    for check in checks:
        if check["type"] == "not_null":
            null_count = df.filter(col(check["column"]).isNull()).count()
            passed = null_count == 0
            results.append({
                "check": f"not_null_{check['column']}",
                "passed": passed,
                "details": f"{null_count} nulls found"
            })

        elif check["type"] == "unique":
            total = df.count()
            distinct = df.select(check["column"]).distinct().count()
            passed = total == distinct
            results.append({
                "check": f"unique_{check['column']}",
                "passed": passed,
                "details": f"{total - distinct} duplicates found"
            })

    # Fail on critical check failures
    critical_failures = [r for r in results if not r["passed"] and r.get("critical", True)]
    if critical_failures:
        raise ValueError(f"Data quality checks failed: {critical_failures}")

    return results

# Define checks
checks = [
    {"type": "not_null", "column": "customer_id", "critical": True},
    {"type": "unique", "column": "order_id", "critical": True},
    {"type": "not_null", "column": "email", "critical": False}
]

validate_dataframe(sales_df, "sales_curated", checks)
```

## Performance Optimization

**Broadcast Joins**

For small dimension tables, use broadcast joins:

```python
from pyspark.sql.functions import broadcast

# Small dimension table (< 10MB)
dim_product = spark.table("Tables/dim_product")

# Large fact table
fact_sales = spark.table("Tables/fact_sales")

# Broadcast the small table
result = fact_sales.join(
    broadcast(dim_product),
    "product_id"
)
```

**Caching Strategy**

Cache intermediate results used multiple times:

```python
# Cache expensive intermediate result
enriched_df = enrich_with_customer_data(raw_df).cache()

# Use cached result multiple times
daily_summary = enriched_df.groupBy("date").agg(...)
monthly_summary = enriched_df.groupBy("month").agg(...)
customer_summary = enriched_df.groupBy("customer_id").agg(...)

# Unpersist when done
enriched_df.unpersist()
```

## Capacity Management

**Monitor CU Consumption**

Track which workloads consume the most capacity:

```python
# Query capacity metrics via Fabric REST APIs
import requests
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default")
headers = {"Authorization": f"Bearer {token.token}"}

# Get capacity metrics via Admin API
workspace_id = "your-workspace-id"
capacity_id = "your-capacity-id"

# Use Fabric Capacity Metrics app or REST API
url = f"https://api.fabric.microsoft.com/v1/admin/capacities/{capacity_id}/workloads"
response = requests.get(url, headers=headers)
metrics = response.json()

# Alternative: Use the Fabric Capacity Metrics Power BI app
# which provides detailed CU consumption analysis
print("For detailed metrics, use the Fabric Capacity Metrics app")
```

**Workload Isolation**

For critical workloads, consider separate workspaces with dedicated capacities. Don't let ad-hoc exploration throttle production pipelines.

## Conclusion

Microsoft Fabric Data Engineering is maturing rapidly. The patterns above reflect what works in production today. Key takeaways:

1. **Modularize**: Small, testable notebooks with shared utilities
2. **Optimize Delta**: Regular maintenance, appropriate partitioning
3. **Pipeline-first**: Use Data Pipelines for orchestration, not notebook chaining
4. **Quality gates**: Fail fast on data quality issues
5. **Monitor everything**: Capacity, performance, data quality metrics

The platform is evolving monthly. Stay current with Fabric updates and adjust patterns as new features land.

## Resources

- [Fabric Data Engineering Documentation](https://learn.microsoft.com/en-us/fabric/data-engineering/)
- [Delta Lake Best Practices](https://docs.delta.io/latest/best-practices.html)
- [Fabric Capacity Metrics](https://learn.microsoft.com/en-us/fabric/enterprise/metrics-app)
