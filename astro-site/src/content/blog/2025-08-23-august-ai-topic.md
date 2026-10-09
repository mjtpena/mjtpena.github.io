---
title: "Data Quality for AI: Ensuring Clean Data for ML and LLM Applications"
description: "Quality encompasses completeness, accuracy, consistency, timeliness, and validity. Each dimension requires specific checks."
author: Michael John Peña
draft: false
date: 2025-08-23
tags:
  - Data Quality
  - Data Engineering
  - Machine Learning
  - LLM
  - Microsoft Fabric
---

## Data Quality Dimensions

Quality encompasses completeness, accuracy, consistency, timeliness, and validity. Each dimension requires specific checks.

```python
from pyspark.sql import DataFrame
from pyspark.sql.functions import col, count, when, isnan, isnull

class DataQualityChecker:
    def __init__(self, df: DataFrame):
        self.df = df
        self.total_rows = df.count()
        self.issues = []

    def check_completeness(self, columns: list[str], threshold: float = 0.95):
        """Check that columns meet completeness threshold."""
        for column in columns:
            null_count = self.df.filter(
                col(column).isNull() | isnan(col(column))
            ).count()

            completeness = 1 - (null_count / self.total_rows)

            if completeness < threshold:
                self.issues.append({
                    "check": "completeness",
                    "column": column,
                    "expected": threshold,
                    "actual": completeness,
                    "status": "FAILED"
                })

    def check_uniqueness(self, columns: list[str]):
        """Check for duplicate values in key columns."""
        distinct_count = self.df.select(columns).distinct().count()

        if distinct_count != self.total_rows:
            self.issues.append({
                "check": "uniqueness",
                "columns": columns,
                "duplicates": self.total_rows - distinct_count,
                "status": "FAILED"
            })

    def check_range(self, column: str, min_val: float, max_val: float):
        """Check that numeric values fall within expected range."""
        out_of_range = self.df.filter(
            (col(column) < min_val) | (col(column) > max_val)
        ).count()

        if out_of_range > 0:
            self.issues.append({
                "check": "range",
                "column": column,
                "out_of_range_count": out_of_range,
                "status": "FAILED"
            })

    def get_report(self) -> dict:
        return {
            "total_rows": self.total_rows,
            "issues_found": len(self.issues),
            "issues": self.issues
        }
```

## Automated Quality Gates

Integrate quality checks into your data pipelines. Fail the pipeline if critical quality thresholds aren't met.

```python
checker = DataQualityChecker(df)
checker.check_completeness(["customer_id", "amount"])
checker.check_uniqueness(["transaction_id"])
checker.check_range("amount", 0, 1000000)

report = checker.get_report()
if report["issues_found"] > 0:
    raise DataQualityError(f"Quality checks failed: {report['issues']}")
```

Treat data quality as a first-class concern. The cost of bad data compounds exponentially through your AI systems.
