---
title: "Intelligent Query Processing in Azure SQL: Automatic Performance Optimization"
author: "Michael John Peña"
draft: false
date: 2021-08-04
tags: ["Azure", "SQL", "Query Processing", "Performance", "Optimization"]

---

I wrote "Intelligent Query Processing in Azure SQL: Automatic Performance Optimization" to share practical, production-minded guidance on this topic.

## IQP Feature Overview

The IQP family includes:
- Adaptive Query Processing (Adaptive Joins, Memory Grant Feedback)
- Table Variable Deferred Compilation
- Batch Mode on Rowstore
- Scalar UDF Inlining
- Approximate Query Processing

## Enabling IQP Features

```sql
-- Enable all IQP features by setting compatibility level
ALTER DATABASE MyDatabase SET COMPATIBILITY_LEVEL = 150;

-- Verify compatibility level
SELECT name, compatibility_level
FROM sys.databases
WHERE name = 'MyDatabase';
```

## Adaptive Joins in Action

Adaptive joins choose between hash and nested loop joins at runtime based on actual row counts:

```sql
-- Query that benefits from adaptive joins
SELECT
    o.OrderID,
    o.OrderDate,
    c.CustomerName,
    p.ProductName
FROM Orders o
INNER JOIN Customers c ON o.CustomerID = c.CustomerID
INNER JOIN Products p ON o.ProductID = p.ProductID
WHERE o.OrderDate >= '2021-01-01';

-- Check if adaptive join was used
SELECT
    qp.query_plan,
    qs.execution_count,
    qs.total_elapsed_time / qs.execution_count AS avg_elapsed_time
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
WHERE qp.query_plan.exist('//RelOp[@PhysicalOp="Adaptive Join"]') = 1;
```

## Memory Grant Feedback

Memory grant feedback adjusts memory allocations based on actual usage:

```sql
-- Query with potential memory grant issues
SELECT
    CustomerID,
    STRING_AGG(OrderID, ',') AS Orders,
    SUM(TotalAmount) AS TotalSpent
FROM Orders
WHERE OrderDate >= DATEADD(YEAR, -1, GETDATE())
GROUP BY CustomerID
ORDER BY TotalSpent DESC;

-- Monitor memory grant feedback
SELECT
    q.query_id,
    p.plan_id,
    p.query_plan_hash,
    rs.avg_query_max_used_memory,
    rs.last_query_max_used_memory,
    p.is_memory_grant_feedback_adjusted
FROM sys.query_store_query q
JOIN sys.query_store_plan p ON q.query_id = p.query_id
JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
WHERE p.is_memory_grant_feedback_adjusted = 1;
```

## Table Variable Deferred Compilation

Prior to IQP, table variables always estimated 1 row. Deferred compilation uses actual cardinality:

```sql
-- Create procedure using table variable
CREATE OR ALTER PROCEDURE GetOrderSummary
    @StartDate DATE,
    @EndDate DATE
AS
BEGIN
    DECLARE @TempOrders TABLE (
        OrderID INT,
        CustomerID INT,
        TotalAmount DECIMAL(18,2)
    );

    -- Insert with actual row count now used for cardinality
    INSERT INTO @TempOrders
    SELECT OrderID, CustomerID, TotalAmount
    FROM Orders
    WHERE OrderDate BETWEEN @StartDate AND @EndDate;

    -- Join now uses accurate row estimate
    SELECT
        t.OrderID,
        c.CustomerName,
        t.TotalAmount
    FROM @TempOrders t
    INNER JOIN Customers c ON t.CustomerID = c.CustomerID;
END;
```

## Batch Mode on Rowstore

Batch mode processing, previously only for columnstore, now works on rowstore tables:

```sql
-- Analytical query benefiting from batch mode on rowstore
SELECT
    YEAR(OrderDate) AS OrderYear,
    MONTH(OrderDate) AS OrderMonth,
    CategoryID,
    COUNT(*) AS OrderCount,
    SUM(Quantity) AS TotalQuantity,
    AVG(UnitPrice) AS AvgPrice
FROM Orders o
JOIN OrderDetails od ON o.OrderID = od.OrderID
GROUP BY YEAR(OrderDate), MONTH(OrderDate), CategoryID
ORDER BY OrderYear, OrderMonth;

-- Verify batch mode usage
SELECT
    qs.execution_count,
    qs.total_worker_time,
    qp.query_plan
FROM sys.dm_exec_query_stats qs
CROSS APPLY sys.dm_exec_query_plan(qs.plan_handle) qp
WHERE qp.query_plan.exist('//RelOp[@EstimatedExecutionMode="Batch"]') = 1;
```

## Scalar UDF Inlining

Scalar UDFs are inlined into the calling query for better performance:

```sql
-- Create an inlineable scalar UDF
CREATE OR ALTER FUNCTION dbo.CalculateDiscount(
    @Price DECIMAL(18,2),
    @Quantity INT
)
RETURNS DECIMAL(18,2)
WITH INLINE = ON
AS
BEGIN
    RETURN CASE
        WHEN @Quantity >= 100 THEN @Price * 0.20
        WHEN @Quantity >= 50 THEN @Price * 0.10
        WHEN @Quantity >= 10 THEN @Price * 0.05
        ELSE 0
    END;
END;

-- Query using the inlined function
SELECT
    ProductID,
    UnitPrice,
    Quantity,
    dbo.CalculateDiscount(UnitPrice, Quantity) AS Discount,
    UnitPrice * Quantity - dbo.CalculateDiscount(UnitPrice, Quantity) AS FinalPrice
FROM OrderDetails;
```

## Approximate Query Processing

For large datasets where approximate results are acceptable:

```sql
-- Use APPROX_COUNT_DISTINCT for faster cardinality estimation
SELECT
    YEAR(OrderDate) AS OrderYear,
    APPROX_COUNT_DISTINCT(CustomerID) AS ApproxUniqueCustomers
FROM Orders
GROUP BY YEAR(OrderDate);

-- Compare with exact count
SELECT
    YEAR(OrderDate) AS OrderYear,
    COUNT(DISTINCT CustomerID) AS ExactUniqueCustomers
FROM Orders
GROUP BY YEAR(OrderDate);
```

## Monitoring IQP Effectiveness

```sql
-- Check IQP feature usage across queries
SELECT
    query_hash,
    COUNT(*) AS execution_count,
    AVG(total_elapsed_time) AS avg_duration,
    SUM(CASE WHEN adaptive_join_applied = 1 THEN 1 ELSE 0 END) AS adaptive_join_count,
    SUM(CASE WHEN memory_grant_feedback_applied = 1 THEN 1 ELSE 0 END) AS memory_feedback_count
FROM sys.dm_exec_query_stats_history
GROUP BY query_hash
ORDER BY execution_count DESC;
```

IQP represents a significant step toward self-tuning databases, reducing the manual effort required to optimize query performance while automatically adapting to changing data distributions and workload patterns.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
