---
title: "Delta Sharing: Secure Data Exchange Across Organizations"
description: "The protocol is open source, meaning recipients don't need Databricks to access shared data."
author: Michael John Peña
draft: false
date: 2022-03-12
tags:
  - Azure
  - Databricks
  - Delta Sharing
  - Data Exchange
  - Open Source
---

## What is Delta Sharing?

Delta Sharing allows you to:
- Share live data without copying
- Control access with revocable tokens
- Support any client (Python, Spark, Power BI, etc.)
- Share across organizations and cloud providers

The protocol is open source, meaning recipients don't need Databricks to access shared data.

## Architecture Overview

```
┌─────────────────┐         ┌─────────────────┐
│  Data Provider  │         │  Data Recipient │
│  (Databricks)   │         │  (Any Client)   │
│                 │         │                 │
│  ┌───────────┐  │   REST  │  ┌───────────┐  │
│  │Delta Table│◄─┼────API──┼──│  Client   │  │
│  └───────────┘  │         │  └───────────┘  │
│        ▲        │         │                 │
│  Access Control │         │  - Python       │
│  & Auditing     │         │  - Spark        │
│                 │         │  - Power BI     │
└─────────────────┘         │  - pandas       │
                            └─────────────────┘
```

## Setting Up Delta Sharing

### Enable Delta Sharing in Unity Catalog

```sql
-- Create a share
CREATE SHARE customer_analytics
COMMENT 'Customer analytics data for partners';

-- Add tables to the share
ALTER SHARE customer_analytics
ADD TABLE production.analytics.customer_segments;

ALTER SHARE customer_analytics
ADD TABLE production.analytics.purchase_patterns
PARTITION (region = 'US');  -- Share specific partitions only

-- Add a schema (all tables in schema)
ALTER SHARE customer_analytics
ADD SCHEMA production.public_metrics;
```

### Create Recipients

```sql
-- Create a recipient (external organization)
CREATE RECIPIENT partner_company
COMMENT 'Analytics partner - Contoso Inc.';

-- Get the activation link to send to recipient
DESCRIBE RECIPIENT partner_company;
-- Returns an activation link they use to get their credential

-- For managed recipients (other Databricks workspaces)
CREATE RECIPIENT internal_team
USING ID 'aws:us-west-2:workspace-12345';
```

### Grant Access

```sql
-- Grant access to the share
GRANT SELECT ON SHARE customer_analytics TO RECIPIENT partner_company;

-- View current grants
SHOW GRANTS ON SHARE customer_analytics;

-- Revoke access
REVOKE SELECT ON SHARE customer_analytics FROM RECIPIENT partner_company;
```

## Consuming Shared Data

### Python Client

```python
import delta_sharing

# Load the profile file (received from data provider)
profile_file = "config.share"

# Create a sharing client
client = delta_sharing.SharingClient(profile_file)

# List available shares
shares = client.list_shares()
for share in shares:
    print(f"Share: {share.name}")

# List schemas in a share
schemas = client.list_schemas(delta_sharing.Share(name="customer_analytics"))
for schema in schemas:
    print(f"Schema: {schema.name}")

# List tables in a schema
tables = client.list_tables(
    delta_sharing.Schema(name="public_metrics", share="customer_analytics")
)
for table in tables:
    print(f"Table: {table.name}")

# Load a table as pandas DataFrame
df = delta_sharing.load_as_pandas(
    f"{profile_file}#customer_analytics.public_metrics.daily_summary"
)
print(df.head())

# Load as Spark DataFrame
spark_df = delta_sharing.load_as_spark(
    f"{profile_file}#customer_analytics.public_metrics.daily_summary"
)
spark_df.show()
```

### Apache Spark

```python
# Configure Spark with Delta Sharing
spark = SparkSession.builder \
    .config("spark.jars.packages", "io.delta:delta-sharing-spark_2.12:0.6.0") \
    .getOrCreate()

# Read shared table
df = spark.read.format("deltaSharing") \
    .load("config.share#customer_analytics.public_metrics.daily_summary")

df.show()

# Query shared data directly
spark.sql("""
    CREATE TABLE IF NOT EXISTS shared_data
    USING deltaSharing
    LOCATION 'config.share#customer_analytics.public_metrics.daily_summary'
""")

spark.sql("SELECT * FROM shared_data WHERE date > '2022-01-01'").show()
```

### Power BI

```python
# Generate a Power BI compatible sharing link
# In Databricks notebook:
share_url = f"""
https://{workspace_url}/api/2.0/delta-sharing/shares/customer_analytics/schemas/public_metrics/tables/daily_summary
"""

# In Power BI:
# 1. Get Data -> Web
# 2. Enter the share URL
# 3. Use Bearer token authentication with the recipient token
```

## Advanced Sharing Scenarios

### Partition-Based Sharing

Share only specific data partitions:

```sql
-- Share only US region data
ALTER SHARE regional_data
ADD TABLE production.sales.transactions
PARTITION (region = 'US');

-- Share multiple partitions
ALTER SHARE regional_data
ADD TABLE production.sales.transactions
PARTITION (region = 'US');

ALTER SHARE regional_data
ADD TABLE production.sales.transactions
PARTITION (region = 'CA');

-- Share with date range (share recent data only)
ALTER SHARE recent_data
ADD TABLE production.sales.transactions
PARTITION (date >= '2022-01-01');
```

### Sharing Views

Share computed results without exposing raw data:

```sql
-- Create a view with aggregated/anonymized data
CREATE VIEW production.shared.customer_summary AS
SELECT
    customer_segment,
    region,
    COUNT(*) as customer_count,
    AVG(lifetime_value) as avg_ltv,
    SUM(total_orders) as total_orders
FROM production.analytics.customer_details
GROUP BY customer_segment, region;

-- Share the view
ALTER SHARE analytics_share
ADD TABLE production.shared.customer_summary;

-- Recipients see aggregated data, not individual customer records
```

### Time-Limited Access

Implement expiring shares:

```python
from datetime import datetime, timedelta
import schedule
import time

def check_share_expiration():
    """Revoke expired shares"""

    expiring_shares = spark.sql("""
        SELECT
            share_name,
            recipient_name,
            expiration_date
        FROM governance.sharing.share_metadata
        WHERE expiration_date <= current_date()
        AND status = 'active'
    """).collect()

    for share in expiring_shares:
        # Revoke access
        spark.sql(f"""
            REVOKE SELECT ON SHARE {share['share_name']}
            FROM RECIPIENT {share['recipient_name']}
        """)

        # Update status
        spark.sql(f"""
            UPDATE governance.sharing.share_metadata
            SET status = 'expired'
            WHERE share_name = '{share['share_name']}'
            AND recipient_name = '{share['recipient_name']}'
        """)

        print(f"Revoked: {share['share_name']} from {share['recipient_name']}")

# Run daily
schedule.every().day.at("00:00").do(check_share_expiration)
```

## Monitoring and Auditing

Track sharing activity:

```sql
-- View sharing audit logs
SELECT
    event_time,
    action_name,
    request_params.share_name,
    request_params.recipient_name,
    user_identity.email,
    response.status_code
FROM system.access.audit
WHERE action_name LIKE '%Share%'
ORDER BY event_time DESC;

-- Track data access by recipients
SELECT
    event_time,
    action_name,
    request_params.table_name,
    source_ip_address,
    user_agent
FROM system.access.audit
WHERE service_name = 'deltaSharing'
AND action_name = 'getTableData'
ORDER BY event_time DESC;
```

### Usage Analytics

```python
def generate_sharing_report():
    """Generate monthly sharing usage report"""

    report = spark.sql("""
        SELECT
            share_name,
            recipient_name,
            table_name,
            COUNT(*) as access_count,
            SUM(bytes_read) as total_bytes_read,
            MIN(event_time) as first_access,
            MAX(event_time) as last_access
        FROM system.access.audit
        WHERE service_name = 'deltaSharing'
        AND event_time >= date_trunc('month', current_date())
        GROUP BY share_name, recipient_name, table_name
    """)

    return report

# Send weekly reports
report_df = generate_sharing_report()
report_df.write.mode("overwrite").saveAsTable("governance.reports.sharing_usage")
```

## Security Best Practices

### Token Management

```python
def rotate_recipient_tokens():
    """Rotate tokens for all recipients periodically"""

    recipients = spark.sql("SHOW RECIPIENTS").collect()

    for recipient in recipients:
        # Rotate token
        spark.sql(f"ALTER RECIPIENT {recipient['name']} ROTATE TOKEN")

        # Notify recipient of new token
        send_token_notification(recipient['name'], recipient['email'])

        print(f"Rotated token for: {recipient['name']}")

# Schedule monthly rotation
```

### IP Restrictions

```sql
-- Create recipient with IP restrictions
CREATE RECIPIENT secure_partner
COMMENT 'Partner with IP restriction'
PROPERTIES (
    'allowed_ip_ranges' = '10.0.0.0/8,192.168.1.0/24'
);
```

### Data Minimization

```sql
-- Share only necessary columns
CREATE VIEW production.shared.minimal_customer AS
SELECT
    customer_id,  -- Anonymized ID
    segment,
    region,
    signup_year  -- Generalized date
FROM production.sales.customers;

-- Don't share: email, phone, address, full name, exact dates
```

## Cross-Cloud Sharing

Share data across cloud providers:

```python
# Provider on Azure Databricks sharing to recipient on AWS
# The protocol works identically regardless of cloud

# Recipient on AWS configures their Spark:
spark = SparkSession.builder \
    .config("spark.hadoop.fs.azure.account.key.{account}.dfs.core.windows.net",
            "not-needed-for-delta-sharing") \
    .getOrCreate()

# Read shared data (data stays on Azure, accessed via REST API)
df = spark.read.format("deltaSharing") \
    .load("azure_provider.share#share_name.schema.table")

# The delta-sharing protocol handles cross-cloud access
# No need for direct storage access
```

## Building a Data Marketplace

Create an internal data marketplace:

```python
class DataMarketplace:
    def __init__(self, spark):
        self.spark = spark

    def register_product(self, product_name, tables, description, owner):
        """Register a new data product for sharing"""

        # Create share
        self.spark.sql(f"""
            CREATE SHARE IF NOT EXISTS {product_name}
            COMMENT '{description}'
        """)

        # Add tables
        for table in tables:
            self.spark.sql(f"""
                ALTER SHARE {product_name} ADD TABLE {table}
            """)

        # Register in catalog
        self.spark.sql(f"""
            INSERT INTO governance.marketplace.products VALUES (
                '{product_name}',
                '{description}',
                '{owner}',
                current_timestamp(),
                'active'
            )
        """)

    def request_access(self, product_name, requester, justification):
        """Submit access request for a data product"""

        self.spark.sql(f"""
            INSERT INTO governance.marketplace.access_requests VALUES (
                uuid(),
                '{product_name}',
                '{requester}',
                '{justification}',
                current_timestamp(),
                'pending'
            )
        """)

        # Notify product owner
        notify_owner(product_name, requester, justification)

    def approve_access(self, request_id):
        """Approve an access request"""

        request = self.spark.sql(f"""
            SELECT * FROM governance.marketplace.access_requests
            WHERE request_id = '{request_id}'
        """).first()

        # Create recipient and grant access
        self.spark.sql(f"""
            CREATE RECIPIENT IF NOT EXISTS {request['requester']}
        """)

        self.spark.sql(f"""
            GRANT SELECT ON SHARE {request['product_name']}
            TO RECIPIENT {request['requester']}
        """)

        # Update request status
        self.spark.sql(f"""
            UPDATE governance.marketplace.access_requests
            SET status = 'approved'
            WHERE request_id = '{request_id}'
        """)
```

## Conclusion

Delta Sharing revolutionizes how organizations exchange data. By enabling secure, live data sharing without copying, it reduces data duplication, ensures freshness, and simplifies governance.

Key benefits:
- Share data without ETL or copying
- Open protocol works with any client
- Fine-grained access control
- Complete audit trail
- Cross-cloud and cross-platform support

Whether sharing with partners, customers, or between internal teams, Delta Sharing provides a modern approach to data exchange.

## Resources

- [Delta Sharing Documentation](https://docs.databricks.com/data-sharing/index.html)
- [Delta Sharing Protocol](https://github.com/delta-io/delta-sharing)
- [Delta Sharing Python Client](https://pypi.org/project/delta-sharing/)
