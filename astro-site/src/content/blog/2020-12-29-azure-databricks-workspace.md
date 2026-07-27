---
title: "Azure Databricks Workspace Management"
author: Michael John Peña
draft: false
date: 2020-12-29
tags:
  - Azure
  - Databricks
  - Administration
  - Data Engineering
---

Spinning up a Databricks workspace is the easy part. Making it production-ready is where I see the most avoidable rework. Cluster policies, AAD passthrough vs service principals, secret scopes backed by Key Vault, init scripts checked into Git, and a sane workspace ACL story up front. Get those right on day one and the workspace scales with the team. Skip them and you'll be unpicking access spaghetti in six months.

## Create Workspace

```bash
az databricks workspace create \
    --name my-databricks \
    --resource-group myRG \
    --location eastus \
    --sku premium \
    --enable-no-public-ip true \
    --require-infrastructure-encryption true \
    --managed-resource-group databricks-managed-rg
```

## VNet Injection

```bash
# Create workspace in your VNet
az databricks workspace create \
    --name my-databricks \
    --resource-group myRG \
    --location eastus \
    --sku premium \
    --vnet /subscriptions/.../virtualNetworks/myVNet \
    --public-subnet databricks-public \
    --private-subnet databricks-private
```

## Unity Catalog Setup

```sql
-- Create catalog
CREATE CATALOG production;

-- Create schema
CREATE SCHEMA production.analytics;

-- Create managed table
CREATE TABLE production.analytics.sales (
    id BIGINT,
    customer_id STRING,
    amount DECIMAL(10,2),
    sale_date DATE
)
USING DELTA
LOCATION 'abfss://data@storage.dfs.core.windows.net/sales';

-- Grant permissions
GRANT SELECT ON TABLE production.analytics.sales TO analysts;
GRANT ALL PRIVILEGES ON SCHEMA production.analytics TO data_engineers;
```

## Cluster Policies

```json
{
    "spark_version": {
        "type": "fixed",
        "value": "11.3.x-scala2.12"
    },
    "node_type_id": {
        "type": "allowlist",
        "values": ["Standard_DS3_v2", "Standard_DS4_v2"]
    },
    "num_workers": {
        "type": "range",
        "minValue": 1,
        "maxValue": 10
    },
    "autoscale.min_workers": {
        "type": "range",
        "minValue": 1,
        "maxValue": 2
    },
    "autoscale.max_workers": {
        "type": "range",
        "minValue": 2,
        "maxValue": 10
    },
    "custom_tags.Environment": {
        "type": "fixed",
        "value": "Production"
    },
    "spark_conf.spark.databricks.cluster.profile": {
        "type": "fixed",
        "value": "serverless"
    }
}
```

## Cluster Configuration

```python
# Via REST API
import requests

cluster_config = {
    "cluster_name": "analytics-cluster",
    "spark_version": "11.3.x-scala2.12",
    "node_type_id": "Standard_DS3_v2",
    "autoscale": {
        "min_workers": 2,
        "max_workers": 8
    },
    "azure_attributes": {
        "availability": "ON_DEMAND_AZURE",
        "first_on_demand": 1,
        "spot_bid_max_price": -1
    },
    "spark_conf": {
        "spark.databricks.delta.preview.enabled": "true"
    },
    "custom_tags": {
        "CostCenter": "Analytics",
        "Team": "Data Engineering"
    }
}

response = requests.post(
    f"{databricks_url}/api/2.0/clusters/create",
    headers={"Authorization": f"Bearer {token}"},
    json=cluster_config
)
```

## Instance Pools

```json
{
    "instance_pool_name": "analytics-pool",
    "min_idle_instances": 2,
    "max_capacity": 20,
    "node_type_id": "Standard_DS3_v2",
    "idle_instance_autotermination_minutes": 30,
    "preloaded_spark_versions": ["11.3.x-scala2.12"],
    "azure_attributes": {
        "availability": "SPOT_WITH_FALLBACK_AZURE",
        "spot_bid_max_price": -1
    }
}
```

## Secret Management

```bash
# Create secret scope backed by Key Vault
databricks secrets create-scope \
    --scope production-secrets \
    --scope-backend-type AZURE_KEYVAULT \
    --resource-id /subscriptions/.../vaults/mykeyvault \
    --dns-name https://mykeyvault.vault.azure.net/
```

```python
# Use secrets in notebooks
storage_key = dbutils.secrets.get(scope="production-secrets", key="storage-key")
```

## Access Control

```python
# Workspace SCIM provisioning
# Sync users/groups from Azure AD

# Table ACLs
%sql
GRANT SELECT ON TABLE sales TO `data_analysts@company.com`;
GRANT ALL PRIVILEGES ON DATABASE analytics TO `data_engineers`;
REVOKE CREATE ON DATABASE analytics FROM `data_analysts@company.com`;
```

## Monitoring

```python
# Enable Ganglia metrics
spark.conf.set("spark.databricks.metrics.enabled", "true")

# Query cluster events
events = spark.sql("""
    SELECT * FROM system.events
    WHERE cluster_id = 'cluster-id'
    ORDER BY timestamp DESC
""")
```

Databricks workspace management: secure, scalable, collaborative.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
