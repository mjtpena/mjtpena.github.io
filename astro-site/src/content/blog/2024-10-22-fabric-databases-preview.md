---
title: "Fabric Databases Preview: Relational Databases in Microsoft Fabric"
author: "Michael John Peña"
draft: false
date: 2024-10-22
tags: ["Microsoft Fabric", "Databases", "SQL", "Azure", "Preview"]

---

I wrote "Fabric Databases Preview: Relational Databases in Microsoft Fabric" to share practical, production-minded guidance on this topic.

## Understanding Fabric Databases

Fabric Databases bring operational database workloads into the unified Fabric platform, with automatic integration to OneLake.

```python
# Architecture Overview
"""
Fabric Databases:
- SQL Database in Fabric (based on Azure SQL)
- PostgreSQL in Fabric (coming)
- Automatic mirroring to OneLake (Delta format)
- Unified governance with Purview
- Integrated with Fabric analytics
"""
```

## Creating a Fabric SQL Database

```python
from azure.identity import DefaultAzureCredential
import requests

credential = DefaultAzureCredential()
token = credential.get_token("https://api.fabric.microsoft.com/.default")

headers = {
    "Authorization": f"Bearer {token.token}",
    "Content-Type": "application/json"
}

# Create SQL Database in Fabric
workspace_id = "your-workspace-id"

database_config = {
    "displayName": "SalesDatabase",
    "description": "Sales operational database",
    "type": "SQLDatabase",
    "properties": {
        # Performance tier
        "sku": "S0",  # Standard tier
        # Auto-mirroring to OneLake
        "autoMirror": True,
        # Collation
        "collation": "SQL_Latin1_General_CP1_CI_AS"
    }
}

response = requests.post(
    f"https://api.fabric.microsoft.com/v1/workspaces/{workspace_id}/items",
    headers=headers,
    json=database_config
)

database = response.json()
print(f"Created database: {database['id']}")
```

## Connecting and Working with Data

```python
import pyodbc
from azure.identity import DefaultAzureCredential

# Connection options
class FabricDatabaseConnection:
    """Connect to Fabric SQL Database"""

    def __init__(self, workspace_name: str, database_name: str):
        self.server = f"{workspace_name}.database.fabric.microsoft.com"
        self.database = database_name
        self.credential = DefaultAzureCredential()

    def get_connection(self) -> pyodbc.Connection:
        """Get database connection with AAD auth"""
        token = self.credential.get_token(
            "https://database.fabric.microsoft.com/.default"
        )

        conn_str = (
            f"Driver={{ODBC Driver 18 for SQL Server}};"
            f"Server={self.server};"
            f"Database={self.database};"
            f"Encrypt=yes;"
        )

        conn = pyodbc.connect(
            conn_str,
            attrs_before={1256: token.token.encode()}
        )

        return conn

    def execute_query(self, query: str, params: tuple = None):
        """Execute a query and return results"""
        conn = self.get_connection()
        cursor = conn.cursor()

        if params:
            cursor.execute(query, params)
        else:
            cursor.execute(query)

        if cursor.description:
            columns = [col[0] for col in cursor.description]
            results = [dict(zip(columns, row)) for row in cursor.fetchall()]
            return results

        conn.commit()
        return cursor.rowcount

# Usage
db = FabricDatabaseConnection("my-workspace", "SalesDatabase")

# Create tables
db.execute_query("""
    CREATE TABLE customers (
        customer_id INT PRIMARY KEY IDENTITY(1,1),
        name NVARCHAR(100) NOT NULL,
        email NVARCHAR(255),
        created_at DATETIME2 DEFAULT GETUTCDATE()
    )
""")

db.execute_query("""
    CREATE TABLE orders (
        order_id INT PRIMARY KEY IDENTITY(1,1),
        customer_id INT REFERENCES customers(customer_id),
        amount DECIMAL(10, 2) NOT NULL,
        status NVARCHAR(20) DEFAULT 'pending',
        order_date DATETIME2 DEFAULT GETUTCDATE()
    )
""")

# Insert data
db.execute_query(
    "INSERT INTO customers (name, email) VALUES (?, ?)",
    ("John Doe", "john@example.com")
)

# Query data
customers = db.execute_query("SELECT * FROM customers")
```

## Auto-Mirroring to OneLake

```python
# Data automatically mirrors to OneLake in Delta format
from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

# Access mirrored data in Lakehouse
# Path: abfss://workspace@onelake.dfs.fabric.microsoft.com/database/Tables/

# Read mirrored customer data
customers_df = spark.read.format("delta").load(
    "abfss://my-workspace@onelake.dfs.fabric.microsoft.com/"
    "SalesDatabase.Database/Tables/dbo/customers"
)

customers_df.show()

# Join with analytical data
analytics_df = spark.read.format("delta").load(
    "abfss://my-workspace@onelake.dfs.fabric.microsoft.com/"
    "AnalyticsLakehouse.Lakehouse/Tables/customer_segments"
)

# Combine operational and analytical data
enriched = customers_df.join(
    analytics_df,
    "customer_id"
).select(
    "customer_id",
    "name",
    "email",
    "segment",
    "lifetime_value"
)
```

## Real-Time Sync Configuration

```python
# Configure real-time sync between database and OneLake
sync_config = {
    "displayName": "CustomerSync",
    "sourceDatabase": "SalesDatabase",
    "tables": [
        {
            "schema": "dbo",
            "table": "customers",
            "syncMode": "incremental",  # or "full"
            "changeTracking": True,
            "watermarkColumn": "updated_at"
        },
        {
            "schema": "dbo",
            "table": "orders",
            "syncMode": "incremental",
            "changeTracking": True,
            "watermarkColumn": "order_date"
        }
    ],
    "schedule": {
        "type": "continuous",  # or "scheduled"
        "latencySeconds": 30
    }
}

# Mirroring happens automatically with ~30 second latency
# Changes are captured via SQL Server Change Tracking
```

## Querying Across Operational and Analytical Data

```python
# T-SQL cross-database queries
cross_db_query = """
    -- Query operational data
    SELECT
        o.order_id,
        c.name as customer_name,
        o.amount,
        o.order_date
    FROM SalesDatabase.dbo.orders o
    JOIN SalesDatabase.dbo.customers c ON o.customer_id = c.customer_id
    WHERE o.order_date >= DATEADD(day, -30, GETUTCDATE())

    -- Join with analytical insights from Lakehouse
    -- Using external tables or views
"""

# Create external table pointing to Lakehouse
db.execute_query("""
    CREATE EXTERNAL TABLE customer_insights (
        customer_id INT,
        segment NVARCHAR(50),
        lifetime_value DECIMAL(10, 2),
        churn_risk FLOAT
    )
    WITH (
        LOCATION = 'Tables/customer_insights',
        DATA_SOURCE = OneLakehouse,
        FILE_FORMAT = DeltaFormat
    )
""")

# Now query across operational and analytical data
results = db.execute_query("""
    SELECT
        c.name,
        c.email,
        i.segment,
        i.churn_risk,
        SUM(o.amount) as total_orders
    FROM customers c
    JOIN customer_insights i ON c.customer_id = i.customer_id
    JOIN orders o ON c.customer_id = o.customer_id
    GROUP BY c.name, c.email, i.segment, i.churn_risk
    HAVING i.churn_risk > 0.7
""")
```

## Performance Optimization

```python
# Index recommendations
db.execute_query("""
    -- Fabric provides automatic index recommendations
    SELECT * FROM sys.dm_db_index_usage_stats

    -- Create recommended indexes
    CREATE NONCLUSTERED INDEX IX_orders_customer_date
    ON orders (customer_id, order_date)
    INCLUDE (amount, status)
""")

# Query Store for performance insights
db.execute_query("""
    -- Enable Query Store (on by default)
    ALTER DATABASE CURRENT SET QUERY_STORE = ON;

    -- Review top resource-consuming queries
    SELECT TOP 10
        qt.query_sql_text,
        rs.avg_duration,
        rs.avg_cpu_time,
        rs.count_executions
    FROM sys.query_store_query_text qt
    JOIN sys.query_store_query q ON qt.query_text_id = q.query_text_id
    JOIN sys.query_store_plan p ON q.query_id = p.query_id
    JOIN sys.query_store_runtime_stats rs ON p.plan_id = rs.plan_id
    ORDER BY rs.avg_cpu_time DESC
""")

# Automatic tuning
db.execute_query("""
    -- Fabric enables automatic tuning
    ALTER DATABASE CURRENT SET AUTOMATIC_TUNING = ON;
""")
```

## Migration from Azure SQL

```python
class FabricMigration:
    """Helper for migrating from Azure SQL to Fabric Database"""

    def __init__(self, source_conn: str, fabric_conn: FabricDatabaseConnection):
        self.source = pyodbc.connect(source_conn)
        self.fabric = fabric_conn

    def migrate_schema(self, tables: list):
        """Migrate table schemas"""
        for table in tables:
            # Get schema from source
            schema = self._get_table_schema(table)

            # Create in Fabric
            self.fabric.execute_query(schema)

    def migrate_data(self, table: str, batch_size: int = 10000):
        """Migrate data in batches"""
        cursor = self.source.cursor()
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        total_rows = cursor.fetchone()[0]

        offset = 0
        while offset < total_rows:
            cursor.execute(f"""
                SELECT * FROM {table}
                ORDER BY (SELECT NULL)
                OFFSET {offset} ROWS
                FETCH NEXT {batch_size} ROWS ONLY
            """)

            rows = cursor.fetchall()
            columns = [col[0] for col in cursor.description]

            # Insert into Fabric
            self._bulk_insert(table, columns, rows)

            offset += batch_size
            print(f"Migrated {min(offset, total_rows)}/{total_rows} rows")

    def _get_table_schema(self, table: str) -> str:
        """Get CREATE TABLE statement"""
        # Implementation to generate DDL
        pass

    def _bulk_insert(self, table: str, columns: list, rows: list):
        """Bulk insert data"""
        placeholders = ", ".join(["?" for _ in columns])
        cols = ", ".join(columns)
        query = f"INSERT INTO {table} ({cols}) VALUES ({placeholders})"

        conn = self.fabric.get_connection()
        cursor = conn.cursor()
        cursor.executemany(query, rows)
        conn.commit()
```

Fabric Databases bring operational workloads into the unified Fabric platform. The automatic mirroring to OneLake enables seamless integration between transactional and analytical workloads.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
