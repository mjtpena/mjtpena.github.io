---
title: "Fabric AI Features: A Deep Dive into Copilot Capabilities"
author: Michael John Peña
draft: false
date: 2025-01-11
tags:
  - Microsoft Fabric
  - Copilot
  - AI
  - Data Analytics
  - Azure

---

I wrote "Fabric AI Features: A Deep Dive into Copilot Capabilities" to share practical, production-minded guidance on this topic.

## Copilot in Data Engineering

### Notebook Assistance

```python
# In a Fabric notebook, Copilot helps write PySpark code

# Ask Copilot: "Read parquet files from the landing zone,
# deduplicate by customer_id keeping the latest record,
# and write to the bronze layer"

# Copilot generates:
from pyspark.sql import functions as F
from pyspark.sql.window import Window

# Read from landing zone
df = spark.read.parquet("Files/landing/customers/")

# Deduplicate keeping latest record
window = Window.partitionBy("customer_id").orderBy(F.desc("updated_at"))
df_deduped = (df
    .withColumn("row_num", F.row_number().over(window))
    .filter(F.col("row_num") == 1)
    .drop("row_num"))

# Write to bronze layer
df_deduped.write.mode("overwrite").format("delta").saveAsTable("bronze.customers")

print(f"Processed {df_deduped.count()} unique customers")
```

### Code Explanation

```python
# Highlight complex code and ask "Explain this code"

# Copilot explains:
"""
This code performs Slowly Changing Dimension Type 2 merge:

1. `MERGE INTO silver.customers AS target` - Updates the target dimension table
2. `USING staging.customers AS source` - Compares against new incoming data
3. `WHEN MATCHED AND target.hash != source.hash` - Detects changed records
   - Closes the old record by setting end_date
4. `WHEN NOT MATCHED BY SOURCE AND target.is_current` - Handles deleted records
5. `WHEN NOT MATCHED` - Inserts new records with is_current = true

The hash column is used for efficient change detection rather than
comparing all columns individually.
"""
```

## Copilot in Data Factory

### Pipeline Generation

```
User: "Create a pipeline that ingests data from Salesforce,
transforms it with a dataflow, loads to warehouse,
and sends email notification on failure"

Copilot generates a complete pipeline with:
- Salesforce connector configuration
- Dataflow Gen2 transformation
- Warehouse load activity
- Email notification on failure
- Proper dependency chain
```

### Natural Language to Dataflow

```python
# In Dataflow Gen2, describe transformations in plain English

# "Join customers with orders on customer_id,
# calculate total order value per customer,
# filter customers with total > $1000,
# add a loyalty tier column based on spend"

# Copilot generates Power Query M code:
let
    Source = customers,
    JoinOrders = Table.NestedJoin(Source, {"customer_id"},
        orders, {"customer_id"}, "Orders", JoinKind.LeftOuter),
    ExpandOrders = Table.ExpandTableColumn(JoinOrders, "Orders", {"amount"}),
    GroupByCustomer = Table.Group(ExpandOrders, {"customer_id", "customer_name"},
        {{"total_spend", each List.Sum([amount]), type number}}),
    FilterHighValue = Table.SelectRows(GroupByCustomer,
        each [total_spend] > 1000),
    AddLoyaltyTier = Table.AddColumn(FilterHighValue, "loyalty_tier",
        each if [total_spend] > 10000 then "Platinum"
        else if [total_spend] > 5000 then "Gold"
        else "Silver")
in
    AddLoyaltyTier
```

## Copilot in Data Warehouse

### SQL Generation

```sql
-- Ask: "Show top 10 products by revenue with month-over-month growth"

-- Copilot generates:
WITH monthly_revenue AS (
    SELECT
        product_id,
        product_name,
        DATE_TRUNC('month', order_date) AS month,
        SUM(quantity * unit_price) AS revenue
    FROM fact_sales f
    JOIN dim_products p ON f.product_id = p.id
    GROUP BY product_id, product_name, DATE_TRUNC('month', order_date)
),
revenue_with_growth AS (
    SELECT
        product_id,
        product_name,
        month,
        revenue,
        LAG(revenue) OVER (PARTITION BY product_id ORDER BY month) AS prev_month_revenue,
        (revenue - LAG(revenue) OVER (PARTITION BY product_id ORDER BY month))
            / NULLIF(LAG(revenue) OVER (PARTITION BY product_id ORDER BY month), 0) * 100
            AS mom_growth_pct
    FROM monthly_revenue
)
SELECT
    product_name,
    revenue AS current_month_revenue,
    prev_month_revenue,
    ROUND(mom_growth_pct, 2) AS growth_percentage
FROM revenue_with_growth
WHERE month = DATE_TRUNC('month', CURRENT_DATE - INTERVAL '1 month')
ORDER BY revenue DESC
LIMIT 10;
```

### Query Optimization

```sql
-- Paste a slow query and ask "Optimize this query"

-- Original (slow):
SELECT * FROM orders o
WHERE EXISTS (
    SELECT 1 FROM customers c
    WHERE c.id = o.customer_id
    AND c.region = 'APAC'
    AND c.created_date > '2024-01-01'
);

-- Copilot suggests optimized version:
SELECT o.*
FROM orders o
INNER JOIN customers c ON o.customer_id = c.id
WHERE c.region = 'APAC'
  AND c.created_date > '2024-01-01';

-- Explanation: "The INNER JOIN is more efficient than EXISTS
-- for this pattern. Consider adding an index on
-- customers(region, created_date) for further optimization."
```

## Copilot in Power BI

### DAX Generation

```dax
// Ask: "Create a measure for year-over-year growth percentage"

// Copilot generates:
YoY Growth % =
VAR CurrentYearSales = [Total Sales]
VAR PreviousYearSales =
    CALCULATE(
        [Total Sales],
        SAMEPERIODLASTYEAR('Date'[Date])
    )
VAR Growth =
    DIVIDE(
        CurrentYearSales - PreviousYearSales,
        PreviousYearSales,
        BLANK()
    )
RETURN
    FORMAT(Growth, "0.0%")
```

### Report Suggestions

```
User: "What visualizations would help analyze customer churn?"

Copilot suggests:
1. Funnel chart showing customer journey stages
2. Line chart of churn rate over time
3. Bar chart of churn reasons
4. Cohort analysis matrix
5. KPI cards for key metrics (churn rate, retention rate, CLV)
6. Scatter plot of engagement vs. churn probability

Would you like me to create any of these visualizations?
```

## Copilot in Real-Time Intelligence

### KQL Query Generation

```kusto
// Ask: "Find anomalies in website traffic in the last hour"

// Copilot generates:
let baselineWindow = 7d;
let analysisWindow = 1h;
let threshold = 3; // standard deviations

website_traffic
| where timestamp > ago(baselineWindow)
| summarize
    avg_requests = avg(request_count),
    stdev_requests = stdev(request_count)
    by bin(timestamp, 1m)
| join kind=inner (
    website_traffic
    | where timestamp > ago(analysisWindow)
    | summarize current_requests = sum(request_count) by bin(timestamp, 1m)
) on timestamp
| extend
    z_score = (current_requests - avg_requests) / stdev_requests,
    is_anomaly = abs((current_requests - avg_requests) / stdev_requests) > threshold
| where is_anomaly
| project timestamp, current_requests, avg_requests, z_score
| order by timestamp desc
```

## Best Practices for Using Copilot

### Be Specific

```python
# Vague (less helpful):
# "Process the data"

# Specific (more helpful):
# "Read sales data from delta table, filter for 2024,
# aggregate by product category and month,
# calculate running totals, and write to silver layer"
```

### Provide Context

```python
# Include schema information:
# "Given tables:
# - customers (id, name, email, region, created_date)
# - orders (id, customer_id, amount, order_date)
# - products (id, name, category, price)
#
# Write a query to find customer lifetime value by region"
```

### Iterate and Refine

```python
# Start broad, then refine:
# Round 1: "Create a data quality check"
# Round 2: "Add null checks for required columns"
# Round 3: "Add duplicate detection logic"
# Round 4: "Add email alerting when checks fail"
```

## Copilot Limitations to Know

1. **Context window**: Copilot has limits on how much code it can see
2. **Real-time data**: Can't access live data, only schema
3. **Complex logic**: May need human review for intricate business rules
4. **Security**: Won't generate code that bypasses security controls

Copilot in Fabric is a productivity multiplier. Use it as a starting point, then refine and validate the output. The combination of AI assistance and human expertise delivers the best results.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
