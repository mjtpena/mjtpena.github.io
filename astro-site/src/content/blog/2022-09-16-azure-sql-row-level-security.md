---
title: "Row-Level Security in Azure SQL Database"
description: "RLS uses security policies with predicate functions to filter rows transparently. Users see only the rows they're authorized to access without any…"
author: "Michael John Peña"
draft: false
date: 2022-09-16
tags: ["Azure", "SQL Database", "Security", "RLS"]
---

## Understanding Row-Level Security

RLS uses security policies with predicate functions to filter rows transparently. Users see only the rows they're authorized to access without any application code changes.

### Setting Up RLS

```sql
-- Create a multi-tenant table
CREATE TABLE dbo.Orders
(
    OrderID INT IDENTITY(1,1) PRIMARY KEY,
    TenantID INT NOT NULL,
    CustomerName NVARCHAR(100) NOT NULL,
    OrderDate DATE NOT NULL,
    TotalAmount DECIMAL(18, 2) NOT NULL,
    Status NVARCHAR(20) NOT NULL DEFAULT 'Pending'
);

-- Create an index for efficient filtering
CREATE INDEX IX_Orders_TenantID ON dbo.Orders(TenantID);

-- Insert sample data for multiple tenants
INSERT INTO dbo.Orders (TenantID, CustomerName, OrderDate, TotalAmount, Status)
VALUES
    (1, 'Acme Corp', '2022-09-01', 1500.00, 'Completed'),
    (1, 'Beta Inc', '2022-09-05', 2300.00, 'Pending'),
    (1, 'Gamma LLC', '2022-09-10', 750.00, 'Shipped'),
    (2, 'Delta Co', '2022-09-02', 4200.00, 'Completed'),
    (2, 'Epsilon Ltd', '2022-09-08', 1800.00, 'Pending'),
    (3, 'Zeta Industries', '2022-09-03', 3500.00, 'Completed'),
    (3, 'Eta Partners', '2022-09-12', 900.00, 'Processing');

-- Create a schema for security objects
CREATE SCHEMA Security;
GO

-- Create the filter predicate function
CREATE FUNCTION Security.fn_TenantAccessPredicate(@TenantID INT)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN SELECT 1 AS fn_result
WHERE
    @TenantID = CAST(SESSION_CONTEXT(N'TenantID') AS INT)
    OR IS_MEMBER('db_owner') = 1;  -- Allow admins to see all
GO

-- Create the security policy
CREATE SECURITY POLICY Security.TenantFilter
ADD FILTER PREDICATE Security.fn_TenantAccessPredicate(TenantID) ON dbo.Orders,
ADD BLOCK PREDICATE Security.fn_TenantAccessPredicate(TenantID) ON dbo.Orders AFTER INSERT,
ADD BLOCK PREDICATE Security.fn_TenantAccessPredicate(TenantID) ON dbo.Orders AFTER UPDATE
WITH (STATE = ON);
```

### Using RLS with Session Context

```csharp
using Microsoft.Data.SqlClient;

public class MultiTenantOrderService
{
    private readonly string _connectionString;

    public MultiTenantOrderService(string connectionString)
    {
        _connectionString = connectionString;
    }

    private async Task<SqlConnection> GetTenantConnectionAsync(int tenantId)
    {
        var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        // Set the tenant context for RLS
        using var cmd = new SqlCommand(
            "EXEC sp_set_session_context @key = N'TenantID', @value = @TenantID",
            connection);
        cmd.Parameters.AddWithValue("@TenantID", tenantId);
        await cmd.ExecuteNonQueryAsync();

        return connection;
    }

    public async Task<List<Order>> GetOrdersAsync(int tenantId)
    {
        using var connection = await GetTenantConnectionAsync(tenantId);

        // Query returns only rows for the tenant
        var sql = "SELECT OrderID, TenantID, CustomerName, OrderDate, TotalAmount, Status FROM dbo.Orders";

        using var command = new SqlCommand(sql, connection);
        var orders = new List<Order>();

        using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            orders.Add(new Order
            {
                OrderID = reader.GetInt32(0),
                TenantID = reader.GetInt32(1),
                CustomerName = reader.GetString(2),
                OrderDate = reader.GetDateTime(3),
                TotalAmount = reader.GetDecimal(4),
                Status = reader.GetString(5)
            });
        }

        return orders;
    }

    public async Task<int> CreateOrderAsync(int tenantId, Order order)
    {
        using var connection = await GetTenantConnectionAsync(tenantId);

        var sql = @"
            INSERT INTO dbo.Orders (TenantID, CustomerName, OrderDate, TotalAmount, Status)
            VALUES (@TenantID, @CustomerName, @OrderDate, @TotalAmount, @Status);
            SELECT SCOPE_IDENTITY();";

        using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@TenantID", tenantId);
        command.Parameters.AddWithValue("@CustomerName", order.CustomerName);
        command.Parameters.AddWithValue("@OrderDate", order.OrderDate);
        command.Parameters.AddWithValue("@TotalAmount", order.TotalAmount);
        command.Parameters.AddWithValue("@Status", order.Status);

        var result = await command.ExecuteScalarAsync();
        return Convert.ToInt32(result);
    }

    public async Task UpdateOrderStatusAsync(int tenantId, int orderId, string newStatus)
    {
        using var connection = await GetTenantConnectionAsync(tenantId);

        // Block predicate prevents updating other tenants' orders
        var sql = "UPDATE dbo.Orders SET Status = @Status WHERE OrderID = @OrderID";

        using var command = new SqlCommand(sql, connection);
        command.Parameters.AddWithValue("@Status", newStatus);
        command.Parameters.AddWithValue("@OrderID", orderId);

        await command.ExecuteNonQueryAsync();
    }
}

public class Order
{
    public int OrderID { get; set; }
    public int TenantID { get; set; }
    public string CustomerName { get; set; }
    public DateTime OrderDate { get; set; }
    public decimal TotalAmount { get; set; }
    public string Status { get; set; }
}
```

### Advanced RLS Patterns

```sql
-- Pattern 1: Role-based access with RLS
CREATE TABLE dbo.Documents
(
    DocumentID INT IDENTITY(1,1) PRIMARY KEY,
    Title NVARCHAR(200) NOT NULL,
    Content NVARCHAR(MAX),
    Classification NVARCHAR(50) NOT NULL, -- Public, Internal, Confidential, Secret
    DepartmentID INT NOT NULL,
    CreatedBy NVARCHAR(128) NOT NULL,
    CreatedDate DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);

CREATE FUNCTION Security.fn_DocumentAccessPredicate(
    @Classification NVARCHAR(50),
    @DepartmentID INT,
    @CreatedBy NVARCHAR(128))
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN SELECT 1 AS fn_result
WHERE
    -- Public documents visible to all
    @Classification = 'Public'
    -- Users see their own documents
    OR @CreatedBy = USER_NAME()
    -- Department members see department documents
    OR (
        @Classification IN ('Public', 'Internal')
        AND @DepartmentID = CAST(SESSION_CONTEXT(N'DepartmentID') AS INT)
    )
    -- Managers see confidential documents in their department
    OR (
        @Classification IN ('Public', 'Internal', 'Confidential')
        AND @DepartmentID = CAST(SESSION_CONTEXT(N'DepartmentID') AS INT)
        AND IS_MEMBER('Managers') = 1
    )
    -- Executives see all documents
    OR IS_MEMBER('Executives') = 1;
GO

-- Pattern 2: Time-based access
CREATE FUNCTION Security.fn_TimeBasedPredicate(@EffectiveDate DATE, @ExpirationDate DATE)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN SELECT 1 AS fn_result
WHERE
    GETDATE() BETWEEN @EffectiveDate AND ISNULL(@ExpirationDate, '9999-12-31')
    OR IS_MEMBER('db_owner') = 1;
GO

-- Pattern 3: Hierarchical access (manager sees team data)
CREATE TABLE dbo.EmployeeHierarchy
(
    EmployeeID INT PRIMARY KEY,
    ManagerID INT NULL REFERENCES dbo.EmployeeHierarchy(EmployeeID),
    UserName NVARCHAR(128) NOT NULL
);

CREATE FUNCTION Security.fn_HierarchyPredicate(@OwnerEmployeeID INT)
RETURNS TABLE
WITH SCHEMABINDING
AS
RETURN
    WITH EmployeeCTE AS (
        -- Current user's employee ID
        SELECT EmployeeID
        FROM dbo.EmployeeHierarchy
        WHERE UserName = USER_NAME()

        UNION ALL

        -- Direct reports recursively
        SELECT e.EmployeeID
        FROM dbo.EmployeeHierarchy e
        JOIN EmployeeCTE c ON e.ManagerID = c.EmployeeID
    )
    SELECT 1 AS fn_result
    WHERE @OwnerEmployeeID IN (SELECT EmployeeID FROM EmployeeCTE);
GO
```

### Managing RLS Policies

```csharp
public class RLSManagementService
{
    private readonly string _connectionString;

    public async Task<List<SecurityPolicy>> GetSecurityPoliciesAsync()
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var sql = @"
            SELECT
                p.name AS policy_name,
                SCHEMA_NAME(p.schema_id) AS schema_name,
                p.is_enabled,
                OBJECT_NAME(pr.target_object_id) AS target_table,
                OBJECT_NAME(pr.predicate_definition) AS predicate_function,
                pr.predicate_type_desc,
                pr.operation_desc
            FROM sys.security_policies p
            JOIN sys.security_predicates pr ON p.object_id = pr.object_id
            ORDER BY p.name";

        using var command = new SqlCommand(sql, connection);
        var policies = new List<SecurityPolicy>();

        using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            policies.Add(new SecurityPolicy
            {
                PolicyName = reader.GetString(0),
                SchemaName = reader.GetString(1),
                IsEnabled = reader.GetBoolean(2),
                TargetTable = reader.GetString(3),
                PredicateType = reader.GetString(5),
                Operation = reader.GetString(6)
            });
        }

        return policies;
    }

    public async Task EnablePolicyAsync(string schemaName, string policyName)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var sql = $"ALTER SECURITY POLICY [{schemaName}].[{policyName}] WITH (STATE = ON)";
        using var command = new SqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    public async Task DisablePolicyAsync(string schemaName, string policyName)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var sql = $"ALTER SECURITY POLICY [{schemaName}].[{policyName}] WITH (STATE = OFF)";
        using var command = new SqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}

public class SecurityPolicy
{
    public string PolicyName { get; set; }
    public string SchemaName { get; set; }
    public bool IsEnabled { get; set; }
    public string TargetTable { get; set; }
    public string PredicateType { get; set; }
    public string Operation { get; set; }
}
```

### Testing RLS

```sql
-- Test RLS behavior
-- Insert test as tenant 1
EXEC sp_set_session_context @key = N'TenantID', @value = 1;

-- Should see only tenant 1 orders
SELECT * FROM dbo.Orders;

-- Try to insert for different tenant (blocked by policy)
INSERT INTO dbo.Orders (TenantID, CustomerName, OrderDate, TotalAmount)
VALUES (2, 'Attempted', GETDATE(), 100.00);
-- Error: The attempted operation failed because the target object 'dbo.Orders'
-- has a block predicate that conflicts with this operation.

-- Switch to tenant 2
EXEC sp_set_session_context @key = N'TenantID', @value = 2;
SELECT * FROM dbo.Orders;  -- Only tenant 2 orders
```

## Best Practices

1. **Use SESSION_CONTEXT** - Pass tenant ID through session context
2. **Create indexes** - Index columns used in predicates
3. **Test thoroughly** - Verify isolation between tenants
4. **Combine with DDM** - Layer RLS with Dynamic Data Masking
5. **Monitor performance** - Predicates add overhead; optimize functions

Row-Level Security provides robust data isolation for multi-tenant applications without application-level complexity.
