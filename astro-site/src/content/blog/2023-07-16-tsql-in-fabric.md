---
title: "T-SQL in Fabric: Patterns and Best Practices"
description: "If you're coming to Fabric Warehouse from a SQL Server or Azure SQL Database background, the T-SQL compatibility is reassuring — CTEs, window functions…"
author: Michael John Peña
draft: false
date: 2023-07-16
tags:
  - Microsoft Fabric
  - T-SQL
  - Data Warehouse
  - SQL
---

If you're coming to Fabric Warehouse from a SQL Server or Azure SQL Database background, the T-SQL compatibility is reassuring — CTEs, window functions (ROW_NUMBER, RANK, LEAD, LAG), aggregations, CASE expressions, string functions, date functions, all work as expected. The areas to watch: some system views behave differently (DMVs in Fabric don't map 1:1 to SQL Server DMVs), linked server syntax doesn't apply (cross-database queries use three-part naming across Fabric items instead), and DML performance characteristics differ from row-store engines because the underlying format is columnar Delta Parquet. MERGE is supported in Fabric Warehouse for upsert patterns, which is important for incremental loading. I'll go through the patterns that work well and a few that need adjustment when you migrate SQL Server queries to Fabric Warehouse.

## T-SQL Surface Area in Fabric

```sql
-- Fabric supports most T-SQL features
-- Some differences from SQL Server:

supported_features = {
    "DDL": "CREATE, ALTER, DROP for tables, views, procedures",
    "DML": "SELECT, INSERT, UPDATE, DELETE, MERGE",
    "Aggregations": "All standard aggregate functions",
    "Window_functions": "Full support",
    "CTEs": "Common Table Expressions",
    "Temp_tables": "#temp tables supported",
    "Table_variables": "@table variables supported"
}

-- Not supported (as of July 2023):
-- IDENTITY columns
-- Triggers
-- User-defined functions (UDFs)
-- Cursors (use set-based operations)
-- OPENROWSET for external data
```

## Data Transformation Patterns

### Slowly Changing Dimension Type 2

```sql
-- SCD Type 2 pattern
CREATE PROCEDURE usp_merge_customer_scd2
AS
BEGIN
    DECLARE @today DATE = CAST(GETUTCDATE() AS DATE);

    -- Step 1: Close existing records that have changes
    UPDATE dim_customer
    SET
        is_current = 0,
        end_date = DATEADD(day, -1, @today),
        modified_date = GETUTCDATE()
    WHERE is_current = 1
        AND customer_id IN (
            SELECT s.customer_id
            FROM staging_customer s
            INNER JOIN dim_customer d ON s.customer_id = d.customer_id
            WHERE d.is_current = 1
                AND (
                    ISNULL(s.customer_name, '') <> ISNULL(d.customer_name, '')
                    OR ISNULL(s.email, '') <> ISNULL(d.email, '')
                    OR ISNULL(s.segment, '') <> ISNULL(d.segment, '')
                )
        );

    -- Step 2: Insert new versions of changed records
    INSERT INTO dim_customer (
        customer_key, customer_id, customer_name, email, segment,
        start_date, end_date, is_current, created_date, modified_date
    )
    SELECT
        (SELECT ISNULL(MAX(customer_key), 0) FROM dim_customer) +
            ROW_NUMBER() OVER (ORDER BY s.customer_id),
        s.customer_id,
        s.customer_name,
        s.email,
        s.segment,
        @today,
        '9999-12-31',
        1,
        GETUTCDATE(),
        GETUTCDATE()
    FROM staging_customer s
    INNER JOIN dim_customer d ON s.customer_id = d.customer_id
    WHERE d.is_current = 0
        AND d.end_date = DATEADD(day, -1, @today);

    -- Step 3: Insert new records (never seen before)
    INSERT INTO dim_customer (
        customer_key, customer_id, customer_name, email, segment,
        start_date, end_date, is_current, created_date, modified_date
    )
    SELECT
        (SELECT ISNULL(MAX(customer_key), 0) FROM dim_customer) +
            ROW_NUMBER() OVER (ORDER BY s.customer_id),
        s.customer_id,
        s.customer_name,
        s.email,
        s.segment,
        @today,
        '9999-12-31',
        1,
        GETUTCDATE(),
        GETUTCDATE()
    FROM staging_customer s
    WHERE NOT EXISTS (
        SELECT 1 FROM dim_customer d WHERE d.customer_id = s.customer_id
    );
END;
```

### MERGE Statement

```sql
-- MERGE for upsert operations
MERGE INTO dim_product AS target
USING staging_product AS source
ON target.product_id = source.product_id

WHEN MATCHED AND (
    target.product_name <> source.product_name OR
    target.category <> source.category OR
    target.unit_price <> source.unit_price
) THEN
    UPDATE SET
        product_name = source.product_name,
        category = source.category,
        unit_price = source.unit_price,
        modified_date = GETUTCDATE()

WHEN NOT MATCHED BY TARGET THEN
    INSERT (product_key, product_id, product_name, category, unit_price, created_date)
    VALUES (
        (SELECT ISNULL(MAX(product_key), 0) + 1 FROM dim_product),
        source.product_id,
        source.product_name,
        source.category,
        source.unit_price,
        GETUTCDATE()
    )

WHEN NOT MATCHED BY SOURCE THEN
    UPDATE SET is_active = 0, modified_date = GETUTCDATE();
```

## Analytical Query Patterns

### Rolling Aggregations

```sql
-- Rolling 7-day average
SELECT
    date_key,
    daily_sales,
    AVG(daily_sales) OVER (
        ORDER BY date_key
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) as rolling_7day_avg,
    SUM(daily_sales) OVER (
        ORDER BY date_key
        ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
    ) as rolling_7day_sum
FROM (
    SELECT
        date_key,
        SUM(total_amount) as daily_sales
    FROM fact_sales
    GROUP BY date_key
) daily
ORDER BY date_key;
```

### Year-over-Year Comparison

```sql
-- YoY comparison
WITH current_year AS (
    SELECT
        d.month_num,
        d.month_name,
        SUM(s.total_amount) as revenue
    FROM fact_sales s
    JOIN dim_date d ON s.date_key = d.date_key
    WHERE d.year_num = 2023
    GROUP BY d.month_num, d.month_name
),
prior_year AS (
    SELECT
        d.month_num,
        SUM(s.total_amount) as revenue
    FROM fact_sales s
    JOIN dim_date d ON s.date_key = d.date_key
    WHERE d.year_num = 2022
    GROUP BY d.month_num
)
SELECT
    cy.month_name,
    cy.revenue as revenue_2023,
    py.revenue as revenue_2022,
    cy.revenue - py.revenue as yoy_change,
    CASE
        WHEN py.revenue = 0 THEN NULL
        ELSE (cy.revenue - py.revenue) / py.revenue * 100
    END as yoy_percent_change
FROM current_year cy
LEFT JOIN prior_year py ON cy.month_num = py.month_num
ORDER BY cy.month_num;
```

### Cohort Analysis

```sql
-- Customer cohort analysis
WITH first_purchase AS (
    SELECT
        customer_key,
        MIN(date_key) as cohort_date_key
    FROM fact_sales
    GROUP BY customer_key
),
cohort_data AS (
    SELECT
        fp.cohort_date_key,
        s.date_key,
        s.customer_key,
        s.total_amount,
        -- Calculate months since first purchase
        DATEDIFF(month,
            CAST(CAST(fp.cohort_date_key AS VARCHAR) AS DATE),
            CAST(CAST(s.date_key AS VARCHAR) AS DATE)
        ) as months_since_first
    FROM fact_sales s
    JOIN first_purchase fp ON s.customer_key = fp.customer_key
)
SELECT
    LEFT(CAST(cohort_date_key AS VARCHAR), 6) as cohort_month,
    months_since_first,
    COUNT(DISTINCT customer_key) as customers,
    SUM(total_amount) as revenue
FROM cohort_data
GROUP BY cohort_date_key, months_since_first
ORDER BY cohort_date_key, months_since_first;
```

## Data Quality Patterns

### Validation Queries

```sql
-- Data quality checks
CREATE PROCEDURE usp_validate_fact_sales
AS
BEGIN
    DECLARE @errors TABLE (
        check_name NVARCHAR(100),
        error_count INT,
        sample_values NVARCHAR(MAX)
    );

    -- Check 1: Null keys
    INSERT INTO @errors
    SELECT
        'Null customer_key',
        COUNT(*),
        STRING_AGG(CAST(sales_key AS VARCHAR), ',')
    FROM fact_sales
    WHERE customer_key IS NULL;

    -- Check 2: Orphan records
    INSERT INTO @errors
    SELECT
        'Orphan customer records',
        COUNT(*),
        NULL
    FROM fact_sales s
    WHERE NOT EXISTS (
        SELECT 1 FROM dim_customer c WHERE c.customer_key = s.customer_key
    );

    -- Check 3: Negative amounts
    INSERT INTO @errors
    SELECT
        'Negative total_amount',
        COUNT(*),
        STRING_AGG(CAST(sales_key AS VARCHAR), ',')
    FROM fact_sales
    WHERE total_amount < 0;

    -- Check 4: Future dates
    INSERT INTO @errors
    SELECT
        'Future date_key',
        COUNT(*),
        NULL
    FROM fact_sales
    WHERE date_key > CONVERT(INT, FORMAT(GETDATE(), 'yyyyMMdd'));

    -- Return results
    SELECT * FROM @errors WHERE error_count > 0;

    -- Raise error if issues found
    IF EXISTS (SELECT 1 FROM @errors WHERE error_count > 0)
    BEGIN
        RAISERROR('Data quality issues detected', 16, 1);
    END
END;
```

### Deduplication

```sql
-- Find and remove duplicates
WITH duplicates AS (
    SELECT
        sales_key,
        ROW_NUMBER() OVER (
            PARTITION BY order_id, customer_key, product_key, date_key
            ORDER BY created_at DESC
        ) as rn
    FROM fact_sales
)
DELETE FROM fact_sales
WHERE sales_key IN (
    SELECT sales_key FROM duplicates WHERE rn > 1
);
```

## Performance Tips

```sql
-- 1. Use appropriate predicates
-- Good: Filter on partitioned/indexed columns
SELECT * FROM fact_sales WHERE date_key BETWEEN 20230101 AND 20230131;

-- 2. Avoid functions on columns in WHERE
-- Bad:
SELECT * FROM fact_sales WHERE YEAR(created_at) = 2023;
-- Good:
SELECT * FROM fact_sales
WHERE created_at >= '2023-01-01' AND created_at < '2024-01-01';

-- 3. Use EXISTS instead of IN for subqueries
-- Better performance for large datasets
SELECT * FROM dim_customer c
WHERE EXISTS (
    SELECT 1 FROM fact_sales s WHERE s.customer_key = c.customer_key
);

-- 4. Limit result sets during development
SELECT TOP 100 * FROM large_table;

-- 5. Use EXPLAIN to understand query plans
-- Check the Query Insights feature in Fabric portal
```

Tomorrow we'll explore cross-database queries in Fabric.

## Resources

- [T-SQL Surface Area in Fabric](https://learn.microsoft.com/en-us/fabric/data-warehouse/tsql-surface-area)
- [Query Performance](https://learn.microsoft.com/en-us/fabric/data-warehouse/query-insights)
- [T-SQL Reference](https://learn.microsoft.com/en-us/sql/t-sql/language-reference)
