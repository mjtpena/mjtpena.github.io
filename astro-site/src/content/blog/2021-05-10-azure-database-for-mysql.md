---
title: "Azure Database for MySQL: Flexible Server Deep Dive"
author: Michael John Peña
draft: false
date: 2021-05-10
tags:
  - Azure
  - MySQL
  - Database
  - Cloud
  - Open Source

---

I wrote "Azure Database for MySQL: Flexible Server Deep Dive" to share practical, production-minded guidance on this topic.

## Flexible Server vs Single Server

Azure offers two MySQL deployment options:
- **Single Server**: Original offering, simpler but less flexible
- **Flexible Server**: Newer, more customizable, recommended for new workloads

Key differences:

| Feature | Single Server | Flexible Server |
|---------|--------------|-----------------|
| Zone redundancy | No | Yes |
| Stop/Start | No | Yes |
| Custom maintenance | Limited | Full control |
| Same-zone HA | No | Yes |
| Cost optimization | Fixed | Flexible |

## Creating a Flexible Server

```bash
# Create flexible server
az mysql flexible-server create \
    --name my-mysql-flex \
    --resource-group my-rg \
    --location eastus \
    --admin-user myadmin \
    --admin-password '<strong-password>' \
    --sku-name Standard_D2ds_v4 \
    --tier GeneralPurpose \
    --storage-size 128 \
    --version 8.0 \
    --high-availability ZoneRedundant \
    --zone 1 \
    --standby-zone 2
```

## High Availability Options

Flexible Server offers two HA modes:

**Zone Redundant HA:**
- Primary and standby in different availability zones
- Automatic failover within 60-120 seconds
- Best for production workloads

**Same-Zone HA:**
- Primary and standby in same zone
- Faster failover
- Lower cost than zone redundant

```python
import mysql.connector
from mysql.connector import pooling

# Connection pool with retry logic for HA
dbconfig = {
    "host": "my-mysql-flex.mysql.database.azure.com",
    "user": "myadmin",
    "password": "<password>",
    "database": "mydb",
    "ssl_ca": "/path/to/DigiCertGlobalRootCA.crt.pem",
    "ssl_verify_cert": True
}

# Create connection pool
pool = mysql.connector.pooling.MySQLConnectionPool(
    pool_name="mypool",
    pool_size=5,
    pool_reset_session=True,
    **dbconfig
)

def execute_with_retry(query, params=None, max_retries=3):
    for attempt in range(max_retries):
        try:
            conn = pool.get_connection()
            cursor = conn.cursor()
            cursor.execute(query, params)
            result = cursor.fetchall()
            cursor.close()
            conn.close()
            return result
        except mysql.connector.Error as e:
            if attempt == max_retries - 1:
                raise
            if e.errno in (2003, 2006, 2013):  # Connection errors
                time.sleep(2 ** attempt)
            else:
                raise
```

## Server Parameters Customization

Flexible Server allows customizing MySQL parameters:

```bash
# Update server parameters
az mysql flexible-server parameter set \
    --name innodb_buffer_pool_size \
    --resource-group my-rg \
    --server-name my-mysql-flex \
    --value 2147483648  # 2GB

# Important parameters to tune
az mysql flexible-server parameter set \
    --name max_connections \
    --resource-group my-rg \
    --server-name my-mysql-flex \
    --value 500

az mysql flexible-server parameter set \
    --name slow_query_log \
    --resource-group my-rg \
    --server-name my-mysql-flex \
    --value ON

az mysql flexible-server parameter set \
    --name long_query_time \
    --resource-group my-rg \
    --server-name my-mysql-flex \
    --value 2
```

## Read Replicas for Scale

Create read replicas to offload read traffic:

```bash
# Create read replica
az mysql flexible-server replica create \
    --replica-name my-mysql-flex-replica \
    --resource-group my-rg \
    --source-server my-mysql-flex \
    --location eastus2

# List replicas
az mysql flexible-server replica list \
    --resource-group my-rg \
    --name my-mysql-flex
```

Application-level read/write splitting:

```python
class MySQLReadWriteSplit:
    def __init__(self, write_config, read_configs):
        self.write_pool = mysql.connector.pooling.MySQLConnectionPool(
            pool_name="write_pool",
            pool_size=5,
            **write_config
        )
        self.read_pools = [
            mysql.connector.pooling.MySQLConnectionPool(
                pool_name=f"read_pool_{i}",
                pool_size=3,
                **config
            )
            for i, config in enumerate(read_configs)
        ]
        self._read_index = 0

    def execute_write(self, query, params=None):
        conn = self.write_pool.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(query, params)
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def execute_read(self, query, params=None):
        # Round-robin across read replicas
        pool = self.read_pools[self._read_index % len(self.read_pools)]
        self._read_index += 1

        conn = pool.get_connection()
        try:
            cursor = conn.cursor(dictionary=True)
            cursor.execute(query, params)
            return cursor.fetchall()
        finally:
            conn.close()

# Usage
db = MySQLReadWriteSplit(
    write_config={"host": "primary.mysql.database.azure.com", ...},
    read_configs=[
        {"host": "replica1.mysql.database.azure.com", ...},
        {"host": "replica2.mysql.database.azure.com", ...}
    ]
)

# Writes go to primary
db.execute_write("INSERT INTO orders (customer_id, total) VALUES (%s, %s)", (1, 99.99))

# Reads distributed across replicas
orders = db.execute_read("SELECT * FROM orders WHERE customer_id = %s", (1,))
```

## Backup and Restore

Flexible Server provides automated backups:

```bash
# Configure backup retention
az mysql flexible-server update \
    --name my-mysql-flex \
    --resource-group my-rg \
    --backup-retention 35

# Enable geo-redundant backup
az mysql flexible-server update \
    --name my-mysql-flex \
    --resource-group my-rg \
    --geo-redundant-backup Enabled

# Point-in-time restore
az mysql flexible-server restore \
    --name my-mysql-flex-restored \
    --resource-group my-rg \
    --source-server my-mysql-flex \
    --restore-time "2021-05-10T12:00:00Z"
```

## Stop/Start for Cost Savings

Unique to Flexible Server - stop instances when not in use:

```bash
# Stop server (compute costs stop, storage continues)
az mysql flexible-server stop \
    --name my-mysql-flex \
    --resource-group my-rg

# Start server
az mysql flexible-server start \
    --name my-mysql-flex \
    --resource-group my-rg

# Automate with Logic Apps or Azure Functions
```

Azure Function to auto-stop dev servers:

```python
import azure.functions as func
from azure.identity import DefaultAzureCredential
from azure.mgmt.rdbms.mysql_flexibleservers import MySQLManagementClient

def main(timer: func.TimerRequest) -> None:
    credential = DefaultAzureCredential()
    client = MySQLManagementClient(credential, subscription_id)

    # Stop all dev servers at 7 PM
    dev_servers = ["dev-mysql-1", "dev-mysql-2"]

    for server_name in dev_servers:
        client.servers.begin_stop(
            resource_group_name="dev-rg",
            server_name=server_name
        )
```

## Private Access with VNet Integration

Secure your MySQL server with VNet integration:

```bash
# Create delegated subnet
az network vnet subnet create \
    --name mysql-subnet \
    --vnet-name my-vnet \
    --resource-group my-rg \
    --address-prefix 10.0.1.0/24 \
    --delegations Microsoft.DBforMySQL/flexibleServers

# Create server with private access
az mysql flexible-server create \
    --name my-mysql-private \
    --resource-group my-rg \
    --location eastus \
    --admin-user myadmin \
    --admin-password '<password>' \
    --vnet my-vnet \
    --subnet mysql-subnet \
    --private-dns-zone my-mysql-zone.private.mysql.database.azure.com
```

## Performance Monitoring

Enable Query Performance Insights:

```sql
-- Enable performance schema
SET GLOBAL performance_schema = ON;

-- Find slow queries
SELECT
    DIGEST_TEXT AS query,
    COUNT_STAR AS exec_count,
    SUM_TIMER_WAIT/1000000000000 AS total_time_sec,
    AVG_TIMER_WAIT/1000000000 AS avg_time_ms,
    SUM_ROWS_EXAMINED AS rows_examined
FROM performance_schema.events_statements_summary_by_digest
ORDER BY SUM_TIMER_WAIT DESC
LIMIT 10;
```

Azure Monitor queries:

```kusto
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.DBFORMYSQL"
| where Category == "MySqlSlowLogs"
| project TimeGenerated, query_time_d, sql_text_s, rows_examined_d
| where query_time_d > 2
| order by TimeGenerated desc
```

## Migration from Single Server

Migrating from Single Server to Flexible Server:

```bash
# Export using mysqldump
mysqldump -h single-server.mysql.database.azure.com \
    -u admin@single-server \
    -p \
    --single-transaction \
    --routines \
    --triggers \
    --databases mydb > dump.sql

# Import to Flexible Server
mysql -h flex-server.mysql.database.azure.com \
    -u admin \
    -p \
    --ssl-ca=DigiCertGlobalRootCA.crt.pem \
    < dump.sql
```

For larger databases, use Azure Database Migration Service.

## Resources

- [Flexible Server Documentation](https://docs.microsoft.com/en-us/azure/mysql/flexible-server/)
- [High Availability](https://docs.microsoft.com/en-us/azure/mysql/flexible-server/concepts-high-availability)
- [Migration Guide](https://docs.microsoft.com/en-us/azure/mysql/howto-migrate-single-flexible-minimum-downtime)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
