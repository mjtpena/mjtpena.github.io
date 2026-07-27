---
title: Azure Synapse Dedicated SQL Pools for Enterprise Data Warehousing
author: Michael John Pena
draft: false
date: 2021-03-09
url: /blog/azure-synapse-dedicated-sql-pools/
tags:
  - Azure
  - Synapse
  - SQL
  - Data Warehouse
  - Analytics

---

I wrote "2021-03-09-azure-synapse-dedicated-sql-pools" to share practical, production-minded guidance on this topic.

## Understanding MPP Architecture

Dedicated SQL pools distribute data across 60 distributions for parallel processing:
- **Control node**: Orchestrates queries and manages metadata
- **Compute nodes**: Execute queries in parallel
- **Distributions**: Data partitions spread across compute nodes

## Creating a Dedicated SQL Pool

```bash
# Create Synapse workspace first
az synapse workspace create \
    --name mysynapseworkspace \
    --resource-group myResourceGroup \
    --storage-account mystorageaccount \
    --file-system synapse-fs \
    --sql-admin-login-user sqladmin \
    --sql-admin-login-password 'ComplexPassword123!' \
    --location eastus

# Create dedicated SQL pool
az synapse sql pool create \
    --name mydedicatedpool \
    --workspace-name mysynapseworkspace \
    --resource-group myResourceGroup \
    --performance-level DW100c
```

## Table Distribution Strategies

### Hash Distribution

Best for large fact tables with high cardinality columns:

```sql
-- Hash distributed fact table
CREATE TABLE dbo.FactSales
(
    SalesKey BIGINT NOT NULL,
    DateKey INT NOT NULL,
    ProductKey INT NOT NULL,
    CustomerKey INT NOT NULL,
    StoreKey INT NOT NULL,
    Quantity INT,
    UnitPrice DECIMAL(18,2),
    TotalAmount DECIMAL(18,2),
    DiscountAmount DECIMAL(18,2)
)
WITH
(
    DISTRIBUTION = HASH(CustomerKey),
    CLUSTERED COLUMNSTORE INDEX,
    PARTITION (DateKey RANGE RIGHT FOR VALUES
        (20210101, 20210201, 20210301, 20210401, 20210501, 20210601,
         20210701, 20210801, 20210901, 20211001, 20211101, 20211201))
);
```

### Replicated Tables

Best for small dimension tables frequently joined:

```sql
-- Replicated dimension table
CREATE TABLE dbo.DimProduct
(
    ProductKey INT NOT NULL,
    ProductName NVARCHAR(100),
    Category NVARCHAR(50),
    SubCategory NVARCHAR(50),
    Brand NVARCHAR(50),
    Color NVARCHAR(20),
    Size NVARCHAR(10),
    UnitCost DECIMAL(18,2),
    UnitPrice DECIMAL(18,2)
)
WITH
(
    DISTRIBUTION = REPLICATE,
    CLUSTERED COLUMNSTORE INDEX
);

-- Customer dimension
CREATE TABLE dbo.DimCustomer
(
    CustomerKey INT NOT NULL,
    CustomerName NVARCHAR(100),
    Email NVARCHAR(255),
    Phone NVARCHAR(20),
    Address NVARCHAR(200),
    City NVARCHAR(50),
    State NVARCHAR(50),
    Country NVARCHAR(50),
    Segment NVARCHAR(20)
)
WITH
(
    DISTRIBUTION = REPLICATE,
    CLUSTERED COLUMNSTORE INDEX
);
```

### Round-Robin Distribution

Best for staging tables or when no clear distribution key:

```sql
-- Staging table with round-robin
CREATE TABLE staging.SalesStaging
(
    TransactionId NVARCHAR(50),
    TransactionDate DATETIME,
    ProductId NVARCHAR(20),
    CustomerId NVARCHAR(20),
    Quantity INT,
    Amount DECIMAL(18,2)
)
WITH
(
    DISTRIBUTION = ROUND_ROBIN,
    HEAP
);
```

## Loading Data with COPY Command

```sql
-- Load from Azure Data Lake using COPY
COPY INTO staging.SalesStaging
FROM 'https://mystorageaccount.dfs.core.windows.net/data/sales/*.parquet'
WITH (
    FILE_TYPE = 'PARQUET',
    CREDENTIAL = (IDENTITY = 'Managed Identity')
);

-- Load CSV files
COPY INTO staging.SalesStaging
FROM 'https://mystorageaccount.blob.core.windows.net/data/sales/'
WITH (
    FILE_TYPE = 'CSV',
    FIELDTERMINATOR = ',',
    ROWTERMINATOR = '\n',
    FIRSTROW = 2,
    CREDENTIAL = (IDENTITY = 'Shared Access Signature', SECRET = '<sas-token>')
);

-- Transform and load into fact table
INSERT INTO dbo.FactSales
SELECT
    ROW_NUMBER() OVER (ORDER BY s.TransactionDate) AS SalesKey,
    CONVERT(INT, FORMAT(s.TransactionDate, 'yyyyMMdd')) AS DateKey,
    COALESCE(p.ProductKey, -1) AS ProductKey,
    COALESCE(c.CustomerKey, -1) AS CustomerKey,
    -1 AS StoreKey,
    s.Quantity,
    s.Amount / NULLIF(s.Quantity, 0) AS UnitPrice,
    s.Amount AS TotalAmount,
    0 AS DiscountAmount
FROM staging.SalesStaging s
LEFT JOIN dbo.DimProduct p ON s.ProductId = p.ProductId
LEFT JOIN dbo.DimCustomer c ON s.CustomerId = c.CustomerId;

-- Clean up staging
TRUNCATE TABLE staging.SalesStaging;
```

## Query Optimization

### Statistics Management

```sql
-- Create statistics on key columns
CREATE STATISTICS stat_DateKey ON dbo.FactSales(DateKey);
CREATE STATISTICS stat_CustomerKey ON dbo.FactSales(CustomerKey);
CREATE STATISTICS stat_ProductKey ON dbo.FactSales(ProductKey);

-- Update statistics
UPDATE STATISTICS dbo.FactSales;

-- Auto-create statistics (recommended)
ALTER DATABASE myDatabase
SET AUTO_CREATE_STATISTICS ON;
```

### Result Set Caching

```sql
-- Enable result set caching
ALTER DATABASE myDatabase
SET RESULT_SET_CACHING ON;

-- Check cache usage
SELECT
    request_id,
    command,
    result_set_cache
FROM sys.dm_pdw_exec_requests
WHERE result_set_cache = 1
ORDER BY start_time DESC;
```

### Materialized Views

```sql
-- Create materialized view for common aggregations
CREATE MATERIALIZED VIEW dbo.vw_MonthlySalesByProduct
WITH (DISTRIBUTION = HASH(ProductKey))
AS
SELECT
    p.Category,
    p.SubCategory,
    p.ProductKey,
    p.ProductName,
    YEAR(d.DateKey) AS SalesYear,
    MONTH(d.DateKey) AS SalesMonth,
    SUM(f.Quantity) AS TotalQuantity,
    SUM(f.TotalAmount) AS TotalRevenue,
    COUNT_BIG(*) AS TransactionCount
FROM dbo.FactSales f
JOIN dbo.DimProduct p ON f.ProductKey = p.ProductKey
JOIN dbo.DimDate d ON f.DateKey = d.DateKey
GROUP BY
    p.Category, p.SubCategory, p.ProductKey, p.ProductName,
    YEAR(d.DateKey), MONTH(d.DateKey);

-- Query uses materialized view automatically
SELECT
    Category,
    SalesYear,
    SalesMonth,
    SUM(TotalRevenue) AS Revenue
FROM dbo.vw_MonthlySalesByProduct
WHERE SalesYear = 2021
GROUP BY Category, SalesYear, SalesMonth
ORDER BY Category, SalesYear, SalesMonth;
```

## Workload Management

```sql
-- Create workload classifier for reporting users
CREATE WORKLOAD CLASSIFIER ReportingUsers
WITH (
    WORKLOAD_GROUP = 'LargeQueries',
    MEMBERNAME = 'ReportingRole',
    IMPORTANCE = Normal
);

-- Create workload group with resource allocation
CREATE WORKLOAD GROUP LargeQueries
WITH (
    MIN_PERCENTAGE_RESOURCE = 20,
    CAP_PERCENTAGE_RESOURCE = 40,
    REQUEST_MIN_RESOURCE_GRANT_PERCENT = 10,
    REQUEST_MAX_RESOURCE_GRANT_PERCENT = 25
);

-- Monitor workload
SELECT
    wg.name AS workload_group,
    wc.name AS workload_classifier,
    r.request_id,
    r.status,
    r.importance,
    r.start_time,
    r.total_elapsed_time
FROM sys.dm_pdw_exec_requests r
JOIN sys.workload_management_workload_classifiers wc
    ON r.classifier_name = wc.name
JOIN sys.workload_management_workload_groups wg
    ON wc.group_name = wg.name
ORDER BY r.start_time DESC;
```

## Pause and Scale

```bash
# Pause to save costs (no compute charges when paused)
az synapse sql pool pause \
    --name mydedicatedpool \
    --workspace-name mysynapseworkspace \
    --resource-group myResourceGroup

# Resume when needed
az synapse sql pool resume \
    --name mydedicatedpool \
    --workspace-name mysynapseworkspace \
    --resource-group myResourceGroup

# Scale up for heavy workloads
az synapse sql pool update \
    --name mydedicatedpool \
    --workspace-name mysynapseworkspace \
    --resource-group myResourceGroup \
    --performance-level DW500c

# Scale down for cost optimization
az synapse sql pool update \
    --name mydedicatedpool \
    --workspace-name mysynapseworkspace \
    --resource-group myResourceGroup \
    --performance-level DW100c
```

## Monitoring Queries

```sql
-- Find long-running queries
SELECT
    request_id,
    submit_time,
    start_time,
    end_time,
    total_elapsed_time / 1000 AS elapsed_seconds,
    status,
    command
FROM sys.dm_pdw_exec_requests
WHERE status = 'Running'
   OR total_elapsed_time > 60000
ORDER BY total_elapsed_time DESC;

-- Analyze query execution steps
SELECT
    request_id,
    step_index,
    operation_type,
    distribution_type,
    location_type,
    status,
    total_elapsed_time,
    row_count,
    command
FROM sys.dm_pdw_request_steps
WHERE request_id = '<request_id>'
ORDER BY step_index;

-- Check data movement
SELECT
    request_id,
    step_index,
    operation_type,
    total_elapsed_time,
    row_count
FROM sys.dm_pdw_request_steps
WHERE operation_type LIKE '%Move%'
ORDER BY total_elapsed_time DESC;
```

## Conclusion

Azure Synapse dedicated SQL pools provide enterprise-grade data warehousing capabilities:

- **MPP architecture** for massive scale and performance
- **Flexible distribution** strategies for optimized joins
- **Advanced features** like materialized views and result caching
- **Cost management** through pause/resume and scaling

Key success factors:
1. Choose appropriate distribution keys based on join patterns
2. Use replicated tables for small dimensions
3. Leverage materialized views for common aggregations
4. Monitor and optimize data movement operations
5. Scale dynamically based on workload demands

