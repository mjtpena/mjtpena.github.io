---
title: "High Availability Architecture for MySQL on Azure"
description: "Implementing these HA patterns ensures your MySQL applications remain resilient during infrastructure failures."
author: "Michael John Peña"
draft: false
date: 2022-07-11
tags: ["Azure", "MySQL", "High Availability", "Disaster Recovery", "Architecture"]
---

## HA Architecture Options

### Zone-Redundant High Availability

```bash
# Create a zone-redundant HA server
az mysql flexible-server create \
    --resource-group myResourceGroup \
    --name myhaserver \
    --location eastus \
    --admin-user myadmin \
    --admin-password 'SecurePassword123!' \
    --sku-name Standard_D4ds_v4 \
    --tier GeneralPurpose \
    --high-availability ZoneRedundant \
    --zone 1 \
    --standby-zone 2
```

### Same-Zone High Availability

```bash
# Create a same-zone HA server (lower cost)
az mysql flexible-server create \
    --resource-group myResourceGroup \
    --name myhaserver-samezone \
    --location eastus \
    --admin-user myadmin \
    --admin-password 'SecurePassword123!' \
    --sku-name Standard_D2ds_v4 \
    --tier GeneralPurpose \
    --high-availability SameZone
```

## Understanding Failover

```python
import mysql.connector
from mysql.connector import Error
import time

def connect_with_retry(max_retries=5, retry_delay=5):
    """Connection logic that handles failover"""
    config = {
        'host': 'myhaserver.mysql.database.azure.com',
        'database': 'mydb',
        'user': 'myadmin',
        'password': 'SecurePassword123!',
        'ssl_ca': '/path/to/DigiCertGlobalRootCA.crt.pem',
        'connection_timeout': 10,
        'autocommit': True
    }

    for attempt in range(max_retries):
        try:
            connection = mysql.connector.connect(**config)
            print(f"Connected successfully on attempt {attempt + 1}")
            return connection
        except Error as e:
            print(f"Attempt {attempt + 1} failed: {e}")
            if attempt < max_retries - 1:
                time.sleep(retry_delay)

    raise Exception("Failed to connect after all retries")

def execute_with_failover_handling(connection, query, params=None):
    """Execute query with automatic reconnection on failover"""
    max_retries = 3

    for attempt in range(max_retries):
        try:
            cursor = connection.cursor()
            cursor.execute(query, params)
            return cursor.fetchall()
        except mysql.connector.errors.OperationalError as e:
            if e.errno in (2006, 2013):  # Server gone away, Lost connection
                print(f"Connection lost, reconnecting... (attempt {attempt + 1})")
                connection = connect_with_retry()
            else:
                raise

    raise Exception("Query failed after all retries")
```

## Monitoring HA Status

```bash
# Check HA status
az mysql flexible-server show \
    --resource-group myResourceGroup \
    --name myhaserver \
    --query "{name:name, haState:highAvailability.state, haMode:highAvailability.mode}"

# View HA events in activity log
az monitor activity-log list \
    --resource-group myResourceGroup \
    --query "[?contains(operationName.value, 'failover')]"
```

## Planned Failover Testing

```bash
# Initiate a planned failover to test your application
az mysql flexible-server restart \
    --resource-group myResourceGroup \
    --name myhaserver \
    --failover Planned
```

## Connection String Best Practices

```python
# Use connection pooling for resilience
from mysql.connector import pooling

db_pool = pooling.MySQLConnectionPool(
    pool_name="mypool",
    pool_size=5,
    pool_reset_session=True,
    host='myhaserver.mysql.database.azure.com',
    database='mydb',
    user='myadmin',
    password='SecurePassword123!',
    ssl_ca='/path/to/DigiCertGlobalRootCA.crt.pem'
)

def get_connection():
    """Get a connection from the pool"""
    return db_pool.get_connection()

def execute_query(query):
    """Execute query using pooled connection"""
    conn = None
    try:
        conn = get_connection()
        cursor = conn.cursor()
        cursor.execute(query)
        return cursor.fetchall()
    finally:
        if conn:
            conn.close()  # Returns to pool
```

## Application-Level Health Checks

```python
from flask import Flask, jsonify
import mysql.connector

app = Flask(__name__)

@app.route('/health/db')
def db_health():
    """Database health check endpoint"""
    try:
        conn = mysql.connector.connect(
            host='myhaserver.mysql.database.azure.com',
            database='mydb',
            user='myadmin',
            password='SecurePassword123!',
            connection_timeout=5
        )
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.fetchone()
        conn.close()

        return jsonify({"status": "healthy", "database": "connected"}), 200
    except Exception as e:
        return jsonify({"status": "unhealthy", "error": str(e)}), 503
```

Implementing these HA patterns ensures your MySQL applications remain resilient during infrastructure failures.
