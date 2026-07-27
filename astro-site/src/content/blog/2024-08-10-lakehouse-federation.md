---
title: "Lakehouse Federation in Microsoft Fabric"
author: Michael John Peña
draft: false
date: 2024-08-10
tags:
  - Microsoft Fabric
  - Lakehouse
  - Federation
  - OneLake
  - Data Architecture

---

I wrote "Lakehouse Federation in Microsoft Fabric" to share practical, production-minded guidance on this topic.

## Federation Architecture

```
                    ┌─────────────────────────────┐
                    │     Unified Query Layer     │
                    │    (SQL Endpoint / Spark)   │
                    └──────────────┬──────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        │                          │                          │
        ▼                          ▼                          ▼
┌───────────────┐        ┌───────────────┐        ┌───────────────┐
│   Sales       │        │   Marketing   │        │   Finance     │
│   Lakehouse   │        │   Lakehouse   │        │   Lakehouse   │
│  (Domain A)   │        │  (Domain B)   │        │  (Domain C)   │
└───────────────┘        └───────────────┘        └───────────────┘
```

## Setting Up Federation

### Create Cross-Lakehouse Shortcuts

```python
class LakehouseFederation:
    def __init__(self, central_workspace_id: str, central_lakehouse_id: str):
        self.central_workspace = central_workspace_id
        self.central_lakehouse = central_lakehouse_id
        self.shortcut_manager = ShortcutManager(
            central_workspace_id,
            central_lakehouse_id
        )

    def federate_lakehouse(
        self,
        source_workspace_id: str,
        source_lakehouse_id: str,
        source_lakehouse_name: str,
        tables_to_federate: list[str]
    ):
        """Create shortcuts to federate a domain lakehouse."""

        for table in tables_to_federate:
            self.shortcut_manager.create_onelake_shortcut(
                shortcut_name=f"{source_lakehouse_name}_{table}",
                source_workspace_id=source_workspace_id,
                source_item_id=source_lakehouse_id,
                source_path=f"Tables/{table}"
            )

        print(f"Federated {len(tables_to_federate)} tables from {source_lakehouse_name}")

    def setup_enterprise_federation(self, domain_configs: list[dict]):
        """Set up federation across multiple domains."""

        for config in domain_configs:
            self.federate_lakehouse(
                source_workspace_id=config["workspace_id"],
                source_lakehouse_id=config["lakehouse_id"],
                source_lakehouse_name=config["name"],
                tables_to_federate=config["tables"]
            )

# Usage
federation = LakehouseFederation(
    central_workspace_id="central-workspace-id",
    central_lakehouse_id="central-lakehouse-id"
)

# Configure domains
domains = [
    {
        "name": "sales",
        "workspace_id": "sales-workspace-id",
        "lakehouse_id": "sales-lakehouse-id",
        "tables": ["customers", "orders", "order_items", "products"]
    },
    {
        "name": "marketing",
        "workspace_id": "marketing-workspace-id",
        "lakehouse_id": "marketing-lakehouse-id",
        "tables": ["campaigns", "leads", "conversions"]
    },
    {
        "name": "finance",
        "workspace_id": "finance-workspace-id",
        "lakehouse_id": "finance-lakehouse-id",
        "tables": ["invoices", "payments", "budgets"]
    }
]

federation.setup_enterprise_federation(domains)
```

## Querying Federated Data

### Cross-Domain Joins

```sql
-- Query from central lakehouse SQL endpoint
-- All domain tables accessible via shortcuts

SELECT
    s.order_id,
    s.order_date,
    s.total_amount,
    m.campaign_name,
    m.channel,
    f.invoice_number,
    f.payment_status
FROM sales_orders s
LEFT JOIN marketing_conversions m
    ON s.customer_id = m.customer_id
    AND s.order_date BETWEEN m.conversion_date AND DATEADD(day, 7, m.conversion_date)
LEFT JOIN finance_invoices f
    ON s.order_id = f.order_id
WHERE s.order_date >= '2024-01-01';
```

### Federated Aggregations

```python
# Spark notebook for cross-domain analytics
from pyspark.sql.functions import *

# Read from federated shortcuts
sales = spark.read.format("delta").table("sales_orders")
marketing = spark.read.format("delta").table("marketing_campaigns")
finance = spark.read.format("delta").table("finance_payments")

# Cross-domain analysis: Revenue attribution
revenue_attribution = sales.alias("s") \
    .join(
        marketing.alias("m"),
        col("s.attribution_id") == col("m.campaign_id"),
        "left"
    ) \
    .join(
        finance.alias("f"),
        col("s.order_id") == col("f.order_reference"),
        "left"
    ) \
    .groupBy(
        col("m.campaign_name"),
        col("m.channel"),
        date_trunc("month", col("s.order_date")).alias("month")
    ) \
    .agg(
        count("s.order_id").alias("orders"),
        sum("s.total_amount").alias("gross_revenue"),
        sum(when(col("f.payment_status") == "completed", col("f.amount"))).alias("collected_revenue")
    )

display(revenue_attribution)
```

## Governance and Access Control

### Workspace-Level Permissions

```python
class FederationGovernance:
    def __init__(self):
        self.access_matrix = {}

    def define_access_policy(
        self,
        user_group: str,
        allowed_domains: list[str],
        allowed_tables: dict[str, list[str]]
    ):
        """Define what data a user group can access."""

        self.access_matrix[user_group] = {
            "domains": allowed_domains,
            "tables": allowed_tables
        }

    def validate_query(self, user_group: str, tables_requested: list[str]) -> bool:
        """Validate if user can access requested tables."""

        policy = self.access_matrix.get(user_group)
        if not policy:
            return False

        for table in tables_requested:
            domain = table.split("_")[0]  # e.g., "sales" from "sales_orders"

            if domain not in policy["domains"]:
                return False

            if table not in policy["tables"].get(domain, []):
                # Check if wildcard access
                if "*" not in policy["tables"].get(domain, []):
                    return False

        return True

# Define policies
governance = FederationGovernance()

governance.define_access_policy(
    user_group="analysts",
    allowed_domains=["sales", "marketing"],
    allowed_tables={
        "sales": ["sales_orders", "sales_products"],
        "marketing": ["*"]  # All marketing tables
    }
)

governance.define_access_policy(
    user_group="finance_team",
    allowed_domains=["finance", "sales"],
    allowed_tables={
        "finance": ["*"],
        "sales": ["sales_orders"]  # Only order totals, not details
    }
)
```

### Row-Level Security Views

```sql
-- Create secure views on federated data
CREATE OR REPLACE VIEW secure_sales_orders AS
SELECT
    order_id,
    order_date,
    customer_id,
    total_amount,
    region
FROM sales_orders
WHERE region IN (
    SELECT allowed_region
    FROM user_permissions
    WHERE user_email = CURRENT_USER()
);

-- Finance view with PII masking
CREATE OR REPLACE VIEW secure_customers AS
SELECT
    customer_id,
    CASE
        WHEN IS_MEMBER('pii_authorized') THEN customer_name
        ELSE CONCAT(LEFT(customer_name, 1), '***')
    END AS customer_name,
    CASE
        WHEN IS_MEMBER('pii_authorized') THEN email
        ELSE CONCAT('***@', SUBSTRING_INDEX(email, '@', -1))
    END AS email,
    segment,
    region
FROM sales_customers;
```

## Performance Optimization

### Materialized Cross-Domain Tables

```python
class FederationOptimizer:
    def create_materialized_join(
        self,
        name: str,
        join_query: str,
        refresh_schedule: str = "daily"
    ):
        """Create materialized table for frequently joined data."""

        # Execute join query
        materialized_df = spark.sql(join_query)

        # Save as Delta table
        materialized_df.write.format("delta") \
            .mode("overwrite") \
            .option("overwriteSchema", "true") \
            .saveAsTable(f"materialized_{name}")

        # Create refresh metadata
        refresh_config = {
            "table": f"materialized_{name}",
            "source_query": join_query,
            "schedule": refresh_schedule,
            "last_refresh": datetime.utcnow().isoformat()
        }

        return refresh_config

    def refresh_materialized_views(self, configs: list[dict]):
        """Refresh all materialized views."""

        for config in configs:
            df = spark.sql(config["source_query"])
            df.write.format("delta") \
                .mode("overwrite") \
                .saveAsTable(config["table"])

            print(f"Refreshed {config['table']}")

# Usage
optimizer = FederationOptimizer()

# Create materialized customer 360 view
customer_360_config = optimizer.create_materialized_join(
    name="customer_360",
    join_query="""
        SELECT
            c.customer_id,
            c.customer_name,
            c.segment,
            COUNT(DISTINCT o.order_id) as total_orders,
            SUM(o.total_amount) as lifetime_value,
            MAX(o.order_date) as last_order_date,
            COUNT(DISTINCT m.campaign_id) as campaigns_engaged
        FROM sales_customers c
        LEFT JOIN sales_orders o ON c.customer_id = o.customer_id
        LEFT JOIN marketing_conversions m ON c.customer_id = m.customer_id
        GROUP BY c.customer_id, c.customer_name, c.segment
    """,
    refresh_schedule="daily"
)
```

## Best Practices

1. **Define clear domains**: Each lakehouse should own specific data
2. **Minimize cross-domain joins**: Materialize frequently joined data
3. **Implement governance early**: Access control from day one
4. **Monitor query patterns**: Identify optimization opportunities
5. **Document dependencies**: Track which domains depend on which

## Conclusion

Lakehouse federation enables enterprise-scale analytics while respecting organizational boundaries. Use shortcuts for flexibility, materialized views for performance, and governance controls for security.

Start with clear domain ownership, then layer in federation as cross-domain needs emerge.

