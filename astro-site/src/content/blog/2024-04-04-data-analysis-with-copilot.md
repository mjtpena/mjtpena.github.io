---
title: "Data Analysis with Copilot: AI-Powered Insights"
description: "Microsoft Fabric's Copilot transforms data analysis by enabling natural language interactions with your data. This guide shows how to leverage Copilot for…"
author: "Michael John Peña"
draft: false
date: 2024-04-04
tags: ["Microsoft Fabric", "Copilot", "Data Analysis", "AI", "Analytics"]
---

Microsoft Fabric's Copilot transforms data analysis by enabling natural language interactions with your data. This guide shows how to leverage Copilot for effective data analysis.

## Getting Started with Copilot Analysis

```python
# Copilot can help with various analysis tasks

COPILOT_ANALYSIS_CAPABILITIES = {
    "exploratory_analysis": [
        "Describe the data structure",
        "Find patterns and anomalies",
        "Identify correlations",
        "Summarize distributions"
    ],
    "statistical_analysis": [
        "Calculate descriptive statistics",
        "Perform hypothesis testing",
        "Run regression analysis",
        "Generate forecasts"
    ],
    "visualization": [
        "Suggest appropriate chart types",
        "Generate visualization code",
        "Create dashboards",
        "Build reports"
    ]
}
```

## Interactive Analysis Session

```python
# Example: How to structure prompts for effective analysis

from pyspark.sql import SparkSession
from pyspark.sql.functions import *

spark = SparkSession.builder.getOrCreate()

# Load your data
df = spark.read.format("delta").load("Tables/sales_data")

# Prompt 1: "Describe this dataset"
# Copilot generates:
def describe_dataset(df):
    """Comprehensive dataset description"""

    print("=== Dataset Overview ===")
    print(f"Total rows: {df.count():,}")
    print(f"Total columns: {len(df.columns)}")

    print("\n=== Column Types ===")
    for col_name, col_type in df.dtypes:
        print(f"  {col_name}: {col_type}")

    print("\n=== Null Values ===")
    null_counts = df.select([
        count(when(col(c).isNull(), c)).alias(c)
        for c in df.columns
    ]).collect()[0]

    for col_name in df.columns:
        null_count = null_counts[col_name]
        if null_count > 0:
            print(f"  {col_name}: {null_count:,} nulls")

    print("\n=== Numeric Statistics ===")
    df.describe().show()

    return df

describe_dataset(df)
```

## Pattern Discovery

```python
# Prompt: "Find patterns in the sales data over time"

# Copilot generates:
def analyze_time_patterns(df):
    """Discover temporal patterns in data"""

    # Ensure date column is properly typed
    df = df.withColumn("order_date", to_date(col("order_date")))

    # Daily patterns
    daily_sales = df.groupBy("order_date").agg(
        count("*").alias("order_count"),
        sum("amount").alias("total_sales"),
        avg("amount").alias("avg_order_value")
    ).orderBy("order_date")

    print("=== Daily Sales Trend ===")
    daily_sales.show(10)

    # Day of week patterns
    dow_sales = df.withColumn(
        "day_of_week", dayofweek(col("order_date"))
    ).groupBy("day_of_week").agg(
        count("*").alias("order_count"),
        avg("amount").alias("avg_amount")
    ).orderBy("day_of_week")

    print("\n=== Day of Week Pattern ===")
    dow_sales.show()

    # Monthly patterns
    monthly_sales = df.withColumn(
        "year_month", date_format(col("order_date"), "yyyy-MM")
    ).groupBy("year_month").agg(
        count("*").alias("order_count"),
        sum("amount").alias("total_sales")
    ).orderBy("year_month")

    print("\n=== Monthly Sales Trend ===")
    monthly_sales.show(12)

    # Identify peak periods
    stats = monthly_sales.agg(
        avg("total_sales").alias("avg"),
        stddev("total_sales").alias("std")
    ).collect()[0]

    peak_months = monthly_sales.filter(
        col("total_sales") > stats["avg"] + stats["std"]
    )

    print("\n=== Peak Months (Above Average) ===")
    peak_months.show()

    return {
        "daily": daily_sales,
        "day_of_week": dow_sales,
        "monthly": monthly_sales,
        "peaks": peak_months
    }

patterns = analyze_time_patterns(df)
```

## Anomaly Detection

```python
# Prompt: "Identify anomalies in the transaction data"

# Copilot generates:
def detect_anomalies(df, value_column="amount", date_column="order_date"):
    """Detect anomalies using statistical methods"""

    from pyspark.sql.window import Window
    from pyspark.sql.functions import percentile_approx

    # Method 1: IQR-based outliers
    quantiles = df.approxQuantile(value_column, [0.25, 0.75], 0.05)
    q1, q3 = quantiles[0], quantiles[1]
    iqr = q3 - q1
    lower_bound = q1 - 1.5 * iqr
    upper_bound = q3 + 1.5 * iqr

    outliers_iqr = df.filter(
        (col(value_column) < lower_bound) |
        (col(value_column) > upper_bound)
    )

    print(f"=== IQR Outliers ===")
    print(f"Lower bound: {lower_bound:.2f}")
    print(f"Upper bound: {upper_bound:.2f}")
    print(f"Outlier count: {outliers_iqr.count()}")
    outliers_iqr.show(5)

    # Method 2: Rolling window anomalies
    window_spec = Window.orderBy(date_column).rowsBetween(-6, 0)

    df_with_rolling = df.withColumn(
        "rolling_avg", avg(col(value_column)).over(window_spec)
    ).withColumn(
        "rolling_std", stddev(col(value_column)).over(window_spec)
    ).withColumn(
        "z_score", (col(value_column) - col("rolling_avg")) / col("rolling_std")
    )

    rolling_anomalies = df_with_rolling.filter(abs(col("z_score")) > 3)

    print(f"\n=== Rolling Window Anomalies (|Z| > 3) ===")
    print(f"Count: {rolling_anomalies.count()}")
    rolling_anomalies.select(
        date_column, value_column, "rolling_avg", "z_score"
    ).show(5)

    # Method 3: Sudden changes
    lag_window = Window.orderBy(date_column)
    df_with_change = df.withColumn(
        "prev_value", lag(col(value_column)).over(lag_window)
    ).withColumn(
        "pct_change", (col(value_column) - col("prev_value")) / col("prev_value") * 100
    )

    sudden_changes = df_with_change.filter(abs(col("pct_change")) > 50)

    print(f"\n=== Sudden Changes (>50% change) ===")
    sudden_changes.show(5)

    return {
        "iqr_outliers": outliers_iqr,
        "rolling_anomalies": rolling_anomalies,
        "sudden_changes": sudden_changes
    }

anomalies = detect_anomalies(df)
```

## Correlation Analysis

```python
# Prompt: "Find correlations between different metrics"

# Copilot generates:
def analyze_correlations(df, numeric_columns=None):
    """Analyze correlations between numeric columns"""

    import pandas as pd
    import numpy as np

    if numeric_columns is None:
        # Auto-detect numeric columns
        numeric_columns = [
            f.name for f in df.schema.fields
            if str(f.dataType) in ['IntegerType', 'LongType', 'DoubleType', 'FloatType']
        ]

    # Convert to pandas for correlation analysis
    pdf = df.select(numeric_columns).toPandas()

    # Calculate correlation matrix
    corr_matrix = pdf.corr()

    print("=== Correlation Matrix ===")
    print(corr_matrix.round(2))

    # Find strong correlations
    print("\n=== Strong Correlations (|r| > 0.7) ===")
    for i in range(len(numeric_columns)):
        for j in range(i+1, len(numeric_columns)):
            corr = corr_matrix.iloc[i, j]
            if abs(corr) > 0.7:
                print(f"{numeric_columns[i]} <-> {numeric_columns[j]}: {corr:.3f}")

    # Visualize (generates code for visualization)
    visualization_code = """
import matplotlib.pyplot as plt
import seaborn as sns

plt.figure(figsize=(10, 8))
sns.heatmap(corr_matrix, annot=True, cmap='coolwarm', center=0)
plt.title('Correlation Heatmap')
plt.tight_layout()
plt.show()
"""

    print("\n=== Visualization Code ===")
    print(visualization_code)

    return corr_matrix

correlations = analyze_correlations(df)
```

## Insight Generation

```python
# Prompt: "Generate key insights from the data"

# Copilot generates:
def generate_insights(df, dimension_cols, metric_cols):
    """Automatically generate key insights"""

    insights = []

    for metric in metric_cols:
        # Overall statistics
        stats = df.agg(
            avg(col(metric)).alias("avg"),
            min(col(metric)).alias("min"),
            max(col(metric)).alias("max"),
            stddev(col(metric)).alias("std")
        ).collect()[0]

        insights.append({
            "type": "statistic",
            "metric": metric,
            "message": f"Average {metric}: {stats['avg']:.2f} (range: {stats['min']:.2f} - {stats['max']:.2f})"
        })

        # Top performers by dimension
        for dim in dimension_cols:
            top = df.groupBy(dim).agg(
                sum(col(metric)).alias("total")
            ).orderBy(col("total").desc()).first()

            insights.append({
                "type": "top_performer",
                "dimension": dim,
                "metric": metric,
                "message": f"Top {dim} by {metric}: {top[dim]} ({top['total']:.2f})"
            })

    print("=== Key Insights ===")
    for i, insight in enumerate(insights, 1):
        print(f"{i}. {insight['message']}")

    return insights

insights = generate_insights(
    df,
    dimension_cols=["region", "product_category"],
    metric_cols=["amount", "quantity"]
)
```

## Conclusion

Copilot-assisted data analysis accelerates insight discovery by generating code for common analytical tasks. The key is to ask specific questions and iterate on the generated analysis.
