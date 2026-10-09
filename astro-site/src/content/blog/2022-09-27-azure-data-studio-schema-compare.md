---
title: "Schema Compare in Azure Data Studio"
description: "Schema Compare is essential for maintaining database consistency across environments."
author: "Michael John Peña"
draft: false
date: 2022-09-27
tags: ["Azure", "Azure Data Studio", "Schema Compare", "Database"]
---

## Using Schema Compare

### Starting a Comparison

```bash
# Open Schema Compare
# Command Palette (Ctrl+Shift+P) > "Schema Compare: New Schema Comparison"

# Or right-click on a database in Object Explorer
# Select "Schema Compare"
```

### Comparison Sources

Schema Compare supports comparing between:
- Database to Database
- Database to DACPAC
- DACPAC to DACPAC
- Database to Project
- Project to Database

```sql
-- Example: Compare Dev to Production
-- Source: DevDB on dev-server
-- Target: ProdDB on prod-server

-- Schema Compare will show:
-- + Objects in source but not in target (will be added)
-- - Objects in target but not in source (will be dropped)
-- ≠ Objects that differ between source and target
```

### Understanding Comparison Results

```sql
-- Objects shown with differences:

-- Table difference example
-- Source (Dev):
CREATE TABLE dbo.Customers (
    CustomerID INT PRIMARY KEY,
    CustomerName NVARCHAR(100),
    Email NVARCHAR(256),
    Phone NVARCHAR(20),
    CreatedDate DATETIME2 DEFAULT GETUTCDATE(),
    IsActive BIT DEFAULT 1  -- New column in Dev
);

-- Target (Prod):
CREATE TABLE dbo.Customers (
    CustomerID INT PRIMARY KEY,
    CustomerName NVARCHAR(100),
    Email NVARCHAR(256),
    Phone NVARCHAR(20),
    CreatedDate DATETIME2 DEFAULT GETUTCDATE()
    -- Missing IsActive column
);

-- Schema Compare shows ALTER statement needed:
ALTER TABLE dbo.Customers ADD IsActive BIT DEFAULT 1;
```

### Comparison Options

```json
// Schema Compare Options
{
    "Include": {
        "Tables": true,
        "Views": true,
        "StoredProcedures": true,
        "Functions": true,
        "Triggers": true,
        "Indexes": true,
        "Constraints": true,
        "Schemas": true,
        "Users": false,
        "Roles": false,
        "Permissions": false
    },
    "Exclude": {
        "ExtendedProperties": true,
        "DatabaseOptions": true
    },
    "General": {
        "IgnoreWhitespace": true,
        "IgnoreComments": true,
        "IgnoreColumnCollation": false,
        "IgnoreIndexOptions": false,
        "IgnoreTableOptions": false
    }
}
```

### Generating Update Scripts

```sql
-- After comparison, click "Generate Script"
-- This creates the deployment script

-- Sample generated script:
PRINT N'Creating [dbo].[NewTable]...';
GO
CREATE TABLE [dbo].[NewTable] (
    [ID] INT IDENTITY(1,1) NOT NULL,
    [Name] NVARCHAR(100) NOT NULL,
    [CreatedDate] DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT [PK_NewTable] PRIMARY KEY CLUSTERED ([ID])
);
GO

PRINT N'Altering [dbo].[Customers]...';
GO
ALTER TABLE [dbo].[Customers]
    ADD [IsActive] BIT NOT NULL DEFAULT 1;
GO

PRINT N'Altering [dbo].[sp_GetCustomers]...';
GO
ALTER PROCEDURE [dbo].[sp_GetCustomers]
    @IncludeInactive BIT = 0
AS
BEGIN
    SELECT CustomerID, CustomerName, Email, Phone, IsActive
    FROM dbo.Customers
    WHERE @IncludeInactive = 1 OR IsActive = 1;
END;
GO

PRINT N'Update complete.';
GO
```

### Programmatic Schema Compare

```csharp
using Microsoft.SqlServer.Dac;
using Microsoft.SqlServer.Dac.Compare;

public class SchemaCompareService
{
    public async Task<SchemaComparisonResult> CompareSchemaAsync(
        string sourceConnectionString,
        string targetConnectionString)
    {
        var sourceEndpoint = new SchemaCompareDatabaseEndpoint(sourceConnectionString);
        var targetEndpoint = new SchemaCompareDatabaseEndpoint(targetConnectionString);

        var comparison = new SchemaComparison(sourceEndpoint, targetEndpoint);

        // Configure options
        comparison.Options.IgnoreWhitespace = true;
        comparison.Options.IgnoreComments = true;
        comparison.Options.IgnoreExtendedProperties = true;

        // Exclude certain object types
        comparison.Options.ExcludeObjectTypes.Add(ObjectType.Users);
        comparison.Options.ExcludeObjectTypes.Add(ObjectType.Roles);
        comparison.Options.ExcludeObjectTypes.Add(ObjectType.Permissions);

        // Run comparison
        var result = comparison.Compare();

        return result;
    }

    public async Task<string> GenerateUpdateScriptAsync(SchemaComparisonResult result)
    {
        if (!result.IsValid)
        {
            throw new InvalidOperationException("Comparison result is not valid");
        }

        // Generate the update script
        var script = result.GenerateScript();
        return script;
    }

    public async Task ApplyChangesAsync(
        SchemaComparisonResult result,
        CancellationToken cancellationToken = default)
    {
        if (!result.IsValid)
        {
            throw new InvalidOperationException("Comparison result is not valid");
        }

        // Apply changes
        var publishResult = result.PublishChangesToTarget(cancellationToken);

        if (!publishResult.Success)
        {
            throw new Exception($"Publish failed: {publishResult.Errors.FirstOrDefault()?.Message}");
        }
    }
}

// Compare with DACPAC
public class DacpacCompareService
{
    public SchemaComparisonResult CompareDacpacToDatabase(
        string dacpacPath,
        string targetConnectionString)
    {
        var sourceEndpoint = new SchemaCompareDacpacEndpoint(dacpacPath);
        var targetEndpoint = new SchemaCompareDatabaseEndpoint(targetConnectionString);

        var comparison = new SchemaComparison(sourceEndpoint, targetEndpoint);
        return comparison.Compare();
    }

    public void SaveComparisonToFile(SchemaComparison comparison, string filePath)
    {
        comparison.SaveToFile(filePath, true);
    }

    public SchemaComparison LoadComparisonFromFile(string filePath)
    {
        return SchemaComparison.Load(filePath);
    }
}
```

### Selective Updates

```sql
-- In Schema Compare UI, you can:
-- - Include/Exclude individual objects
-- - Group by schema or object type
-- - Review each change before applying

-- For selective deployment, modify the generated script:

-- Only deploy specific changes
PRINT N'Selective deployment - Tables only';
GO

-- Include this table
CREATE TABLE [dbo].[NewTable] (...);
GO

-- Skip this table (commented out)
-- CREATE TABLE [dbo].[AnotherTable] (...);
-- GO

-- Include this alteration
ALTER TABLE [dbo].[Customers] ADD [IsActive] BIT;
GO
```

### Comparing Across Environments

```powershell
# PowerShell script for environment comparison
param(
    [string]$DevServer = "dev-server.database.windows.net",
    [string]$TestServer = "test-server.database.windows.net",
    [string]$ProdServer = "prod-server.database.windows.net",
    [string]$Database = "MyDatabase"
)

# Compare Dev to Test
Write-Host "Comparing Dev to Test..."
SqlPackage /Action:Script `
    /SourceConnectionString:"Server=$DevServer;Database=$Database;..." `
    /TargetConnectionString:"Server=$TestServer;Database=$Database;..." `
    /OutputPath:"DevToTest.sql"

# Compare Test to Prod
Write-Host "Comparing Test to Prod..."
SqlPackage /Action:Script `
    /SourceConnectionString:"Server=$TestServer;Database=$Database;..." `
    /TargetConnectionString:"Server=$ProdServer;Database=$Database;..." `
    /OutputPath:"TestToProd.sql"

Write-Host "Comparison complete. Review generated scripts."
```

## Best Practices

1. **Compare regularly** - Catch drift early
2. **Review all changes** - Before applying updates
3. **Backup first** - Always backup target before sync
4. **Use in CI/CD** - Automate schema validation
5. **Exclude wisely** - Know what to include/exclude

Schema Compare is essential for maintaining database consistency across environments.
