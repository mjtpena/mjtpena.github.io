---
title: Azure Database Migration Service - Strategies for Database Modernization
author: Michael John Peña
draft: false
date: 2021-04-29
url: /blog/azure-database-migration-service-strategies/
tags:
  - Azure
  - Database Migration
  - SQL Server
  - DMS
  - Modernization
---

## Understanding Azure DMS

### Supported Migration Scenarios

```yaml
SQL Server migrations:
  Source:
    - SQL Server 2005+
    - Amazon RDS for SQL Server
  Target:
    - Azure SQL Database
    - Azure SQL Managed Instance
    - SQL Server on Azure VM

Open source migrations:
  Source:
    - MySQL (on-premises, RDS)
    - PostgreSQL (on-premises, RDS)
    - MongoDB
  Target:
    - Azure Database for MySQL
    - Azure Database for PostgreSQL
    - Azure Cosmos DB (MongoDB API)

Oracle migrations:
  Source:
    - Oracle 10g+
  Target:
    - Azure Database for PostgreSQL (via ora2pg)
```

### Migration Types

```
Online Migration (Minimal Downtime):
┌────────────────────────────────────────────────────────┐
│ Source DB ────── Initial Full Load ────── Target DB   │
│     │                                          │       │
│     └────────── CDC/Continuous Sync ───────────┘       │
│                       │                                │
│                  [Cutover]                             │
│                       │                                │
│              Applications switch                       │
└────────────────────────────────────────────────────────┘

Offline Migration (Scheduled Downtime):
┌────────────────────────────────────────────────────────┐
│ Source DB ─── Stop Applications ─── Full Backup ─────► │
│                                                        │
│              Restore to Target DB                      │
│                       │                                │
│              Applications switch                       │
└────────────────────────────────────────────────────────┘
```

## Setting Up DMS

### Create DMS Instance

```bash
# Create virtual network for DMS
az network vnet create \
    --name dms-vnet \
    --resource-group migration-rg \
    --address-prefix 10.0.0.0/16 \
    --subnet-name dms-subnet \
    --subnet-prefix 10.0.1.0/24

# Create DMS instance
az dms create \
    --resource-group migration-rg \
    --name database-migration-service \
    --location eastus \
    --sku-name Premium_4vCores \
    --subnet /subscriptions/.../subnets/dms-subnet

# Verify creation
az dms show \
    --resource-group migration-rg \
    --name database-migration-service
```

### Terraform Configuration

```hcl
resource "azurerm_database_migration_service" "dms" {
  name                = "database-migration-service"
  location            = azurerm_resource_group.migration.location
  resource_group_name = azurerm_resource_group.migration.name
  subnet_id           = azurerm_subnet.dms.id
  sku_name            = "Premium_4vCores"

  tags = {
    Environment = "Migration"
  }
}
```

## SQL Server to Azure SQL Migration

### Pre-Migration Assessment

```python
# Using Data Migration Assistant API
import subprocess
import json

def run_dma_assessment(server, database, output_path):
    """Run DMA assessment for SQL Server database"""

    dma_path = r"C:\Program Files\Microsoft Data Migration Assistant\DmaCmd.exe"

    cmd = [
        dma_path,
        "/AssessmentName", f"{database}_assessment",
        "/AssessmentDatabases", f"Server={server};Integrated Security=true;Database={database}",
        "/AssessmentTargetPlatform", "AzureSqlDatabase",
        "/AssessmentEvaluateCompatibilityIssues",
        "/AssessmentEvaluateFeatureParity",
        "/AssessmentOverwriteResult",
        "/AssessmentResultJson", output_path
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)

    # Parse results
    with open(output_path) as f:
        assessment = json.load(f)

    return {
        "compatibility_level": assessment.get("CompatibilityLevel"),
        "breaking_changes": len([i for i in assessment.get("Issues", []) if i["Severity"] == "Error"]),
        "behavior_changes": len([i for i in assessment.get("Issues", []) if i["Severity"] == "Warning"]),
        "feature_parity_issues": len(assessment.get("FeatureParityIssues", []))
    }

# Run assessment
assessment = run_dma_assessment("sql-server.company.local", "SalesDB", "assessment.json")
print(f"Breaking changes: {assessment['breaking_changes']}")
print(f"Behavior changes: {assessment['behavior_changes']}")
```

### Online Migration to Azure SQL MI

```python
from azure.mgmt.datamigration import DataMigrationServiceManagementClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
dms_client = DataMigrationServiceManagementClient(credential, subscription_id)

# Create migration project
project = dms_client.projects.create_or_update(
    resource_group_name="migration-rg",
    service_name="database-migration-service",
    project_name="sql-to-sqlmi-project",
    parameters={
        "location": "eastus",
        "properties": {
            "sourcePlatform": "SQL",
            "targetPlatform": "SQLMI"
        }
    }
)

# Create migration task
task_properties = {
    "taskType": "Migrate.SqlServer.AzureSqlDbMI.Sync",
    "input": {
        "selectedDatabases": [
            {
                "name": "SalesDB",
                "restoreDatabaseName": "SalesDB",
                "backupFileShare": {
                    "path": r"\\fileserver\sqlbackups\SalesDB"
                }
            }
        ],
        "backupBlobShare": {
            "sasUri": blob_sas_uri
        },
        "sourceConnectionInfo": {
            "type": "SqlConnectionInfo",
            "dataSource": "sql-server.company.local",
            "authentication": "SqlAuthentication",
            "userName": "migrationuser",
            "password": source_password,
            "encryptConnection": True,
            "trustServerCertificate": True
        },
        "targetConnectionInfo": {
            "type": "MiSqlConnectionInfo",
            "managedInstanceResourceId": sql_mi_resource_id,
            "userName": "sqladmin",
            "password": target_password
        },
        "azureApp": {
            "appKey": app_key,
            "applicationId": app_id,
            "tenantId": tenant_id
        }
    }
}

task = dms_client.tasks.create_or_update(
    resource_group_name="migration-rg",
    service_name="database-migration-service",
    project_name="sql-to-sqlmi-project",
    task_name="migrate-salesdb",
    parameters={"properties": task_properties}
)
```

### Monitor Migration Progress

```python
def monitor_migration(task_name):
    """Monitor migration task progress"""

    while True:
        task = dms_client.tasks.get(
            resource_group_name="migration-rg",
            service_name="database-migration-service",
            project_name="sql-to-sqlmi-project",
            task_name=task_name,
            expand="output"
        )

        state = task.properties.state
        print(f"Task state: {state}")

        if task.properties.output:
            for output in task.properties.output:
                if hasattr(output, "migration_state"):
                    print(f"  Database: {output.database_name}")
                    print(f"  State: {output.migration_state}")
                    print(f"  Full backup restored: {output.full_backup_set_info}")

                    if hasattr(output, "active_backup_sets"):
                        for backup in output.active_backup_sets:
                            print(f"    Log backup: {backup.backup_set_id} - {backup.restore_status}")

        if state in ["Succeeded", "Failed", "Canceled"]:
            break

        time.sleep(30)

    return task

# Monitor and wait for sync
result = monitor_migration("migrate-salesdb")
```

### Perform Cutover

```python
def perform_cutover(task_name, database_name):
    """Perform cutover for online migration"""

    # Stop application writes to source database
    print("Stopping application writes...")

    # Wait for final log backups to be applied
    task = dms_client.tasks.get(
        resource_group_name="migration-rg",
        service_name="database-migration-service",
        project_name="sql-to-sqlmi-project",
        task_name=task_name,
        expand="output"
    )

    for output in task.properties.output:
        if output.database_name == database_name:
            pending_logs = output.active_backup_sets
            if pending_logs:
                print(f"Waiting for {len(pending_logs)} pending log backups...")
                time.sleep(60)
                return perform_cutover(task_name, database_name)

    # Initiate cutover
    cutover_input = {
        "databaseName": database_name
    }

    dms_client.tasks.command(
        resource_group_name="migration-rg",
        service_name="database-migration-service",
        project_name="sql-to-sqlmi-project",
        task_name=task_name,
        command_input={"commandType": "Migrate.SqlServer.AzureSqlDbMI.Complete", **cutover_input}
    )

    print(f"Cutover initiated for {database_name}")

    # Update application connection strings
    print("Update application connection strings to target database")

    return True

# Execute cutover
perform_cutover("migrate-salesdb", "SalesDB")
```

## MySQL to Azure Database for MySQL

```python
# MySQL online migration configuration
mysql_migration_config = {
    "taskType": "Migrate.MySql.AzureDbForMySql.Sync",
    "input": {
        "sourceConnectionInfo": {
            "type": "MySqlConnectionInfo",
            "serverName": "mysql.company.local",
            "port": 3306,
            "userName": "migrationuser",
            "password": source_password
        },
        "targetConnectionInfo": {
            "type": "MySqlConnectionInfo",
            "serverName": "mysql-server.mysql.database.azure.com",
            "port": 3306,
            "userName": "mysqladmin@mysql-server",
            "password": target_password
        },
        "selectedDatabases": [
            {
                "name": "ecommerce",
                "targetDatabaseName": "ecommerce",
                "makeSourceDbReadOnly": False,
                "tableMap": {
                    "ecommerce.orders": "ecommerce.orders",
                    "ecommerce.customers": "ecommerce.customers",
                    "ecommerce.products": "ecommerce.products"
                }
            }
        ]
    }
}
```

## PostgreSQL to Azure Database for PostgreSQL

```python
# PostgreSQL migration configuration
pg_migration_config = {
    "taskType": "Migrate.PostgreSql.AzureDbForPostgreSql.SyncV2",
    "input": {
        "sourceConnectionInfo": {
            "type": "PostgreSqlConnectionInfo",
            "serverName": "postgres.company.local",
            "port": 5432,
            "databaseName": "analytics",
            "userName": "migrationuser",
            "password": source_password
        },
        "targetConnectionInfo": {
            "type": "PostgreSqlConnectionInfo",
            "serverName": "pg-server.postgres.database.azure.com",
            "port": 5432,
            "databaseName": "analytics",
            "userName": "pgadmin@pg-server",
            "password": target_password
        },
        "selectedDatabases": [
            {
                "name": "analytics",
                "targetDatabaseName": "analytics"
            }
        ],
        "encryptConnection": True,
        "startedOn": datetime.utcnow().isoformat()
    }
}
```

## Migration Validation

### Data Validation Script

```python
import hashlib
import pyodbc

def validate_migration(source_conn_str, target_conn_str, tables):
    """Validate data integrity after migration"""

    validation_results = []

    for table in tables:
        # Get row counts
        source_count = get_row_count(source_conn_str, table)
        target_count = get_row_count(target_conn_str, table)

        # Get checksum (for smaller tables)
        if source_count < 1000000:
            source_checksum = get_table_checksum(source_conn_str, table)
            target_checksum = get_table_checksum(target_conn_str, table)
            checksum_match = source_checksum == target_checksum
        else:
            checksum_match = None  # Skip for large tables

        validation_results.append({
            "table": table,
            "source_count": source_count,
            "target_count": target_count,
            "count_match": source_count == target_count,
            "checksum_match": checksum_match
        })

    return validation_results


def get_row_count(conn_str, table):
    conn = pyodbc.connect(conn_str)
    cursor = conn.cursor()
    cursor.execute(f"SELECT COUNT(*) FROM {table}")
    count = cursor.fetchone()[0]
    conn.close()
    return count


def get_table_checksum(conn_str, table):
    conn = pyodbc.connect(conn_str)
    cursor = conn.cursor()
    cursor.execute(f"SELECT CHECKSUM_AGG(BINARY_CHECKSUM(*)) FROM {table}")
    checksum = cursor.fetchone()[0]
    conn.close()
    return checksum


# Run validation
tables = ["dbo.Orders", "dbo.Customers", "dbo.Products"]
results = validate_migration(source_conn, target_conn, tables)

for result in results:
    status = "PASS" if result["count_match"] else "FAIL"
    print(f"{result['table']}: {status}")
    print(f"  Source: {result['source_count']}, Target: {result['target_count']}")
```

## Best Practices

1. **Assess compatibility first** - Use DMA for SQL Server
2. **Test migrations in non-prod** - Validate before production
3. **Plan for downtime** - Even online migrations have cutover windows
4. **Monitor network bandwidth** - Initial sync can be large
5. **Use Premium tier DMS** - Required for online migrations
6. **Validate data integrity** - Compare counts and checksums
7. **Document connection strings** - Update all applications
8. **Keep source available** - Until migration is fully validated

## Common Issues and Solutions

```yaml
Issue: Migration taking too long
Solution:
  - Increase DMS tier
  - Check network bandwidth
  - Consider parallel migrations

Issue: Schema compatibility errors
Solution:
  - Review DMA assessment
  - Modify schema before migration
  - Use compatibility mode

Issue: CDC not capturing changes
Solution:
  - Verify CDC is enabled
  - Check permissions
  - Review transaction log settings

Issue: Cutover fails
Solution:
  - Check pending transactions
  - Verify network connectivity
  - Review error logs
```

## Conclusion

Azure Database Migration Service simplifies the complex process of migrating databases to Azure. Whether you're performing an offline migration during a maintenance window or an online migration with minimal downtime, DMS provides the tools and automation needed for successful database modernization. The key is thorough assessment, proper planning, and comprehensive validation.
