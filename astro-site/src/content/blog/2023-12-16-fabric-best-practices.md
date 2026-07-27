---
title: "Microsoft Fabric Best Practices for Production"
author: "Michael John Peña"
draft: false
date: 2023-12-16
tags: ["Microsoft Fabric", "Best Practices", "Production", "Data Engineering", "Architecture"]

---

I wrote "Microsoft Fabric Best Practices for Production" to share practical, production-minded guidance on this topic.

Shipping Fabric into production exposes common anti-patterns — unbounded capacity use, duplicated data copies, and insufficient observability. The best practices below are battle-tested and oriented to keeping costs predictable while enabling scale.

## Workspace Organization

## Workspace Organization

```python
from dataclasses import dataclass
from typing import List, Dict

@dataclass
class WorkspacePattern:
    pattern_name: str
    description: str
    workspace_structure: Dict[str, List[str]]
    pros: List[str]
    cons: List[str]
    best_for: str

workspace_patterns = {
    "environment_based": WorkspacePattern(
        pattern_name="Environment-Based",
        description="Separate workspaces for dev, test, prod",
        workspace_structure={
            "Sales-Dev": ["Development notebooks", "Test data"],
            "Sales-Test": ["Integration testing", "UAT"],
            "Sales-Prod": ["Production workloads", "Live data"]
        },
        pros=["Clear separation", "Easy access control", "Standard CI/CD"],
        cons=["Workspace proliferation", "Cross-environment testing complex"],
        best_for="Traditional enterprise deployments"
    ),
    "domain_based": WorkspacePattern(
        pattern_name="Domain-Based",
        description="Workspaces aligned with business domains",
        workspace_structure={
            "Sales-Domain": ["All sales workloads"],
            "Marketing-Domain": ["All marketing workloads"],
            "Finance-Domain": ["All finance workloads"],
            "Platform-Shared": ["Shared data products"]
        },
        pros=["Domain autonomy", "Clear ownership", "Data mesh aligned"],
        cons=["Need cross-domain governance", "Potential duplication"],
        best_for="Data mesh implementations"
    ),
    "hybrid": WorkspacePattern(
        pattern_name="Hybrid (Domain + Environment)",
        description="Combine domain and environment separation",
        workspace_structure={
            "Sales-Dev": ["Development"],
            "Sales-Prod": ["Production"],
            "Marketing-Dev": ["Development"],
            "Marketing-Prod": ["Production"],
            "Platform-Shared": ["Cross-domain shared"]
        },
        pros=["Full isolation", "Domain ownership", "Environment control"],
        cons=["Many workspaces to manage", "Complex governance"],
        best_for="Large enterprises with strict requirements"
    )
}

def recommend_workspace_pattern(requirements: Dict) -> str:
    """Recommend workspace pattern based on requirements."""
    if requirements.get("data_mesh"):
        return "domain_based"
    elif requirements.get("strict_environments"):
        return "environment_based"
    elif requirements.get("large_enterprise"):
        return "hybrid"
    else:
        return "environment_based"
```

## Naming Conventions

```python
naming_conventions = {
    "workspaces": {
        "pattern": "{Domain}-{Environment}",
        "examples": ["Sales-Prod", "Marketing-Dev", "Finance-UAT"],
        "rules": [
            "Use PascalCase",
            "Keep under 50 characters",
            "Include environment suffix for non-prod"
        ]
    },
    "lakehouses": {
        "pattern": "lh_{domain}_{purpose}",
        "examples": ["lh_sales_raw", "lh_sales_curated", "lh_shared_reference"],
        "rules": [
            "Use snake_case",
            "Prefix with 'lh_'",
            "Include layer (raw/curated/serving)"
        ]
    },
    "warehouses": {
        "pattern": "wh_{domain}_{purpose}",
        "examples": ["wh_sales_analytics", "wh_finance_reporting"],
        "rules": [
            "Use snake_case",
            "Prefix with 'wh_'",
            "Indicate primary use case"
        ]
    },
    "notebooks": {
        "pattern": "{category}_{action}_{subject}",
        "examples": ["etl_load_customers", "analysis_monthly_sales", "transform_dedupe_records"],
        "rules": [
            "Use snake_case",
            "Start with category (etl, analysis, transform, test)",
            "Be descriptive but concise"
        ]
    },
    "pipelines": {
        "pattern": "pl_{source}_{target}_{frequency}",
        "examples": ["pl_sqlserver_lakehouse_daily", "pl_api_bronze_hourly"],
        "rules": [
            "Prefix with 'pl_'",
            "Include source and target",
            "Include frequency if scheduled"
        ]
    },
    "semantic_models": {
        "pattern": "{domain} {subject} Model",
        "examples": ["Sales Performance Model", "Customer Analytics Model"],
        "rules": [
            "Use Title Case with spaces",
            "Include domain context",
            "End with 'Model'"
        ]
    },
    "reports": {
        "pattern": "{domain} - {report_name}",
        "examples": ["Sales - Executive Dashboard", "Finance - Monthly Close Report"],
        "rules": [
            "Start with domain",
            "Use dash separator",
            "Be user-friendly"
        ]
    }
}

def validate_name(item_type: str, name: str) -> Dict:
    """Validate name against conventions."""
    convention = naming_conventions.get(item_type, {})
    pattern = convention.get("pattern", "")
    rules = convention.get("rules", [])

    issues = []

    # Check basic rules
    if len(name) > 100:
        issues.append("Name too long (max 100 characters)")

    if item_type in ["lakehouses", "warehouses", "notebooks", "pipelines"]:
        if " " in name:
            issues.append("Should not contain spaces (use snake_case)")
        if name != name.lower():
            issues.append("Should be lowercase")

    # Check prefix
    if item_type == "lakehouses" and not name.startswith("lh_"):
        issues.append("Should start with 'lh_' prefix")
    elif item_type == "warehouses" and not name.startswith("wh_"):
        issues.append("Should start with 'wh_' prefix")
    elif item_type == "pipelines" and not name.startswith("pl_"):
        issues.append("Should start with 'pl_' prefix")

    return {
        "name": name,
        "item_type": item_type,
        "valid": len(issues) == 0,
        "issues": issues,
        "pattern": pattern
    }
```

## Data Lakehouse Best Practices

```python
lakehouse_best_practices = {
    "layer_organization": {
        "bronze_layer": {
            "purpose": "Raw data landing zone",
            "format": "Delta (preserve original schema)",
            "retention": "Keep full history",
            "naming": "{source}_{table}_raw",
            "tips": [
                "Preserve source schema exactly",
                "Add ingestion metadata columns",
                "Partition by ingestion date"
            ]
        },
        "silver_layer": {
            "purpose": "Cleansed, validated data",
            "format": "Delta (standardized schema)",
            "retention": "Keep relevant history",
            "naming": "{domain}_{entity}_clean",
            "tips": [
                "Apply data quality rules",
                "Standardize data types",
                "Handle duplicates and nulls"
            ]
        },
        "gold_layer": {
            "purpose": "Business-ready aggregates",
            "format": "Delta (optimized for queries)",
            "retention": "As needed by business",
            "naming": "{domain}_{subject}_agg",
            "tips": [
                "Pre-aggregate common metrics",
                "Optimize for Power BI DirectQuery",
                "Apply V-Order optimization"
            ]
        }
    },
    "delta_table_optimization": {
        "v_order": {
            "description": "Column-based sorting for faster reads",
            "how_to_enable": "spark.conf.set('spark.sql.parquet.vorder.enabled', 'true')",
            "best_for": "Tables frequently queried in Power BI"
        },
        "optimize_write": {
            "description": "Automatic file sizing",
            "how_to_enable": "spark.conf.set('spark.microsoft.delta.optimizeWrite.enabled', 'true')",
            "best_for": "All tables"
        },
        "partitioning": {
            "description": "Partition large tables",
            "guidance": "Partition by date for time-series, by key for lookups",
            "avoid": "Over-partitioning (< 1GB per partition is too small)"
        },
        "z_ordering": {
            "description": "Cluster data by query columns",
            "how_to": "OPTIMIZE table ZORDER BY (column)",
            "best_for": "Tables with common filter columns"
        }
    }
}

def generate_lakehouse_template(domain: str, layers: List[str]) -> str:
    """Generate lakehouse setup code."""
    code = f"""
# Lakehouse Setup for {domain} Domain

from pyspark.sql import SparkSession

spark = SparkSession.builder.getOrCreate()

# Enable optimizations
spark.conf.set("spark.sql.parquet.vorder.enabled", "true")
spark.conf.set("spark.microsoft.delta.optimizeWrite.enabled", "true")

# Create schemas for each layer
"""

    for layer in layers:
        code += f"""
# {layer.upper()} Layer Tables
spark.sql("CREATE SCHEMA IF NOT EXISTS {domain}_{layer}")
"""

    code += """
# Example: Create bronze table with metadata
def create_bronze_table(df, table_name, source_name):
    from pyspark.sql.functions import current_timestamp, lit

    df_with_metadata = df.withColumn("_ingested_at", current_timestamp()) \\
                         .withColumn("_source", lit(source_name))

    df_with_metadata.write \\
        .format("delta") \\
        .mode("append") \\
        .option("mergeSchema", "true") \\
        .saveAsTable(f"{domain}_bronze.{table_name}")
"""

    return code
```

## Security Best Practices

```python
security_best_practices = {
    "access_control": {
        "workspace_level": [
            "Use Azure AD groups for workspace access",
            "Assign minimum required roles",
            "Review access quarterly"
        ],
        "item_level": [
            "Apply item permissions for sensitive assets",
            "Use Row-Level Security for multi-tenant data",
            "Implement Object-Level Security for sensitive columns"
        ]
    },
    "data_protection": {
        "encryption": [
            "Data encrypted at rest by default",
            "Use customer-managed keys for sensitive workloads",
            "Ensure TLS 1.2+ for transit"
        ],
        "masking": [
            "Apply dynamic data masking for PII",
            "Use column-level encryption for highly sensitive data"
        ]
    },
    "audit_logging": {
        "what_to_log": [
            "User access to workspaces",
            "Data reads and exports",
            "Schema changes",
            "Permission changes"
        ],
        "how_to": "Enable and export Microsoft 365 Unified Audit Log"
    }
}
```

Tomorrow, we'll explore Fabric architecture patterns in depth!\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
