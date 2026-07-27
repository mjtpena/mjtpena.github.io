---
title: "Dynamic Data Masking in Azure SQL Database"
author: "Michael John Peña"
draft: false
date: 2022-09-15
tags: ["Azure", "SQL Database", "Security", "Data Masking"]

---

I wrote "Dynamic Data Masking in Azure SQL Database" to share practical, production-minded guidance on this topic.

## Understanding Dynamic Data Masking

DDM is a policy-based security feature that hides sensitive data in query results. The data in the database is not modified, making it ideal for scenarios where you need to limit data exposure without changing application logic.

### Masking Functions

```sql
-- 1. Default masking - full masking of the value
-- Strings: XXXX or less
-- Numbers: 0
-- Dates: 01.01.1900 00:00:00
-- Binary: 0x00

ALTER TABLE dbo.Customers
ALTER COLUMN Email ADD MASKED WITH (FUNCTION = 'default()');

-- 2. Email masking - shows first letter and domain suffix
-- "john.doe@example.com" becomes "jXXX@XXXX.com"

ALTER TABLE dbo.Customers
ALTER COLUMN Email ADD MASKED WITH (FUNCTION = 'email()');

-- 3. Partial masking - custom prefix, suffix, and padding
-- partial(prefix, padding, suffix)

ALTER TABLE dbo.Customers
ALTER COLUMN Phone ADD MASKED WITH (FUNCTION = 'partial(0, "XXX-XXX-", 4)');
-- "555-123-4567" becomes "XXX-XXX-4567"

ALTER TABLE dbo.Customers
ALTER COLUMN CreditCard ADD MASKED WITH (FUNCTION = 'partial(0, "XXXX-XXXX-XXXX-", 4)');
-- "1234-5678-9012-3456" becomes "XXXX-XXXX-XXXX-3456"

-- 4. Random masking - random value within specified range
ALTER TABLE dbo.Employees
ALTER COLUMN Salary ADD MASKED WITH (FUNCTION = 'random(10000, 100000)');
```

### Creating Tables with Masking

```sql
-- Create table with masking policies defined inline
CREATE TABLE dbo.Customers
(
    CustomerID INT IDENTITY(1,1) PRIMARY KEY,
    FirstName NVARCHAR(50) NOT NULL,
    LastName NVARCHAR(50) NOT NULL,
    Email NVARCHAR(100) MASKED WITH (FUNCTION = 'email()') NOT NULL,
    Phone NVARCHAR(20) MASKED WITH (FUNCTION = 'partial(0, "XXX-XXX-", 4)'),
    SSN CHAR(11) MASKED WITH (FUNCTION = 'partial(0, "XXX-XX-", 4)'),
    CreditCard NVARCHAR(19) MASKED WITH (FUNCTION = 'partial(0, "XXXX-XXXX-XXXX-", 4)'),
    DateOfBirth DATE MASKED WITH (FUNCTION = 'default()'),
    AnnualIncome DECIMAL(18, 2) MASKED WITH (FUNCTION = 'random(20000, 200000)'),
    Address NVARCHAR(200) MASKED WITH (FUNCTION = 'default()'),
    CreatedDate DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);

-- Insert test data
INSERT INTO dbo.Customers (FirstName, LastName, Email, Phone, SSN, CreditCard, DateOfBirth, AnnualIncome, Address)
VALUES
    ('John', 'Doe', 'john.doe@example.com', '555-123-4567', '123-45-6789', '4111-1111-1111-1111', '1985-03-15', 75000.00, '123 Main St, Seattle, WA'),
    ('Jane', 'Smith', 'jane.smith@company.org', '555-987-6543', '987-65-4321', '5500-0000-0000-0004', '1990-07-22', 95000.00, '456 Oak Ave, Portland, OR');
```

### Permission Management

```sql
-- Create a user who cannot see unmasked data
CREATE USER DataAnalyst WITHOUT LOGIN;
GRANT SELECT ON dbo.Customers TO DataAnalyst;

-- Create a user with unmask permission
CREATE USER DataAdmin WITHOUT LOGIN;
GRANT SELECT ON dbo.Customers TO DataAdmin;
GRANT UNMASK TO DataAdmin;

-- Test as masked user
EXECUTE AS USER = 'DataAnalyst';
SELECT CustomerID, FirstName, LastName, Email, Phone, SSN, CreditCard
FROM dbo.Customers;
REVERT;

-- Results for DataAnalyst:
-- CustomerID | FirstName | LastName | Email           | Phone        | SSN         | CreditCard
-- 1          | John      | Doe      | jXXX@XXXX.com  | XXX-XXX-4567 | XXX-XX-6789 | XXXX-XXXX-XXXX-1111

-- Test as unmasked user
EXECUTE AS USER = 'DataAdmin';
SELECT CustomerID, FirstName, LastName, Email, Phone, SSN, CreditCard
FROM dbo.Customers;
REVERT;

-- Results for DataAdmin show actual values
```

### C# Implementation

```csharp
using Microsoft.Data.SqlClient;

public class DataMaskingService
{
    private readonly string _connectionString;

    public DataMaskingService(string connectionString)
    {
        _connectionString = connectionString;
    }

    public async Task<List<Customer>> GetCustomersAsync(string userContext)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        // Set user context for masking
        if (!string.IsNullOrEmpty(userContext))
        {
            using var contextCmd = new SqlCommand(
                $"EXECUTE AS USER = @UserContext", connection);
            contextCmd.Parameters.AddWithValue("@UserContext", userContext);
            await contextCmd.ExecuteNonQueryAsync();
        }

        try
        {
            var sql = @"
                SELECT CustomerID, FirstName, LastName, Email, Phone, SSN, CreditCard, DateOfBirth
                FROM dbo.Customers
                ORDER BY LastName, FirstName";

            using var command = new SqlCommand(sql, connection);
            var customers = new List<Customer>();

            using var reader = await command.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                customers.Add(new Customer
                {
                    CustomerID = reader.GetInt32(0),
                    FirstName = reader.GetString(1),
                    LastName = reader.GetString(2),
                    Email = reader.GetString(3),
                    Phone = reader.IsDBNull(4) ? null : reader.GetString(4),
                    SSN = reader.IsDBNull(5) ? null : reader.GetString(5),
                    CreditCard = reader.IsDBNull(6) ? null : reader.GetString(6),
                    DateOfBirth = reader.IsDBNull(7) ? null : reader.GetDateTime(7)
                });
            }

            return customers;
        }
        finally
        {
            if (!string.IsNullOrEmpty(userContext))
            {
                using var revertCmd = new SqlCommand("REVERT", connection);
                await revertCmd.ExecuteNonQueryAsync();
            }
        }
    }

    // Manage masking policies
    public async Task AddMaskingPolicyAsync(string tableName, string columnName, string maskFunction)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var sql = $@"
            ALTER TABLE {tableName}
            ALTER COLUMN {columnName} ADD MASKED WITH (FUNCTION = '{maskFunction}')";

        using var command = new SqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    public async Task RemoveMaskingPolicyAsync(string tableName, string columnName)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var sql = $@"
            ALTER TABLE {tableName}
            ALTER COLUMN {columnName} DROP MASKED";

        using var command = new SqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    public async Task<List<MaskedColumnInfo>> GetMaskedColumnsAsync()
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var sql = @"
            SELECT
                SCHEMA_NAME(t.schema_id) AS schema_name,
                t.name AS table_name,
                c.name AS column_name,
                mc.masking_function
            FROM sys.masked_columns mc
            JOIN sys.columns c ON mc.object_id = c.object_id AND mc.column_id = c.column_id
            JOIN sys.tables t ON c.object_id = t.object_id
            ORDER BY t.name, c.column_id";

        using var command = new SqlCommand(sql, connection);
        var columns = new List<MaskedColumnInfo>();

        using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            columns.Add(new MaskedColumnInfo
            {
                SchemaName = reader.GetString(0),
                TableName = reader.GetString(1),
                ColumnName = reader.GetString(2),
                MaskingFunction = reader.GetString(3)
            });
        }

        return columns;
    }

    public async Task GrantUnmaskPermissionAsync(string userName)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var sql = $"GRANT UNMASK TO [{userName}]";
        using var command = new SqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    public async Task RevokeUnmaskPermissionAsync(string userName)
    {
        using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync();

        var sql = $"REVOKE UNMASK FROM [{userName}]";
        using var command = new SqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }
}

public class Customer
{
    public int CustomerID { get; set; }
    public string FirstName { get; set; }
    public string LastName { get; set; }
    public string Email { get; set; }
    public string Phone { get; set; }
    public string SSN { get; set; }
    public string CreditCard { get; set; }
    public DateTime? DateOfBirth { get; set; }
}

public class MaskedColumnInfo
{
    public string SchemaName { get; set; }
    public string TableName { get; set; }
    public string ColumnName { get; set; }
    public string MaskingFunction { get; set; }
}
```

### Discovering Recommended Masks

```sql
-- Azure SQL can recommend columns that should be masked
SELECT
    schema_name(o.schema_id) AS schema_name,
    o.name AS table_name,
    c.name AS column_name,
    recommended_masking_function
FROM sys.dm_db_unmasked_columns c
JOIN sys.objects o ON c.object_id = o.object_id
WHERE c.recommended_masking_function IS NOT NULL;

-- Apply recommended masks
DECLARE @sql NVARCHAR(MAX) = '';

SELECT @sql = @sql + '
ALTER TABLE ' + QUOTENAME(schema_name(o.schema_id)) + '.' + QUOTENAME(o.name) +
' ALTER COLUMN ' + QUOTENAME(c.name) + ' ADD MASKED WITH (FUNCTION = ''' +
c.recommended_masking_function + ''');'
FROM sys.dm_db_unmasked_columns c
JOIN sys.objects o ON c.object_id = o.object_id
WHERE c.recommended_masking_function IS NOT NULL;

PRINT @sql;
-- EXEC sp_executesql @sql;  -- Uncomment to execute
```

## Best Practices

1. **Combine with RLS** - Use with Row-Level Security for comprehensive protection
2. **Audit unmask usage** - Track who has unmask permissions
3. **Use in development** - Mask production data copies for dev/test
4. **Regular review** - Periodically review masking policies
5. **Defense in depth** - DDM is one layer; combine with encryption

Dynamic Data Masking provides an easy way to limit sensitive data exposure without application changes.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
