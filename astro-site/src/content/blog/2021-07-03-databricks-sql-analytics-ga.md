---
title: Databricks SQL Analytics is Now Generally Available
author: Michael John Peña
draft: false
date: 2021-07-03
url: /blog/databricks-sql-analytics-ga/
tags:
  - Azure
  - Data
  - Databricks
  - SQL
  - Analytics

---

I wrote "2021-07-03-databricks-sql-analytics-ga" to share practical, production-minded guidance on this topic.

# What is Databricks SQL Analytics?

Databricks SQL Analytics provides:

- Native SQL interface to query Delta Lake tables
- SQL Endpoints with auto-scaling compute
- Built-in visualization and dashboarding
- Integration with popular BI tools like Power BI and Tableau
- Query history and performance monitoring

# Setting Up SQL Endpoints

Create a SQL Endpoint using the Azure Databricks workspace:

```python
# Using Databricks CLI to create SQL Endpoint
databricks sql endpoints create --json '{
    "name": "analytics-endpoint",
    "cluster_size": "Medium",
    "min_num_clusters": 1,
    "max_num_clusters": 5,
    "auto_stop_mins": 30,
    "enable_photon": true,
    "spot_instance_policy": "COST_OPTIMIZED",
    "channel": {
        "name": "CHANNEL_NAME_CURRENT"
    }
}'
```

Or configure through Terraform:

```hcl
resource "databricks_sql_endpoint" "analytics" {
  name             = "analytics-endpoint"
  cluster_size     = "Medium"
  min_num_clusters = 1
  max_num_clusters = 5
  auto_stop_mins   = 30

  enable_photon = true

  tags {
    custom_tags {
      key   = "Environment"
      value = "Production"
    }
  }
}
```

# Querying Delta Lake Tables

Write standard SQL to query your data lake:

```sql
-- Create a database for analytics
CREATE DATABASE IF NOT EXISTS analytics;
USE analytics;

-- Create a managed Delta table
CREATE TABLE IF NOT EXISTS sales_summary (
    date DATE,
    product_category STRING,
    region STRING,
    total_sales DECIMAL(18,2),
    transaction_count INT
)
USING DELTA
PARTITIONED BY (date)
COMMENT 'Daily sales summary by category and region';

-- Insert aggregated data
INSERT INTO sales_summary
SELECT
    sale_date as date,
    product_category,
    region,
    SUM(amount) as total_sales,
    COUNT(*) as transaction_count
FROM raw_data.transactions
WHERE sale_date >= '2021-01-01'
GROUP BY sale_date, product_category, region;

-- Query with window functions
SELECT
    date,
    product_category,
    total_sales,
    LAG(total_sales) OVER (
        PARTITION BY product_category
        ORDER BY date
    ) as previous_day_sales,
    total_sales - LAG(total_sales) OVER (
        PARTITION BY product_category
        ORDER BY date
    ) as sales_change
FROM sales_summary
WHERE date >= DATE_SUB(CURRENT_DATE(), 30)
ORDER BY date DESC, product_category;
```

# Creating Visualizations

Build visualizations directly in the SQL Analytics interface:

```sql
-- Query for time series visualization
SELECT
    DATE_TRUNC('week', date) as week,
    product_category,
    SUM(total_sales) as weekly_sales
FROM sales_summary
WHERE date >= DATE_SUB(CURRENT_DATE(), 90)
GROUP BY DATE_TRUNC('week', date), product_category
ORDER BY week;

-- Query for geographic distribution
SELECT
    region,
    SUM(total_sales) as total_sales,
    SUM(transaction_count) as total_transactions,
    SUM(total_sales) / SUM(transaction_count) as avg_transaction_value
FROM sales_summary
WHERE date >= DATE_TRUNC('month', CURRENT_DATE())
GROUP BY region
ORDER BY total_sales DESC;

-- Query for category breakdown
SELECT
    product_category,
    SUM(total_sales) as total_sales,
    SUM(total_sales) * 100.0 / SUM(SUM(total_sales)) OVER () as percentage
FROM sales_summary
WHERE date >= DATE_SUB(CURRENT_DATE(), 30)
GROUP BY product_category
ORDER BY total_sales DESC;
```

# Photon Engine Performance

Photon is a vectorized query engine that dramatically improves performance:

```sql
-- Enable query profile to see Photon usage
SET spark.databricks.queryWatchdog.enabled = true;

-- Complex analytical query optimized by Photon
WITH daily_metrics AS (
    SELECT
        date,
        product_category,
        region,
        total_sales,
        AVG(total_sales) OVER (
            PARTITION BY product_category, region
            ORDER BY date
            ROWS BETWEEN 6 PRECEDING AND CURRENT ROW
        ) as rolling_7day_avg
    FROM sales_summary
),
ranked_categories AS (
    SELECT
        date,
        product_category,
        region,
        total_sales,
        rolling_7day_avg,
        RANK() OVER (
            PARTITION BY date, region
            ORDER BY total_sales DESC
        ) as category_rank
    FROM daily_metrics
)
SELECT
    date,
    region,
    product_category,
    total_sales,
    rolling_7day_avg,
    category_rank
FROM ranked_categories
WHERE category_rank <= 5
    AND date >= DATE_SUB(CURRENT_DATE(), 30)
ORDER BY date DESC, region, category_rank;
```

# Connecting Power BI

Connect Power BI to Databricks SQL Analytics:

```python
# Get connection details
server = "adb-<workspace-id>.<random>.azuredatabricks.net"
http_path = "/sql/1.0/endpoints/<endpoint-id>"

# Power BI connection string format
connection_string = f"""
    Driver={{Simba Spark ODBC Driver}};
    Host={server};
    Port=443;
    SSL=1;
    ThriftTransport=2;
    HTTPPath={http_path};
    AuthMech=3;
    UID=token;
    PWD=<your-personal-access-token>
"""
```

Create a Power BI DirectQuery dataset:

```m
// Power Query M code for DirectQuery
let
    Source = Databricks.Catalogs(
        "adb-1234567890.1.azuredatabricks.net",
        "/sql/1.0/endpoints/abc123",
        [Catalog="hive_metastore", Database="analytics"]
    ),
    sales_summary = Source{[Schema="analytics", Item="sales_summary"]}[Data]
in
    sales_summary
```

# Creating Dashboards

Build operational dashboards with scheduled refreshes:

```sql
-- Dashboard query 1: KPI Cards
SELECT
    SUM(total_sales) as mtd_sales,
    SUM(transaction_count) as mtd_transactions,
    AVG(total_sales / transaction_count) as avg_order_value
FROM sales_summary
WHERE date >= DATE_TRUNC('month', CURRENT_DATE());

-- Dashboard query 2: Daily trend
SELECT
    date,
    SUM(total_sales) as daily_sales
FROM sales_summary
WHERE date >= DATE_SUB(CURRENT_DATE(), 30)
GROUP BY date
ORDER BY date;

-- Dashboard query 3: Top products
SELECT
    product_category,
    SUM(total_sales) as total_sales,
    SUM(transaction_count) as transactions
FROM sales_summary
WHERE date >= DATE_SUB(CURRENT_DATE(), 7)
GROUP BY product_category
ORDER BY total_sales DESC
LIMIT 10;
```

# Access Control

Implement fine-grained access control:

```sql
-- Create a group for analysts
CREATE GROUP IF NOT EXISTS data_analysts;

-- Grant access to specific tables
GRANT SELECT ON TABLE analytics.sales_summary TO `data_analysts`;
GRANT SELECT ON TABLE analytics.product_catalog TO `data_analysts`;

-- Column-level security with views
CREATE VIEW analytics.sales_summary_restricted AS
SELECT
    date,
    product_category,
    region,
    total_sales
    -- transaction_count excluded for restricted access
FROM analytics.sales_summary;

GRANT SELECT ON VIEW analytics.sales_summary_restricted TO `restricted_users`;

-- Row-level security
CREATE VIEW analytics.sales_by_region AS
SELECT * FROM analytics.sales_summary
WHERE region = current_user_region();
```

# Conclusion

Databricks SQL Analytics GA brings enterprise-grade SQL analytics to the lakehouse. With Photon engine performance, native BI tool connectivity, and built-in dashboarding, data teams can now serve analytics directly from Delta Lake without data movement or duplication.

This represents a significant step forward in unifying data engineering and analytics on a single platform, reducing complexity and enabling faster insights from your data lake investments.

