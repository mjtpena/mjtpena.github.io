---
title: "Copilot for SQL in Microsoft Fabric Data Warehouse"
author: Michael John Peña
draft: false
date: 2024-06-10
tags:
  - Microsoft Fabric
  - Copilot
  - SQL
  - Data Warehouse
  - Natural Language
---

Copilot for SQL transforms natural language into T-SQL queries. Today I'm exploring how to leverage AI for data warehouse development in Fabric.

## Natural Language to SQL

### Simple Queries

```sql
-- Prompt: "Show me total sales by region for 2024"

-- Copilot generates:
SELECT
    r.region_name,
    SUM(s.sale_amount) AS total_sales,
    COUNT(DISTINCT s.order_id) AS order_count
FROM dbo.sales s
INNER JOIN dbo.regions r ON s.region_id = r.region_id
WHERE YEAR(s.order_date) = 2024
GROUP BY r.region_name
ORDER BY total_sales DESC;
```

### Complex Analytics

```sql
-- Prompt: "Compare this month's sales to same period last year by product category,
--          show growth percentage and rank categories by growth"

-- Copilot generates:
WITH current_period AS (
    SELECT
        p.category_name,
        SUM(s.sale_amount) AS current_sales
    FROM dbo.sales s
    INNER JOIN dbo.products p ON s.product_id = p.product_id
    WHERE s.order_date >= DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()), 0)
      AND s.order_date < DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()) + 1, 0)
    GROUP BY p.category_name
),
prior_period AS (
    SELECT
        p.category_name,
        SUM(s.sale_amount) AS prior_sales
    FROM dbo.sales s
    INNER JOIN dbo.products p ON s.product_id = p.product_id
    WHERE s.order_date >= DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()) - 12, 0)
      AND s.order_date < DATEADD(MONTH, DATEDIFF(MONTH, 0, GETDATE()) - 11, 0)
    GROUP BY p.category_name
)
SELECT
    COALESCE(c.category_name, p.category_name) AS category_name,
    ISNULL(c.current_sales, 0) AS current_month_sales,
    ISNULL(p.prior_sales, 0) AS same_month_last_year,
    ISNULL(c.current_sales, 0) - ISNULL(p.prior_sales, 0) AS sales_change,
    CASE
        WHEN ISNULL(p.prior_sales, 0) = 0 THEN NULL
        ELSE ROUND((ISNULL(c.current_sales, 0) - p.prior_sales) / p.prior_sales * 100, 2)
    END AS growth_percentage,
    RANK() OVER (
        ORDER BY CASE
            WHEN ISNULL(p.prior_sales, 0) = 0 THEN -999999
            ELSE (ISNULL(c.current_sales, 0) - p.prior_sales) / p.prior_sales
        END DESC
    ) AS growth_rank
FROM current_period c
FULL OUTER JOIN prior_period p ON c.category_name = p.category_name
ORDER BY growth_percentage DESC NULLS LAST;
```

## Schema Understanding

### Auto-detecting Relationships

```sql
-- Prompt: "What tables are related to the customers table?"

-- Copilot analyzes schema and responds:
/*
The customers table has the following relationships:

1. dbo.orders - FK: customer_id references customers.customer_id
   - One customer can have many orders

2. dbo.customer_addresses - FK: customer_id references customers.customer_id
   - One customer can have multiple addresses

3. dbo.customer_segments - FK: segment_id references customer_segments.segment_id
   - Many customers belong to one segment

4. dbo.loyalty_points - FK: customer_id references customers.customer_id
   - One customer has one loyalty record

Sample join query:
*/

SELECT
    c.customer_id,
    c.customer_name,
    c.email,
    cs.segment_name,
    COUNT(o.order_id) AS total_orders,
    SUM(o.order_total) AS lifetime_value
FROM dbo.customers c
LEFT JOIN dbo.customer_segments cs ON c.segment_id = cs.segment_id
LEFT JOIN dbo.orders o ON c.customer_id = o.customer_id
GROUP BY c.customer_id, c.customer_name, c.email, cs.segment_name;
```

### Data Profiling

```sql
-- Prompt: "Profile the orders table - show data quality metrics"

-- Copilot generates:
WITH column_stats AS (
    SELECT
        'order_id' AS column_name,
        COUNT(*) AS total_rows,
        COUNT(order_id) AS non_null_count,
        COUNT(DISTINCT order_id) AS distinct_count,
        0 AS null_percentage
    FROM dbo.orders

    UNION ALL

    SELECT
        'customer_id',
        COUNT(*),
        COUNT(customer_id),
        COUNT(DISTINCT customer_id),
        ROUND(100.0 * SUM(CASE WHEN customer_id IS NULL THEN 1 ELSE 0 END) / COUNT(*), 2)
    FROM dbo.orders

    UNION ALL

    SELECT
        'order_date',
        COUNT(*),
        COUNT(order_date),
        COUNT(DISTINCT order_date),
        ROUND(100.0 * SUM(CASE WHEN order_date IS NULL THEN 1 ELSE 0 END) / COUNT(*), 2)
    FROM dbo.orders

    UNION ALL

    SELECT
        'order_total',
        COUNT(*),
        COUNT(order_total),
        COUNT(DISTINCT order_total),
        ROUND(100.0 * SUM(CASE WHEN order_total IS NULL THEN 1 ELSE 0 END) / COUNT(*), 2)
    FROM dbo.orders
)
SELECT
    column_name,
    total_rows,
    non_null_count,
    distinct_count,
    null_percentage,
    ROUND(100.0 * distinct_count / NULLIF(non_null_count, 0), 2) AS uniqueness_percentage
FROM column_stats;

-- Additional statistics for numeric columns
SELECT
    'order_total' AS column_name,
    MIN(order_total) AS min_value,
    MAX(order_total) AS max_value,
    AVG(order_total) AS avg_value,
    STDEV(order_total) AS std_dev,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY order_total) OVER() AS median
FROM dbo.orders;
```

## Query Optimization

### Index Recommendations

```sql
-- Prompt: "Optimize this query and suggest indexes"

-- Original query:
SELECT c.customer_name, SUM(o.order_total) as total_spent
FROM orders o
JOIN customers c ON o.customer_id = c.customer_id
WHERE o.order_date BETWEEN '2024-01-01' AND '2024-06-30'
  AND c.region = 'West'
GROUP BY c.customer_name
HAVING SUM(o.order_total) > 1000
ORDER BY total_spent DESC;

-- Copilot optimization and recommendations:
/*
Recommended indexes:

1. On orders table:
   CREATE NONCLUSTERED INDEX IX_orders_date_customer
   ON dbo.orders (order_date, customer_id)
   INCLUDE (order_total);

2. On customers table:
   CREATE NONCLUSTERED INDEX IX_customers_region
   ON dbo.customers (region)
   INCLUDE (customer_id, customer_name);

Query rewrite for better performance:
*/

SELECT c.customer_name, SUM(o.order_total) as total_spent
FROM dbo.customers c
INNER JOIN dbo.orders o
    ON c.customer_id = o.customer_id
    AND o.order_date >= '2024-01-01'
    AND o.order_date < '2024-07-01'  -- Use < instead of BETWEEN for date ranges
WHERE c.region = 'West'
GROUP BY c.customer_name
HAVING SUM(o.order_total) > 1000
ORDER BY total_spent DESC;

-- Explanation:
-- 1. Changed join order to filter customers first (smaller table)
-- 2. Used >= and < for date range (more index-friendly)
-- 3. Moved date filter to JOIN condition for early filtering
```

### Query Execution Analysis

```sql
-- Prompt: "Explain why this query is slow and how to fix it"

-- Slow query:
SELECT * FROM orders WHERE YEAR(order_date) = 2024;

-- Copilot explanation:
/*
PERFORMANCE ISSUE:
Using YEAR() function on order_date prevents index usage (non-SARGable).

The query engine cannot seek on an index because it must evaluate
YEAR(order_date) for every row.

SOLUTIONS:

1. Use date range (best):
*/
SELECT * FROM orders
WHERE order_date >= '2024-01-01' AND order_date < '2025-01-01';

/*
2. If you have many year-based queries, consider a computed column:
*/
ALTER TABLE orders ADD order_year AS YEAR(order_date) PERSISTED;
CREATE INDEX IX_orders_year ON orders(order_year);

-- Then query:
SELECT * FROM orders WHERE order_year = 2024;
```

## Stored Procedure Generation

```sql
-- Prompt: "Create a stored procedure to get customer order summary
--          with parameters for date range and minimum order count"

-- Copilot generates:
CREATE OR ALTER PROCEDURE dbo.usp_GetCustomerOrderSummary
    @StartDate DATE,
    @EndDate DATE,
    @MinOrderCount INT = 1
AS
BEGIN
    SET NOCOUNT ON;

    -- Validate parameters
    IF @StartDate IS NULL OR @EndDate IS NULL
    BEGIN
        RAISERROR('Start and end dates are required', 16, 1);
        RETURN;
    END

    IF @StartDate > @EndDate
    BEGIN
        RAISERROR('Start date must be before end date', 16, 1);
        RETURN;
    END

    -- Main query
    SELECT
        c.customer_id,
        c.customer_name,
        c.email,
        COUNT(o.order_id) AS order_count,
        SUM(o.order_total) AS total_spent,
        AVG(o.order_total) AS avg_order_value,
        MIN(o.order_date) AS first_order_in_period,
        MAX(o.order_date) AS last_order_in_period,
        DATEDIFF(DAY, MIN(o.order_date), MAX(o.order_date)) AS days_active
    FROM dbo.customers c
    INNER JOIN dbo.orders o ON c.customer_id = o.customer_id
    WHERE o.order_date >= @StartDate
      AND o.order_date < DATEADD(DAY, 1, @EndDate)
    GROUP BY c.customer_id, c.customer_name, c.email
    HAVING COUNT(o.order_id) >= @MinOrderCount
    ORDER BY total_spent DESC;

    -- Return summary stats
    SELECT
        COUNT(DISTINCT o.customer_id) AS unique_customers,
        COUNT(o.order_id) AS total_orders,
        SUM(o.order_total) AS total_revenue,
        AVG(o.order_total) AS avg_order_value
    FROM dbo.orders o
    WHERE o.order_date >= @StartDate
      AND o.order_date < DATEADD(DAY, 1, @EndDate);
END;
GO

-- Example usage:
EXEC dbo.usp_GetCustomerOrderSummary
    @StartDate = '2024-01-01',
    @EndDate = '2024-06-30',
    @MinOrderCount = 5;
```

## View Creation

```sql
-- Prompt: "Create a view for sales analytics with all commonly needed dimensions"

-- Copilot generates:
CREATE OR ALTER VIEW dbo.vw_SalesAnalytics
AS
SELECT
    -- Fact measures
    s.sale_id,
    s.sale_amount,
    s.quantity,
    s.discount_amount,
    s.sale_amount - s.discount_amount AS net_amount,

    -- Date dimensions
    s.sale_date,
    YEAR(s.sale_date) AS sale_year,
    MONTH(s.sale_date) AS sale_month,
    DATEPART(QUARTER, s.sale_date) AS sale_quarter,
    DATEPART(WEEK, s.sale_date) AS sale_week,
    DATENAME(WEEKDAY, s.sale_date) AS day_of_week,
    CASE WHEN DATEPART(WEEKDAY, s.sale_date) IN (1, 7) THEN 'Weekend' ELSE 'Weekday' END AS day_type,

    -- Product dimensions
    p.product_id,
    p.product_name,
    p.category_id,
    pc.category_name,
    p.brand,
    p.unit_cost,
    s.sale_amount - (s.quantity * p.unit_cost) AS gross_margin,

    -- Customer dimensions
    c.customer_id,
    c.customer_name,
    c.email,
    cs.segment_name AS customer_segment,

    -- Geography dimensions
    r.region_id,
    r.region_name,
    r.country,
    r.state,
    r.city,

    -- Time dimensions for period comparisons
    EOMONTH(s.sale_date) AS month_end_date,
    DATEFROMPARTS(YEAR(s.sale_date), 1, 1) AS year_start_date

FROM dbo.sales s
INNER JOIN dbo.products p ON s.product_id = p.product_id
INNER JOIN dbo.product_categories pc ON p.category_id = pc.category_id
INNER JOIN dbo.customers c ON s.customer_id = c.customer_id
LEFT JOIN dbo.customer_segments cs ON c.segment_id = cs.segment_id
INNER JOIN dbo.regions r ON s.region_id = r.region_id;
GO

-- Usage example:
SELECT
    sale_year,
    sale_quarter,
    category_name,
    customer_segment,
    SUM(net_amount) AS total_sales,
    SUM(gross_margin) AS total_margin
FROM dbo.vw_SalesAnalytics
WHERE sale_year = 2024
GROUP BY sale_year, sale_quarter, category_name, customer_segment
ORDER BY sale_year, sale_quarter, total_sales DESC;
```

## Best Practices

1. **Describe the business need** - Not just technical requirements
2. **Mention table names** - When you know them
3. **Specify expected output** - Columns, aggregations
4. **Ask for explanations** - Learn from generated SQL
5. **Request optimizations** - Get performance tips

## What's Next

Tomorrow I'll cover Fabric Admin updates.

## Resources

- [Copilot for SQL](https://learn.microsoft.com/fabric/data-warehouse/copilot)
- [T-SQL Reference](https://learn.microsoft.com/sql/t-sql/)
- [Query Performance Tips](https://learn.microsoft.com/sql/relational-databases/performance/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
