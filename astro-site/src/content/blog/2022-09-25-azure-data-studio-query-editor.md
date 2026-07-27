---
title: "Mastering the Query Editor in Azure Data Studio"
author: "Michael John Peña"
draft: false
date: 2022-09-25
tags: ["Azure", "Azure Data Studio", "SQL", "Query Editor"]

---

I wrote "Mastering the Query Editor in Azure Data Studio" to share practical, production-minded guidance on this topic.

## Query Editor Features

### IntelliSense and Auto-Completion

```sql
-- IntelliSense provides intelligent suggestions
-- Type table name and press Ctrl+Space for column suggestions

SELECT
    c.  -- Ctrl+Space shows CustomerID, CustomerName, Email, etc.
FROM dbo.Customers c

-- IntelliSense also suggests:
-- - Keywords (SELECT, WHERE, JOIN)
-- - Functions (GETDATE(), COUNT(), SUM())
-- - Stored procedures
-- - Views
```

### Code Formatting

```sql
-- Before formatting (messy code)
select customerid,customername,email,phone from dbo.customers c inner join dbo.orders o on c.customerid=o.customerid where o.orderdate>'2022-01-01' order by customername

-- After formatting (Shift+Alt+F)
SELECT
    customerid,
    customername,
    email,
    phone
FROM dbo.customers c
INNER JOIN dbo.orders o ON c.customerid = o.customerid
WHERE o.orderdate > '2022-01-01'
ORDER BY customername;
```

### Format Settings

```json
// Customize SQL formatting in settings.json
{
    "sql.format.keywordCasing": "upper",
    "sql.format.datatypeCasing": "lower",
    "sql.format.identifierCasing": "lower",
    "sql.format.placeCommasBeforeNextStatement": true,
    "sql.format.alignColumnDefinitionsInColumns": true,
    "sql.format.indentationSize": 4,
    "sql.format.placeSelectStatementReferencesOnNewLine": true
}
```

### Multi-Cursor Editing

```sql
-- Hold Alt and click to add multiple cursors
-- Or Ctrl+Alt+Down/Up to add cursor on adjacent lines

-- Example: Add quotes to multiple values
-- Before:
INSERT INTO dbo.Status (StatusName) VALUES
(Active),
(Pending),
(Completed),
(Cancelled);

-- Select all status names with multi-cursor
-- Type quotes around each simultaneously

-- After:
INSERT INTO dbo.Status (StatusName) VALUES
('Active'),
('Pending'),
('Completed'),
('Cancelled');
```

### Find and Replace with Regex

```sql
-- Ctrl+H opens Find and Replace
-- Enable regex mode with .* button

-- Example: Convert legacy JOIN syntax to ANSI
-- Find: FROM (\w+) (\w+), (\w+) (\w+)\s+WHERE \2\.(\w+) = \4\.(\w+)
-- Replace: FROM $1 $2\nJOIN $3 $4 ON $2.$5 = $4.$6\nWHERE

-- Before:
SELECT * FROM Customers c, Orders o
WHERE c.CustomerID = o.CustomerID
AND o.OrderDate > '2022-01-01';

-- After:
SELECT * FROM Customers c
JOIN Orders o ON c.CustomerID = o.CustomerID
WHERE o.OrderDate > '2022-01-01';
```

### Query Results Grid

```sql
-- Execute query
SELECT
    CustomerID,
    CustomerName,
    Email,
    TotalOrders,
    TotalSpent
FROM dbo.vw_CustomerSummary
ORDER BY TotalSpent DESC;

-- Results grid features:
-- - Click column header to sort
-- - Drag columns to reorder
-- - Right-click for options:
--   - Copy (Ctrl+C)
--   - Copy with Headers (Ctrl+Shift+C)
--   - Select All (Ctrl+A)
--   - Save as CSV/JSON/Excel
--   - Chart visualization
```

### Query History

```sql
-- Access via View > Query History
-- Or Ctrl+H with Query History extension

-- History shows:
-- - Query text
-- - Execution time
-- - Row count
-- - Connection used

-- Click to re-run or copy to editor
```

### Execution Plan Analysis

```sql
-- Enable actual execution plan
-- Ctrl+M or click "Include Actual Plan" button

SELECT
    c.CustomerName,
    COUNT(o.OrderID) AS OrderCount,
    SUM(o.TotalAmount) AS TotalSpent
FROM dbo.Customers c
LEFT JOIN dbo.Orders o ON c.CustomerID = o.CustomerID
WHERE c.Status = 'Active'
GROUP BY c.CustomerName
HAVING SUM(o.TotalAmount) > 1000
ORDER BY TotalSpent DESC;

-- Execution plan shows:
-- - Operators (Scan, Seek, Sort, Join)
-- - Estimated vs Actual rows
-- - Cost percentages
-- - Missing index suggestions
-- - Warnings (implicit conversions, spills)
```

### Working with Variables

```sql
-- Declare and use variables
DECLARE @StartDate DATE = '2022-01-01';
DECLARE @EndDate DATE = '2022-12-31';
DECLARE @MinAmount DECIMAL(18,2) = 100.00;

-- Use in query
SELECT
    OrderID,
    CustomerID,
    OrderDate,
    TotalAmount
FROM dbo.Orders
WHERE OrderDate BETWEEN @StartDate AND @EndDate
  AND TotalAmount >= @MinAmount;

-- PRINT for debugging
PRINT 'Start Date: ' + CONVERT(VARCHAR, @StartDate, 120);
PRINT 'End Date: ' + CONVERT(VARCHAR, @EndDate, 120);
PRINT 'Min Amount: ' + CAST(@MinAmount AS VARCHAR);
```

### Batch Execution

```sql
-- Use GO to separate batches
-- Each batch executes independently

-- Batch 1: Create table
CREATE TABLE #TempResults (
    ID INT,
    Value NVARCHAR(100)
);
GO

-- Batch 2: Insert data
INSERT INTO #TempResults VALUES (1, 'First');
INSERT INTO #TempResults VALUES (2, 'Second');
GO

-- Batch 3: Query results
SELECT * FROM #TempResults;
GO

-- Batch 4: Cleanup
DROP TABLE #TempResults;
GO

-- GO with count runs batch multiple times
INSERT INTO dbo.TestData (Value)
VALUES (NEWID());
GO 1000  -- Inserts 1000 rows
```

### Query Shortcuts

```json
// Configure query shortcuts in settings
// Preferences > Settings > search "query shortcuts"
{
    "sql.query.shortcuts": {
        "ctrl+1": "SELECT TOP 100 * FROM ",
        "ctrl+2": "SELECT COUNT(*) FROM ",
        "ctrl+3": "sp_help ",
        "ctrl+4": "sp_helptext ",
        "ctrl+5": "SELECT * FROM sys.dm_exec_requests"
    }
}
```

### Saving and Loading Queries

```sql
-- Save query: Ctrl+S
-- Save as: Ctrl+Shift+S

-- Organize queries in folders:
/*
/Queries
├── /Maintenance
│   ├── IndexRebuild.sql
│   └── UpdateStats.sql
├── /Reports
│   ├── DailySales.sql
│   └── CustomerAnalysis.sql
└── /Troubleshooting
    ├── BlockingQueries.sql
    └── SlowQueries.sql
*/

-- Open recent: Ctrl+R
-- Quick open: Ctrl+P then type filename
```

### Connection Management

```sql
-- Change connection without closing editor
-- Ctrl+Shift+C or click connection in status bar

-- Execute against different databases
USE SalesDB;
GO
SELECT * FROM dbo.Orders;
GO

USE InventoryDB;
GO
SELECT * FROM dbo.Products;
GO

-- Three-part naming for cross-database
SELECT
    s.OrderID,
    p.ProductName
FROM SalesDB.dbo.OrderDetails s
JOIN InventoryDB.dbo.Products p ON s.ProductID = p.ProductID;
```

## Productivity Tips

1. **Use snippets** - Type prefixes like `sqlSelect` and press Tab
2. **Multiple cursors** - Alt+Click for editing multiple locations
3. **Format on save** - Enable auto-formatting in settings
4. **Learn shortcuts** - Invest time in keyboard shortcuts
5. **Use history** - Re-run queries from query history

The query editor in Azure Data Studio provides everything needed for efficient SQL development.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
