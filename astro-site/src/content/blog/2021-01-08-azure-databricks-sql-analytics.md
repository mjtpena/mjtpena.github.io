---
title: "Databricks SQL Analytics: BI on the Lakehouse"
author: Michael John Peña
draft: false
date: 2021-01-08
tags:
  - Azure
  - Databricks
  - SQL
  - Analytics
---

SQL Analytics is Databricks' bid for the BI persona who never wanted to learn PySpark. A T-SQL endpoint over Delta Lake, a query editor that looks like every other web SQL UI, and dashboards that don't require Power BI to render. For lakehouse architectures it closes the last awkward gap—data engineers in notebooks, analysts in SQL, both writing against the same Delta tables. Not a replacement for Power BI, but a credible answer to "I just need to write a query."

## SQL Endpoints

```sql
-- Create SQL endpoint (via UI or API)
-- SQL endpoints provide serverless compute for queries

-- Query Delta tables
SELECT
    product_category,
    SUM(revenue) as total_revenue,
    COUNT(DISTINCT customer_id) as unique_customers
FROM delta.`/mnt/data/sales`
WHERE order_date >= '2021-01-01'
GROUP BY product_category
ORDER BY total_revenue DESC
```

## SQL Endpoint Configuration

```json
{
    "name": "analytics-endpoint",
    "cluster_size": "Medium",
    "min_num_clusters": 1,
    "max_num_clusters": 10,
    "auto_stop_mins": 30,
    "enable_photon": true,
    "spot_instance_policy": "COST_OPTIMIZED",
    "channel": "CHANNEL_NAME_CURRENT"
}
```

## Query History and Optimization

```sql
-- View query history
SELECT
    query_id,
    query_text,
    execution_time_ms,
    rows_produced,
    bytes_read
FROM system.query_history
WHERE start_time >= current_date() - INTERVAL 7 DAYS
ORDER BY execution_time_ms DESC
LIMIT 20

-- Analyze query plan
EXPLAIN FORMATTED
SELECT * FROM sales WHERE product_id = 'ABC123'
```

## Photon Engine

Photon accelerates SQL queries on Delta Lake:

```sql
-- Photon automatically optimizes:
-- - Joins
-- - Aggregations
-- - Filters on Parquet/Delta

-- Check Photon usage
SELECT
    query_id,
    photon_enabled,
    photon_cpu_time_ms,
    total_time_ms
FROM system.query_history
WHERE start_time >= current_date()
```

## Built-in Visualizations

```sql
-- Query results can be visualized directly
-- Supported chart types:
-- - Bar, Line, Area charts
-- - Pie, Scatter plots
-- - Maps
-- - Tables with formatting
-- - Counters and gauges

SELECT
    DATE_TRUNC('month', order_date) as month,
    SUM(revenue) as monthly_revenue
FROM sales
WHERE order_date >= '2020-01-01'
GROUP BY 1
ORDER BY 1
-- Visualize as Line Chart
```

## Dashboards

```python
# Create dashboard via API
import requests

dashboard = {
    "name": "Sales Dashboard",
    "tags": ["sales", "monthly"],
    "widgets": [
        {
            "visualization_id": "viz_123",
            "options": {
                "position": {"col": 0, "row": 0, "size_x": 6, "size_y": 4}
            }
        }
    ]
}

response = requests.post(
    f"{workspace_url}/api/2.0/preview/sql/dashboards",
    headers={"Authorization": f"Bearer {token}"},
    json=dashboard
)
```

## Alerts

```sql
-- Create alert on query results
-- Alert when daily revenue drops below threshold

SELECT SUM(revenue) as daily_revenue
FROM sales
WHERE order_date = current_date()

-- Alert configuration:
-- Trigger when: daily_revenue < 10000
-- Frequency: Every 1 hour
-- Notify: email, Slack, PagerDuty
```

## Connect BI Tools

### Power BI

```
// Connection string
Server: adb-xxxxx.azuredatabricks.net
HTTP Path: /sql/1.0/endpoints/xxxxx
Authentication: Azure AD
```

### Tableau

```
Server: adb-xxxxx.azuredatabricks.net
Port: 443
HTTP Path: /sql/1.0/endpoints/xxxxx
Authentication: Personal Access Token
```

## Query Parameters

```sql
-- Parameterized queries
SELECT *
FROM sales
WHERE product_category = {{ category }}
  AND order_date BETWEEN {{ start_date }} AND {{ end_date }}
  AND revenue >= {{ min_revenue }}

-- Parameters appear as input fields in the UI
```

## Access Control

```sql
-- Grant query access
GRANT SELECT ON TABLE sales TO `analysts@company.com`;
GRANT USAGE ON SCHEMA analytics TO `analysts@company.com`;

-- Grant dashboard access
GRANT VIEW ON DASHBOARD `Sales Dashboard` TO `managers@company.com`;
```

## Cost Optimization

| Tip | Benefit |
|-----|---------|
| Use Photon | 2-8x faster queries |
| Auto-stop | No idle costs |
| Spot instances | Lower compute costs |
| Query caching | Avoid redundant scans |

Databricks SQL: warehouse speed on lakehouse data.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
