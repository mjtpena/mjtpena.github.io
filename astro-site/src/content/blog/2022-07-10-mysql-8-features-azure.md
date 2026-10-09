---
title: "Leveraging MySQL 8.0 Features on Azure"
description: "MySQL 8.0 features significantly enhance your application capabilities on Azure Database for MySQL Flexible Server."
author: "Michael John Peña"
draft: false
date: 2022-07-10
tags: ["Azure", "MySQL", "MySQL 8.0", "Database", "SQL"]
---

## Window Functions

MySQL 8.0 introduced window functions for advanced analytics:

```sql
-- Ranking orders by amount within each customer
SELECT
    customer_id,
    order_id,
    order_date,
    amount,
    ROW_NUMBER() OVER (PARTITION BY customer_id ORDER BY amount DESC) as rank_by_amount,
    SUM(amount) OVER (PARTITION BY customer_id) as customer_total,
    amount / SUM(amount) OVER (PARTITION BY customer_id) * 100 as percent_of_total
FROM orders;

-- Running totals and moving averages
SELECT
    order_date,
    amount,
    SUM(amount) OVER (ORDER BY order_date) as running_total,
    AVG(amount) OVER (ORDER BY order_date ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) as moving_avg_7day
FROM daily_sales;
```

## Common Table Expressions (CTEs)

```sql
-- Recursive CTE for hierarchical data
WITH RECURSIVE category_tree AS (
    -- Base case: root categories
    SELECT id, name, parent_id, 0 as level, CAST(name AS CHAR(1000)) as path
    FROM categories
    WHERE parent_id IS NULL

    UNION ALL

    -- Recursive case: child categories
    SELECT c.id, c.name, c.parent_id, ct.level + 1,
           CONCAT(ct.path, ' > ', c.name)
    FROM categories c
    JOIN category_tree ct ON c.parent_id = ct.id
)
SELECT * FROM category_tree ORDER BY path;

-- Non-recursive CTE for readability
WITH monthly_sales AS (
    SELECT
        DATE_FORMAT(order_date, '%Y-%m') as month,
        SUM(amount) as total_sales
    FROM orders
    GROUP BY DATE_FORMAT(order_date, '%Y-%m')
),
monthly_growth AS (
    SELECT
        month,
        total_sales,
        LAG(total_sales) OVER (ORDER BY month) as prev_month_sales
    FROM monthly_sales
)
SELECT
    month,
    total_sales,
    prev_month_sales,
    ROUND((total_sales - prev_month_sales) / prev_month_sales * 100, 2) as growth_percent
FROM monthly_growth;
```

## JSON Enhancements

```sql
-- Create table with JSON column
CREATE TABLE products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255),
    attributes JSON,
    INDEX idx_brand ((CAST(attributes->>'$.brand' AS CHAR(50))))
);

-- Insert JSON data
INSERT INTO products (name, attributes) VALUES
('Laptop', '{"brand": "Dell", "specs": {"ram": "16GB", "storage": "512GB SSD"}, "tags": ["electronics", "computers"]}'),
('Phone', '{"brand": "Apple", "specs": {"storage": "256GB"}, "tags": ["electronics", "mobile"]}');

-- Query JSON data
SELECT
    name,
    attributes->>'$.brand' as brand,
    attributes->>'$.specs.ram' as ram,
    JSON_CONTAINS(attributes->'$.tags', '"electronics"') as is_electronics
FROM products
WHERE attributes->>'$.brand' = 'Dell';

-- JSON table functions
SELECT
    p.name,
    tag.value as tag
FROM products p,
JSON_TABLE(p.attributes, '$.tags[*]' COLUMNS (value VARCHAR(50) PATH '$')) as tag;
```

## Invisible Indexes

```sql
-- Create an invisible index
CREATE INDEX idx_email ON users(email) INVISIBLE;

-- Test query performance without the index
EXPLAIN SELECT * FROM users WHERE email = 'test@example.com';

-- Make the index visible if it helps
ALTER TABLE users ALTER INDEX idx_email VISIBLE;
```

## Descending Indexes

```sql
-- Create a composite index with descending order
CREATE INDEX idx_orders_date_amount ON orders(order_date DESC, amount DESC);

-- This query benefits from the descending index
SELECT * FROM orders
ORDER BY order_date DESC, amount DESC
LIMIT 100;
```

## Atomic DDL

```sql
-- DDL operations are now atomic
CREATE TABLE new_table (
    id INT PRIMARY KEY,
    data VARCHAR(255)
);

-- If this fails, no partial changes remain
ALTER TABLE new_table
    ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    ADD INDEX idx_created (created_at);
```

## Resource Groups (Performance Tuning)

```sql
-- Create a resource group for batch processing
CREATE RESOURCE GROUP batch_processing
    TYPE = USER
    VCPU = 2-3
    THREAD_PRIORITY = 10;

-- Assign a connection to the resource group
SET RESOURCE GROUP batch_processing;
```

MySQL 8.0 features significantly enhance your application capabilities on Azure Database for MySQL Flexible Server.
