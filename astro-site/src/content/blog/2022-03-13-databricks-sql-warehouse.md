---
title: "Databricks SQL: Analytics Warehousing on the Lakehouse"
author: Michael John Peña
draft: false
date: 2022-03-13
tags:
  - Azure
  - Databricks
  - SQL
  - Data Warehouse
  - Analytics

---

I wrote "Databricks SQL: Analytics Warehousing on the Lakehouse" to share practical, production-minded guidance on this topic.

## What is Databricks SQL?

Databricks SQL offers:
- **SQL Endpoints**: Serverless compute for SQL queries
- **Query Editor**: Web-based SQL IDE
- **Dashboards**: Built-in visualization and reporting
- **Alerts**: Automated monitoring and notifications

## Creating a SQL Warehouse

```python
# Using Databricks REST API
import requests

workspace_url = "https://adb-xxxx.azuredatabricks.net"
token = os.environ["DATABRICKS_TOKEN"]

headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}

# Create SQL Warehouse
warehouse_config = {
    "name": "analytics-warehouse",
    "cluster_size": "Medium",
    "min_num_clusters": 1,
    "max_num_clusters": 4,
    "auto_stop_mins": 30,
    "enable_photon": True,
    "enable_serverless_compute": True,
    "warehouse_type": "PRO",
    "tags": {
        "custom_tags": [
            {"key": "department", "value": "analytics"},
            {"key": "cost_center", "value": "CC-123"}
        ]
    }
}

response = requests.post(
    f"{workspace_url}/api/2.0/sql/warehouses",
    headers=headers,
    json=warehouse_config
)

warehouse = response.json()
print(f"Warehouse created: {warehouse['id']}")
```

## Warehouse Sizing

Choose the right size for your workload:

| Size | Workers | Use Case |
|------|---------|----------|
| 2X-Small | 1 | Development, testing |
| X-Small | 2 | Light ad-hoc queries |
| Small | 4 | Small team analytics |
| Medium | 8 | Standard analytics |
| Large | 16 | Heavy concurrent usage |
| X-Large | 32 | Enterprise workloads |
| 2X-Large | 64 | Large-scale analytics |

## Optimizing Query Performance

### Table Optimization

```sql
-- Optimize table layout for query patterns
OPTIMIZE production.sales.transactions
ZORDER BY (customer_id, transaction_date);

-- Analyze table statistics
ANALYZE TABLE production.sales.transactions
COMPUTE STATISTICS FOR ALL COLUMNS;

-- Check table statistics
DESCRIBE EXTENDED production.sales.transactions;
```

### Query Optimization

```sql
-- Use predicate pushdown
SELECT * FROM production.sales.transactions
WHERE transaction_date >= '2022-01-01'  -- Pushes filter to storage
AND region = 'US';

-- Avoid SELECT *
SELECT transaction_id, amount, transaction_date
FROM production.sales.transactions
WHERE region = 'US';

-- Use appropriate joins
-- Broadcast small tables
SELECT /*+ BROADCAST(dim) */ f.*, dim.category_name
FROM production.sales.transactions f
JOIN production.dim.product_categories dim
ON f.category_id = dim.category_id;
```

## Query Profiles and Diagnostics

```python
# Get query history
def get_query_history(warehouse_id, hours=24):
    response = requests.get(
        f"{workspace_url}/api/2.0/sql/history/queries",
        headers=headers,
        params={
            "filter_by.warehouse_ids": [warehouse_id],
            "include_metrics": True,
            "max_results": 100
        }
    )
    return response.json()

# Analyze slow queries
history = get_query_history(warehouse_id)
slow_queries = [
    q for q in history['res']
    if q.get('metrics', {}).get('execution_time_ms', 0) > 30000
]

for query in slow_queries:
    print(f"Query ID: {query['query_id']}")
    print(f"Duration: {query['metrics']['execution_time_ms']}ms")
    print(f"Rows: {query['metrics']['rows_produced_count']}")
    print(f"SQL: {query['query_text'][:100]}...")
```

## Building Dashboards

```python
# Create a dashboard via API
dashboard_config = {
    "name": "Sales Performance",
    "tags": ["sales", "executive"],
    "widgets": []
}

response = requests.post(
    f"{workspace_url}/api/2.0/preview/sql/dashboards",
    headers=headers,
    json=dashboard_config
)

dashboard = response.json()
dashboard_id = dashboard['id']

# Add a visualization widget
visualization_config = {
    "dashboard_id": dashboard_id,
    "visualization": {
        "query_id": "query-123",
        "type": "CHART",
        "name": "Daily Revenue",
        "options": {
            "chartType": "line",
            "xAxis": {"column": "date"},
            "yAxis": [{"column": "revenue", "type": "sum"}]
        }
    },
    "width": 3,
    "position": {"col": 0, "row": 0}
}

requests.post(
    f"{workspace_url}/api/2.0/preview/sql/widgets",
    headers=headers,
    json=visualization_config
)
```

## SQL Alerts

Set up automated alerts:

```python
# Create an alert
alert_config = {
    "name": "Low Inventory Alert",
    "query_id": "query-inventory-check",
    "options": {
        "column": "low_stock_count",
        "op": ">",
        "value": 10
    },
    "rearm": 300  # Seconds before re-triggering
}

response = requests.post(
    f"{workspace_url}/api/2.0/preview/sql/alerts",
    headers=headers,
    json=alert_config
)

alert = response.json()

# Set up notification destination
notification_config = {
    "alert_id": alert['id'],
    "notification_destination_id": "email-dest-123"
}

requests.post(
    f"{workspace_url}/api/2.0/preview/sql/alert-subscriptions",
    headers=headers,
    json=notification_config
)
```

## Connecting BI Tools

### Power BI

```python
# Get connection details
response = requests.get(
    f"{workspace_url}/api/2.0/sql/warehouses/{warehouse_id}",
    headers=headers
)

warehouse = response.json()
connection_info = {
    "server": warehouse['odbc_params']['hostname'],
    "port": warehouse['odbc_params']['port'],
    "http_path": warehouse['odbc_params']['path'],
    "catalog": "production",
    "schema": "analytics"
}

print("Power BI Connection:")
print(f"Server: {connection_info['server']}")
print(f"HTTP Path: {connection_info['http_path']}")
```

### JDBC/ODBC Connection String

```
# JDBC
jdbc:spark://{server}:443/default;transportMode=http;ssl=1;
httpPath={http_path};AuthMech=3;UID=token;PWD={personal_access_token}

# ODBC
Driver=Simba Spark ODBC Driver;Host={server};Port=443;
HTTPPath={http_path};AuthMech=3;SSL=1;ThriftTransport=2;
UID=token;PWD={personal_access_token}
```

## Query Federation

Query external data sources:

```sql
-- Create external connection
CREATE CONNECTION snowflake_conn
TYPE snowflake
OPTIONS (
    host 'account.snowflakecomputing.com',
    user 'service_account',
    password secret('scope', 'snowflake-password')
);

-- Create foreign catalog
CREATE FOREIGN CATALOG snowflake_data
USING CONNECTION snowflake_conn
OPTIONS (database 'ANALYTICS');

-- Query federated data
SELECT
    d.customer_id,
    d.customer_name,
    s.total_orders
FROM snowflake_data.public.customers s
JOIN production.sales.order_summary d
ON s.customer_id = d.customer_id;
```

## Cost Management

Monitor and control costs:

```python
def get_warehouse_usage(warehouse_id, days=30):
    """Get warehouse usage and estimated cost"""

    # Get billing usage
    response = requests.get(
        f"{workspace_url}/api/2.0/sql/warehouses/{warehouse_id}/usage",
        headers=headers,
        params={"days": days}
    )

    usage = response.json()

    # Calculate costs
    dbu_price = 0.55  # Example price per DBU
    total_dbus = sum(d['total_dbus'] for d in usage['usage'])
    estimated_cost = total_dbus * dbu_price

    return {
        "total_dbus": total_dbus,
        "estimated_cost": estimated_cost,
        "daily_average": total_dbus / days
    }

# Implement auto-scaling limits
def configure_auto_scaling(warehouse_id, min_clusters, max_clusters, auto_stop_mins):
    config = {
        "min_num_clusters": min_clusters,
        "max_num_clusters": max_clusters,
        "auto_stop_mins": auto_stop_mins
    }

    requests.post(
        f"{workspace_url}/api/2.0/sql/warehouses/{warehouse_id}/edit",
        headers=headers,
        json=config
    )
```

## Query Caching

Leverage result caching:

```sql
-- Results are cached by default for identical queries
-- Cache TTL is based on underlying data changes (Delta Lake)

-- Force cache refresh
SELECT /*+ REFRESH_CACHE */ *
FROM production.sales.daily_summary
WHERE date = current_date();

-- Check if result was from cache
-- Look at query profile for "Cache Hit"
```

## Parameterized Queries

```sql
-- Create parameterized query for reuse
-- Parameters are defined with {{ parameter_name }}

SELECT
    region,
    SUM(revenue) as total_revenue,
    COUNT(DISTINCT customer_id) as unique_customers
FROM production.sales.transactions
WHERE transaction_date BETWEEN '{{ start_date }}' AND '{{ end_date }}'
AND region IN ({{ regions }})
GROUP BY region
ORDER BY total_revenue DESC;
```

## Best Practices

### Query Optimization Checklist

```sql
-- 1. Filter early and precisely
SELECT * FROM large_table WHERE partition_col = 'value';

-- 2. Use LIMIT during exploration
SELECT * FROM large_table LIMIT 1000;

-- 3. Avoid cross joins
-- Bad: SELECT * FROM t1, t2
-- Good: SELECT * FROM t1 JOIN t2 ON t1.key = t2.key

-- 4. Use CTEs for readability and optimization
WITH recent_orders AS (
    SELECT * FROM orders WHERE order_date > dateadd(day, -30, current_date())
)
SELECT customer_id, COUNT(*)
FROM recent_orders
GROUP BY customer_id;

-- 5. Leverage materialized views for repeated queries
CREATE MATERIALIZED VIEW mv_daily_sales AS
SELECT date, SUM(revenue) as daily_revenue
FROM transactions
GROUP BY date;
```

### Warehouse Configuration Tips

1. **Start small**: Begin with smaller warehouses and scale up based on query profiles
2. **Use auto-stop**: Set appropriate auto-stop (15-60 minutes) to control costs
3. **Enable Photon**: Always enable for better performance (included in pricing)
4. **Set concurrency limits**: Prevent runaway queries from impacting others
5. **Use warehouse types appropriately**: Classic for batch, Pro/Serverless for interactive

## Conclusion

Databricks SQL brings traditional data warehouse capabilities to the lakehouse architecture. With serverless compute, Photon acceleration, and native Unity Catalog integration, it provides a modern SQL analytics experience without the complexity of managing separate systems.

Key advantages:
- No data movement between lake and warehouse
- Unified governance with Unity Catalog
- Automatic optimization with Photon
- Serverless scaling
- Rich ecosystem connectivity

## Resources

- [Databricks SQL Documentation](https://docs.databricks.com/sql/index.html)
- [SQL Warehouse Configuration](https://docs.databricks.com/sql/admin/sql-endpoints.html)
- [Query Performance Tuning](https://docs.databricks.com/sql/admin/query-performance.html)

