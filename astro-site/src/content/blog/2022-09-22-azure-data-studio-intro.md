---
title: "Getting Started with Azure Data Studio"
description: "Azure Data Studio offers a lightweight, customizable interface that combines the best features of modern code editors with database-specific functionality."
author: "Michael John Peña"
draft: false
date: 2022-09-22
tags: ["Azure", "Azure Data Studio", "SQL", "Tools"]
---

## Introduction to Azure Data Studio

Azure Data Studio offers a lightweight, customizable interface that combines the best features of modern code editors with database-specific functionality.

### Key Features

1. **Cross-platform** - Windows, macOS, and Linux
2. **IntelliSense** - Smart code completion
3. **Notebooks** - Combine code, text, and visualizations
4. **Extensions** - Rich ecosystem of add-ons
5. **Source control** - Built-in Git support

### Connecting to Databases

```json
// Connection configuration example
{
    "server": "myserver.database.windows.net",
    "database": "mydb",
    "authenticationType": "AzureMFA",
    "user": "user@company.com",
    "connectionTimeout": 30,
    "options": {
        "encrypt": true,
        "trustServerCertificate": false
    }
}
```

### Keyboard Shortcuts

```text
Essential shortcuts:
- Ctrl+Shift+P / Cmd+Shift+P: Command Palette
- Ctrl+Space: Trigger IntelliSense
- Ctrl+Enter: Execute query
- Ctrl+Shift+E: Execute selected query
- Ctrl+/: Toggle comment
- F5: Run query
- Ctrl+N: New query
- Ctrl+Shift+C: Copy with headers (results)
```

### Code Snippets

```sql
-- Type 'sqlSelect' and press Tab
SELECT TOP (1000) *
FROM [dbo].[TableName]

-- Type 'sqlCreateTable' and press Tab
CREATE TABLE [dbo].[TableName]
(
    [Id] INT NOT NULL PRIMARY KEY,
    [Column1] NVARCHAR(50) NOT NULL,
    [Column2] NVARCHAR(50) NULL
);

-- Type 'sqlCreateProc' and press Tab
CREATE PROCEDURE [dbo].[ProcedureName]
    @Param1 INT,
    @Param2 NVARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    -- Procedure logic here
END;
GO
```

### Custom Snippets

```json
// Create custom snippets in settings
// File > Preferences > User Snippets > sql.json
{
    "Select with pagination": {
        "prefix": "sqlPaged",
        "body": [
            "SELECT ${1:columns}",
            "FROM ${2:table}",
            "ORDER BY ${3:column}",
            "OFFSET @PageSize * (@PageNumber - 1) ROWS",
            "FETCH NEXT @PageSize ROWS ONLY;"
        ],
        "description": "Select with offset pagination"
    },
    "Upsert pattern": {
        "prefix": "sqlUpsert",
        "body": [
            "MERGE INTO ${1:target_table} AS target",
            "USING ${2:source} AS source",
            "ON target.${3:key_column} = source.${3:key_column}",
            "WHEN MATCHED THEN",
            "    UPDATE SET",
            "        ${4:column} = source.${4:column}",
            "WHEN NOT MATCHED THEN",
            "    INSERT (${4:column})",
            "    VALUES (source.${4:column});"
        ],
        "description": "MERGE upsert pattern"
    }
}
```

### Dashboard Widgets

```json
// Customize server dashboard
// Add to settings.json
{
    "dashboard.server.widgets": [
        {
            "name": "Database Size",
            "gridItemConfig": {
                "sizex": 2,
                "sizey": 1
            },
            "widget": {
                "insights-widget": {
                    "type": {
                        "bar": {
                            "dataDirection": "horizontal",
                            "legendPosition": "none",
                            "labelFirstColumn": true
                        }
                    },
                    "queryFile": "~/widgets/dbsize.sql"
                }
            }
        }
    ]
}
```

```sql
-- ~/widgets/dbsize.sql
SELECT
    DB_NAME(database_id) AS [Database],
    SUM(size * 8 / 1024) AS [Size (MB)]
FROM sys.master_files
WHERE type = 0
GROUP BY database_id
ORDER BY [Size (MB)] DESC;
```

### Query Results Export

```typescript
// Use the command palette for export options
// Or programmatically via extensions:

// Export to CSV
// Ctrl+Shift+P -> "Export Results as CSV"

// Export to JSON
// Ctrl+Shift+P -> "Export Results as JSON"

// Export to Excel
// Ctrl+Shift+P -> "Export Results as Excel"

// Chart visualization
// Right-click results -> "Chart"
```

### Settings Configuration

```json
// User settings (settings.json)
{
    // Editor settings
    "editor.fontSize": 14,
    "editor.tabSize": 4,
    "editor.insertSpaces": true,
    "editor.formatOnSave": true,

    // SQL specific
    "sql.intelliSense.enableIntellisense": true,
    "sql.intelliSense.enableSuggestions": true,
    "sql.format.keywordCasing": "upper",
    "sql.format.datatypeCasing": "lower",
    "sql.format.placeCommasBeforeNextStatement": true,

    // Query settings
    "sql.query.displayBitAsNumber": false,
    "sql.query.maxCharsToStore": 200000,
    "sql.query.rowCount": 5000,

    // Results grid
    "sql.results.fontSize": 12,
    "sql.results.saveAsCsv.includeHeaders": true,

    // Connections
    "sql.connections": [
        {
            "server": "myserver.database.windows.net",
            "database": "mydb",
            "authenticationType": "AzureMFA",
            "user": "user@company.com"
        }
    ]
}
```

### Integrated Terminal

```bash
# Access via Ctrl+` or View > Terminal

# Use sqlcmd from terminal
sqlcmd -S myserver.database.windows.net -d mydb -U user -P password -i script.sql

# Use Azure CLI
az sql db list --server myserver --resource-group myRG -o table

# Use PowerShell
Invoke-Sqlcmd -ServerInstance "myserver.database.windows.net" -Database "mydb" -Query "SELECT @@VERSION"
```

### Source Control Integration

```bash
# Initialize git repo for your SQL scripts
git init

# Create .gitignore for SQL projects
echo "*.bak" >> .gitignore
echo "*.trn" >> .gitignore
echo "bin/" >> .gitignore
echo "obj/" >> .gitignore

# Stage and commit
git add .
git commit -m "Initial SQL scripts"

# Connect to Azure Repos or GitHub
git remote add origin https://github.com/user/sql-scripts.git
git push -u origin main
```

### Multi-Database Queries

```sql
-- Execute against multiple databases
-- Use the connection dropdown to select different databases

-- Or use three-part naming within same server
SELECT
    'Sales' AS Source,
    COUNT(*) AS RecordCount
FROM SalesDB.dbo.Orders
UNION ALL
SELECT
    'Inventory' AS Source,
    COUNT(*) AS RecordCount
FROM InventoryDB.dbo.Products;
```

## Best Practices

1. **Use keyboard shortcuts** - Learn common shortcuts for efficiency
2. **Customize snippets** - Create snippets for repeated patterns
3. **Enable Git** - Version control your SQL scripts
4. **Use notebooks** - Document queries with markdown
5. **Install extensions** - Enhance functionality for your needs

Azure Data Studio provides a modern, extensible environment for all your database development needs.
