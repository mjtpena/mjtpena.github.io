---
title: "Fabric Warehouse: Cloud-Native SQL Analytics"
author: Michael John Peña
draft: false
date: 2023-07-15
tags:
  - Microsoft Fabric
  - Data Warehouse
  - T-SQL
  - Analytics
---

The Fabric Warehouse is the part of Microsoft Fabric that surprised me most in hands-on testing. I expected it to be the Lakehouse's SQL analytics endpoint with write access bolted on, but the engineering is more substantial than that: the Warehouse supports full DDL (CREATE TABLE, ALTER TABLE, DROP), DML (INSERT, UPDATE, DELETE, MERGE), stored procedures, views, and T-SQL transactions, while storing data in open Delta Parquet format in OneLake. That last point is the strategic differentiator versus Synapse Dedicated SQL Pool — your data is in open format, readable by Spark jobs in the same workspace, not locked into a proprietary columnar store. At preview, there are T-SQL gaps (no CLR, no XML data type, limited agent jobs), but for analytical SQL workloads the parity is much closer than I expected.

## Fabric Warehouse Overview

```python
# Warehouse characteristics
fabric_warehouse = {
    "engine": "Distributed SQL engine",
    "storage": "OneLake (Delta format)",
    "language": "T-SQL",
    "distribution": "Automatic (no manual configuration)",
    "indexing": "Automatic (no manual indexes)",
    "scaling": "Automatic within capacity"
}

# Key differences from Synapse Dedicated Pool:
differences = {
    "no_distribution_keys": "Automatic data distribution",
    "no_indexes": "Automatic indexing/statistics",
    "no_cluster_management": "Serverless-like experience",
    "no_pause_resume": "Always available",
    "delta_format": "Uses Delta Lake, not columnstore"
}
```

## Creating a Warehouse

```sql
-- In Fabric portal:
-- 1. Navigate to workspace
-- 2. Click "+ New" > "Warehouse"
-- 3. Name your warehouse

-- Warehouse naming convention:
-- {domain}_{purpose}_wh
-- Example: sales_analytics_wh, finance_reporting_wh
```

## Creating Tables

```sql
-- Create a basic table
CREATE TABLE dim_customer (
    customer_key INT NOT NULL,
    customer_id NVARCHAR(50) NOT NULL,
    customer_name NVARCHAR(200),
    email NVARCHAR(200),
    segment NVARCHAR(50),
    city NVARCHAR(100),
    state NVARCHAR(50),
    country NVARCHAR(50),
    created_date DATE,
    modified_date DATETIME2
);

-- Create table with constraints
CREATE TABLE fact_sales (
    sales_key BIGINT NOT NULL,
    order_id NVARCHAR(50) NOT NULL,
    customer_key INT NOT NULL,
    product_key INT NOT NULL,
    date_key INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(18, 2) NOT NULL,
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    total_amount AS (quantity * unit_price * (1 - discount_percent / 100)) PERSISTED,
    created_at DATETIME2 DEFAULT GETUTCDATE()
);

-- Note: No IDENTITY columns in Fabric Warehouse yet
-- Generate keys using sequences or Spark
```

## Loading Data

### Using COPY Statement

```sql
-- COPY FROM is the fastest way to load data
COPY INTO dim_customer
FROM 'abfss://workspace@onelake.dfs.fabric.microsoft.com/lakehouse/Tables/customers'
WITH (
    FILE_TYPE = 'PARQUET'
);

-- Copy from CSV
COPY INTO staging_orders
FROM 'abfss://workspace@onelake.dfs.fabric.microsoft.com/lakehouse/Files/raw/*.csv'
WITH (
    FILE_TYPE = 'CSV',
    FIRSTROW = 2,
    FIELDTERMINATOR = ',',
    ROWTERMINATOR = '\n'
);

-- Copy with column mapping
COPY INTO dim_product (product_key, product_name, category)
FROM 'abfss://path/to/files/*.parquet'
WITH (
    FILE_TYPE = 'PARQUET',
    COLUMN_MAPPING = 'product_key=id, product_name=name, category=category_name'
);
```

### Using INSERT...SELECT

```sql
-- Insert from another table
INSERT INTO dim_customer_current
SELECT * FROM dim_customer
WHERE is_current = 1;

-- Insert from Lakehouse (cross-database query)
INSERT INTO warehouse.dbo.fact_sales
SELECT
    ROW_NUMBER() OVER (ORDER BY order_id) as sales_key,
    order_id,
    customer_key,
    product_key,
    CONVERT(INT, FORMAT(order_date, 'yyyyMMdd')) as date_key,
    quantity,
    unit_price,
    discount_percent
FROM lakehouse.dbo.orders;
```

## Querying Data

### Basic Queries

```sql
-- Select with aggregation
SELECT
    c.segment,
    COUNT(DISTINCT s.customer_key) as unique_customers,
    COUNT(*) as total_orders,
    SUM(s.total_amount) as total_revenue,
    AVG(s.total_amount) as avg_order_value
FROM fact_sales s
INNER JOIN dim_customer c ON s.customer_key = c.customer_key
WHERE s.date_key >= 20230101
GROUP BY c.segment
ORDER BY total_revenue DESC;

-- Window functions
SELECT
    customer_key,
    order_id,
    total_amount,
    SUM(total_amount) OVER (
        PARTITION BY customer_key
        ORDER BY date_key
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) as running_total,
    ROW_NUMBER() OVER (
        PARTITION BY customer_key
        ORDER BY date_key DESC
    ) as order_rank
FROM fact_sales;
```

### CTEs and Subqueries

```sql
-- Common Table Expression
WITH monthly_sales AS (
    SELECT
        d.year_month,
        c.segment,
        SUM(s.total_amount) as monthly_revenue
    FROM fact_sales s
    JOIN dim_date d ON s.date_key = d.date_key
    JOIN dim_customer c ON s.customer_key = c.customer_key
    GROUP BY d.year_month, c.segment
),
segment_ranking AS (
    SELECT
        year_month,
        segment,
        monthly_revenue,
        RANK() OVER (PARTITION BY year_month ORDER BY monthly_revenue DESC) as rank
    FROM monthly_sales
)
SELECT * FROM segment_ranking
WHERE rank <= 3
ORDER BY year_month, rank;
```

### Cross-Database Queries

```sql
-- Query Lakehouse tables from Warehouse
SELECT
    w.customer_key,
    w.customer_name,
    l.total_orders,
    l.total_spent
FROM warehouse.dbo.dim_customer w
LEFT JOIN lakehouse.dbo.customer_metrics l
    ON w.customer_id = l.customer_id;

-- Join across workspaces (using shortcuts)
SELECT *
FROM sales_warehouse.dbo.orders o
JOIN reference_lakehouse.dbo.products p
    ON o.product_id = p.product_id;
```

## Views and Stored Procedures

```sql
-- Create view
CREATE VIEW vw_customer_360 AS
SELECT
    c.customer_key,
    c.customer_name,
    c.segment,
    COUNT(s.sales_key) as total_orders,
    SUM(s.total_amount) as lifetime_value,
    MAX(d.full_date) as last_order_date,
    DATEDIFF(day, MAX(d.full_date), GETDATE()) as days_since_last_order
FROM dim_customer c
LEFT JOIN fact_sales s ON c.customer_key = s.customer_key
LEFT JOIN dim_date d ON s.date_key = d.date_key
GROUP BY c.customer_key, c.customer_name, c.segment;

-- Create stored procedure
CREATE PROCEDURE usp_refresh_customer_metrics
    @start_date DATE,
    @end_date DATE
AS
BEGIN
    -- Truncate target
    TRUNCATE TABLE customer_metrics;

    -- Insert fresh calculations
    INSERT INTO customer_metrics
    SELECT
        customer_key,
        COUNT(*) as order_count,
        SUM(total_amount) as total_spent,
        AVG(total_amount) as avg_order_value
    FROM fact_sales
    WHERE date_key BETWEEN
        CONVERT(INT, FORMAT(@start_date, 'yyyyMMdd'))
        AND CONVERT(INT, FORMAT(@end_date, 'yyyyMMdd'))
    GROUP BY customer_key;
END;

-- Execute stored procedure
EXEC usp_refresh_customer_metrics '2023-01-01', '2023-12-31';
```

## Performance Considerations

```sql
-- Check query statistics
-- Use the Query Insights feature in the portal

-- Best practices for performance:
-- 1. Use appropriate data types
-- 2. Filter early in queries
-- 3. Avoid SELECT *
-- 4. Use CTEs for readability
-- 5. Leverage partitioning where possible

-- Example: Optimized query pattern
SELECT
    c.segment,
    d.year_month,
    SUM(s.total_amount) as revenue
FROM fact_sales s
INNER JOIN dim_customer c ON s.customer_key = c.customer_key
INNER JOIN dim_date d ON s.date_key = d.date_key
WHERE s.date_key BETWEEN 20230101 AND 20231231  -- Filter fact table first
    AND c.country = 'USA'
GROUP BY c.segment, d.year_month;
```

## Security

```sql
-- Row-level security
CREATE FUNCTION fn_security_predicate(@region NVARCHAR(50))
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN SELECT 1 AS result
WHERE @region = USER_NAME() OR USER_NAME() = 'admin';

CREATE SECURITY POLICY region_filter
ADD FILTER PREDICATE dbo.fn_security_predicate(region)
ON dbo.fact_sales;

-- Column-level security via views
CREATE VIEW vw_sales_public AS
SELECT
    order_id,
    customer_key,
    product_key,
    quantity,
    -- Exclude sensitive columns like discount, cost
    total_amount
FROM fact_sales;
```

Tomorrow we'll dive deeper into T-SQL patterns specific to Fabric.

## Resources

- [Fabric Warehouse Documentation](https://learn.microsoft.com/en-us/fabric/data-warehouse/data-warehousing)
- [T-SQL in Fabric](https://learn.microsoft.com/en-us/fabric/data-warehouse/tsql-surface-area)
- [Warehouse Best Practices](https://learn.microsoft.com/en-us/fabric/data-warehouse/guidelines-warehouse-performance)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
