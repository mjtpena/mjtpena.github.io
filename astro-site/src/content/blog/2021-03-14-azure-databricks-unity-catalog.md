---
title: Azure Databricks Workspace Management and Data Governance Best Practices
author: Michael John Pena
draft: false
date: 2021-03-14
url: /blog/azure-databricks-workspace-governance/
tags:
  - Azure
  - Databricks
  - Data Governance
  - Data Lakehouse
  - Security
---

Databricks workspace governance was the problem nobody thought about until there were thirty workspaces, fifteen clusters running overnight, and six teams asking why the bill was double the estimate. Unity Catalog is still rolling out (and at the time of writing, early access), but the organisational patterns for workspace governance are already mature: workspace-per-team or shared workspace with access controls, metastore organisation, cluster policies that prevent runaway compute, and the secret scope practices that keep credentials out of notebooks. This post is what I put in place for a client with fifteen data engineers and a procurement team asking uncomfortable questions about the bill.

## Workspace Organization

A well-organized Databricks workspace is essential for team productivity and security.

### Folder Structure Best Practices

```
/Repos/              # Git-integrated notebooks and code
  /team-a/
  /team-b/
  /shared/

/Users/              # Personal user folders
  /user@company.com/

/Shared/             # Shared resources
  /Libraries/        # Common libraries and utilities
  /Data/             # Shared datasets and references
  /Templates/        # Notebook templates

/Production/         # Production workflows (restricted access)
  /ETL/
  /ML/
  /Reports/
```

### Creating Workspace Structure

```python
# Using Databricks CLI
%sh
# Create folder structure
databricks workspace mkdirs /Shared/Libraries
databricks workspace mkdirs /Shared/Data
databricks workspace mkdirs /Shared/Templates
databricks workspace mkdirs /Production/ETL
databricks workspace mkdirs /Production/ML
```

## Access Control with Table ACLs

Enable table access control for fine-grained permissions:

```sql
-- Enable table access control on a cluster
-- Set spark.databricks.acl.dfAclsEnabled to true in cluster config

-- Grant database access
GRANT USAGE ON DATABASE analytics TO `data_analysts@company.com`;

-- Grant table read access
GRANT SELECT ON TABLE analytics.sales TO `data_analysts@company.com`;

-- Grant table write access
GRANT SELECT, MODIFY ON TABLE analytics.sales_staging TO `data_engineers@company.com`;

-- Grant all privileges on database
GRANT ALL PRIVILEGES ON DATABASE analytics TO `data_platform_admins@company.com`;

-- View grants
SHOW GRANTS ON TABLE analytics.sales;
```

## Hive Metastore Organization

Structure your databases for clarity and access control:

```sql
-- Create databases for different zones
CREATE DATABASE IF NOT EXISTS raw
COMMENT 'Raw data ingested from source systems'
LOCATION 'abfss://raw@storage.dfs.core.windows.net/';

CREATE DATABASE IF NOT EXISTS curated
COMMENT 'Cleaned and standardized data'
LOCATION 'abfss://curated@storage.dfs.core.windows.net/';

CREATE DATABASE IF NOT EXISTS analytics
COMMENT 'Analytics-ready datasets and aggregations'
LOCATION 'abfss://analytics@storage.dfs.core.windows.net/';

CREATE DATABASE IF NOT EXISTS sandbox
COMMENT 'Sandbox for exploration and development'
LOCATION 'abfss://sandbox@storage.dfs.core.windows.net/';
```

## Cluster Policies

Define cluster policies to control costs and standardize configurations:

```json
{
  "cluster_type": {
    "type": "fixed",
    "value": "all-purpose"
  },
  "autotermination_minutes": {
    "type": "range",
    "minValue": 10,
    "maxValue": 120,
    "defaultValue": 60
  },
  "spark_version": {
    "type": "allowlist",
    "values": [
      "7.3.x-scala2.12",
      "8.1.x-scala2.12",
      "8.2.x-scala2.12"
    ],
    "defaultValue": "8.2.x-scala2.12"
  },
  "node_type_id": {
    "type": "allowlist",
    "values": [
      "Standard_DS3_v2",
      "Standard_DS4_v2",
      "Standard_DS5_v2"
    ]
  },
  "num_workers": {
    "type": "range",
    "minValue": 1,
    "maxValue": 10,
    "defaultValue": 2
  },
  "custom_tags.team": {
    "type": "fixed",
    "value": "data-engineering"
  },
  "custom_tags.environment": {
    "type": "allowlist",
    "values": ["dev", "test", "prod"]
  }
}
```

## Secret Management

Use Azure Key Vault for secure secret management:

```python
# Create secret scope backed by Azure Key Vault
# Via Databricks CLI
%sh
databricks secrets create-scope --scope my-secrets \
  --scope-backend-type AZURE_KEYVAULT \
  --resource-id /subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.KeyVault/vaults/{vault-name} \
  --dns-name https://{vault-name}.vault.azure.net/

# Access secrets in notebooks
storage_key = dbutils.secrets.get(scope="my-secrets", key="storage-account-key")
sql_password = dbutils.secrets.get(scope="my-secrets", key="sql-password")

# Use in Spark configuration
spark.conf.set(
    "fs.azure.account.key.mystorageaccount.dfs.core.windows.net",
    dbutils.secrets.get(scope="my-secrets", key="storage-account-key")
)
```

## Data Lineage Tracking

Implement custom lineage tracking for your pipelines:

```python
from datetime import datetime
import json

class LineageTracker:
    def __init__(self, spark, lineage_table="governance.data_lineage"):
        self.spark = spark
        self.lineage_table = lineage_table

    def track_transformation(self, source_tables, target_table,
                            transformation_name, notebook_path):
        """Record data lineage for a transformation."""
        lineage_record = {
            "transformation_id": str(uuid.uuid4()),
            "transformation_name": transformation_name,
            "source_tables": json.dumps(source_tables),
            "target_table": target_table,
            "notebook_path": notebook_path,
            "executed_by": spark.sql("SELECT current_user()").first()[0],
            "executed_at": datetime.utcnow().isoformat(),
            "cluster_id": spark.conf.get("spark.databricks.clusterUsageTags.clusterId")
        }

        lineage_df = spark.createDataFrame([lineage_record])
        lineage_df.write.format("delta").mode("append").saveAsTable(self.lineage_table)

        return lineage_record["transformation_id"]

# Usage
tracker = LineageTracker(spark)

# Before your transformation
transformation_id = tracker.track_transformation(
    source_tables=["raw.events", "raw.users"],
    target_table="curated.user_events",
    transformation_name="Join events with users",
    notebook_path=dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
)

# Your transformation logic here...
```

## Data Quality Framework

Implement data quality checks:

```python
from pyspark.sql.functions import *

class DataQualityChecker:
    def __init__(self, spark):
        self.spark = spark
        self.checks = []

    def check_not_null(self, df, columns):
        """Check that specified columns have no null values."""
        for col_name in columns:
            null_count = df.filter(col(col_name).isNull()).count()
            self.checks.append({
                "check": f"not_null_{col_name}",
                "passed": null_count == 0,
                "details": f"Found {null_count} null values"
            })
        return self

    def check_unique(self, df, columns):
        """Check that specified columns form a unique key."""
        total_count = df.count()
        distinct_count = df.select(columns).distinct().count()
        self.checks.append({
            "check": f"unique_{','.join(columns)}",
            "passed": total_count == distinct_count,
            "details": f"Total: {total_count}, Distinct: {distinct_count}"
        })
        return self

    def check_range(self, df, column, min_val, max_val):
        """Check that values are within expected range."""
        out_of_range = df.filter(
            (col(column) < min_val) | (col(column) > max_val)
        ).count()
        self.checks.append({
            "check": f"range_{column}",
            "passed": out_of_range == 0,
            "details": f"Found {out_of_range} out of range values"
        })
        return self

    def check_referential_integrity(self, df, column, reference_df, reference_column):
        """Check referential integrity between tables."""
        orphan_count = df.join(
            reference_df,
            df[column] == reference_df[reference_column],
            "left_anti"
        ).count()
        self.checks.append({
            "check": f"referential_{column}",
            "passed": orphan_count == 0,
            "details": f"Found {orphan_count} orphan records"
        })
        return self

    def get_results(self):
        """Return all check results."""
        return self.checks

    def assert_all_passed(self):
        """Raise exception if any check failed."""
        failed = [c for c in self.checks if not c["passed"]]
        if failed:
            raise Exception(f"Data quality checks failed: {failed}")
        print("All data quality checks passed!")

# Usage
df = spark.table("curated.transactions")

checker = DataQualityChecker(spark)
checker \
    .check_not_null(df, ["transaction_id", "customer_id", "amount"]) \
    .check_unique(df, ["transaction_id"]) \
    .check_range(df, "amount", 0, 1000000) \
    .assert_all_passed()
```

## Job Monitoring and Alerting

Set up monitoring for your data pipelines:

```python
import requests
from datetime import datetime

def send_alert(webhook_url, title, message, severity="warning"):
    """Send alert to Teams/Slack webhook."""
    payload = {
        "title": title,
        "text": message,
        "severity": severity,
        "timestamp": datetime.utcnow().isoformat()
    }
    response = requests.post(webhook_url, json=payload)
    return response.status_code == 200

def monitor_job_health(job_name, expected_rows_min, actual_rows):
    """Monitor job output and alert if anomalies detected."""
    webhook_url = dbutils.secrets.get("alerts", "teams-webhook")

    if actual_rows < expected_rows_min:
        send_alert(
            webhook_url,
            f"Low Row Count Alert: {job_name}",
            f"Expected minimum {expected_rows_min} rows, got {actual_rows}",
            "critical"
        )
        return False

    return True

# Usage in your pipeline
rows_processed = df.count()
monitor_job_health("daily_sales_etl", expected_rows_min=1000, actual_rows=rows_processed)
```

## Environment Separation

Manage multiple environments (dev, test, prod):

```python
# Configuration management
class EnvironmentConfig:
    def __init__(self, env_name):
        self.env = env_name
        self.configs = {
            "dev": {
                "storage_account": "devstorageaccount",
                "database_prefix": "dev_",
                "cluster_size": "small"
            },
            "test": {
                "storage_account": "teststorageaccount",
                "database_prefix": "test_",
                "cluster_size": "medium"
            },
            "prod": {
                "storage_account": "prodstorageaccount",
                "database_prefix": "",
                "cluster_size": "large"
            }
        }

    def get(self, key):
        return self.configs[self.env][key]

    def get_database_name(self, base_name):
        return f"{self.configs[self.env]['database_prefix']}{base_name}"

# Usage
env = EnvironmentConfig(dbutils.widgets.get("environment"))
database = env.get_database_name("analytics")
storage = env.get("storage_account")
```

## Best Practices Summary

1. **Organize workspaces** - Use consistent folder structures across teams
2. **Implement RBAC** - Use table ACLs and cluster policies for access control
3. **Secure secrets** - Always use Azure Key Vault or Databricks secrets
4. **Track lineage** - Implement custom lineage for compliance and debugging
5. **Monitor quality** - Build data quality checks into every pipeline
6. **Separate environments** - Use configuration-driven environment management

## Conclusion

Effective workspace management and data governance are essential for scaling Azure Databricks in the enterprise. By implementing these patterns, you create a foundation for secure, reliable, and auditable data operations.
