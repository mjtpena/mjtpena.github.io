---
title: "Azure Database for MySQL Flexible Server: A Complete Guide"
author: "Michael John Peña"
draft: false
date: 2022-07-09
tags: ["Azure", "MySQL", "Flexible Server", "Database", "Cloud"]

---

I wrote "Azure Database for MySQL Flexible Server: A Complete Guide" to share practical, production-minded guidance on this topic.

## Key Features of Flexible Server

- **Zone-redundant high availability**: Automatic failover across availability zones
- **Scheduled maintenance windows**: Control when maintenance happens
- **Burstable compute**: Cost-effective for variable workloads
- **Stop/Start capability**: Pause your server to save costs
- **Custom maintenance**: Choose your maintenance window

## Creating a Flexible Server

```bash
# Create a resource group
az group create --name myResourceGroup --location eastus

# Create a MySQL Flexible Server
az mysql flexible-server create \
    --resource-group myResourceGroup \
    --name mymysqlserver \
    --location eastus \
    --admin-user myadmin \
    --admin-password 'SecurePassword123!' \
    --sku-name Standard_B1ms \
    --tier Burstable \
    --storage-size 32 \
    --version 8.0 \
    --high-availability ZoneRedundant \
    --zone 1 \
    --standby-zone 2
```

## Configuring Server Parameters

```bash
# List all parameters
az mysql flexible-server parameter list \
    --resource-group myResourceGroup \
    --server-name mymysqlserver

# Set a specific parameter
az mysql flexible-server parameter set \
    --resource-group myResourceGroup \
    --server-name mymysqlserver \
    --name max_connections \
    --value 500

# Enable slow query log
az mysql flexible-server parameter set \
    --resource-group myResourceGroup \
    --server-name mymysqlserver \
    --name slow_query_log \
    --value ON

az mysql flexible-server parameter set \
    --resource-group myResourceGroup \
    --server-name mymysqlserver \
    --name long_query_time \
    --value 2
```

## Connecting to Your Server

```python
import mysql.connector
from mysql.connector import Error

def create_connection():
    try:
        connection = mysql.connector.connect(
            host='mymysqlserver.mysql.database.azure.com',
            database='mydb',
            user='myadmin',
            password='SecurePassword123!',
            ssl_ca='/path/to/DigiCertGlobalRootCA.crt.pem',
            ssl_verify_cert=True
        )

        if connection.is_connected():
            db_info = connection.get_server_info()
            print(f"Connected to MySQL Server version {db_info}")

            cursor = connection.cursor()
            cursor.execute("SELECT DATABASE();")
            record = cursor.fetchone()
            print(f"Connected to database: {record}")

            return connection

    except Error as e:
        print(f"Error: {e}")
        return None

# Usage
conn = create_connection()
```

## Stop/Start for Cost Optimization

```bash
# Stop the server during off-hours
az mysql flexible-server stop \
    --resource-group myResourceGroup \
    --name mymysqlserver

# Start it when needed
az mysql flexible-server start \
    --resource-group myResourceGroup \
    --name mymysqlserver
```

## Backup and Restore

```bash
# Configure backup retention
az mysql flexible-server update \
    --resource-group myResourceGroup \
    --name mymysqlserver \
    --backup-retention 14

# Restore to a point in time
az mysql flexible-server restore \
    --resource-group myResourceGroup \
    --name mymysqlserver-restored \
    --source-server mymysqlserver \
    --restore-time "2022-07-08T12:00:00Z"
```

## Monitoring with Azure Monitor

```bash
# Enable diagnostic settings
az monitor diagnostic-settings create \
    --name myDiagnostics \
    --resource "/subscriptions/{sub}/resourceGroups/myResourceGroup/providers/Microsoft.DBforMySQL/flexibleServers/mymysqlserver" \
    --logs '[{"category": "MySqlSlowLogs", "enabled": true}, {"category": "MySqlAuditLogs", "enabled": true}]' \
    --metrics '[{"category": "AllMetrics", "enabled": true}]' \
    --workspace "/subscriptions/{sub}/resourceGroups/myResourceGroup/providers/Microsoft.OperationalInsights/workspaces/myWorkspace"
```

Flexible Server provides the enterprise features you need while maintaining the simplicity of a managed service.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
