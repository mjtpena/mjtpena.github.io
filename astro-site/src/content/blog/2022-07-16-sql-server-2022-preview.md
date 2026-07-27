---
title: "SQL Server 2022 Preview: Key Features for Developers"
author: "Michael John Peña"
draft: false
date: 2022-07-16
tags: ["SQL Server", "SQL Server 2022", "Database", "Azure", "Preview"]
---

SQL Server 2022 entered public preview in late 2021 and continued preview through 2022 with a feature set deliberately designed to bridge the gap between on-premises SQL Server and Azure SQL—the "most cloud-connected SQL Server ever" positioning from Microsoft isn't marketing hyperbole; it reflects genuine architectural investments in making on-premises SQL Server aware of and connected to Azure services. The headline features in preview: the Link feature (near-real-time replication to Azure SQL Managed Instance over the public internet, enabling cloud-connected disaster recovery without ExpressRoute); ledger tables (append-only tables with cryptographic verification of record immutability—bringing blockchain-like tamper evidence to SQL Server without the operational complexity of a blockchain); contained availability groups (instance-level objects—logins, SQL Agent jobs—replicated as part of the AG, eliminating the manual synchronisation work that made AG failovers operationally risky); and Azure Purview integration for data discovery and classification metadata. The Synapse Link for SQL Server 2022 integration (querying SQL Server data in Synapse Analytics without SSIS or ADF pipeline copying) was the feature I found most practically significant for the organisations I work with—eliminating the ETL pipeline for analytical queries against operational SQL Server data.

## Azure Synapse Link for SQL Server

Query SQL Server data directly from Azure Synapse without ETL:

```sql
-- Enable Azure Synapse Link
EXEC sp_configure 'azure_synapse_link_enabled', 1;
RECONFIGURE;

-- Create a link connection
CREATE EXTERNAL DATA SOURCE SynapseLink
WITH (
    TYPE = SYNAPSE,
    LOCATION = 'https://mysynapse.sql.azuresynapse.net',
    CREDENTIAL = SynapseCredential
);
```

## Ledger Tables for Data Integrity

Tamper-evident tables with cryptographic verification:

```sql
-- Create a ledger table
CREATE TABLE dbo.AuditedTransactions (
    TransactionId INT PRIMARY KEY,
    AccountNumber VARCHAR(50),
    Amount DECIMAL(18,2),
    TransactionDate DATETIME2
) WITH (
    SYSTEM_VERSIONING = ON,
    LEDGER = ON
);

-- Insert data - automatically creates cryptographic proof
INSERT INTO dbo.AuditedTransactions
VALUES (1, 'ACC001', 1000.00, GETDATE());

-- Verify ledger integrity
EXECUTE sp_verify_database_ledger;

-- Generate ledger digest for external verification
DECLARE @digest AS NVARCHAR(MAX);
EXECUTE sp_generate_database_ledger_digest @digest = @digest OUTPUT;
SELECT @digest;
```

## Query Store Hints

Optimize queries without changing application code:

```sql
-- View query hint options
SELECT * FROM sys.query_store_query_hints;

-- Apply a hint to a specific query
EXEC sp_query_store_set_hints
    @query_id = 12345,
    @query_hints = N'OPTION (MAXDOP 4, RECOMPILE)';

-- Clear hints for a query
EXEC sp_query_store_clear_hints @query_id = 12345;
```

## Parameter Sensitive Plan Optimization

Better plan selection for queries with varying parameter values:

```sql
-- Check if PSP optimization is enabled
SELECT name, value_in_use
FROM sys.configurations
WHERE name = 'parameter sensitive plan optimization';

-- View PSP variants
SELECT
    q.query_id,
    p.plan_id,
    p.is_psp_plan,
    p.psp_plan_type,
    qsrs.avg_duration
FROM sys.query_store_query q
JOIN sys.query_store_plan p ON q.query_id = p.query_id
JOIN sys.query_store_runtime_stats qsrs ON p.plan_id = qsrs.plan_id
WHERE p.is_psp_plan = 1;
```

## Enhanced JSON Support

Native JSON functions with better performance:

```sql
-- JSON_PATH_EXISTS function
SELECT JSON_PATH_EXISTS('{"name":"John","address":{"city":"Seattle"}}', '$.address.city');
-- Returns 1

-- JSON_OBJECT function for building JSON
SELECT JSON_OBJECT(
    'orderId': o.OrderId,
    'customer': o.CustomerName,
    'items': (
        SELECT JSON_ARRAYAGG(
            JSON_OBJECT('product': ProductName, 'qty': Quantity)
        )
        FROM OrderItems i WHERE i.OrderId = o.OrderId
    )
) AS OrderJson
FROM Orders o;

-- Improved JSON parsing
DECLARE @json NVARCHAR(MAX) = N'[
    {"id": 1, "name": "Product A", "price": 10.99},
    {"id": 2, "name": "Product B", "price": 20.99}
]';

SELECT * FROM OPENJSON(@json)
WITH (
    id INT '$.id',
    name NVARCHAR(100) '$.name',
    price DECIMAL(10,2) '$.price'
);
```

## Degree of Parallelism Feedback

Automatic DOP adjustment based on execution history:

```sql
-- Enable DOP feedback
ALTER DATABASE SCOPED CONFIGURATION SET DOP_FEEDBACK = ON;

-- View DOP feedback information
SELECT
    request_id,
    runtime_dop,
    dop_feedback_eligible,
    dop_feedback_provided
FROM sys.dm_exec_requests
WHERE session_id = @@SPID;
```

## T-SQL Enhancements

```sql
-- DATE_BUCKET function for time-series grouping
SELECT
    DATE_BUCKET(HOUR, 4, SaleDateTime) AS TimeBucket,
    SUM(Amount) AS TotalSales
FROM Sales
GROUP BY DATE_BUCKET(HOUR, 4, SaleDateTime);

-- GREATEST and LEAST functions
SELECT
    GREATEST(Price1, Price2, Price3) AS MaxPrice,
    LEAST(Price1, Price2, Price3) AS MinPrice
FROM Products;

-- STRING_SPLIT with ordinal
SELECT value, ordinal
FROM STRING_SPLIT('apple,banana,cherry', ',', 1);
```

## Object Storage Integration

```sql
-- Query Parquet files in Azure Blob Storage
SELECT *
FROM OPENROWSET(
    BULK 'https://mystorageaccount.blob.core.windows.net/container/data/*.parquet',
    FORMAT = 'PARQUET',
    CREDENTIAL = StorageCredential
) AS data;
```

SQL Server 2022 represents a significant evolution, bringing cloud-native capabilities to on-premises deployments while maintaining the reliability SQL Server is known for.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
