---
title: "Cross-Database Queries in Fabric: Unified Data Access"
author: Michael John Peña
draft: false
date: 2023-07-17
tags:
  - Microsoft Fabric
  - SQL
  - Cross-Database
  - Data Integration

---

I wrote "Cross-Database Queries in Fabric: Unified Data Access" to share practical, production-minded guidance on this topic.

## Understanding Cross-Database Access

```sql
-- Fabric enables queries across:
-- 1. Lakehouse SQL endpoints
-- 2. Warehouses
-- 3. Shortcuts to external data

-- Naming convention:
-- [database_name].[schema].[object_name]

-- Examples:
-- sales_lakehouse.dbo.customers
-- analytics_warehouse.dbo.fact_sales
```

## Querying Lakehouse from Warehouse

```sql
-- In your Warehouse, query Lakehouse tables directly
-- Lakehouse tables appear as databases

-- Simple cross-database query
SELECT
    w.customer_key,
    w.customer_name,
    l.total_orders,
    l.total_spent
FROM warehouse.dbo.dim_customer w
INNER JOIN lakehouse.dbo.customer_summary l
    ON w.customer_id = l.customer_id;

-- Aggregation across databases
SELECT
    c.segment,
    COUNT(DISTINCT o.order_id) as order_count,
    SUM(o.total_amount) as total_revenue
FROM analytics_warehouse.dbo.dim_customer c
INNER JOIN sales_lakehouse.dbo.orders o
    ON c.customer_id = o.customer_id
WHERE o.order_date >= '2023-01-01'
GROUP BY c.segment;
```

## Setting Up Shortcuts for Cross-Workspace Access

```sql
-- Shortcuts allow access to data in other workspaces
-- Create shortcuts in your Lakehouse UI:
-- 1. Right-click Tables folder
-- 2. New shortcut > OneLake
-- 3. Select source workspace and Lakehouse
-- 4. Choose tables

-- Once created, access like local tables
SELECT * FROM my_lakehouse.dbo.shortcut_to_other_workspace_table;
```

## Cross-Database Query Patterns

### Pattern 1: Federated Reporting

```sql
-- Combine data from multiple domains for reporting
CREATE VIEW vw_enterprise_dashboard AS
SELECT
    'Sales' as domain,
    s.region,
    s.month,
    s.revenue,
    s.order_count
FROM sales_warehouse.dbo.monthly_metrics s

UNION ALL

SELECT
    'Marketing' as domain,
    m.region,
    m.month,
    m.campaign_spend as revenue,
    m.leads_generated as order_count
FROM marketing_lakehouse.dbo.campaign_metrics m

UNION ALL

SELECT
    'Finance' as domain,
    f.region,
    f.month,
    f.actual_revenue as revenue,
    f.invoice_count as order_count
FROM finance_warehouse.dbo.financial_summary f;
```

### Pattern 2: Master Data Lookup

```sql
-- Central master data with distributed transaction data
-- Master data in shared Lakehouse
-- Transaction data in domain-specific storage

SELECT
    t.transaction_id,
    t.transaction_date,
    t.amount,
    c.customer_name,
    c.segment,
    p.product_name,
    p.category
FROM sales_lakehouse.dbo.transactions t
INNER JOIN master_data_lakehouse.dbo.customers c
    ON t.customer_id = c.customer_id
INNER JOIN master_data_lakehouse.dbo.products p
    ON t.product_id = p.product_id;
```

### Pattern 3: Data Mesh Query

```sql
-- Each domain owns their data, consumers query across
-- Domain: Sales
SELECT
    customer_id,
    order_count,
    total_revenue,
    last_order_date
FROM sales_domain.dbo.customer_metrics;

-- Domain: Support
SELECT
    customer_id,
    ticket_count,
    avg_resolution_time,
    satisfaction_score
FROM support_domain.dbo.customer_support_metrics;

-- Consumer: 360 view combining domains
CREATE VIEW vw_customer_360 AS
SELECT
    s.customer_id,
    s.order_count,
    s.total_revenue,
    s.last_order_date,
    sp.ticket_count,
    sp.avg_resolution_time,
    sp.satisfaction_score,
    m.campaign_response_rate
FROM sales_domain.dbo.customer_metrics s
LEFT JOIN support_domain.dbo.customer_support_metrics sp
    ON s.customer_id = sp.customer_id
LEFT JOIN marketing_domain.dbo.customer_engagement m
    ON s.customer_id = m.customer_id;
```

### Pattern 4: Historical Analysis with Current Reference

```sql
-- Transaction data in Lakehouse (large volume)
-- Reference data in Warehouse (frequently updated)

SELECT
    DATE_TRUNC('month', t.transaction_date) as month,
    r.current_region_name,  -- Current reference value
    r.current_manager,
    SUM(t.amount) as total_amount,
    COUNT(*) as transaction_count
FROM transaction_lakehouse.dbo.historical_transactions t
INNER JOIN reference_warehouse.dbo.dim_region r
    ON t.region_code = r.region_code
WHERE t.transaction_date >= DATEADD(year, -2, GETDATE())
GROUP BY
    DATE_TRUNC('month', t.transaction_date),
    r.current_region_name,
    r.current_manager
ORDER BY month;
```

## Performance Considerations

```sql
-- Cross-database queries involve data movement
-- Optimize for performance:

-- 1. Filter early
-- Bad: Filter after join
SELECT * FROM warehouse.dbo.large_fact f
JOIN lakehouse.dbo.large_dim d ON f.key = d.key
WHERE f.date > '2023-01-01';

-- Better: Push filter to source
SELECT *
FROM (
    SELECT * FROM warehouse.dbo.large_fact WHERE date > '2023-01-01'
) f
JOIN lakehouse.dbo.large_dim d ON f.key = d.key;

-- 2. Select only needed columns
-- Reduces data transfer between databases
SELECT
    f.id,
    f.amount,
    d.name
FROM warehouse.dbo.facts f
JOIN lakehouse.dbo.dimensions d ON f.dim_key = d.key;

-- 3. Use materialized views where possible
-- Pre-join frequently combined data
CREATE TABLE materialized_combined AS
SELECT
    f.*,
    d.name,
    d.category
FROM warehouse.dbo.facts f
JOIN lakehouse.dbo.dimensions d ON f.dim_key = d.key;
```

## Security Considerations

```sql
-- Cross-database queries respect security boundaries
-- User needs access to ALL referenced databases

-- Access model:
-- 1. Workspace-level access grants database visibility
-- 2. Object-level permissions control read/write
-- 3. Row-level security applies per database

-- Check current permissions
SELECT
    database_name,
    permission_name,
    state_desc
FROM sys.database_permissions;

-- Grant cross-database access (Admin only)
-- Done through workspace sharing in Fabric portal
```

## Troubleshooting

```sql
-- Common issues and solutions:

-- Issue: "Database not found"
-- Solution: Verify database name, check workspace access

-- Issue: "Permission denied"
-- Solution: Request workspace access, check object permissions

-- Issue: Slow performance
-- Solution: Add filters, reduce columns, consider materialization

-- Check available databases
SELECT name FROM sys.databases;

-- Check tables in a database
SELECT
    TABLE_SCHEMA,
    TABLE_NAME
FROM lakehouse.INFORMATION_SCHEMA.TABLES;
```

Tomorrow we'll explore Query Insights for monitoring and optimization.

## Resources

- [Cross-Database Queries](https://learn.microsoft.com/en-us/fabric/data-warehouse/query-cross-database)
- [OneLake Shortcuts](https://learn.microsoft.com/en-us/fabric/onelake/onelake-shortcuts)
- [Security Model](https://learn.microsoft.com/en-us/fabric/data-warehouse/security)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
