---
title: Azure Database for PostgreSQL Flexible Server - A Deep Dive
author: Michael John Peña
draft: false
date: 2021-02-02
url: /blog/azure-postgresql-flexible-server/
tags:
  - Azure
  - PostgreSQL
  - Database
  - Cloud
  - Data
---

Flexible Server is the deployment option I now default to when a client asks "which PostgreSQL on Azure should I use?" The original Single Server mode served its purpose but the constraints were real: limited parameter tuning, no support for extensions like `pg_partman`, and an HA story that was slower than it needed to be. Flexible Server gives you a VM you can reason about, a maintenance window you can schedule, zone-redundant HA with a 60-second failover, and the ability to stop the server overnight for dev workloads without losing configuration.

## Why Flexible Server?

The Flexible Server deployment option addresses several limitations of the Single Server:

- **Zone-redundant high availability** - Automatic failover across availability zones
- **Burstable compute** - Pay for baseline resources and burst when needed
- **Reserved capacity pricing** - Up to 60% savings with reserved instances
- **Start/Stop capability** - Stop your server during non-business hours
- **Custom maintenance windows** - Choose when updates are applied
- **Better cost controls** - Same-zone HA option for lower costs

## Creating a Flexible Server

Let's create a PostgreSQL Flexible Server using Azure CLI:

```bash
# Create a resource group
az group create \
    --name rg-postgres-demo \
    --location eastus

# Create a Flexible Server
az postgres flexible-server create \
    --name my-postgres-flex \
    --resource-group rg-postgres-demo \
    --location eastus \
    --admin-user pgadmin \
    --admin-password 'YourSecurePassword123!' \
    --sku-name Standard_B1ms \
    --tier Burstable \
    --storage-size 32 \
    --version 13 \
    --high-availability ZoneRedundant
```

The burstable tier is perfect for development and testing workloads with variable usage patterns.

## Configuring Networking

Flexible Server offers two networking options: public access or private access via VNet integration.

### Public Access with Firewall Rules

```bash
# Add a firewall rule for your IP
az postgres flexible-server firewall-rule create \
    --resource-group rg-postgres-demo \
    --name my-postgres-flex \
    --rule-name AllowMyIP \
    --start-ip-address 203.0.113.10 \
    --end-ip-address 203.0.113.10

# Allow Azure services
az postgres flexible-server firewall-rule create \
    --resource-group rg-postgres-demo \
    --name my-postgres-flex \
    --rule-name AllowAzureServices \
    --start-ip-address 0.0.0.0 \
    --end-ip-address 0.0.0.0
```

### Private Access with VNet Integration

```bash
# Create a VNet
az network vnet create \
    --name vnet-postgres \
    --resource-group rg-postgres-demo \
    --address-prefix 10.0.0.0/16 \
    --subnet-name subnet-postgres \
    --subnet-prefix 10.0.1.0/24

# Delegate the subnet to PostgreSQL
az network vnet subnet update \
    --name subnet-postgres \
    --resource-group rg-postgres-demo \
    --vnet-name vnet-postgres \
    --delegations Microsoft.DBforPostgreSQL/flexibleServers

# Create server with VNet integration
az postgres flexible-server create \
    --name my-postgres-private \
    --resource-group rg-postgres-demo \
    --vnet vnet-postgres \
    --subnet subnet-postgres \
    --private-dns-zone postgres-dns.private.postgres.database.azure.com
```

## Connecting with Python

Here's how to connect to your Flexible Server using Python and psycopg2:

```python
import psycopg2
from psycopg2 import pool
import os

# Connection parameters
DB_HOST = "my-postgres-flex.postgres.database.azure.com"
DB_NAME = "postgres"
DB_USER = "pgadmin"
DB_PASSWORD = os.environ.get("PGPASSWORD")
DB_PORT = "5432"

# Create a connection pool
connection_pool = psycopg2.pool.ThreadedConnectionPool(
    minconn=1,
    maxconn=10,
    host=DB_HOST,
    database=DB_NAME,
    user=DB_USER,
    password=DB_PASSWORD,
    port=DB_PORT,
    sslmode="require"
)

def get_connection():
    return connection_pool.getconn()

def release_connection(conn):
    connection_pool.putconn(conn)

def create_sample_table():
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS products (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    price DECIMAL(10, 2),
                    category VARCHAR(50),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()
            print("Table created successfully!")
    finally:
        release_connection(conn)

def insert_product(name, price, category):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO products (name, price, category)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (name, price, category)
            )
            product_id = cursor.fetchone()[0]
            conn.commit()
            return product_id
    finally:
        release_connection(conn)

def get_products_by_category(category):
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT id, name, price, created_at
                FROM products
                WHERE category = %s
                ORDER BY price DESC
                """,
                (category,)
            )
            return cursor.fetchall()
    finally:
        release_connection(conn)

# Usage example
if __name__ == "__main__":
    create_sample_table()

    # Insert sample data
    insert_product("Laptop", 999.99, "Electronics")
    insert_product("Keyboard", 79.99, "Electronics")
    insert_product("Mouse", 29.99, "Electronics")

    # Query products
    electronics = get_products_by_category("Electronics")
    for product in electronics:
        print(f"ID: {product[0]}, Name: {product[1]}, Price: ${product[2]}")
```

## High Availability Configuration

Flexible Server offers zone-redundant HA for production workloads:

```bash
# Enable zone-redundant HA
az postgres flexible-server update \
    --name my-postgres-flex \
    --resource-group rg-postgres-demo \
    --high-availability ZoneRedundant

# Check HA status
az postgres flexible-server show \
    --name my-postgres-flex \
    --resource-group rg-postgres-demo \
    --query "highAvailability"
```

For same-zone HA (lower cost option):

```bash
az postgres flexible-server update \
    --name my-postgres-flex \
    --resource-group rg-postgres-demo \
    --high-availability SameZone
```

## Custom Server Parameters

Flexible Server allows you to customize PostgreSQL configuration:

```bash
# View current parameters
az postgres flexible-server parameter list \
    --resource-group rg-postgres-demo \
    --server-name my-postgres-flex \
    --output table

# Increase shared buffers
az postgres flexible-server parameter set \
    --resource-group rg-postgres-demo \
    --server-name my-postgres-flex \
    --name shared_buffers \
    --value "256MB"

# Enable query logging for debugging
az postgres flexible-server parameter set \
    --resource-group rg-postgres-demo \
    --server-name my-postgres-flex \
    --name log_statement \
    --value "all"

# Set work_mem for complex queries
az postgres flexible-server parameter set \
    --resource-group rg-postgres-demo \
    --server-name my-postgres-flex \
    --name work_mem \
    --value "64MB"
```

## Backup and Restore

Flexible Server includes automated backups with point-in-time restore:

```bash
# Configure backup retention (default is 7 days, max 35 days)
az postgres flexible-server update \
    --name my-postgres-flex \
    --resource-group rg-postgres-demo \
    --backup-retention 14

# Point-in-time restore
az postgres flexible-server restore \
    --resource-group rg-postgres-demo \
    --name my-postgres-flex-restored \
    --source-server my-postgres-flex \
    --restore-time "2021-02-01T12:00:00Z"
```

## Monitoring with Azure Monitor

Set up diagnostic settings for comprehensive monitoring:

```bash
# Create a Log Analytics workspace
az monitor log-analytics workspace create \
    --resource-group rg-postgres-demo \
    --workspace-name postgres-logs

# Enable diagnostic settings
az monitor diagnostic-settings create \
    --name postgres-diagnostics \
    --resource "/subscriptions/{sub-id}/resourceGroups/rg-postgres-demo/providers/Microsoft.DBforPostgreSQL/flexibleServers/my-postgres-flex" \
    --workspace postgres-logs \
    --logs '[{"category": "PostgreSQLLogs", "enabled": true}]' \
    --metrics '[{"category": "AllMetrics", "enabled": true}]'
```

Query your logs in Log Analytics:

```kusto
// Query slow queries
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.DBFORPOSTGRESQL"
| where Category == "PostgreSQLLogs"
| where Message contains "duration"
| parse Message with * "duration: " duration_ms:real " ms" *
| where duration_ms > 1000
| project TimeGenerated, duration_ms, Message
| order by duration_ms desc
| take 100
```

## Cost Optimization with Start/Stop

For non-production environments, save costs by stopping the server:

```bash
# Stop the server (saves compute costs, storage still billed)
az postgres flexible-server stop \
    --name my-postgres-flex \
    --resource-group rg-postgres-demo

# Start the server
az postgres flexible-server start \
    --name my-postgres-flex \
    --resource-group rg-postgres-demo
```

Automate this with Azure Automation or Logic Apps for scheduled start/stop.

## Conclusion

Azure Database for PostgreSQL Flexible Server is a significant improvement over Single Server, offering better cost optimization, more control, and enhanced high availability. The burstable tier makes it perfect for development environments, while zone-redundant HA ensures production readiness.

Consider migrating from Single Server to Flexible Server to take advantage of these new capabilities. Microsoft provides migration tools to help with this transition.
