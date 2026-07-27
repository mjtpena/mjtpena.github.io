---
title: "Essential Azure Data Studio Extensions"
author: "Michael John Peña"
draft: false
date: 2022-09-24
tags: ["Azure", "Azure Data Studio", "Extensions", "Productivity"]

---

I wrote "Essential Azure Data Studio Extensions" to share practical, production-minded guidance on this topic.

## Top Extensions

### Admin Pack for SQL Server

```bash
# Install via Extensions marketplace
# Search: "Admin Pack for SQL Server"

# Features:
# - SQL Server Agent management
# - SQL Profiler
# - Server Reports
# - Import/Export wizard
```

```sql
-- With Admin Pack, you can run Agent jobs directly
-- Right-click on SQL Server Agent > Jobs > Start Job

-- View server reports for quick insights
-- Right-click database > Reports
```

### Schema Compare

```bash
# Install: "Schema Compare" extension

# Features:
# - Compare database schemas
# - Generate deployment scripts
# - Sync schemas between environments
```

```typescript
// Schema compare workflow
// 1. Open command palette (Ctrl+Shift+P)
// 2. Search "Schema Compare: New Schema Comparison"
// 3. Select source and target
// 4. Run comparison
// 5. Generate update script or apply changes
```

### DACPAC Extension

```bash
# Enables working with Data-tier Applications

# Extract DACPAC from database
# Right-click database > Data-tier Application Wizard > Extract

# Deploy DACPAC to database
# Right-click Databases > Data-tier Application Wizard > Deploy
```

### SQL Database Projects

```bash
# Install: "SQL Database Projects" extension

# Create a new database project
# File > New Project > SQL Database Project
```

```sql
-- Project structure
/*
MyDatabaseProject/
├── dbo/
│   ├── Tables/
│   │   ├── Customers.sql
│   │   └── Orders.sql
│   ├── Views/
│   │   └── vw_CustomerOrders.sql
│   ├── Stored Procedures/
│   │   └── sp_GetCustomerOrders.sql
│   └── Functions/
│       └── fn_CalculateTotal.sql
├── Security/
│   ├── Roles/
│   └── Users/
├── MyDatabaseProject.sqlproj
└── .gitignore
*/
```

```xml
<!-- Sample .sqlproj file -->
<?xml version="1.0" encoding="utf-8"?>
<Project DefaultTargets="Build" ToolsVersion="4.0">
  <PropertyGroup>
    <Name>MyDatabaseProject</Name>
    <DSP>Microsoft.Data.Tools.Schema.Sql.SqlAzureV12DatabaseSchemaProvider</DSP>
    <ModelCollation>1033, CI</ModelCollation>
  </PropertyGroup>
  <ItemGroup>
    <Build Include="dbo\Tables\Customers.sql" />
    <Build Include="dbo\Tables\Orders.sql" />
    <Build Include="dbo\Stored Procedures\sp_GetCustomerOrders.sql" />
  </ItemGroup>
</Project>
```

### PostgreSQL Extension

```bash
# Install: "PostgreSQL" extension

# Connect to PostgreSQL databases
# Azure Database for PostgreSQL
# Amazon RDS PostgreSQL
# Local PostgreSQL
```

```sql
-- PostgreSQL queries in Azure Data Studio
SELECT
    table_name,
    pg_size_pretty(pg_total_relation_size(quote_ident(table_name))) AS size
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY pg_total_relation_size(quote_ident(table_name)) DESC;
```

### MySQL Extension

```bash
# Install: "MySQL" extension

# Connect to MySQL/MariaDB databases
# Azure Database for MySQL
# Local MySQL instances
```

### SandDance for Data Exploration

```bash
# Install: "SandDance for Azure Data Studio"

# Visual data exploration
# Run a query, then click the SandDance icon in results
```

```sql
-- Query data, then visualize with SandDance
SELECT
    Category,
    Region,
    SUM(Sales) AS TotalSales,
    COUNT(*) AS TransactionCount
FROM dbo.SalesData
GROUP BY Category, Region;

-- After results appear, click SandDance icon for interactive visualization
```

### PowerShell Extension

```bash
# Install: "PowerShell" extension

# Run PowerShell scripts directly in Azure Data Studio
# Integrate with dbatools for SQL Server management
```

```powershell
# Example: Database backup script
Import-Module dbatools

$servers = @("server1", "server2", "server3")
$backupPath = "\\backup\sqlbackups"

foreach ($server in $servers) {
    $databases = Get-DbaDatabase -SqlInstance $server -ExcludeSystem

    foreach ($db in $databases) {
        Backup-DbaDatabase `
            -SqlInstance $server `
            -Database $db.Name `
            -Path $backupPath `
            -CompressBackup `
            -Checksum
    }
}
```

### Redgate SQL Search

```bash
# Install: "Redgate SQL Search"

# Search across all database objects
# Find dependencies
# Navigate code quickly
```

### Creating Custom Extensions

```typescript
// package.json for a custom extension
{
    "name": "my-custom-extension",
    "displayName": "My Custom Extension",
    "version": "1.0.0",
    "engines": {
        "vscode": "^1.50.0",
        "azdata": ">=1.25.0"
    },
    "categories": ["Other"],
    "activationEvents": [
        "onCommand:myExtension.runHealthCheck"
    ],
    "contributes": {
        "commands": [
            {
                "command": "myExtension.runHealthCheck",
                "title": "Run Database Health Check"
            }
        ],
        "menus": {
            "objectExplorer/item/context": [
                {
                    "command": "myExtension.runHealthCheck",
                    "when": "nodeType == Database",
                    "group": "myExtension"
                }
            ]
        }
    }
}
```

```typescript
// extension.ts
import * as azdata from 'azdata';
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand(
        'myExtension.runHealthCheck',
        async () => {
            const connection = await azdata.connection.getCurrentConnection();

            if (!connection) {
                vscode.window.showErrorMessage('No active connection');
                return;
            }

            const provider = azdata.dataprotocol.getProvider<azdata.QueryProvider>(
                connection.providerId,
                azdata.DataProviderType.QueryProvider
            );

            const query = `
                SELECT
                    'Database Size' AS Metric,
                    CAST(SUM(size * 8 / 1024) AS VARCHAR) + ' MB' AS Value
                FROM sys.master_files
                WHERE database_id = DB_ID()
                UNION ALL
                SELECT
                    'Table Count',
                    CAST(COUNT(*) AS VARCHAR)
                FROM sys.tables
            `;

            // Execute and display results
            const uri = await azdata.queryeditor.connect(
                connection.connectionId,
                connection.options.database
            );

            await azdata.queryeditor.runQuery(uri, query);
        }
    );

    context.subscriptions.push(disposable);
}
```

### Recommended Extension Pack

```json
// Create an extension pack for your team
{
    "name": "dba-extension-pack",
    "displayName": "DBA Extension Pack",
    "description": "Essential extensions for database administrators",
    "version": "1.0.0",
    "extensionPack": [
        "microsoft.admin-pack",
        "microsoft.schema-compare",
        "microsoft.sql-database-projects",
        "microsoft.dacpac",
        "redgate.sql-search",
        "microsoft.powershell"
    ]
}
```

## Extension Management

```bash
# List installed extensions
azuredatastudio --list-extensions

# Install extension from command line
azuredatastudio --install-extension publisher.extension-name

# Uninstall extension
azuredatastudio --uninstall-extension publisher.extension-name

# Disable extension
# Preferences > Extensions > Find extension > Disable
```

Extensions transform Azure Data Studio into a comprehensive database development platform.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
