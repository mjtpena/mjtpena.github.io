---
title: "Fabric Copilot Updates: AI-Powered Data Analytics"
author: Michael John Peña
draft: false
date: 2024-06-08
tags:
  - Microsoft Fabric
  - Copilot
  - AI
  - Data Analytics
  - Natural Language
---

Fabric Copilot has received significant updates. Today I'm exploring how AI assistants are transforming data work in Microsoft Fabric.

## Copilot Capabilities in Fabric

```
Fabric Copilot:
├── Notebooks (code generation)
├── Data Warehouse (SQL generation)
├── Power BI (report building)
├── Data Factory (pipeline creation)
└── Real-Time Intelligence (KQL queries)
```

## Copilot for Notebooks

### Code Generation

```python
# User prompt: "Load sales data from the lakehouse and show top 10 products by revenue"

# Copilot generates:
from pyspark.sql import SparkSession
from pyspark.sql.functions import col, sum as spark_sum

# Initialize Spark session
spark = SparkSession.builder.getOrCreate()

# Load sales data from Lakehouse
sales_df = spark.read.format("delta").load("Tables/sales")

# Calculate revenue by product and get top 10
top_products = (
    sales_df
    .groupBy("product_id", "product_name")
    .agg(spark_sum(col("quantity") * col("unit_price")).alias("total_revenue"))
    .orderBy(col("total_revenue").desc())
    .limit(10)
)

# Display results
display(top_products)
```

### Code Explanation

```python
# User prompt: "Explain this code"

# Original code:
result = df.groupBy("category").agg(
    F.count("*").alias("count"),
    F.avg("price").alias("avg_price"),
    F.percentile_approx("price", 0.5).alias("median_price")
).filter(F.col("count") > 100)

# Copilot explains:
"""
This code performs the following operations:

1. Groups the DataFrame by the 'category' column
2. Calculates aggregations for each group:
   - count: Total number of rows
   - avg_price: Average of the 'price' column
   - median_price: Approximate median (50th percentile) of prices
3. Filters to only include categories with more than 100 items

The result is a summary statistics table for each product category
that has significant volume (>100 items).
"""
```

### Code Fixing

```python
# User prompt: "Fix this error: Column 'price' does not exist"

# Original (buggy) code:
df.select("product_name", "price", "quantity")

# Copilot suggests:
# The column is named 'unit_price', not 'price'. Here's the fix:
df.select("product_name", "unit_price", "quantity")

# Or if you need to rename it:
df.select(
    "product_name",
    F.col("unit_price").alias("price"),
    "quantity"
)
```

## Copilot for Data Warehouse

### Natural Language to SQL

```sql
-- User prompt: "Show me monthly sales trends for 2024 compared to 2023"

-- Copilot generates:
WITH monthly_sales AS (
    SELECT
        YEAR(order_date) as year,
        MONTH(order_date) as month,
        SUM(total_amount) as total_sales,
        COUNT(DISTINCT order_id) as order_count
    FROM dbo.orders
    WHERE YEAR(order_date) IN (2023, 2024)
    GROUP BY YEAR(order_date), MONTH(order_date)
)
SELECT
    m2024.month,
    m2024.total_sales as sales_2024,
    m2023.total_sales as sales_2023,
    ROUND((m2024.total_sales - m2023.total_sales) / m2023.total_sales * 100, 2) as yoy_growth_pct
FROM monthly_sales m2024
LEFT JOIN monthly_sales m2023
    ON m2024.month = m2023.month
    AND m2023.year = 2023
WHERE m2024.year = 2024
ORDER BY m2024.month;
```

### Query Optimization

```sql
-- User prompt: "Optimize this query for better performance"

-- Original query:
SELECT * FROM orders o
WHERE o.customer_id IN (
    SELECT customer_id FROM customers WHERE region = 'West'
)
AND o.order_date > '2024-01-01';

-- Copilot suggests:
-- Use JOIN instead of IN for better performance with large datasets:
SELECT o.*
FROM orders o
INNER JOIN customers c ON o.customer_id = c.customer_id
WHERE c.region = 'West'
  AND o.order_date > '2024-01-01';

-- Additional recommendations:
-- 1. Add index on customers.region if not exists
-- 2. Add index on orders.order_date if not exists
-- 3. Consider partitioning orders table by order_date
```

## Copilot for Power BI

### Report Creation

```
User prompt: "Create a sales dashboard with:
- KPI cards for total revenue, orders, and average order value
- Line chart showing monthly trends
- Bar chart of top 10 products
- Map showing sales by region"

Copilot:
1. Creates page layout with optimal tile placement
2. Adds KPI cards with appropriate measures
3. Creates line chart with proper date hierarchy
4. Builds bar chart with top N filter
5. Adds map visual with geographic data mapping
```

### DAX Generation

```dax
// User prompt: "Create a measure for year-over-year growth percentage"

// Copilot generates:
YoY Growth % =
VAR CurrentYearSales = [Total Sales]
VAR PriorYearSales =
    CALCULATE(
        [Total Sales],
        SAMEPERIODLASTYEAR('Date'[Date])
    )
RETURN
    IF(
        NOT ISBLANK(PriorYearSales) && PriorYearSales <> 0,
        DIVIDE(CurrentYearSales - PriorYearSales, PriorYearSales),
        BLANK()
    )
```

### Insight Suggestions

```
Copilot analysis of sales data:

Key Insights Detected:
1. Revenue increased 15% in Q2 compared to Q1
2. Product category "Electronics" drives 45% of total revenue
3. Weekend orders are 30% higher than weekday orders
4. Customer retention rate dropped 5% in the last month
5. Top 3 regions account for 70% of all orders

Suggested Visualizations:
- Decomposition tree to analyze revenue drivers
- Cohort analysis for customer retention
- Anomaly detection on daily sales
```

## Copilot for Data Factory

### Pipeline Generation

```
User prompt: "Create a pipeline that:
1. Copies data from Azure SQL to Lakehouse daily
2. Transforms the data using a notebook
3. Updates the warehouse
4. Sends email on completion"

Copilot generates pipeline with:
- Copy activity with Azure SQL source
- Notebook activity with dependency
- Stored procedure activity for warehouse
- Web activity for email notification
- Schedule trigger for daily execution
```

### Data Flow Suggestions

```python
# User describes transformation needs
# Copilot generates Dataflow Gen2 code:

# Source: SQL Server customers table
source = spark.read.format("sqlserver") \
    .option("host", "server.database.windows.net") \
    .option("database", "sales_db") \
    .option("dbtable", "customers") \
    .load()

# Transform: Clean and standardize
transformed = source \
    .withColumn("full_name", F.concat_ws(" ", "first_name", "last_name")) \
    .withColumn("email_domain", F.split("email", "@").getItem(1)) \
    .withColumn("created_date", F.to_date("created_at")) \
    .filter(F.col("is_active") == True) \
    .select("customer_id", "full_name", "email", "email_domain",
            "region", "created_date")

# Destination: Lakehouse delta table
transformed.write.format("delta") \
    .mode("merge") \
    .option("mergeSchema", "true") \
    .save("Tables/dim_customers")
```

## Copilot for KQL

### Query Generation

```kusto
// User prompt: "Find devices with anomalous temperature readings in the last hour"

// Copilot generates:
SensorData
| where EventTime > ago(1h)
| where SensorType == "temperature"
| summarize
    avg_temp = avg(Value),
    stdev_temp = stdev(Value),
    readings = count()
    by DeviceId
| join kind=inner (
    SensorData
    | where EventTime > ago(1h)
    | where SensorType == "temperature"
) on DeviceId
| where abs(Value - avg_temp) > 3 * stdev_temp
| project
    EventTime,
    DeviceId,
    Value,
    avg_temp,
    deviation = abs(Value - avg_temp) / stdev_temp
| order by deviation desc
```

## Best Practices for Using Copilot

### Effective Prompting

```
Good prompts:
- "Create a PySpark function that calculates rolling 7-day average sales by product"
- "Write a SQL query to find customers who ordered in January but not February"
- "Generate DAX for month-over-month growth with null handling"

Less effective prompts:
- "Make a chart" (too vague)
- "Fix it" (missing context)
- "Better code" (no specific goal)
```

### Review and Validate

```python
# Always review Copilot output

# Copilot suggestion (may need validation):
result = df.filter(F.col("date") > "2024-01-01")

# Validated and improved:
from datetime import date

# Use proper date type for type safety
result = df.filter(F.col("date") > F.lit(date(2024, 1, 1)))

# Add data quality check
assert result.count() > 0, "No data after filter - check date range"
```

## Copilot Availability

| Feature | SKU Required | Status |
|---------|-------------|--------|
| Notebooks | F64+ | GA |
| Data Warehouse | F64+ | GA |
| Power BI | PPU/F64+ | GA |
| Data Factory | F64+ | Preview |
| Real-Time Intel | F64+ | Preview |

## What's Next

Tomorrow I'll cover Copilot for Notebooks in more depth.

## Resources

- [Fabric Copilot Overview](https://learn.microsoft.com/fabric/get-started/copilot-fabric-overview)
- [Copilot for Notebooks](https://learn.microsoft.com/fabric/data-engineering/copilot-notebooks)
- [Copilot for SQL](https://learn.microsoft.com/fabric/data-warehouse/copilot)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
