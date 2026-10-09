---
title: "Fabric Components: When to Use What"
description: "Fabric's component set is broad; the hard part is picking the minimal surface that solves your business need. This guide distils when to use Lakehouse…"
author: "Michael John Peña"
draft: false
date: 2023-12-19
tags: ["Microsoft Fabric", "Architecture", "Components", "Decision Guide", "Best Practices"]
---

Fabric's component set is broad; the hard part is picking the minimal surface that solves your business need. This guide distils when to use Lakehouse, Warehouse, Dataflows and more based on workload characteristics and operational constraints.

## Component Overview

## Component Overview

```python
from dataclasses import dataclass
from typing import List, Dict

@dataclass
class FabricComponent:
    name: str
    category: str
    primary_use: str
    when_to_use: List[str]
    when_not_to_use: List[str]
    integrates_with: List[str]

fabric_components = {
    "lakehouse": FabricComponent(
        name="Lakehouse",
        category="Data Storage",
        primary_use="Unified data storage with Delta Lake",
        when_to_use=[
            "Data engineering with Spark",
            "Large datasets for Direct Lake",
            "Semi-structured data",
            "ML workloads",
            "Open format requirements"
        ],
        when_not_to_use=[
            "Complex T-SQL stored procedures",
            "Legacy SQL Server migration",
            "Real-time streaming storage"
        ],
        integrates_with=["Notebooks", "Pipelines", "Semantic Models", "Warehouse (shortcuts)"]
    ),
    "warehouse": FabricComponent(
        name="Warehouse",
        category="Data Storage",
        primary_use="SQL-based analytics warehouse",
        when_to_use=[
            "Complex T-SQL requirements",
            "Stored procedures and functions",
            "SQL Server migration",
            "SQL-centric teams"
        ],
        when_not_to_use=[
            "Heavy Spark processing",
            "Semi-structured data",
            "ML model training"
        ],
        integrates_with=["Pipelines", "Semantic Models", "Lakehouse (shortcuts)"]
    ),
    "notebook": FabricComponent(
        name="Notebook",
        category="Compute",
        primary_use="Interactive data engineering and science",
        when_to_use=[
            "Data transformations with Spark",
            "Exploratory data analysis",
            "ML model development",
            "Ad-hoc analysis"
        ],
        when_not_to_use=[
            "Production scheduled jobs (use pipelines)",
            "Simple data copies",
            "T-SQL transformations"
        ],
        integrates_with=["Lakehouse", "Pipelines", "ML Models"]
    ),
    "pipeline": FabricComponent(
        name="Data Pipeline",
        category="Orchestration",
        primary_use="Orchestrate data movement and transformation",
        when_to_use=[
            "Scheduled data ingestion",
            "Orchestrating multiple activities",
            "Data movement between systems",
            "Production ETL jobs"
        ],
        when_not_to_use=[
            "Real-time data (use Eventstream)",
            "Ad-hoc analysis",
            "Simple Spark transformations"
        ],
        integrates_with=["Lakehouse", "Warehouse", "Notebooks", "Dataflows"]
    ),
    "dataflow_gen2": FabricComponent(
        name="Dataflow Gen2",
        category="Data Transformation",
        primary_use="Low-code data transformation",
        when_to_use=[
            "Simple transformations",
            "Power Query familiarity",
            "Citizen data engineers",
            "Quick data prep"
        ],
        when_not_to_use=[
            "Complex transformations",
            "Large data volumes",
            "Custom code requirements"
        ],
        integrates_with=["Lakehouse", "Warehouse", "Pipelines"]
    ),
    "semantic_model": FabricComponent(
        name="Semantic Model",
        category="Analytics",
        primary_use="Business logic layer for reporting",
        when_to_use=[
            "Always for Power BI reports",
            "Defining business metrics",
            "Row-level security",
            "Calculation logic"
        ],
        when_not_to_use=[
            "Raw data exploration",
            "Data transformation"
        ],
        integrates_with=["Lakehouse", "Warehouse", "Reports"]
    ),
    "kql_database": FabricComponent(
        name="KQL Database",
        category="Real-Time Analytics",
        primary_use="Real-time data analytics",
        when_to_use=[
            "Streaming data analysis",
            "Log analytics",
            "Time-series data",
            "Real-time dashboards"
        ],
        when_not_to_use=[
            "Traditional batch analytics",
            "Complex joins across systems"
        ],
        integrates_with=["Eventstream", "Real-Time Dashboards"]
    ),
    "eventstream": FabricComponent(
        name="Eventstream",
        category="Data Ingestion",
        primary_use="Real-time event ingestion",
        when_to_use=[
            "IoT data streams",
            "Event-driven architectures",
            "Real-time data capture",
            "Streaming from Kafka/Event Hubs"
        ],
        when_not_to_use=[
            "Batch data ingestion",
            "File-based data"
        ],
        integrates_with=["KQL Database", "Lakehouse", "Reflex"]
    )
}
```

## Decision Trees

```python
def recommend_for_data_ingestion(requirements: Dict) -> str:
    """Recommend component for data ingestion."""
    if requirements.get("real_time"):
        return "Eventstream -> KQL Database or Lakehouse"
    elif requirements.get("simple_copy"):
        return "Pipeline with Copy Activity"
    elif requirements.get("transformation_needed"):
        if requirements.get("low_code_preferred"):
            return "Dataflow Gen2"
        else:
            return "Pipeline orchestrating Notebook"
    else:
        return "Pipeline with Copy Activity"

def recommend_for_transformation(requirements: Dict) -> str:
    """Recommend component for data transformation."""
    complexity = requirements.get("complexity", "medium")
    data_size = requirements.get("data_size_gb", 100)
    language = requirements.get("preferred_language", "spark")

    if complexity == "simple" and data_size < 50:
        return "Dataflow Gen2 (low-code)"
    elif language == "tsql":
        return "Warehouse (T-SQL scripts/stored procedures)"
    elif language == "spark":
        if complexity == "complex" or data_size > 100:
            return "Notebook with Spark"
        else:
            return "Notebook with Spark or Dataflow Gen2"
    else:
        return "Notebook with Spark"

def recommend_for_analytics(requirements: Dict) -> str:
    """Recommend component for analytics."""
    query_type = requirements.get("query_type", "batch")
    data_size_tb = requirements.get("data_size_tb", 1)
    bi_tool = requirements.get("bi_tool", "power_bi")

    if query_type == "real_time":
        return "KQL Database + Real-Time Dashboard"
    elif bi_tool == "power_bi":
        if data_size_tb > 5:
            return "Lakehouse + Direct Lake + Semantic Model"
        else:
            return "Lakehouse or Warehouse + Semantic Model"
    else:
        return "Lakehouse or Warehouse with SQL endpoint"
```

## Workload-Based Recommendations

```python
workload_recommendations = {
    "enterprise_bi": {
        "description": "Traditional enterprise BI with dashboards and reports",
        "recommended_stack": [
            ("Data Ingestion", "Pipeline"),
            ("Data Storage", "Lakehouse (or Warehouse for T-SQL)"),
            ("Business Logic", "Semantic Model"),
            ("Visualization", "Power BI Reports")
        ],
        "tips": [
            "Use Direct Lake for large datasets",
            "Implement semantic model governance",
            "Consider incremental refresh"
        ]
    },
    "data_engineering": {
        "description": "ETL/ELT pipelines and data processing",
        "recommended_stack": [
            ("Orchestration", "Pipeline"),
            ("Compute", "Notebook with Spark"),
            ("Storage", "Lakehouse (Delta)"),
            ("Monitoring", "Pipeline monitoring")
        ],
        "tips": [
            "Use medallion architecture",
            "Implement data quality checks",
            "Version control notebooks"
        ]
    },
    "real_time_analytics": {
        "description": "Streaming data and real-time insights",
        "recommended_stack": [
            ("Ingestion", "Eventstream"),
            ("Storage", "KQL Database"),
            ("Analytics", "KQL queries"),
            ("Visualization", "Real-Time Dashboard")
        ],
        "tips": [
            "Design for late-arriving data",
            "Set appropriate retention policies",
            "Monitor stream health"
        ]
    },
    "data_science": {
        "description": "ML model development and deployment",
        "recommended_stack": [
            ("Data Prep", "Notebook"),
            ("Training", "Notebook with MLflow"),
            ("Storage", "Lakehouse"),
            ("Deployment", "ML Model endpoint")
        ],
        "tips": [
            "Use MLflow for experiment tracking",
            "Version your training data",
            "Implement model monitoring"
        ]
    },
    "hybrid_analytics": {
        "description": "Mixed batch and real-time requirements",
        "recommended_stack": [
            ("Batch Ingestion", "Pipeline"),
            ("Real-Time Ingestion", "Eventstream"),
            ("Batch Storage", "Lakehouse"),
            ("Real-Time Storage", "KQL Database"),
            ("Unified View", "Semantic Model with composite")
        ],
        "tips": [
            "Design clear data contracts",
            "Consider data freshness requirements",
            "Plan for data reconciliation"
        ]
    }
}

def get_recommendation_for_workload(workload_type: str) -> Dict:
    """Get detailed recommendations for a workload type."""
    if workload_type in workload_recommendations:
        rec = workload_recommendations[workload_type]
        return {
            "workload": workload_type,
            "description": rec["description"],
            "stack": rec["recommended_stack"],
            "tips": rec["tips"],
            "diagram": generate_architecture_diagram(rec["recommended_stack"])
        }
    return {"error": "Unknown workload type"}

def generate_architecture_diagram(stack: List[tuple]) -> str:
    """Generate ASCII architecture diagram."""
    diagram = "\n```\n"
    for i, (layer, component) in enumerate(stack):
        if i > 0:
            diagram += "        |\n        v\n"
        diagram += f"[{layer}] --> {component}\n"
    diagram += "```"
    return diagram
```

Tomorrow, we'll explore Fabric performance tuning techniques!
