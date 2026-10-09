---
title: "Scaling Reads with MySQL Read Replicas on Azure"
description: "Read replicas in Azure Database for MySQL Flexible Server enable scaling out read-heavy workloads by directing reporting queries, analytical queries, and…"
author: "Michael John Peña"
draft: false
date: 2022-07-12
tags: ["Azure", "MySQL", "Read Replicas", "Scaling", "Performance"]
---

Read replicas in Azure Database for MySQL Flexible Server enable scaling out read-heavy workloads by directing reporting queries, analytical queries, and read-heavy application traffic to replica servers while writes continue to the primary—up to five read replicas per Flexible Server primary (as of 2022). The replication mechanism: MySQL's native asynchronous binary log replication; the replica applies binary log events from the primary with a small lag (typically sub-second for low-write-volume primaries; potentially seconds behind for high-write-volume primaries with slow replica I/O). The architectural pattern for web applications: the application uses a primary connection string for all write operations; a separate connection string pointing to a read replica for all read queries; the application handles the replication lag by either accepting slightly stale data for reads or routing reads that require up-to-date data to the primary. Read replicas can be in a different region from the primary (cross-region replicas)—useful for disaster recovery promotion (the cross-region replica is promoted to a standalone server during regional failure) and for serving reads with lower latency to users in the replica's region. Read replicas are not the right tool for write scaling (all writes still go to the primary) or for high-availability (asynchronous replication means data loss is possible on failover).

## Creating Read Replicas

```bash
# Create the primary server first
az mysql flexible-server create \
    --resource-group myResourceGroup \
    --name myprimaryserver \
    --location eastus \
    --admin-user myadmin \
    --admin-password 'SecurePassword123!' \
    --sku-name Standard_D4ds_v4

# Create a read replica
az mysql flexible-server replica create \
    --resource-group myResourceGroup \
    --name myreadreplica1 \
    --source-server myprimaryserver \
    --location eastus

# Create a replica in another region for disaster recovery
az mysql flexible-server replica create \
    --resource-group myResourceGroup \
    --name myreadreplica-westus \
    --source-server myprimaryserver \
    --location westus2
```

## Application-Level Read/Write Splitting

```python
import mysql.connector
from mysql.connector import pooling
import random

class MySQLReadWriteSplit:
    def __init__(self):
        self.write_config = {
            'host': 'myprimaryserver.mysql.database.azure.com',
            'database': 'mydb',
            'user': 'myadmin',
            'password': 'SecurePassword123!',
            'ssl_ca': '/path/to/cert.pem'
        }

        self.read_configs = [
            {
                'host': 'myreadreplica1.mysql.database.azure.com',
                'database': 'mydb',
                'user': 'myadmin',
                'password': 'SecurePassword123!',
                'ssl_ca': '/path/to/cert.pem'
            },
            {
                'host': 'myreadreplica-westus.mysql.database.azure.com',
                'database': 'mydb',
                'user': 'myadmin',
                'password': 'SecurePassword123!',
                'ssl_ca': '/path/to/cert.pem'
            }
        ]

        # Create connection pools
        self.write_pool = pooling.MySQLConnectionPool(
            pool_name="write_pool",
            pool_size=5,
            **self.write_config
        )

        self.read_pools = [
            pooling.MySQLConnectionPool(
                pool_name=f"read_pool_{i}",
                pool_size=10,
                **config
            )
            for i, config in enumerate(self.read_configs)
        ]

    def get_write_connection(self):
        """Get connection for write operations"""
        return self.write_pool.get_connection()

    def get_read_connection(self):
        """Get connection from a random read replica"""
        pool = random.choice(self.read_pools)
        return pool.get_connection()

    def execute_write(self, query, params=None):
        """Execute a write query on primary"""
        conn = self.get_write_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(query, params)
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def execute_read(self, query, params=None):
        """Execute a read query on a replica"""
        conn = self.get_read_connection()
        try:
            cursor = conn.cursor(dictionary=True)
            cursor.execute(query, params)
            return cursor.fetchall()
        finally:
            conn.close()

# Usage
db = MySQLReadWriteSplit()

# Writes go to primary
user_id = db.execute_write(
    "INSERT INTO users (name, email) VALUES (%s, %s)",
    ("John Doe", "john@example.com")
)

# Reads go to replicas
users = db.execute_read("SELECT * FROM users WHERE active = 1")
```

## Monitoring Replication Lag

```sql
-- Check replication status on replica
SHOW SLAVE STATUS\G

-- Key metrics to monitor:
-- Seconds_Behind_Master: Replication lag
-- Slave_IO_Running: Should be 'Yes'
-- Slave_SQL_Running: Should be 'Yes'
```

```python
def check_replication_lag(replica_connection):
    """Check replication lag on a replica"""
    cursor = replica_connection.cursor(dictionary=True)
    cursor.execute("SHOW SLAVE STATUS")
    status = cursor.fetchone()

    if status:
        return {
            'seconds_behind_master': status.get('Seconds_Behind_Master'),
            'io_running': status.get('Slave_IO_Running'),
            'sql_running': status.get('Slave_SQL_Running'),
            'last_error': status.get('Last_Error')
        }
    return None
```

## Handling Replication Lag in Reads

```python
class LagAwareReadWriteSplit(MySQLReadWriteSplit):
    def __init__(self, max_acceptable_lag=5):
        super().__init__()
        self.max_acceptable_lag = max_acceptable_lag

    def get_healthy_read_connection(self):
        """Get connection from a replica with acceptable lag"""
        for pool in self.read_pools:
            conn = pool.get_connection()
            lag_info = check_replication_lag(conn)

            if lag_info and lag_info['seconds_behind_master'] <= self.max_acceptable_lag:
                return conn
            else:
                conn.close()

        # Fall back to primary if all replicas have high lag
        print("Warning: All replicas have high lag, using primary for read")
        return self.get_write_connection()

    def execute_read_after_write(self, query, params=None):
        """Use primary for reads that need to see recent writes"""
        conn = self.get_write_connection()
        try:
            cursor = conn.cursor(dictionary=True)
            cursor.execute(query, params)
            return cursor.fetchall()
        finally:
            conn.close()
```

## Promoting a Replica

```bash
# Promote a replica to become a standalone server
az mysql flexible-server replica stop-replication \
    --resource-group myResourceGroup \
    --name myreadreplica1

# After promotion, the replica becomes an independent server
# You'll need to update your application configuration
```

Read replicas are essential for scaling read-heavy workloads while maintaining a single source of truth for writes.
