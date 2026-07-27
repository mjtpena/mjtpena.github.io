---
title: "Azure Databricks Unity Catalog: Unified Data Governance for the Lakehouse"
author: Michael John Peña
draft: false
date: 2022-06-30
tags:
  - Azure
  - Databricks
  - Data Governance
  - Unity Catalog
  - Data Engineering

---

I wrote "Azure Databricks Unity Catalog: Unified Data Governance for the Lakehouse" to share practical, production-minded guidance on this topic.

## The Problem Unity Catalog Solves

Before Unity Catalog, data governance in Databricks was... fragmented:
- Each workspace had its own Hive metastore
- Access control was table-level at best
- Data lineage required third-party tools
- Sharing data between workspaces was painful

Unity Catalog provides a unified governance layer across all your Databricks workspaces.

## Key Concepts

**Metastore**: The top-level container for all metadata. You create one metastore per region, and it serves all workspaces in that region.

**Catalog**: A grouping of schemas (databases). Think of it like a database in traditional RDBMS terms.

**Schema**: Contains tables, views, and functions.

**Tables**: Managed or external tables, just like before.

```sql
-- Create a catalog
CREATE CATALOG sales_data;

-- Create a schema within the catalog
CREATE SCHEMA sales_data.raw;

-- Create a table
CREATE TABLE sales_data.raw.transactions (
    transaction_id BIGINT,
    customer_id BIGINT,
    amount DECIMAL(18,2),
    transaction_date DATE
)
USING DELTA;
```

The three-level namespace (catalog.schema.table) provides much better organization than the previous two-level approach.

## Fine-Grained Access Control

Unity Catalog introduces proper row-level and column-level security:

```sql
-- Grant read access to a table
GRANT SELECT ON TABLE sales_data.raw.transactions
TO data_analysts;

-- Grant access to specific columns only
GRANT SELECT (transaction_id, amount, transaction_date)
ON TABLE sales_data.curated.transactions
TO reporting_team;

-- Row-level security with views
CREATE VIEW sales_data.curated.my_region_sales
AS SELECT * FROM sales_data.raw.transactions
WHERE region = current_user_region();

GRANT SELECT ON VIEW sales_data.curated.my_region_sales
TO regional_analysts;
```

This is enterprise-grade access control that rivals what you'd expect from a traditional data warehouse.

## Automatic Data Lineage

One of the most powerful features: Unity Catalog automatically captures lineage for all queries executed in Databricks. No setup, no agents, no additional cost.

```python
# This notebook's lineage is automatically tracked
df = spark.table("sales_data.raw.transactions")
enriched = df.join(
    spark.table("sales_data.reference.customers"),
    "customer_id"
)
enriched.write.mode("overwrite").saveAsTable("sales_data.curated.enriched_transactions")
```

You can see:
- Which tables feed into which tables
- Which notebooks and jobs create which tables
- Column-level lineage (which source columns feed which target columns)

## Integration with Azure Services

Unity Catalog integrates nicely with Azure:

**Azure Active Directory**: Use AAD identities for authentication. No more service principals scattered everywhere.

**Azure Data Lake Storage**: Unity Catalog manages credentials for your ADLS accounts centrally.

```sql
-- Create a storage credential
CREATE STORAGE CREDENTIAL adls_cred
WITH (AZURE_MANAGED_IDENTITY = '/subscriptions/.../managedIdentities/my-identity');

-- Create an external location
CREATE EXTERNAL LOCATION sales_external
URL 'abfss://sales@mystorageaccount.dfs.core.windows.net/'
WITH (CREDENTIAL = adls_cred);
```

**Azure Purview**: While not automatic yet, Unity Catalog metadata can be registered with Azure Purview for enterprise-wide data cataloging.

## Migration Considerations

Migrating existing workspaces to Unity Catalog:

1. **Create a Metastore**: One per region, assigned to your workspaces
2. **Upgrade Tables**: Unity Catalog uses Delta Lake exclusively for managed tables
3. **Migrate Permissions**: Translate your existing table ACLs to Unity Catalog grants
4. **Update Code**: Change from two-level to three-level namespace (or use default catalog)

```python
# Before: Two-level namespace
df = spark.table("my_database.my_table")

# After: Three-level namespace
df = spark.table("my_catalog.my_database.my_table")

# Or set a default catalog to minimize changes
spark.sql("USE CATALOG my_catalog")
df = spark.table("my_database.my_table")  # Works without code changes
```

## Pricing Implications

Unity Catalog is included with Databricks - no additional cost for the core governance features. However:
- Serverless compute for SQL queries is consumption-based
- Premium tier is required for some features like audit logging
- Storage costs in ADLS remain the same

## What's Still Coming

Features announced but not yet GA:
- Delta Sharing integration (sharing across organizations)
- Attribute-based access control
- Data quality monitoring
- Deeper Azure Purview integration

## My Take

Unity Catalog is a necessary evolution. If you're building a data platform on Databricks, you should:

1. **Start new projects on Unity Catalog** - Don't create more legacy metastore debt
2. **Plan workspace consolidation** - The governance benefits come from centralizing
3. **Migrate incrementally** - Prioritize tables that need better access control
4. **Combine with Azure Purview** - For enterprise-wide catalog beyond Databricks

The lakehouse is growing up. Proper governance was the missing piece, and Unity Catalog fills that gap.

## Resources

- [Unity Catalog Documentation](https://docs.databricks.com/data-governance/unity-catalog/index.html)
- [Azure Databricks Unity Catalog](https://docs.microsoft.com/en-us/azure/databricks/data-governance/unity-catalog/)
- [Databricks Unity Catalog Best Practices](https://docs.databricks.com/data-governance/unity-catalog/best-practices.html)
- [Data + AI Summit 2022 Announcements](https://databricks.com/dataaisummit/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
