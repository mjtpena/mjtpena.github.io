---
title: "SQLCMD Mode in Azure Data Studio"
description: "SQLCMD mode transforms Azure Data Studio into a powerful deployment and scripting platform."
author: "Michael John Peña"
draft: false
date: 2022-09-29
tags: ["Azure", "Azure Data Studio", "SQLCMD", "Scripting"]
---

## Enabling SQLCMD Mode

### Activate SQLCMD Mode

```sql
-- Enable SQLCMD mode via status bar or command palette
-- Status bar: Click "SQLCMD Mode: Off" to toggle
-- Command Palette: "Toggle SQLCMD Mode"

-- Once enabled, SQLCMD commands work in the editor
```

### SQLCMD Variables

```sql
-- Define variables
:setvar DatabaseName "MyDatabase"
:setvar SchemaName "dbo"
:setvar TableName "Customers"
:setvar Environment "Development"

-- Use variables with $(VariableName) syntax
USE $(DatabaseName);
GO

SELECT * FROM $(SchemaName).$(TableName);
GO

PRINT 'Environment: $(Environment)';
GO
```

### Environment-Specific Scripts

```sql
-- Define environment-specific connection
:setvar ServerName "dev-server.database.windows.net"
:setvar DatabaseName "MyDatabase_Dev"

:connect $(ServerName)

USE $(DatabaseName);
GO

-- Run environment-specific logic
IF '$(Environment)' = 'Development'
BEGIN
    PRINT 'Running in Development mode';
    -- Enable verbose logging
    SET NOCOUNT OFF;
END
ELSE IF '$(Environment)' = 'Production'
BEGIN
    PRINT 'Running in Production mode';
    SET NOCOUNT ON;
END
GO
```

### Connection Commands

```sql
-- Connect to different servers within same script
:connect server1.database.windows.net
USE Database1;
SELECT 'Connected to Server 1';
GO

:connect server2.database.windows.net
USE Database2;
SELECT 'Connected to Server 2';
GO

-- Connect with specific credentials
:connect server1.database.windows.net -U adminuser -P password123
```

### File Operations

```sql
-- Execute external script file
:r "C:\Scripts\CreateTables.sql"
GO

:r "C:\Scripts\SeedData.sql"
GO

-- Output results to file
:out "C:\Output\QueryResults.txt"
SELECT * FROM dbo.Customers;
GO
:out stdout
```

### Error Handling

```sql
-- Stop on error
:on error exit

-- Continue on error
:on error ignore

-- Example with error handling
:on error exit

:setvar DatabaseName "MyDatabase"

USE $(DatabaseName);
GO

-- If this fails, script stops
CREATE TABLE dbo.NewTable (
    ID INT PRIMARY KEY,
    Name NVARCHAR(100)
);
GO

-- This won't run if above fails
INSERT INTO dbo.NewTable VALUES (1, 'Test');
GO
```

### Dynamic Schema Deployment

```sql
-- deployment.sql
:setvar Environment "$(Environment)"
:setvar SchemaVersion "2.0.0"

PRINT '=================================';
PRINT 'Deploying to $(Environment)';
PRINT 'Schema Version: $(SchemaVersion)';
PRINT '=================================';
GO

-- Check current version
IF NOT EXISTS (SELECT 1 FROM dbo.SchemaVersions WHERE Version = '1.0.0')
BEGIN
    RAISERROR('Prerequisite version 1.0.0 not found', 16, 1);
    RETURN;
END
GO

-- Environment-specific settings
:setvar ConnectionTimeout "30"
:setvar CommandTimeout "120"

IF '$(Environment)' = 'Production'
BEGIN
    :setvar ConnectionTimeout "60"
    :setvar CommandTimeout "300"
END
GO

-- Create new objects
:r ".\Tables\NewTable1.sql"
:r ".\Tables\NewTable2.sql"
:r ".\StoredProcedures\sp_NewProcedure.sql"
GO

-- Record deployment
INSERT INTO dbo.SchemaVersions (Version, DeployedBy, DeployedAt, Environment)
VALUES ('$(SchemaVersion)', SYSTEM_USER, GETUTCDATE(), '$(Environment)');
GO

PRINT 'Deployment complete!';
GO
```

### Multi-Database Operations

```sql
-- Compare row counts across databases
:setvar ProdServer "prod-server.database.windows.net"
:setvar TestServer "test-server.database.windows.net"
:setvar DatabaseName "MyDatabase"

-- Get production count
:connect $(ProdServer)
USE $(DatabaseName);
GO

SELECT 'Production' AS Environment, COUNT(*) AS CustomerCount
FROM dbo.Customers;
GO

-- Get test count
:connect $(TestServer)
USE $(DatabaseName);
GO

SELECT 'Test' AS Environment, COUNT(*) AS CustomerCount
FROM dbo.Customers;
GO
```

### Build Scripts

```sql
-- master_build.sql - Main deployment orchestrator
:setvar BuildDate "$(Date)"
:setvar BuildNumber "$(BuildNumber)"

PRINT 'Build: $(BuildNumber)';
PRINT 'Date: $(BuildDate)';
GO

-- Pre-deployment checks
:r ".\Scripts\PreDeployment\ValidateEnvironment.sql"
:r ".\Scripts\PreDeployment\BackupCheck.sql"
GO

-- Schema changes
:r ".\Schema\Tables\001_CreateNewTables.sql"
:r ".\Schema\Tables\002_AlterExistingTables.sql"
:r ".\Schema\Views\001_CreateViews.sql"
:r ".\Schema\StoredProcedures\001_CreateProcedures.sql"
GO

-- Data migrations
:r ".\Scripts\DataMigration\001_MigrateCustomerData.sql"
GO

-- Post-deployment
:r ".\Scripts\PostDeployment\UpdateStatistics.sql"
:r ".\Scripts\PostDeployment\RebuildIndexes.sql"
:r ".\Scripts\PostDeployment\RecordDeployment.sql"
GO

PRINT 'Build $(BuildNumber) completed successfully!';
GO
```

### Conditional Execution

```sql
-- Using SQLCMD variables for conditional logic
:setvar IncludeTestData "true"

IF '$(IncludeTestData)' = 'true'
BEGIN
    PRINT 'Including test data...';
    :r ".\Scripts\TestData\InsertTestData.sql"
END
GO

-- Feature flags
:setvar EnableNewFeature "false"

IF '$(EnableNewFeature)' = 'true'
BEGIN
    :r ".\Features\NewFeature\Schema.sql"
    :r ".\Features\NewFeature\Procedures.sql"
END
GO
```

### Running from Command Line

```bash
# Run SQLCMD script with variables
sqlcmd -S myserver.database.windows.net -d MyDatabase \
    -i deployment.sql \
    -v Environment="Production" \
    -v SchemaVersion="2.0.0" \
    -o deployment_log.txt

# Azure SQL with AAD auth
sqlcmd -S myserver.database.windows.net -d MyDatabase \
    -G -U user@company.com \
    -i deployment.sql \
    -v Environment="Development"
```

### Best Practices

```sql
-- 1. Always set variables at the start
:setvar DatabaseName "MyDatabase"
:setvar SchemaName "dbo"

-- 2. Use meaningful variable names
:setvar MaxRetryCount "3"
:setvar TimeoutSeconds "30"

-- 3. Include error handling
:on error exit

-- 4. Log important operations
PRINT 'Starting deployment at ' + CONVERT(VARCHAR, GETDATE(), 120);

-- 5. Use consistent file organization
:r ".\01_PreDeployment.sql"
:r ".\02_SchemaChanges.sql"
:r ".\03_DataMigration.sql"
:r ".\04_PostDeployment.sql"
```

SQLCMD mode transforms Azure Data Studio into a powerful deployment and scripting platform.
