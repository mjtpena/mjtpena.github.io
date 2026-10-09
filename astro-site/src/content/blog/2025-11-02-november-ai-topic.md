---
title: "Implementing Data Quality Checks in Microsoft Fabric Lakehouses"
description: "Poor data quality leads to incorrect business decisions, failed ML models, and eroded trust in analytics platforms. A proactive approach to data validation…"
author: Michael John Peña
draft: false
date: 2025-11-02
tags:
  - Microsoft Fabric
  - Data Quality
  - Lakehouse
  - Data Engineering
  - PySpark
---

## Why Data Quality Matters

Poor data quality leads to incorrect business decisions, failed ML models, and eroded trust in analytics platforms. A proactive approach to data validation saves significant debugging time and prevents costly mistakes.

## Building a Quality Framework

Fabric notebooks with PySpark enable flexible, scalable data quality checks:

```python
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, count, when, isnan, isnull
from datetime import datetime

class DataQualityValidator:
    def __init__(self, spark: SparkSession, table_name: str):
        self.spark = spark
        self.table_name = table_name
        self.df = spark.table(table_name)
        self.results = []

    def check_completeness(self, columns: list, threshold: float = 0.95):
        """Verify columns meet minimum completeness threshold."""
        total_rows = self.df.count()

        for column in columns:
            non_null_count = self.df.filter(
                col(column).isNotNull() & ~isnan(col(column))
            ).count()

            completeness = non_null_count / total_rows
            passed = completeness >= threshold

            self.results.append({
                "check": "completeness",
                "column": column,
                "value": completeness,
                "threshold": threshold,
                "passed": passed
            })

        return self

    def check_uniqueness(self, columns: list):
        """Verify columns contain unique values."""
        total_rows = self.df.count()
        distinct_count = self.df.select(columns).distinct().count()

        uniqueness = distinct_count / total_rows

        self.results.append({
            "check": "uniqueness",
            "columns": columns,
            "value": uniqueness,
            "passed": uniqueness == 1.0
        })

        return self

    def check_freshness(self, date_column: str, max_hours: int = 24):
        """Verify data is recent enough."""
        latest_date = self.df.agg({date_column: "max"}).collect()[0][0]
        hours_old = (datetime.now() - latest_date).total_seconds() / 3600

        self.results.append({
            "check": "freshness",
            "column": date_column,
            "hours_old": hours_old,
            "max_hours": max_hours,
            "passed": hours_old <= max_hours
        })

        return self

    def save_results(self, results_table: str):
        """Persist validation results for tracking."""
        results_df = self.spark.createDataFrame(self.results)
        results_df.write.mode("append").saveAsTable(results_table)

# Execute quality checks
validator = DataQualityValidator(spark, "sales.transactions")
validator.check_completeness(["customer_id", "amount", "transaction_date"])
validator.check_uniqueness(["transaction_id"])
validator.check_freshness("transaction_date", max_hours=6)
validator.save_results("quality.validation_results")
```

## Automating Quality Gates

Integrate these checks into Fabric Data Factory pipelines to create automated quality gates. Failed checks can trigger alerts or halt downstream processing, ensuring only validated data flows through your analytics platform.

Building data quality into your lakehouse architecture from the start prevents the accumulation of technical debt that becomes increasingly difficult to address over time.
