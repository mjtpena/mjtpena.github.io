---
title: "Copilot for Notebooks: AI-Assisted Data Engineering"
description: "Copilot for Notebooks transforms how data engineers write code. Today I'm exploring practical patterns for leveraging AI assistance in Fabric notebooks."
author: Michael John Peña
draft: false
date: 2024-06-09
tags:
  - Microsoft Fabric
  - Copilot
  - Notebooks
  - PySpark
  - Data Engineering
---

Copilot for Notebooks transforms how data engineers write code. Today I'm exploring practical patterns for leveraging AI assistance in Fabric notebooks.

## Getting Started

### Enabling Copilot

```python
# Copilot is available in Fabric notebooks on F64+ capacities
# No special setup required - just start typing or use chat

# Example interaction:
# You: "Load customer data from the lakehouse"
# Copilot generates:
df_customers = spark.read.format("delta").load("Tables/customers")
display(df_customers.limit(10))
```

## Code Generation Patterns

### Data Loading

```python
# Prompt: "Load all tables from the Sales schema and show their row counts"

# Copilot generates:
from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

# List all tables in the Sales lakehouse
tables = spark.catalog.listTables("sales_lakehouse")

# Load and count rows for each table
table_stats = []
for table in tables:
    df = spark.read.table(f"sales_lakehouse.{table.name}")
    table_stats.append({
        "table_name": table.name,
        "row_count": df.count(),
        "column_count": len(df.columns)
    })

# Display as DataFrame
stats_df = spark.createDataFrame(table_stats)
display(stats_df.orderBy("row_count", ascending=False))
```

### Data Transformation

```python
# Prompt: "Clean the customer data: standardize names, validate emails, handle nulls"

# Copilot generates:
from pyspark.sql import functions as F
from pyspark.sql.types import StringType
import re

def clean_customer_data(df):
    """Clean and standardize customer data."""

    # Standardize names (title case, trim whitespace)
    df = df.withColumn(
        "first_name",
        F.initcap(F.trim(F.col("first_name")))
    ).withColumn(
        "last_name",
        F.initcap(F.trim(F.col("last_name")))
    )

    # Validate email format
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    df = df.withColumn(
        "email_valid",
        F.col("email").rlike(email_pattern)
    ).withColumn(
        "email",
        F.when(F.col("email_valid"), F.lower(F.col("email"))).otherwise(None)
    )

    # Handle nulls
    df = df.withColumn(
        "phone",
        F.coalesce(F.col("phone"), F.lit("Unknown"))
    ).withColumn(
        "address",
        F.coalesce(F.col("address"), F.lit("Not Provided"))
    )

    # Create full name
    df = df.withColumn(
        "full_name",
        F.concat_ws(" ", "first_name", "last_name")
    )

    return df.drop("email_valid")

# Apply cleaning
df_clean = clean_customer_data(df_customers)
display(df_clean)
```

### Complex Aggregations

```python
# Prompt: "Calculate customer lifetime value with recency, frequency, monetary analysis"

# Copilot generates:
from pyspark.sql import Window
from pyspark.sql import functions as F
from datetime import datetime

def calculate_rfm(df_orders, reference_date=None):
    """
    Calculate RFM (Recency, Frequency, Monetary) metrics for customers.
    """
    if reference_date is None:
        reference_date = datetime.now()

    # Calculate RFM metrics
    rfm = df_orders.groupBy("customer_id").agg(
        # Recency: days since last order
        F.datediff(
            F.lit(reference_date),
            F.max("order_date")
        ).alias("recency"),

        # Frequency: number of orders
        F.countDistinct("order_id").alias("frequency"),

        # Monetary: total spend
        F.sum("order_total").alias("monetary"),

        # Additional metrics
        F.avg("order_total").alias("avg_order_value"),
        F.min("order_date").alias("first_order_date"),
        F.max("order_date").alias("last_order_date")
    )

    # Calculate RFM scores (1-5 scale using quantiles)
    for metric in ["recency", "frequency", "monetary"]:
        quantiles = rfm.approxQuantile(metric, [0.2, 0.4, 0.6, 0.8], 0.01)

        # For recency, lower is better (reverse scoring)
        if metric == "recency":
            rfm = rfm.withColumn(
                f"{metric}_score",
                F.when(F.col(metric) <= quantiles[0], 5)
                .when(F.col(metric) <= quantiles[1], 4)
                .when(F.col(metric) <= quantiles[2], 3)
                .when(F.col(metric) <= quantiles[3], 2)
                .otherwise(1)
            )
        else:
            rfm = rfm.withColumn(
                f"{metric}_score",
                F.when(F.col(metric) <= quantiles[0], 1)
                .when(F.col(metric) <= quantiles[1], 2)
                .when(F.col(metric) <= quantiles[2], 3)
                .when(F.col(metric) <= quantiles[3], 4)
                .otherwise(5)
            )

    # Calculate composite RFM score
    rfm = rfm.withColumn(
        "rfm_score",
        F.concat(
            F.col("recency_score"),
            F.col("frequency_score"),
            F.col("monetary_score")
        )
    )

    # Segment customers
    rfm = rfm.withColumn(
        "segment",
        F.when(F.col("rfm_score").rlike("^[45][45][45]$"), "Champions")
        .when(F.col("rfm_score").rlike("^[45][45][123]$"), "Loyal Customers")
        .when(F.col("rfm_score").rlike("^[45][123][45]$"), "Potential Loyalists")
        .when(F.col("rfm_score").rlike("^[12][12]"), "At Risk")
        .when(F.col("rfm_score").rlike("^[12][45]"), "Can't Lose Them")
        .otherwise("Others")
    )

    return rfm

# Calculate RFM
rfm_df = calculate_rfm(df_orders)
display(rfm_df)
```

## Code Explanation and Documentation

### Understanding Complex Code

```python
# Prompt: "Explain what this window function does"

# Code to explain:
window_spec = Window.partitionBy("product_category").orderBy(
    F.col("sale_date")
).rowsBetween(-6, 0)

df = df.withColumn(
    "rolling_7day_avg",
    F.avg("daily_sales").over(window_spec)
)

# Copilot explanation:
"""
This code calculates a 7-day rolling average of sales for each product category.

Window specification breakdown:
1. partitionBy("product_category")
   - Creates separate windows for each product category
   - Rolling average is calculated independently per category

2. orderBy(F.col("sale_date"))
   - Orders rows by date within each partition
   - Essential for time-based calculations

3. rowsBetween(-6, 0)
   - Defines the window frame: current row and 6 preceding rows
   - Total of 7 rows (days) for the average

4. F.avg("daily_sales").over(window_spec)
   - Calculates average of daily_sales over the defined window
   - Result is the rolling 7-day average

Example:
For category "Electronics" on 2024-06-07:
- Window includes: June 1-7 (7 days)
- Calculates: avg(sales for June 1, 2, 3, 4, 5, 6, 7)
"""
```

### Auto-Documentation

```python
# Prompt: "Add comprehensive docstrings and comments to this function"

def process_orders(df_orders, df_products, df_customers):
    """
    Process and enrich order data with product and customer information.

    This function performs the following transformations:
    1. Joins orders with product catalog for product details
    2. Joins with customer data for customer segmentation
    3. Calculates derived metrics (discounts, margins)
    4. Filters invalid records
    5. Adds audit columns

    Parameters
    ----------
    df_orders : DataFrame
        Raw orders data with columns: order_id, product_id, customer_id,
        quantity, unit_price, order_date
    df_products : DataFrame
        Product catalog with columns: product_id, product_name, category,
        cost_price
    df_customers : DataFrame
        Customer master data with columns: customer_id, customer_name,
        segment, region

    Returns
    -------
    DataFrame
        Enriched order data with additional columns:
        - product_name, category (from products)
        - customer_name, segment, region (from customers)
        - line_total, discount_amount, margin
        - processing_timestamp

    Examples
    --------
    >>> enriched = process_orders(orders_df, products_df, customers_df)
    >>> enriched.select("order_id", "product_name", "margin").show()

    Notes
    -----
    - Records with null product_id or customer_id are filtered out
    - Margin calculation assumes cost_price is available in products table
    """

    # Join with products for product details
    df = df_orders.join(
        df_products.select("product_id", "product_name", "category", "cost_price"),
        on="product_id",
        how="inner"  # Filter orders with invalid products
    )

    # Join with customers for customer info
    df = df.join(
        df_customers.select("customer_id", "customer_name", "segment", "region"),
        on="customer_id",
        how="inner"  # Filter orders with invalid customers
    )

    # Calculate derived metrics
    df = df.withColumn(
        "line_total",
        F.col("quantity") * F.col("unit_price")
    ).withColumn(
        "margin",
        F.col("line_total") - (F.col("quantity") * F.col("cost_price"))
    ).withColumn(
        "margin_pct",
        F.col("margin") / F.col("line_total") * 100
    )

    # Add audit column
    df = df.withColumn(
        "processing_timestamp",
        F.current_timestamp()
    )

    return df
```

## Error Fixing

### Common Error Patterns

```python
# Prompt: "Fix this error: AnalysisException: Column 'price' does not exist"

# Error context:
# df.columns shows: ['product_id', 'product_name', 'unit_price', 'quantity']

# Original code:
df.withColumn("total", F.col("price") * F.col("quantity"))

# Copilot fix:
# The column is named 'unit_price', not 'price'. Here's the corrected code:
df.withColumn("total", F.col("unit_price") * F.col("quantity"))

# Copilot also suggests adding column validation:
required_columns = ["unit_price", "quantity"]
missing = [c for c in required_columns if c not in df.columns]
if missing:
    raise ValueError(f"Missing required columns: {missing}")
```

### Performance Issues

```python
# Prompt: "This code is slow, help me optimize it"

# Original (slow):
for product_id in product_ids:
    product_df = df.filter(F.col("product_id") == product_id)
    # Process each product
    results.append(product_df.agg(F.sum("sales")).collect()[0][0])

# Copilot optimized version:
# Avoid iteration - use groupBy for parallel processing:
results = df.filter(
    F.col("product_id").isin(product_ids)
).groupBy(
    "product_id"
).agg(
    F.sum("sales").alias("total_sales")
).collect()

# Convert to dictionary if needed:
results_dict = {row["product_id"]: row["total_sales"] for row in results}

# Performance improvement:
# - Single pass through data instead of N passes
# - Leverages Spark's distributed processing
# - Reduces driver memory usage
```

## Testing Assistance

```python
# Prompt: "Generate unit tests for the clean_customer_data function"

import unittest
from pyspark.sql import SparkSession
from pyspark.sql.types import StructType, StructField, StringType

class TestCleanCustomerData(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.spark = SparkSession.builder.master("local[*]").getOrCreate()

    def test_name_standardization(self):
        """Test that names are properly title-cased and trimmed."""
        data = [("  john  ", "  DOE  ", "john@example.com")]
        df = self.spark.createDataFrame(data, ["first_name", "last_name", "email"])

        result = clean_customer_data(df)
        row = result.collect()[0]

        self.assertEqual(row["first_name"], "John")
        self.assertEqual(row["last_name"], "Doe")
        self.assertEqual(row["full_name"], "John Doe")

    def test_email_validation(self):
        """Test that invalid emails are set to None."""
        data = [
            ("John", "Doe", "valid@example.com"),
            ("Jane", "Doe", "invalid-email"),
            ("Bob", "Smith", None)
        ]
        df = self.spark.createDataFrame(data, ["first_name", "last_name", "email"])

        result = clean_customer_data(df)
        emails = [row["email"] for row in result.collect()]

        self.assertEqual(emails[0], "valid@example.com")
        self.assertIsNone(emails[1])
        self.assertIsNone(emails[2])

    def test_null_handling(self):
        """Test that nulls are replaced with default values."""
        data = [("John", "Doe", "john@example.com", None, None)]
        df = self.spark.createDataFrame(
            data,
            ["first_name", "last_name", "email", "phone", "address"]
        )

        result = clean_customer_data(df)
        row = result.collect()[0]

        self.assertEqual(row["phone"], "Unknown")
        self.assertEqual(row["address"], "Not Provided")

# Run tests
unittest.main(argv=[''], exit=False, verbosity=2)
```

## Best Practices

1. **Be specific** - "Calculate rolling 7-day average" not "do averages"
2. **Provide context** - Include column names and data types
3. **Review output** - Always validate generated code
4. **Iterate** - Refine prompts based on results
5. **Learn patterns** - Use Copilot to learn new techniques

## What's Next

Tomorrow I'll cover Copilot for SQL in Fabric Data Warehouse.

## Resources

- [Copilot for Notebooks](https://learn.microsoft.com/fabric/data-engineering/copilot-notebooks)
- [PySpark Reference](https://spark.apache.org/docs/latest/api/python/)
- [Fabric Notebooks](https://learn.microsoft.com/fabric/data-engineering/how-to-use-notebook)
