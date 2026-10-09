---
title: "Fabric Architecture Patterns: Designing for Scale"
description: "Designing for scale in Fabric is about decomposition and clear contracts between layers. The medallion architecture works well: small, composable…"
author: "Michael John Peña"
draft: false
date: 2023-12-17
tags: ["Microsoft Fabric", "Architecture", "Data Engineering", "Design Patterns", "Lakehouse"]
---

Designing for scale in Fabric is about decomposition and clear contracts between layers. The medallion architecture works well: small, composable transformations, clear ownership, and idempotent jobs. Below are patterns I've seen succeed at scale.

## Medallion Architecture in Fabric

## Medallion Architecture in Fabric

```python
from dataclasses import dataclass
from typing import List, Dict

@dataclass
class MedallionLayer:
    name: str
    purpose: str
    data_characteristics: List[str]
    fabric_components: List[str]
    transformations: List[str]

medallion_architecture = {
    "bronze": MedallionLayer(
        name="Bronze Layer",
        purpose="Raw data ingestion and storage",
        data_characteristics=[
            "Exact copy of source data",
            "Full fidelity preserved",
            "Schema on read",
            "Append-only with audit columns"
        ],
        fabric_components=[
            "Lakehouse Tables (Delta)",
            "Files folder for non-tabular data",
            "Shortcuts to external sources"
        ],
        transformations=[
            "Add ingestion timestamp",
            "Add source system identifier",
            "Add batch/run identifier",
            "Basic deduplication (optional)"
        ]
    ),
    "silver": MedallionLayer(
        name="Silver Layer",
        purpose="Cleansed, conformed, enriched data",
        data_characteristics=[
            "Schema enforced",
            "Data quality rules applied",
            "Business keys established",
            "Slowly Changing Dimensions supported"
        ],
        fabric_components=[
            "Lakehouse Tables (Delta)",
            "Notebooks for transformations",
            "Dataflows Gen2 for simple ETL"
        ],
        transformations=[
            "Data type standardization",
            "Null handling",
            "Deduplication",
            "Business key generation",
            "Reference data enrichment"
        ]
    ),
    "gold": MedallionLayer(
        name="Gold Layer",
        purpose="Business-ready, aggregated data",
        data_characteristics=[
            "Denormalized for analytics",
            "Pre-aggregated metrics",
            "Optimized for query performance",
            "Business terminology used"
        ],
        fabric_components=[
            "Warehouse (for SQL-heavy workloads)",
            "Lakehouse with Direct Lake",
            "Semantic Models"
        ],
        transformations=[
            "Fact and dimension modeling",
            "KPI calculations",
            "Aggregations by common grains",
            "V-Order optimization"
        ]
    )
}

def generate_medallion_code(domain: str) -> str:
    """Generate medallion architecture code."""
    return f"""
# Medallion Architecture Implementation for {domain}

from pyspark.sql import SparkSession
from pyspark.sql.functions import *
from delta.tables import DeltaTable

spark = SparkSession.builder.getOrCreate()

# ============== BRONZE LAYER ==============

def ingest_to_bronze(source_df, source_name, table_name):
    \"\"\"Ingest raw data to bronze layer.\"\"\"
    bronze_df = source_df \\
        .withColumn("_ingested_at", current_timestamp()) \\
        .withColumn("_source_system", lit(source_name)) \\
        .withColumn("_batch_id", lit(spark.conf.get("spark.batch.id", "manual")))

    bronze_df.write \\
        .format("delta") \\
        .mode("append") \\
        .option("mergeSchema", "true") \\
        .saveAsTable(f"{domain}_bronze.{{table_name}}")

    return bronze_df.count()

# ============== SILVER LAYER ==============

def transform_to_silver(table_name, transformations):
    \"\"\"Transform bronze data to silver layer.\"\"\"
    bronze_df = spark.table(f"{domain}_bronze.{{table_name}}")

    # Apply standard cleansing
    silver_df = bronze_df \\
        .dropDuplicates() \\
        .filter(col("_ingested_at") >= date_sub(current_date(), 7))

    # Apply custom transformations
    for transform in transformations:
        silver_df = transform(silver_df)

    # Merge into silver table (SCD Type 1 example)
    if spark.catalog.tableExists(f"{domain}_silver.{{table_name}}"):
        delta_table = DeltaTable.forName(spark, f"{domain}_silver.{{table_name}}")
        delta_table.alias("target").merge(
            silver_df.alias("source"),
            "target.business_key = source.business_key"
        ).whenMatchedUpdateAll().whenNotMatchedInsertAll().execute()
    else:
        silver_df.write.format("delta").saveAsTable(f"{domain}_silver.{{table_name}}")

# ============== GOLD LAYER ==============

def build_gold_aggregate(fact_table, dim_tables, aggregations):
    \"\"\"Build gold layer aggregation.\"\"\"
    # Read fact table
    fact_df = spark.table(f"{domain}_silver.{{fact_table}}")

    # Join dimensions
    for dim_table, join_key in dim_tables:
        dim_df = spark.table(f"{domain}_silver.{{dim_table}}")
        fact_df = fact_df.join(dim_df, join_key, "left")

    # Apply aggregations
    gold_df = fact_df.groupBy(*aggregations['group_by']).agg(
        *[agg_func.alias(name) for name, agg_func in aggregations['metrics'].items()]
    )

    # Write with V-Order optimization
    gold_df.write \\
        .format("delta") \\
        .mode("overwrite") \\
        .option("spark.sql.parquet.vorder.enabled", "true") \\
        .saveAsTable(f"{domain}_gold.{{fact_table}}_agg")
"""
```

## Lakehouse vs Warehouse Decision

```python
@dataclass
class WorkloadPattern:
    pattern: str
    use_lakehouse: bool
    use_warehouse: bool
    reasoning: str
    recommended_setup: str

workload_patterns = {
    "data_engineering": WorkloadPattern(
        pattern="Heavy Data Engineering with Spark",
        use_lakehouse=True,
        use_warehouse=False,
        reasoning="Spark transformations, Python/Scala code, ML workloads",
        recommended_setup="Lakehouse + Notebooks + Pipelines"
    ),
    "traditional_bi": WorkloadPattern(
        pattern="Traditional BI with Complex SQL",
        use_lakehouse=False,
        use_warehouse=True,
        reasoning="Complex T-SQL, stored procedures, SQL-based ETL",
        recommended_setup="Warehouse + T-SQL scripts + Pipelines"
    ),
    "hybrid_analytics": WorkloadPattern(
        pattern="Hybrid Analytics",
        use_lakehouse=True,
        use_warehouse=True,
        reasoning="Spark for ingestion/transform, SQL for analytics",
        recommended_setup="Lakehouse (bronze/silver) -> Warehouse (gold) -> Semantic Model"
    ),
    "real_time_plus_batch": WorkloadPattern(
        pattern="Real-time and Batch Combined",
        use_lakehouse=True,
        use_warehouse=False,
        reasoning="Streaming ingestion, real-time analytics, batch processing",
        recommended_setup="Lakehouse + Eventstream + KQL Database"
    ),
    "direct_lake_bi": WorkloadPattern(
        pattern="High-Performance BI with Direct Lake",
        use_lakehouse=True,
        use_warehouse=False,
        reasoning="Large datasets, fast Power BI, no import needed",
        recommended_setup="Lakehouse with V-Order -> Direct Lake Semantic Model"
    )
}

def recommend_architecture(requirements: Dict) -> Dict:
    """Recommend architecture based on requirements."""
    result = {
        "primary_pattern": None,
        "components": [],
        "data_flow": "",
        "reasoning": []
    }

    # Analyze requirements
    has_spark = requirements.get("spark_workloads", False)
    has_complex_sql = requirements.get("complex_sql", False)
    has_realtime = requirements.get("realtime", False)
    data_size_tb = requirements.get("data_size_tb", 1)
    bi_users = requirements.get("bi_users", 10)

    # Recommend pattern
    if has_spark and not has_complex_sql:
        result["primary_pattern"] = "data_engineering"
    elif has_complex_sql and not has_spark:
        result["primary_pattern"] = "traditional_bi"
    elif has_realtime:
        result["primary_pattern"] = "real_time_plus_batch"
    elif data_size_tb > 10 or bi_users > 100:
        result["primary_pattern"] = "direct_lake_bi"
    else:
        result["primary_pattern"] = "hybrid_analytics"

    pattern = workload_patterns[result["primary_pattern"]]
    result["reasoning"].append(pattern.reasoning)

    # Build component list
    if pattern.use_lakehouse:
        result["components"].append("Lakehouse")
    if pattern.use_warehouse:
        result["components"].append("Warehouse")

    result["components"].extend(["Pipelines", "Semantic Model", "Reports"])

    if has_realtime:
        result["components"].extend(["Eventstream", "KQL Database"])

    # Define data flow
    result["data_flow"] = pattern.recommended_setup

    return result
```

## Hub and Spoke Pattern

```python
def hub_spoke_architecture() -> Dict:
    """Define hub and spoke architecture for enterprise Fabric."""
    return {
        "overview": """
Hub and Spoke architecture centralizes shared data while allowing
domain autonomy. The hub contains shared reference data and data products,
while spokes are domain-specific workspaces.
""",
        "hub_workspace": {
            "name": "Platform-Shared",
            "contents": [
                "Reference data (countries, currencies, etc.)",
                "Master data (customers, products)",
                "Shared semantic models",
                "Cross-domain data products"
            ],
            "governance": "Centrally managed by platform team"
        },
        "spoke_workspaces": {
            "pattern": "{Domain}-{Environment}",
            "contents": [
                "Domain-specific data",
                "Domain transformations",
                "Domain reports"
            ],
            "governance": "Managed by domain teams"
        },
        "connectivity": {
            "hub_to_spoke": "Shortcuts from hub to spokes (read access)",
            "spoke_to_hub": "Data contracts for sharing back to hub",
            "spoke_to_spoke": "Via hub only (no direct connections)"
        },
        "implementation": """
# Creating shortcuts from spoke to hub data

# In domain workspace notebook:
from pyspark.sql import SparkSession
spark = SparkSession.builder.getOrCreate()

# Reference hub data via shortcut
customers = spark.table("Platform_Shared.lh_master.customers")

# Join with domain data
domain_sales = spark.table("Sales_Prod.lh_curated.transactions")
enriched = domain_sales.join(customers, "customer_id", "left")
"""
    }
```

## Reference Architecture

```python
def generate_reference_architecture(org_name: str) -> str:
    """Generate reference architecture documentation."""
    return f"""
# {org_name} Fabric Reference Architecture

## Overview

This document defines the standard architecture patterns for Microsoft Fabric
implementations at {org_name}.

## Workspace Structure

```
{org_name}-Platform-Shared (Hub)
├── lh_reference_data
├── lh_master_data
└── sm_enterprise_dimensions

{org_name}-Sales-Prod (Spoke)
├── lh_sales_bronze
├── lh_sales_silver
├── lh_sales_gold
├── wh_sales_analytics (if needed)
└── sm_sales_analytics

{org_name}-Sales-Dev
└── (Development copies)
```

## Data Flow

```
External Sources
     │
     ▼
[Bronze Layer] ─── Raw data in Lakehouse
     │
     ▼
[Silver Layer] ─── Cleansed data in Lakehouse
     │
     ▼
[Gold Layer] ──── Business-ready in Lakehouse/Warehouse
     │
     ▼
[Semantic Model] ─ Direct Lake or Import
     │
     ▼
[Reports/Dashboards]
```

## Key Design Decisions

1. **Lakehouse-first approach** for most workloads
2. **Warehouse** only when complex T-SQL required
3. **Direct Lake** for large datasets in Power BI
4. **Shortcuts** for cross-workspace data access
5. **Medallion architecture** for data layers
"""
```

Tomorrow, we'll explore Lakehouse vs Warehouse in detail!
