---
title: "Notebooks in Azure Data Studio"
author: "Michael John Peña"
draft: false
date: 2022-09-23
tags: ["Azure", "Azure Data Studio", "Notebooks", "Documentation"]

---

I wrote "Notebooks in Azure Data Studio" to share practical, production-minded guidance on this topic.

## Creating and Using Notebooks

### Basic Notebook Structure

Notebooks consist of cells that can contain either code or markdown text. Code cells can execute SQL, Python, PowerShell, or other languages depending on the kernel selected.

```markdown
# Database Health Check Runbook

This notebook provides step-by-step instructions for checking database health.

## Prerequisites
- Access to the target SQL Server
- db_datareader permissions minimum

## Steps
Follow each section in order.
```

```sql
-- Code cell: Check database status
SELECT
    name,
    state_desc,
    recovery_model_desc,
    compatibility_level
FROM sys.databases
WHERE database_id > 4
ORDER BY name;
```

### SQL Kernel Notebooks

```sql
-- Cell 1: Database overview
SELECT
    DB_NAME() AS DatabaseName,
    @@VERSION AS SQLVersion,
    GETDATE() AS CurrentTime;
```

```markdown
## Storage Analysis
Check how much space is being used by each table.
```

```sql
-- Cell 2: Table sizes
SELECT
    SCHEMA_NAME(t.schema_id) AS SchemaName,
    t.name AS TableName,
    p.rows AS RowCount,
    SUM(a.total_pages) * 8 / 1024 AS TotalSpaceMB,
    SUM(a.used_pages) * 8 / 1024 AS UsedSpaceMB
FROM sys.tables t
INNER JOIN sys.indexes i ON t.object_id = i.object_id
INNER JOIN sys.partitions p ON i.object_id = p.object_id AND i.index_id = p.index_id
INNER JOIN sys.allocation_units a ON p.partition_id = a.container_id
GROUP BY t.schema_id, t.name, p.rows
ORDER BY SUM(a.total_pages) DESC;
```

### Python Kernel for Data Analysis

```python
# Cell 1: Import libraries and connect
import pandas as pd
import pyodbc
import matplotlib.pyplot as plt

connection_string = (
    "Driver={ODBC Driver 17 for SQL Server};"
    "Server=myserver.database.windows.net;"
    "Database=mydb;"
    "Authentication=ActiveDirectoryInteractive;"
)

conn = pyodbc.connect(connection_string)
print("Connected successfully!")
```

```python
# Cell 2: Query and visualize data
query = """
SELECT
    CAST(OrderDate AS DATE) AS OrderDate,
    COUNT(*) AS OrderCount,
    SUM(TotalAmount) AS Revenue
FROM dbo.Orders
WHERE OrderDate >= DATEADD(month, -3, GETDATE())
GROUP BY CAST(OrderDate AS DATE)
ORDER BY OrderDate
"""

df = pd.read_sql(query, conn)

# Create visualization
fig, axes = plt.subplots(2, 1, figsize=(12, 8))

# Order count over time
axes[0].plot(df['OrderDate'], df['OrderCount'], 'b-')
axes[0].set_title('Daily Order Count')
axes[0].set_xlabel('Date')
axes[0].set_ylabel('Orders')

# Revenue over time
axes[1].bar(df['OrderDate'], df['Revenue'], color='green', alpha=0.7)
axes[1].set_title('Daily Revenue')
axes[1].set_xlabel('Date')
axes[1].set_ylabel('Revenue ($)')

plt.tight_layout()
plt.show()
```

### Parameterized Notebooks

```markdown
# Parameterized Database Report

Enter parameters in the cell below before running.
```

```sql
-- Parameters cell (tag this cell as 'parameters')
DECLARE @StartDate DATE = '2022-09-01';
DECLARE @EndDate DATE = '2022-09-30';
DECLARE @MinAmount DECIMAL(18,2) = 100.00;
```

```sql
-- Analysis cell uses parameters
SELECT
    c.CustomerName,
    COUNT(o.OrderID) AS OrderCount,
    SUM(o.TotalAmount) AS TotalSpent,
    AVG(o.TotalAmount) AS AvgOrderValue
FROM dbo.Orders o
JOIN dbo.Customers c ON o.CustomerID = c.CustomerID
WHERE o.OrderDate BETWEEN @StartDate AND @EndDate
  AND o.TotalAmount >= @MinAmount
GROUP BY c.CustomerName
ORDER BY TotalSpent DESC;
```

### Troubleshooting Notebook Template

```markdown
# SQL Server Troubleshooting Runbook

## Issue: Slow Query Performance

Use this notebook to diagnose slow-running queries.

### Step 1: Identify Currently Running Queries
```

```sql
-- Find long-running queries
SELECT
    r.session_id,
    r.status,
    r.command,
    r.wait_type,
    r.wait_time / 1000.0 AS wait_seconds,
    r.cpu_time / 1000.0 AS cpu_seconds,
    r.total_elapsed_time / 1000.0 AS elapsed_seconds,
    r.reads,
    r.writes,
    r.logical_reads,
    t.text AS query_text,
    qp.query_plan
FROM sys.dm_exec_requests r
CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t
CROSS APPLY sys.dm_exec_query_plan(r.plan_handle) qp
WHERE r.session_id > 50
  AND r.total_elapsed_time > 5000  -- More than 5 seconds
ORDER BY r.total_elapsed_time DESC;
```

```markdown
### Step 2: Check for Blocking
```

```sql
-- Identify blocking chains
SELECT
    blocking.session_id AS blocking_session,
    blocked.session_id AS blocked_session,
    blocked.wait_type,
    blocked.wait_time / 1000.0 AS wait_seconds,
    bt.text AS blocking_query,
    wt.text AS blocked_query
FROM sys.dm_exec_requests blocked
JOIN sys.dm_exec_requests blocking ON blocked.blocking_session_id = blocking.session_id
CROSS APPLY sys.dm_exec_sql_text(blocked.sql_handle) wt
CROSS APPLY sys.dm_exec_sql_text(blocking.sql_handle) bt
WHERE blocked.blocking_session_id > 0;
```

```markdown
### Step 3: Check Index Usage
```

```sql
-- Missing indexes
SELECT TOP 10
    OBJECT_NAME(mid.object_id) AS TableName,
    migs.avg_user_impact * migs.user_seeks AS ImpactScore,
    mid.equality_columns,
    mid.inequality_columns,
    mid.included_columns,
    migs.user_seeks,
    migs.avg_user_impact
FROM sys.dm_db_missing_index_details mid
JOIN sys.dm_db_missing_index_groups mig ON mid.index_handle = mig.index_handle
JOIN sys.dm_db_missing_index_group_stats migs ON mig.index_group_handle = migs.group_handle
WHERE mid.database_id = DB_ID()
ORDER BY ImpactScore DESC;
```

### Creating Notebook Books (Collections)

```json
// toc.yml - Table of contents for a notebook book
- title: DBA Runbooks
  file: README.md
- title: Daily Checks
  file: 01-daily-checks.ipynb
- title: Performance Troubleshooting
  file: 02-performance.ipynb
- title: Backup Verification
  file: 03-backup-verify.ipynb
- title: Security Audit
  file: 04-security-audit.ipynb
```

### Sharing and Exporting

```bash
# Export notebook to different formats
# From command palette: "Export Notebook"

# Or use nbconvert (if Python installed)
jupyter nbconvert --to html my-notebook.ipynb
jupyter nbconvert --to pdf my-notebook.ipynb

# Share via Git
git add *.ipynb
git commit -m "Add database health check notebooks"
git push
```

### Scheduling Notebooks

```powershell
# Use Azure Automation or Task Scheduler to run notebooks
# Export notebook to SQL script first, then schedule

# PowerShell script to execute notebook
$notebookPath = "C:\Notebooks\daily-health-check.ipynb"
$connectionString = "Server=myserver;Database=mydb;Integrated Security=true"

# Using ads-cli (Azure Data Studio CLI)
azuredatastudio --run-notebook $notebookPath --connection $connectionString
```

## Best Practices

1. **Document extensively** - Use markdown to explain each step
2. **Make it runnable** - Ensure notebooks work end-to-end
3. **Use parameters** - Allow customization without editing
4. **Version control** - Track changes in Git
5. **Test regularly** - Validate notebooks still work

Notebooks transform how you document and share database knowledge.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
