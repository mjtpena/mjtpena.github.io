---
title: "Distributed Transactions in Azure SQL Managed Instance"
description: "Distributed transactions coordinate changes across multiple databases using the two-phase commit protocol. Managed Instance supports both cross-database and…"
author: "Michael John Peña"
draft: false
date: 2022-09-19
tags: ["Azure", "SQL Managed Instance", "Transactions", "DTC"]
---

## Understanding Distributed Transactions

Distributed transactions coordinate changes across multiple databases using the two-phase commit protocol. Managed Instance supports both cross-database and cross-instance transactions.

### Cross-Database Transactions

```sql
-- Cross-database transaction within the same instance
USE master;
GO

-- Create test databases
CREATE DATABASE SalesDB;
CREATE DATABASE InventoryDB;
GO

-- Create tables
USE SalesDB;
CREATE TABLE dbo.Orders (
    OrderID INT IDENTITY(1,1) PRIMARY KEY,
    CustomerName NVARCHAR(100),
    ProductID INT,
    Quantity INT,
    OrderDate DATETIME2 DEFAULT GETUTCDATE()
);
GO

USE InventoryDB;
CREATE TABLE dbo.Products (
    ProductID INT PRIMARY KEY,
    ProductName NVARCHAR(100),
    StockQuantity INT
);

INSERT INTO dbo.Products VALUES (1, 'Widget', 100);
GO

-- Cross-database transaction
USE SalesDB;
GO

BEGIN TRANSACTION;

-- Insert order
INSERT INTO dbo.Orders (CustomerName, ProductID, Quantity)
VALUES ('Acme Corp', 1, 10);

-- Update inventory in another database
UPDATE InventoryDB.dbo.Products
SET StockQuantity = StockQuantity - 10
WHERE ProductID = 1;

-- Verify stock is not negative
IF EXISTS (SELECT 1 FROM InventoryDB.dbo.Products WHERE ProductID = 1 AND StockQuantity < 0)
BEGIN
    ROLLBACK TRANSACTION;
    THROW 50001, 'Insufficient stock', 1;
END

COMMIT TRANSACTION;
```

### Cross-Instance Distributed Transactions

```csharp
using System.Transactions;
using Microsoft.Data.SqlClient;

public class DistributedTransactionService
{
    private readonly string _instance1ConnectionString;
    private readonly string _instance2ConnectionString;

    public DistributedTransactionService(string conn1, string conn2)
    {
        _instance1ConnectionString = conn1;
        _instance2ConnectionString = conn2;
    }

    public async Task ExecuteDistributedTransactionAsync(Order order)
    {
        // TransactionScope automatically promotes to distributed transaction
        // when multiple connections are used
        var options = new TransactionOptions
        {
            IsolationLevel = IsolationLevel.ReadCommitted,
            Timeout = TimeSpan.FromMinutes(5)
        };

        using var scope = new TransactionScope(
            TransactionScopeOption.Required,
            options,
            TransactionScopeAsyncFlowOption.Enabled);

        try
        {
            // Operation on Instance 1 (Orders)
            using (var conn1 = new SqlConnection(_instance1ConnectionString))
            {
                await conn1.OpenAsync();

                var insertCmd = new SqlCommand(@"
                    INSERT INTO dbo.Orders (CustomerID, TotalAmount, OrderDate)
                    VALUES (@CustomerID, @TotalAmount, @OrderDate);
                    SELECT SCOPE_IDENTITY();", conn1);

                insertCmd.Parameters.AddWithValue("@CustomerID", order.CustomerID);
                insertCmd.Parameters.AddWithValue("@TotalAmount", order.TotalAmount);
                insertCmd.Parameters.AddWithValue("@OrderDate", DateTime.UtcNow);

                order.OrderID = Convert.ToInt32(await insertCmd.ExecuteScalarAsync());
            }

            // Operation on Instance 2 (Payments)
            using (var conn2 = new SqlConnection(_instance2ConnectionString))
            {
                await conn2.OpenAsync();

                var paymentCmd = new SqlCommand(@"
                    INSERT INTO dbo.PaymentRecords (OrderID, Amount, PaymentDate, Status)
                    VALUES (@OrderID, @Amount, @PaymentDate, 'Pending')", conn2);

                paymentCmd.Parameters.AddWithValue("@OrderID", order.OrderID);
                paymentCmd.Parameters.AddWithValue("@Amount", order.TotalAmount);
                paymentCmd.Parameters.AddWithValue("@PaymentDate", DateTime.UtcNow);

                await paymentCmd.ExecuteNonQueryAsync();
            }

            // Both operations succeeded - commit
            scope.Complete();
        }
        catch (Exception)
        {
            // Transaction will automatically rollback
            throw;
        }
    }
}

public class Order
{
    public int OrderID { get; set; }
    public int CustomerID { get; set; }
    public decimal TotalAmount { get; set; }
}
```

### Linked Server Transactions

```sql
-- Create linked server to another Managed Instance
EXEC sp_addlinkedserver
    @server = N'MI_INVENTORY',
    @srvproduct = N'',
    @provider = N'MSOLEDBSQL',
    @datasrc = N'inventory-mi.public.eastus.database.windows.net',
    @catalog = N'InventoryDB';

-- Configure linked server security
EXEC sp_addlinkedsrvlogin
    @rmtsrvname = N'MI_INVENTORY',
    @useself = N'False',
    @locallogin = NULL,
    @rmtuser = N'linkeduser',
    @rmtpassword = N'StrongP@ssw0rd!';

-- Enable RPC and distributed transactions
EXEC sp_serveroption @server = N'MI_INVENTORY', @optname = 'rpc', @optvalue = 'true';
EXEC sp_serveroption @server = N'MI_INVENTORY', @optname = 'rpc out', @optvalue = 'true';

-- Distributed transaction with linked server
SET XACT_ABORT ON;

BEGIN DISTRIBUTED TRANSACTION;

-- Local operation
INSERT INTO dbo.Orders (CustomerName, ProductID, Quantity)
VALUES ('Beta Corp', 1, 5);

-- Remote operation via linked server
UPDATE MI_INVENTORY.InventoryDB.dbo.Products
SET StockQuantity = StockQuantity - 5
WHERE ProductID = 1;

COMMIT TRANSACTION;
```

### Monitoring Distributed Transactions

```sql
-- View active distributed transactions
SELECT
    dt.transaction_id,
    dt.name AS transaction_name,
    dt.transaction_begin_time,
    dt.transaction_type,
    dt.transaction_state,
    DATEDIFF(second, dt.transaction_begin_time, GETDATE()) AS duration_seconds
FROM sys.dm_tran_active_transactions dt
WHERE dt.transaction_type = 2;  -- Distributed transaction

-- View transaction locks
SELECT
    t.transaction_id,
    l.request_session_id,
    l.resource_type,
    l.resource_database_id,
    DB_NAME(l.resource_database_id) AS database_name,
    l.request_mode,
    l.request_status
FROM sys.dm_tran_locks l
JOIN sys.dm_tran_active_transactions t ON l.request_owner_id = t.transaction_id
WHERE t.transaction_type = 2;

-- Check DTC status
SELECT * FROM sys.dm_tran_distributed_transaction_stats;
```

### Handling Transaction Failures

```csharp
public class ResilientTransactionService
{
    private readonly string _conn1;
    private readonly string _conn2;
    private readonly ILogger _logger;

    public async Task<TransactionResult> ExecuteWithRetryAsync(
        Func<SqlConnection, SqlConnection, Task> operation,
        int maxRetries = 3)
    {
        var attempt = 0;
        var delay = TimeSpan.FromSeconds(1);

        while (true)
        {
            try
            {
                var options = new TransactionOptions
                {
                    IsolationLevel = IsolationLevel.ReadCommitted,
                    Timeout = TimeSpan.FromMinutes(2)
                };

                using var scope = new TransactionScope(
                    TransactionScopeOption.Required,
                    options,
                    TransactionScopeAsyncFlowOption.Enabled);

                using var conn1 = new SqlConnection(_conn1);
                using var conn2 = new SqlConnection(_conn2);

                await conn1.OpenAsync();
                await conn2.OpenAsync();

                await operation(conn1, conn2);

                scope.Complete();

                return new TransactionResult { Success = true };
            }
            catch (TransactionAbortedException ex)
            {
                attempt++;
                _logger.LogWarning(ex,
                    "Transaction aborted, attempt {Attempt} of {MaxRetries}",
                    attempt, maxRetries);

                if (attempt >= maxRetries)
                {
                    return new TransactionResult
                    {
                        Success = false,
                        Error = ex.Message
                    };
                }

                await Task.Delay(delay);
                delay = TimeSpan.FromSeconds(delay.TotalSeconds * 2);
            }
            catch (SqlException ex) when (IsTransientError(ex))
            {
                attempt++;
                _logger.LogWarning(ex,
                    "Transient SQL error, attempt {Attempt} of {MaxRetries}",
                    attempt, maxRetries);

                if (attempt >= maxRetries)
                {
                    return new TransactionResult
                    {
                        Success = false,
                        Error = ex.Message
                    };
                }

                await Task.Delay(delay);
                delay = TimeSpan.FromSeconds(delay.TotalSeconds * 2);
            }
        }
    }

    private static bool IsTransientError(SqlException ex)
    {
        int[] transientErrors = { 1205, 3960, 41302, 41305, 41325, 41839 };
        return transientErrors.Contains(ex.Number);
    }
}

public class TransactionResult
{
    public bool Success { get; set; }
    public string Error { get; set; }
}
```

### Best Practices

```sql
-- Always use XACT_ABORT for distributed transactions
SET XACT_ABORT ON;

-- Keep transactions short
BEGIN DISTRIBUTED TRANSACTION;
    -- Minimal operations only
COMMIT;

-- Use appropriate isolation levels
SET TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- Handle deadlocks
BEGIN TRY
    BEGIN DISTRIBUTED TRANSACTION;
        -- Operations
    COMMIT;
END TRY
BEGIN CATCH
    IF XACT_STATE() <> 0
        ROLLBACK;

    IF ERROR_NUMBER() = 1205  -- Deadlock
    BEGIN
        WAITFOR DELAY '00:00:01';
        -- Retry logic
    END
    ELSE
        THROW;
END CATCH
```

## Considerations

1. **Performance overhead** - Distributed transactions have higher latency
2. **Network reliability** - Depends on network connectivity between instances
3. **Timeout configuration** - Set appropriate transaction timeouts
4. **Isolation level** - Choose carefully for your consistency needs
5. **Error handling** - Implement robust retry and compensation logic

Distributed transactions in Azure SQL Managed Instance enable enterprise-grade data consistency across complex architectures.
