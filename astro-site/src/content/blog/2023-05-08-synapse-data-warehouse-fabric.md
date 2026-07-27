---
title: "Synapse Data Warehouse in Microsoft Fabric: Cloud-Native SQL Analytics"
author: Michael John Peña
draft: false
date: 2023-05-08
tags:
  - Microsoft Fabric
  - Data Warehouse
  - T-SQL
  - Analytics
  - Azure

---

I wrote "Synapse Data Warehouse in Microsoft Fabric: Cloud-Native SQL Analytics" to share practical, production-minded guidance on this topic.

## Fabric Data Warehouse Overview

The Fabric Warehouse offers:
- Full T-SQL support
- Automatic optimization (no index management)
- Auto-scaling compute
- Cross-database queries
- Native integration with Fabric workloads

```
┌─────────────────────────────────────────────────────┐
│             Synapse Data Warehouse                   │
├─────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────┐ │
│  │              T-SQL Engine                       │ │
│  │  (DDL, DML, Views, Stored Procs, Functions)    │ │
│  └────────────────────────────────────────────────┘ │
│                        │                            │
│                        ▼                            │
│  ┌────────────────────────────────────────────────┐ │
│  │         Automatic Optimization                  │ │
│  │   (Distribution, Statistics, Caching)          │ │
│  └────────────────────────────────────────────────┘ │
│                        │                            │
│                        ▼                            │
│  ┌────────────────────────────────────────────────┐ │
│  │              OneLake Storage                    │ │
│  │           (Delta Lake Format)                   │ │
│  └────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Creating Warehouse Objects

### Tables

```sql
-- Create dimension tables
CREATE TABLE dim_customer (
    customer_key INT NOT NULL,
    customer_id NVARCHAR(50) NOT NULL,
    customer_name NVARCHAR(200),
    email NVARCHAR(200),
    country NVARCHAR(100),
    segment NVARCHAR(50),
    created_date DATE,
    modified_date DATE,
    is_current BIT DEFAULT 1
);

CREATE TABLE dim_product (
    product_key INT NOT NULL,
    product_id NVARCHAR(50) NOT NULL,
    product_name NVARCHAR(200),
    category NVARCHAR(100),
    subcategory NVARCHAR(100),
    unit_price DECIMAL(18,2),
    cost DECIMAL(18,2)
);

CREATE TABLE dim_date (
    date_key INT NOT NULL,
    full_date DATE NOT NULL,
    year INT,
    quarter INT,
    month INT,
    month_name NVARCHAR(20),
    day INT,
    day_of_week INT,
    day_name NVARCHAR(20),
    is_weekend BIT,
    is_holiday BIT
);

-- Create fact table
CREATE TABLE fact_sales (
    sales_key BIGINT IDENTITY(1,1) NOT NULL,
    date_key INT NOT NULL,
    customer_key INT NOT NULL,
    product_key INT NOT NULL,
    order_id NVARCHAR(50),
    quantity INT,
    unit_price DECIMAL(18,2),
    discount_amount DECIMAL(18,2),
    sales_amount DECIMAL(18,2),
    cost_amount DECIMAL(18,2),
    profit_amount AS (sales_amount - cost_amount)
);
```

### Loading Data

```sql
-- Load from Lakehouse using COPY INTO
COPY INTO dim_customer
FROM 'abfss://workspace@onelake.dfs.fabric.microsoft.com/lakehouse.Lakehouse/Tables/customers'
WITH (
    FILE_TYPE = 'PARQUET',
    CREDENTIAL = (IDENTITY = 'Managed Identity')
);

-- Load from external files
COPY INTO fact_sales (date_key, customer_key, product_key, order_id, quantity, unit_price, discount_amount, sales_amount, cost_amount)
FROM 'abfss://workspace@onelake.dfs.fabric.microsoft.com/lakehouse.Lakehouse/Files/sales/'
WITH (
    FILE_TYPE = 'CSV',
    FIRSTROW = 2,
    FIELDTERMINATOR = ',',
    ROWTERMINATOR = '\n'
);

-- Insert from query
INSERT INTO fact_sales (date_key, customer_key, product_key, order_id, quantity, unit_price, discount_amount, sales_amount, cost_amount)
SELECT
    dd.date_key,
    dc.customer_key,
    dp.product_key,
    s.order_id,
    s.quantity,
    s.unit_price,
    s.discount,
    s.quantity * s.unit_price * (1 - s.discount),
    s.quantity * dp.cost
FROM lakehouse.dbo.staging_sales s
JOIN dim_date dd ON s.order_date = dd.full_date
JOIN dim_customer dc ON s.customer_id = dc.customer_id
JOIN dim_product dp ON s.product_id = dp.product_id;
```

### Views

```sql
-- Create analytical views
CREATE VIEW vw_sales_summary AS
SELECT
    dd.year,
    dd.quarter,
    dd.month,
    dd.month_name,
    dc.segment,
    dc.country,
    dp.category,
    dp.subcategory,
    COUNT(DISTINCT fs.order_id) AS order_count,
    SUM(fs.quantity) AS total_quantity,
    SUM(fs.sales_amount) AS total_sales,
    SUM(fs.profit_amount) AS total_profit,
    AVG(fs.sales_amount) AS avg_order_value
FROM fact_sales fs
JOIN dim_date dd ON fs.date_key = dd.date_key
JOIN dim_customer dc ON fs.customer_key = dc.customer_key
JOIN dim_product dp ON fs.product_key = dp.product_key
GROUP BY
    dd.year, dd.quarter, dd.month, dd.month_name,
    dc.segment, dc.country,
    dp.category, dp.subcategory;

-- Materialized view for performance (coming soon)
-- CREATE MATERIALIZED VIEW mv_daily_sales AS ...
```

### Stored Procedures

```sql
-- ETL stored procedure
CREATE PROCEDURE sp_load_daily_sales
    @load_date DATE
AS
BEGIN
    -- Start transaction
    BEGIN TRANSACTION;

    BEGIN TRY
        -- Delete existing data for the date (idempotent)
        DELETE FROM fact_sales
        WHERE date_key = (SELECT date_key FROM dim_date WHERE full_date = @load_date);

        -- Load new data
        INSERT INTO fact_sales (date_key, customer_key, product_key, order_id, quantity, unit_price, discount_amount, sales_amount, cost_amount)
        SELECT
            dd.date_key,
            dc.customer_key,
            dp.product_key,
            s.order_id,
            s.quantity,
            s.unit_price,
            s.discount,
            s.quantity * s.unit_price * (1 - s.discount),
            s.quantity * dp.cost
        FROM lakehouse.dbo.staging_sales s
        JOIN dim_date dd ON s.order_date = dd.full_date
        JOIN dim_customer dc ON s.customer_id = dc.customer_id
        JOIN dim_product dp ON s.product_id = dp.product_id
        WHERE s.order_date = @load_date;

        -- Log success
        INSERT INTO etl_log (procedure_name, load_date, status, row_count)
        SELECT 'sp_load_daily_sales', @load_date, 'SUCCESS', @@ROWCOUNT;

        COMMIT TRANSACTION;
    END TRY
    BEGIN CATCH
        ROLLBACK TRANSACTION;

        -- Log error
        INSERT INTO etl_log (procedure_name, load_date, status, error_message)
        SELECT 'sp_load_daily_sales', @load_date, 'FAILED', ERROR_MESSAGE();

        THROW;
    END CATCH
END;
```

### User-Defined Functions

```sql
-- Scalar function
CREATE FUNCTION fn_calculate_margin(@sales DECIMAL(18,2), @cost DECIMAL(18,2))
RETURNS DECIMAL(18,4)
AS
BEGIN
    RETURN CASE WHEN @sales = 0 THEN 0 ELSE (@sales - @cost) / @sales END;
END;

-- Table-valued function
CREATE FUNCTION fn_get_customer_orders(@customer_id NVARCHAR(50))
RETURNS TABLE
AS
RETURN
(
    SELECT
        fs.order_id,
        dd.full_date AS order_date,
        dp.product_name,
        fs.quantity,
        fs.sales_amount
    FROM fact_sales fs
    JOIN dim_customer dc ON fs.customer_key = dc.customer_key
    JOIN dim_date dd ON fs.date_key = dd.date_key
    JOIN dim_product dp ON fs.product_key = dp.product_key
    WHERE dc.customer_id = @customer_id
);

-- Usage
SELECT * FROM fn_get_customer_orders('C001');
```

## Analytical Queries

### Time Intelligence

```sql
-- Year-over-year comparison
WITH monthly_sales AS (
    SELECT
        dd.year,
        dd.month,
        SUM(fs.sales_amount) AS sales
    FROM fact_sales fs
    JOIN dim_date dd ON fs.date_key = dd.date_key
    GROUP BY dd.year, dd.month
)
SELECT
    curr.year,
    curr.month,
    curr.sales AS current_year_sales,
    prev.sales AS prior_year_sales,
    curr.sales - prev.sales AS yoy_change,
    CASE WHEN prev.sales = 0 THEN NULL
         ELSE (curr.sales - prev.sales) / prev.sales * 100
    END AS yoy_pct_change
FROM monthly_sales curr
LEFT JOIN monthly_sales prev
    ON curr.year = prev.year + 1
    AND curr.month = prev.month
ORDER BY curr.year, curr.month;
```

### Running Totals and Moving Averages

```sql
-- Running totals and 3-month moving average
SELECT
    dd.year,
    dd.month,
    SUM(fs.sales_amount) AS monthly_sales,
    SUM(SUM(fs.sales_amount)) OVER (
        PARTITION BY dd.year
        ORDER BY dd.month
        ROWS UNBOUNDED PRECEDING
    ) AS ytd_sales,
    AVG(SUM(fs.sales_amount)) OVER (
        ORDER BY dd.year, dd.month
        ROWS BETWEEN 2 PRECEDING AND CURRENT ROW
    ) AS moving_avg_3m
FROM fact_sales fs
JOIN dim_date dd ON fs.date_key = dd.date_key
GROUP BY dd.year, dd.month
ORDER BY dd.year, dd.month;
```

### Customer Segmentation (RFM)

```sql
-- RFM Analysis
WITH customer_rfm AS (
    SELECT
        dc.customer_id,
        dc.customer_name,
        DATEDIFF(day, MAX(dd.full_date), GETDATE()) AS recency_days,
        COUNT(DISTINCT fs.order_id) AS frequency,
        SUM(fs.sales_amount) AS monetary
    FROM fact_sales fs
    JOIN dim_customer dc ON fs.customer_key = dc.customer_key
    JOIN dim_date dd ON fs.date_key = dd.date_key
    GROUP BY dc.customer_id, dc.customer_name
),
rfm_scores AS (
    SELECT
        customer_id,
        customer_name,
        recency_days,
        frequency,
        monetary,
        NTILE(5) OVER (ORDER BY recency_days DESC) AS r_score,
        NTILE(5) OVER (ORDER BY frequency) AS f_score,
        NTILE(5) OVER (ORDER BY monetary) AS m_score
    FROM customer_rfm
)
SELECT
    customer_id,
    customer_name,
    recency_days,
    frequency,
    monetary,
    r_score,
    f_score,
    m_score,
    CONCAT(r_score, f_score, m_score) AS rfm_segment,
    CASE
        WHEN r_score >= 4 AND f_score >= 4 AND m_score >= 4 THEN 'Champions'
        WHEN r_score >= 4 AND f_score >= 3 THEN 'Loyal Customers'
        WHEN r_score >= 3 AND f_score >= 1 AND m_score >= 3 THEN 'Potential Loyalists'
        WHEN r_score >= 4 AND f_score <= 2 THEN 'New Customers'
        WHEN r_score <= 2 AND f_score >= 3 THEN 'At Risk'
        WHEN r_score <= 2 AND f_score <= 2 THEN 'Lost'
        ELSE 'Others'
    END AS customer_segment
FROM rfm_scores
ORDER BY monetary DESC;
```

## Cross-Database Queries

```sql
-- Query across Warehouse and Lakehouse
SELECT
    w.customer_name,
    w.segment,
    l.recent_web_visits,
    l.avg_session_duration,
    w.total_purchases
FROM warehouse.dbo.customer_summary w
JOIN lakehouse.dbo.web_analytics l
    ON w.customer_id = l.customer_id;
```

The Fabric Data Warehouse provides enterprise SQL analytics without infrastructure management. Tomorrow, I will cover Synapse Real-Time Analytics for streaming workloads.

## Resources

- [Warehouse in Fabric](https://learn.microsoft.com/en-us/fabric/data-warehouse/)
- [T-SQL Reference](https://learn.microsoft.com/en-us/fabric/data-warehouse/tsql-surface-area)
- [Data Warehouse Tutorial](https://learn.microsoft.com/en-us/fabric/data-warehouse/tutorial-introduction)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
