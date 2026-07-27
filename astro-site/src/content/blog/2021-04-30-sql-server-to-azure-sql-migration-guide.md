---
title: SQL Server to Azure SQL Migration - A Complete Guide
author: Michael John Peña
draft: false
date: 2021-04-30
url: /blog/sql-server-to-azure-sql-migration-guide/
tags:
  - Azure
  - SQL Server
  - Azure SQL
  - Migration
  - Database
---

SQL Server to Azure SQL migration is the database journey I've been on more times than any other, and the first decision that shapes everything else is which Azure SQL target: Azure SQL Database (PaaS, fully managed, some compatibility gaps), SQL Managed Instance (PaaS, near-complete SQL Server compatibility, VNet-isolated), or SQL Server on Azure VMs (IaaS, full control, full responsibility). The compatibility gaps between SQL Server 2016–2019 and Azure SQL Database are well-documented by the Data Migration Assistant; the bigger surprises usually involve features you didn't know your application was using—Service Broker, linked servers, xp_cmdshell, CLR integration—most of which point you to Managed Instance rather than Azure SQL Database.

## Choosing Your Target

### Azure SQL Options

```
┌─────────────────────────────────────────────────────────────────┐
│                     Azure SQL Portfolio                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  SQL Server on Azure VM          │  Azure SQL Managed Instance │
│  ─────────────────────           │  ─────────────────────────  │
│  • Full SQL Server control       │  • Near 100% compatibility  │
│  • Same features as on-prem      │  • PaaS benefits            │
│  • IaaS (manage everything)      │  • Easy lift & shift        │
│  • Best for: Apps requiring      │  • Best for: Existing apps  │
│    specific SQL features         │    with minimal changes     │
│                                  │                              │
│  Azure SQL Database              │  Azure SQL Database          │
│  (Single Database)               │  (Elastic Pool)              │
│  ─────────────────────           │  ─────────────────────────  │
│  • Fully managed PaaS            │  • Shared resources          │
│  • Isolated resource model       │  • Cost-effective for many   │
│  • Auto-scaling options          │    small databases           │
│  • Best for: New cloud apps,     │  • Best for: SaaS scenarios, │
│    single database workloads     │    multiple tenant databases │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Decision Matrix

```python
def recommend_azure_sql_target(requirements):
    """Recommend Azure SQL target based on requirements"""

    score = {
        "sql_vm": 0,
        "sql_mi": 0,
        "sql_db": 0
    }

    # Feature compatibility
    if requirements.get("sql_agent_jobs"):
        score["sql_vm"] += 3
        score["sql_mi"] += 3
        score["sql_db"] += 0  # Not available

    if requirements.get("cross_database_queries"):
        score["sql_vm"] += 3
        score["sql_mi"] += 2
        score["sql_db"] += 1  # Limited with elastic queries

    if requirements.get("clr_assemblies"):
        score["sql_vm"] += 3
        score["sql_mi"] += 2  # Limited
        score["sql_db"] += 0

    if requirements.get("linked_servers"):
        score["sql_vm"] += 3
        score["sql_mi"] += 2
        score["sql_db"] += 0

    # Management preference
    if requirements.get("fully_managed"):
        score["sql_vm"] += 0
        score["sql_mi"] += 2
        score["sql_db"] += 3

    if requirements.get("minimal_changes"):
        score["sql_vm"] += 3
        score["sql_mi"] += 2
        score["sql_db"] += 1

    # Cost sensitivity
    if requirements.get("cost_optimized"):
        score["sql_vm"] += 1
        score["sql_mi"] += 2
        score["sql_db"] += 3

    # Return recommendation
    recommended = max(score, key=score.get)
    return {
        "recommendation": recommended,
        "scores": score,
        "confidence": score[recommended] / sum(score.values()) if sum(score.values()) > 0 else 0
    }

# Example
requirements = {
    "sql_agent_jobs": True,
    "cross_database_queries": True,
    "fully_managed": True,
    "minimal_changes": True
}

result = recommend_azure_sql_target(requirements)
print(f"Recommended: {result['recommendation']}")
```

## Assessment Phase

### Using Data Migration Assistant

```powershell
# Install DMA
# Download from: https://www.microsoft.com/download/details.aspx?id=53595

# Run assessment via command line
& "C:\Program Files\Microsoft Data Migration Assistant\DmaCmd.exe" `
    /AssessmentName="SQLMigrationAssessment" `
    /AssessmentDatabases="Server=sqlserver;Integrated Security=true;Initial Catalog=SalesDB" `
    /AssessmentTargetPlatform="AzureSqlManagedInstance" `
    /AssessmentEvaluateCompatibilityIssues `
    /AssessmentEvaluateFeatureParity `
    /AssessmentOverwriteResult `
    /AssessmentResultJson="C:\Assessment\result.json" `
    /AssessmentResultCsv="C:\Assessment\result.csv"
```

### Assessment Script

```python
import json
from collections import defaultdict

def analyze_dma_assessment(assessment_file):
    """Analyze DMA assessment results"""

    with open(assessment_file) as f:
        assessment = json.load(f)

    analysis = {
        "databases": [],
        "summary": {
            "total_issues": 0,
            "breaking_changes": 0,
            "behavior_changes": 0,
            "feature_parity": 0
        },
        "blocking_issues": [],
        "recommendations": []
    }

    for db in assessment.get("Databases", []):
        db_analysis = {
            "name": db["Name"],
            "compatibility_level": db.get("CompatibilityLevel"),
            "issues": []
        }

        for issue in db.get("AssessmentRecommendations", []):
            severity = issue.get("Severity", "Information")
            issue_info = {
                "title": issue.get("Title"),
                "description": issue.get("Description"),
                "severity": severity,
                "recommendation": issue.get("Recommendation"),
                "affected_objects": issue.get("AffectedObjects", [])
            }

            db_analysis["issues"].append(issue_info)
            analysis["summary"]["total_issues"] += 1

            if severity == "Error":
                analysis["summary"]["breaking_changes"] += 1
                analysis["blocking_issues"].append(issue_info)
            elif severity == "Warning":
                analysis["summary"]["behavior_changes"] += 1

        analysis["databases"].append(db_analysis)

    # Generate recommendations
    if analysis["summary"]["breaking_changes"] > 0:
        analysis["recommendations"].append(
            "Address all breaking changes before migration"
        )

    if analysis["summary"]["breaking_changes"] == 0:
        analysis["recommendations"].append(
            "Database is ready for migration to target platform"
        )

    return analysis

# Analyze assessment
results = analyze_dma_assessment("assessment.json")
print(f"Total issues: {results['summary']['total_issues']}")
print(f"Breaking changes: {results['summary']['breaking_changes']}")
```

## Schema Migration

### Generate Migration Scripts

```sql
-- Use SSMS or Azure Data Studio to generate schema scripts
-- Or use DACPac for schema extraction

-- Create DACPAC from source database
SqlPackage.exe /Action:Extract /SourceServerName:sqlserver.company.local /SourceDatabaseName:SalesDB /TargetFile:SalesDB.dacpac

-- Generate deployment script
SqlPackage.exe /Action:Script /SourceFile:SalesDB.dacpac /TargetServerName:target.database.windows.net /TargetDatabaseName:SalesDB /OutputPath:migration.sql
```

### Handle Schema Differences

```sql
-- Common schema modifications for Azure SQL Database

-- 1. Remove unsupported features
-- Filegroups (except PRIMARY)
ALTER DATABASE SalesDB REMOVE FILE SecondaryFile;

-- 2. Modify authentication
-- Change Windows auth to SQL auth where needed
ALTER LOGIN [DOMAIN\ServiceAccount]
    WITH PASSWORD = 'StrongPassword123!';

-- 3. Update collation if needed
-- Azure SQL default: SQL_Latin1_General_CP1_CI_AS
ALTER DATABASE SalesDB COLLATE SQL_Latin1_General_CP1_CI_AS;

-- 4. Handle cross-database references
-- Replace three-part names with external tables or linked servers (MI)
-- Original: SELECT * FROM OtherDB.dbo.Customers
-- Azure SQL DB: Use external tables
CREATE EXTERNAL DATA SOURCE OtherDBSource
WITH (
    TYPE = RDBMS,
    LOCATION = 'otherdb.database.windows.net',
    DATABASE_NAME = 'OtherDB',
    CREDENTIAL = OtherDBCredential
);

-- 5. Replace SQL Agent jobs with alternative
-- Use Azure Automation, Logic Apps, or Elastic Jobs
```

## Data Migration Methods

### Method 1: BACPAC Export/Import

```powershell
# Export BACPAC
SqlPackage.exe /Action:Export `
    /SourceServerName:sqlserver.company.local `
    /SourceDatabaseName:SalesDB `
    /TargetFile:SalesDB.bacpac

# Upload to Azure Storage
az storage blob upload `
    --account-name migrationstg `
    --container-name bacpac `
    --file SalesDB.bacpac `
    --name SalesDB.bacpac

# Import to Azure SQL
az sql db import `
    --resource-group production-rg `
    --server sql-server `
    --name SalesDB `
    --storage-key $storageKey `
    --storage-key-type StorageAccessKey `
    --storage-uri "https://migrationstg.blob.core.windows.net/bacpac/SalesDB.bacpac" `
    --admin-user sqladmin `
    --admin-password $password
```

### Method 2: Transactional Replication

```sql
-- On source SQL Server (Publisher)
-- Enable database for replication
USE master;
EXEC sp_replicationdboption @dbname = N'SalesDB',
    @optname = N'publish', @value = N'true';

-- Create publication
USE SalesDB;
EXEC sp_addpublication @publication = N'SalesDB_Publication',
    @description = N'Transactional publication for Azure SQL migration',
    @sync_method = N'concurrent',
    @retention = 0,
    @allow_push = N'true',
    @allow_pull = N'true',
    @allow_anonymous = N'false',
    @enabled_for_internet = N'true',
    @snapshot_in_defaultfolder = N'true',
    @compress_snapshot = N'false',
    @ftp_port = 21,
    @allow_subscription_copy = N'false',
    @add_to_active_directory = N'false',
    @repl_freq = N'continuous',
    @status = N'active';

-- Add articles (tables)
EXEC sp_addarticle @publication = N'SalesDB_Publication',
    @article = N'Customers',
    @source_owner = N'dbo',
    @source_object = N'Customers',
    @type = N'logbased',
    @description = N'',
    @creation_script = null,
    @pre_creation_cmd = N'drop',
    @schema_option = 0x000000000803509F;

-- Add subscriber (Azure SQL Database)
EXEC sp_addsubscription @publication = N'SalesDB_Publication',
    @subscriber = N'yourserver.database.windows.net',
    @destination_db = N'SalesDB',
    @subscription_type = N'push',
    @sync_type = N'automatic',
    @article = N'all',
    @update_mode = N'read only',
    @subscriber_type = 0;
```

### Method 3: Azure Database Migration Service (Online)

```python
# Configure DMS for online migration
migration_task = {
    "taskType": "Migrate.SqlServer.AzureSqlDb.Sync",
    "input": {
        "selectedDatabases": [
            {
                "name": "SalesDB",
                "targetDatabaseName": "SalesDB",
                "schemaName": "dbo",
                "tableMap": {
                    "dbo.Customers": "dbo.Customers",
                    "dbo.Orders": "dbo.Orders",
                    "dbo.OrderItems": "dbo.OrderItems",
                    "dbo.Products": "dbo.Products"
                }
            }
        ],
        "sourceConnectionInfo": {
            "type": "SqlConnectionInfo",
            "dataSource": "sqlserver.company.local",
            "authentication": "SqlAuthentication",
            "userName": "migrationuser",
            "password": source_password,
            "encryptConnection": True
        },
        "targetConnectionInfo": {
            "type": "SqlConnectionInfo",
            "dataSource": "yourserver.database.windows.net",
            "authentication": "SqlAuthentication",
            "userName": "sqladmin",
            "password": target_password,
            "encryptConnection": True
        },
        "validationOptions": {
            "enableSchemaValidation": True,
            "enableDataIntegrityValidation": True,
            "enableQueryAnalysisValidation": True
        }
    }
}
```

## Post-Migration Steps

### Update Connection Strings

```csharp
// Before (on-premises)
var connectionString = "Server=sqlserver.company.local;Database=SalesDB;Integrated Security=True;";

// After (Azure SQL Database)
var connectionString = "Server=tcp:yourserver.database.windows.net,1433;Database=SalesDB;User ID=sqladmin;Password={password};Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;";

// Best practice: Use Azure Key Vault
var connectionString = await keyVaultClient.GetSecretAsync("SqlConnectionString");
```

### Configure Security

```sql
-- Create contained database users
USE SalesDB;

-- Application user
CREATE USER AppUser WITH PASSWORD = 'StrongPassword123!';
ALTER ROLE db_datareader ADD MEMBER AppUser;
ALTER ROLE db_datawriter ADD MEMBER AppUser;

-- Admin user
CREATE USER DbAdmin WITH PASSWORD = 'AdminPassword456!';
ALTER ROLE db_owner ADD MEMBER DbAdmin;

-- Enable Azure AD authentication
-- Configure in Azure portal: SQL Server > Azure Active Directory
```

### Performance Optimization

```sql
-- 1. Update statistics
EXEC sp_updatestats;

-- 2. Rebuild indexes
DECLARE @TableName NVARCHAR(256);
DECLARE TableCursor CURSOR FOR
    SELECT TABLE_SCHEMA + '.' + TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_TYPE = 'BASE TABLE';

OPEN TableCursor;
FETCH NEXT FROM TableCursor INTO @TableName;

WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC('ALTER INDEX ALL ON ' + @TableName + ' REBUILD');
    FETCH NEXT FROM TableCursor INTO @TableName;
END;

CLOSE TableCursor;
DEALLOCATE TableCursor;

-- 3. Enable automatic tuning
ALTER DATABASE SalesDB
SET AUTOMATIC_TUNING (
    FORCE_LAST_GOOD_PLAN = ON,
    CREATE_INDEX = ON,
    DROP_INDEX = OFF
);

-- 4. Review Query Store recommendations
SELECT * FROM sys.dm_db_tuning_recommendations;
```

### Monitoring Setup

```python
# Configure Azure Monitor alerts
alert_rules = [
    {
        "name": "High DTU Usage",
        "metric": "dtu_consumption_percent",
        "operator": "GreaterThan",
        "threshold": 80,
        "window": "PT5M"
    },
    {
        "name": "Storage Space Low",
        "metric": "storage_percent",
        "operator": "GreaterThan",
        "threshold": 90,
        "window": "PT15M"
    },
    {
        "name": "Deadlock Detected",
        "metric": "deadlock",
        "operator": "GreaterThan",
        "threshold": 0,
        "window": "PT1M"
    },
    {
        "name": "Connection Failed",
        "metric": "connection_failed",
        "operator": "GreaterThan",
        "threshold": 10,
        "window": "PT5M"
    }
]

for rule in alert_rules:
    create_metric_alert(
        resource_group="production-rg",
        server_name="yourserver",
        database_name="SalesDB",
        **rule
    )
```

## Validation Checklist

```python
def run_migration_validation(source_conn, target_conn):
    """Comprehensive migration validation"""

    validation_results = {
        "schema_validation": {},
        "data_validation": {},
        "application_tests": {},
        "performance_tests": {}
    }

    # 1. Schema validation
    source_objects = get_database_objects(source_conn)
    target_objects = get_database_objects(target_conn)

    validation_results["schema_validation"] = {
        "tables_match": source_objects["tables"] == target_objects["tables"],
        "views_match": source_objects["views"] == target_objects["views"],
        "procedures_match": source_objects["procedures"] == target_objects["procedures"],
        "missing_objects": list(set(source_objects["all"]) - set(target_objects["all"]))
    }

    # 2. Data validation
    for table in source_objects["tables"]:
        source_count = get_row_count(source_conn, table)
        target_count = get_row_count(target_conn, table)

        validation_results["data_validation"][table] = {
            "source_count": source_count,
            "target_count": target_count,
            "match": source_count == target_count
        }

    # 3. Sample data comparison
    for table in source_objects["tables"][:5]:  # Top 5 tables
        sample_match = compare_sample_data(source_conn, target_conn, table, sample_size=100)
        validation_results["data_validation"][f"{table}_sample"] = sample_match

    return validation_results

# Run validation
results = run_migration_validation(source_connection, target_connection)

# Print summary
print("=== Migration Validation Summary ===")
print(f"Schema Match: {all(results['schema_validation'].values())}")
print(f"Data Match: {all(v['match'] for v in results['data_validation'].values() if isinstance(v, dict))}")
```

## Best Practices Summary

1. **Assess thoroughly** - Use DMA to identify all issues
2. **Test migrations** - Practice in non-production first
3. **Plan cutover window** - Minimize downtime
4. **Update all connection strings** - Applications, reports, integrations
5. **Configure security** - Azure AD, firewall rules, encryption
6. **Monitor performance** - Enable Query Store, set up alerts
7. **Document changes** - Track schema modifications
8. **Have rollback plan** - Keep source available temporarily

## Conclusion

Migrating SQL Server to Azure SQL is a well-established path with excellent tooling support. By following a structured approach - assess, plan, migrate, validate - you can execute successful migrations with minimal risk. The choice between Azure SQL Database, Managed Instance, or SQL Server on VM depends on your specific compatibility and management requirements.
