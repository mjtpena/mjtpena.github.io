---
title: "SemPy Library: Python for Semantic Models in Fabric"
author: Michael John Peña
draft: false
date: 2023-09-27
description: "Deep dive into the SemPy library for working with Power BI semantic models in Microsoft Fabric notebooks."
tags:
  - Microsoft Fabric
  - SemPy
  - Python
  - Power BI
  - Data Science

---

I wrote "SemPy Library: Python for Semantic Models in Fabric" to share practical, production-minded guidance on this topic.

## Introduction

SemPy (Semantic Link Python library) is the core library that enables interaction between Python notebooks and Power BI semantic models in Microsoft Fabric. This post provides a comprehensive guide to using SemPy for data science and analytics workflows.

## SemPy Fundamentals

### Installation and Setup

```python
# SemPy is pre-installed in Fabric notebooks
# For local development or other environments:
# pip install semantic-link

# Import the library
import sempy.fabric as fabric

# Basic usage demonstration
class SemPyIntroduction:
    """Introduction to SemPy capabilities"""

    def __init__(self):
        self.features = {
            "read_table": "Read tables from semantic models",
            "evaluate_measure": "Evaluate DAX measures",
            "evaluate_dax": "Execute arbitrary DAX queries",
            "list_datasets": "List available datasets",
            "get_model_info": "Get semantic model metadata",
            "refresh_dataset": "Trigger dataset refresh"
        }

    def demonstrate_basic_operations(self) -> str:
        """Generate code demonstrating basic operations"""
        return '''
# Basic SemPy Operations
import sempy.fabric as fabric

# 1. List available datasets in workspace
datasets = fabric.list_datasets()
print("Available datasets:")
for ds in datasets:
    print(f"  - {ds['name']} (ID: {ds['id']})")

# 2. Read a table
df = fabric.read_table(
    dataset="Sales Analytics",
    table="Sales"
)
print(f"\\nSales table: {df.shape[0]} rows, {df.shape[1]} columns")

# 3. Evaluate a measure
revenue = fabric.evaluate_measure(
    dataset="Sales Analytics",
    measure="Total Revenue"
)
print(f"\\nTotal Revenue: {revenue}")

# 4. Evaluate measure with grouping
revenue_by_region = fabric.evaluate_measure(
    dataset="Sales Analytics",
    measure=["Total Revenue", "Order Count"],
    groupby_columns=["Region"]
)
print("\\nRevenue by Region:")
print(revenue_by_region)

# 5. Execute DAX query
dax_result = fabric.evaluate_dax(
    dataset="Sales Analytics",
    dax_string="""
    EVALUATE
    TOPN(10,
        SUMMARIZE(
            Sales,
            Products[ProductName],
            "Revenue", [Total Revenue]
        ),
        [Revenue], DESC
    )
    """
)
print("\\nTop 10 Products by Revenue:")
print(dax_result)
'''
```

### Working with Tables

```python
class SemPyTableOperations:
    """Table operations with SemPy"""

    def read_table_patterns(self) -> str:
        """Patterns for reading tables"""
        return '''
# Reading Tables with SemPy
import sempy.fabric as fabric
import pandas as pd

# Basic table read
sales_df = fabric.read_table(
    dataset="Sales Analytics",
    table="Sales"
)

# Read with multiindex (for tables with hierarchies)
calendar_df = fabric.read_table(
    dataset="Sales Analytics",
    table="Calendar",
    multiindex_hierarchies=True  # Preserves hierarchical structure
)

# Read multiple tables
tables_to_read = ["Sales", "Products", "Customers"]
dataframes = {}
for table in tables_to_read:
    dataframes[table] = fabric.read_table(
        dataset="Sales Analytics",
        table=table
    )

# Combine tables based on model relationships
# (SemPy doesn't auto-join, but you can leverage relationship info)
model_info = fabric.get_model_info("Sales Analytics")

# Find relationship between Sales and Products
for rel in model_info['relationships']:
    if rel['fromTable'] == 'Sales' and rel['toTable'] == 'Products':
        print(f"Join on: Sales.{rel['fromColumn']} = Products.{rel['toColumn']}")

# Perform the join
merged_df = dataframes['Sales'].merge(
    dataframes['Products'],
    left_on='ProductID',
    right_on='ProductKey',
    how='left'
)
'''

    def optimize_large_table_reads(self) -> str:
        """Patterns for optimizing large table reads"""
        return '''
# Optimizing Large Table Reads
import sempy.fabric as fabric

# Option 1: Use DAX to filter before reading
filtered_data = fabric.evaluate_dax(
    dataset="Sales Analytics",
    dax_string="""
    EVALUATE
    FILTER(
        Sales,
        Sales[OrderDate] >= DATE(2023, 1, 1)
    )
    """
)

# Option 2: Read specific columns only
# First, get table structure
model_info = fabric.get_model_info("Sales Analytics")
sales_columns = [col['name'] for col in model_info['tables'][0]['columns']]
print(f"Available columns: {sales_columns}")

# Select only needed columns via DAX
selected_columns = fabric.evaluate_dax(
    dataset="Sales Analytics",
    dax_string="""
    EVALUATE
    SELECTCOLUMNS(
        Sales,
        "OrderID", Sales[OrderID],
        "OrderDate", Sales[OrderDate],
        "Amount", Sales[Amount]
    )
    """
)

# Option 3: Sample for exploration
sample_data = fabric.evaluate_dax(
    dataset="Sales Analytics",
    dax_string="""
    EVALUATE
    SAMPLE(1000, Sales, Sales[OrderID])
    """
)
print(f"Sample size: {sample_data.shape[0]} rows")
'''
```

### Working with Measures

```python
class SemPyMeasureOperations:
    """Measure operations with SemPy"""

    def evaluate_measures_patterns(self) -> str:
        """Patterns for evaluating measures"""
        return '''
# Evaluating Measures with SemPy
import sempy.fabric as fabric

# Single measure, no grouping (total)
total_revenue = fabric.evaluate_measure(
    dataset="Sales Analytics",
    measure="Total Revenue"
)
print(f"Total Revenue: ${total_revenue:,.2f}")

# Multiple measures, no grouping
metrics = fabric.evaluate_measure(
    dataset="Sales Analytics",
    measure=["Total Revenue", "Total Cost", "Profit Margin"]
)
print("\\nAll metrics:")
print(metrics)

# Single measure with grouping
revenue_by_region = fabric.evaluate_measure(
    dataset="Sales Analytics",
    measure="Total Revenue",
    groupby_columns=["Region"]
)

# Multiple measures with multiple groupings
detailed_metrics = fabric.evaluate_measure(
    dataset="Sales Analytics",
    measure=["Total Revenue", "Order Count", "Average Order Value"],
    groupby_columns=["Region", "ProductCategory"]
)
print("\\nDetailed metrics by Region and Category:")
print(detailed_metrics)

# Measures with filters (using DAX for more control)
filtered_measure = fabric.evaluate_dax(
    dataset="Sales Analytics",
    dax_string="""
    EVALUATE
    SUMMARIZE(
        FILTER(Sales, Sales[Region] = "North"),
        Calendar[Year],
        "Revenue", [Total Revenue],
        "YoY Growth", [Revenue YoY %]
    )
    """
)
'''

    def create_feature_measures(self) -> str:
        """Create ML features from measures"""
        return '''
# Creating ML Features from DAX Measures
import sempy.fabric as fabric
import pandas as pd

# Get customer-level features using business measures
customer_features = fabric.evaluate_measure(
    dataset="Sales Analytics",
    measure=[
        "Lifetime Value",
        "Average Order Value",
        "Order Frequency",
        "Days Since Last Order",
        "Total Orders",
        "Product Diversity Score"
    ],
    groupby_columns=["CustomerID"]
)

# Add customer attributes
customer_info = fabric.read_table(
    dataset="Sales Analytics",
    table="Customers"
)

# Merge features with attributes
feature_df = customer_features.merge(
    customer_info[["CustomerID", "Segment", "JoinDate", "Region"]],
    on="CustomerID",
    how="left"
)

# Calculate additional derived features
feature_df["tenure_days"] = (pd.Timestamp.now() - pd.to_datetime(feature_df["JoinDate"])).dt.days
feature_df["orders_per_month"] = feature_df["Total Orders"] / (feature_df["tenure_days"] / 30)

print(f"Feature set: {feature_df.shape}")
print(f"Features: {list(feature_df.columns)}")
feature_df.head()
'''
```

### Advanced DAX Queries

```python
class SemPyDAXOperations:
    """Advanced DAX operations with SemPy"""

    def complex_dax_patterns(self) -> str:
        """Complex DAX query patterns"""
        return '''
# Complex DAX Queries with SemPy
import sempy.fabric as fabric

# Time Intelligence Analysis
time_analysis = fabric.evaluate_dax(
    dataset="Sales Analytics",
    dax_string="""
    EVALUATE
    ADDCOLUMNS(
        SUMMARIZE(
            Sales,
            'Calendar'[Year],
            'Calendar'[MonthName],
            'Calendar'[MonthNumber]
        ),
        "Current Revenue", [Total Revenue],
        "Previous Year Revenue", CALCULATE(
            [Total Revenue],
            SAMEPERIODLASTYEAR('Calendar'[Date])
        ),
        "YoY Growth %",
            DIVIDE(
                [Total Revenue] - CALCULATE([Total Revenue], SAMEPERIODLASTYEAR('Calendar'[Date])),
                CALCULATE([Total Revenue], SAMEPERIODLASTYEAR('Calendar'[Date]))
            ),
        "Running Total YTD", TOTALYTD([Total Revenue], 'Calendar'[Date])
    )
    ORDER BY 'Calendar'[Year], 'Calendar'[MonthNumber]
    """
)

# Cohort Analysis
cohort_analysis = fabric.evaluate_dax(
    dataset="Sales Analytics",
    dax_string="""
    EVALUATE
    ADDCOLUMNS(
        SUMMARIZE(
            Customers,
            Customers[CohortMonth],
            "Months Since Join", DATEDIFF(Customers[CohortMonth], TODAY(), MONTH)
        ),
        "Cohort Size", CALCULATE(DISTINCTCOUNT(Customers[CustomerID])),
        "Active Customers", CALCULATE(
            DISTINCTCOUNT(Sales[CustomerID]),
            USERELATIONSHIP(Customers[CustomerID], Sales[CustomerID])
        ),
        "Retention Rate", DIVIDE(
            CALCULATE(DISTINCTCOUNT(Sales[CustomerID])),
            CALCULATE(DISTINCTCOUNT(Customers[CustomerID]))
        )
    )
    """
)

# RFM Analysis
rfm_analysis = fabric.evaluate_dax(
    dataset="Sales Analytics",
    dax_string="""
    EVALUATE
    ADDCOLUMNS(
        VALUES(Customers[CustomerID]),
        "Recency", [Days Since Last Order],
        "Frequency", [Order Count],
        "Monetary", [Lifetime Value],
        "R_Score",
            SWITCH(
                TRUE(),
                [Days Since Last Order] <= 30, 5,
                [Days Since Last Order] <= 60, 4,
                [Days Since Last Order] <= 90, 3,
                [Days Since Last Order] <= 180, 2,
                1
            ),
        "F_Score",
            SWITCH(
                TRUE(),
                [Order Count] >= 20, 5,
                [Order Count] >= 10, 4,
                [Order Count] >= 5, 3,
                [Order Count] >= 2, 2,
                1
            ),
        "M_Score",
            SWITCH(
                TRUE(),
                [Lifetime Value] >= 10000, 5,
                [Lifetime Value] >= 5000, 4,
                [Lifetime Value] >= 1000, 3,
                [Lifetime Value] >= 500, 2,
                1
            )
    )
    """
)

print("RFM Analysis Results:")
print(rfm_analysis)
'''

    def parameterized_queries(self) -> str:
        """Parameterized DAX queries"""
        return '''
# Parameterized DAX Queries
import sempy.fabric as fabric
from datetime import datetime, timedelta

def get_revenue_for_period(start_date, end_date, region=None):
    """Get revenue for a specific period and optionally region"""
    filter_clause = f"""
        Sales[OrderDate] >= DATE({start_date.year}, {start_date.month}, {start_date.day}) &&
        Sales[OrderDate] <= DATE({end_date.year}, {end_date.month}, {end_date.day})
    """

    if region:
        filter_clause += f" && Sales[Region] = \\"{region}\\""

    dax_query = f"""
    EVALUATE
    ROW(
        "StartDate", DATE({start_date.year}, {start_date.month}, {start_date.day}),
        "EndDate", DATE({end_date.year}, {end_date.month}, {end_date.day}),
        "Revenue", CALCULATE([Total Revenue], {filter_clause}),
        "Orders", CALCULATE([Order Count], {filter_clause})
    )
    """

    return fabric.evaluate_dax(
        dataset="Sales Analytics",
        dax_string=dax_query
    )

# Usage
today = datetime.now()
last_30_days = get_revenue_for_period(
    today - timedelta(days=30),
    today
)
print(f"Last 30 days: {last_30_days}")

north_region = get_revenue_for_period(
    datetime(2023, 1, 1),
    datetime(2023, 12, 31),
    region="North"
)
print(f"North region 2023: {north_region}")
'''

# Usage
dax_ops = SemPyDAXOperations()
print(dax_ops.complex_dax_patterns())
```

### Model Metadata and Exploration

```python
class SemPyModelExploration:
    """Explore semantic model metadata"""

    def explore_model_structure(self) -> str:
        """Code for exploring model structure"""
        return '''
# Exploring Semantic Model Structure
import sempy.fabric as fabric
import json

# Get comprehensive model information
model_info = fabric.get_model_info("Sales Analytics")

# Explore tables
print("=== TABLES ===")
for table in model_info['tables']:
    print(f"\\n{table['name']}:")
    print(f"  Columns: {len(table['columns'])}")
    print(f"  Measures: {len([m for m in model_info['measures'] if m.get('table') == table['name']])}")

    # Show column details
    for col in table['columns'][:5]:  # First 5 columns
        print(f"    - {col['name']} ({col['dataType']})")
    if len(table['columns']) > 5:
        print(f"    ... and {len(table['columns']) - 5} more columns")

# Explore relationships
print("\\n=== RELATIONSHIPS ===")
for rel in model_info['relationships']:
    print(f"  {rel['fromTable']}[{rel['fromColumn']}] -> {rel['toTable']}[{rel['toColumn']}]")
    print(f"    Cardinality: {rel.get('crossFilteringBehavior', 'unknown')}")

# Explore measures
print("\\n=== MEASURES ===")
for measure in model_info['measures'][:10]:  # First 10 measures
    print(f"  {measure['name']}:")
    print(f"    Expression: {measure['expression'][:80]}...")
    if 'description' in measure:
        print(f"    Description: {measure['description']}")

# Save model documentation
documentation = {
    "tables": [
        {
            "name": t['name'],
            "columns": [{"name": c['name'], "type": c['dataType']} for c in t['columns']],
            "row_count": "N/A"  # Would need separate query
        }
        for t in model_info['tables']
    ],
    "measures": [
        {"name": m['name'], "expression": m['expression']}
        for m in model_info['measures']
    ],
    "relationships": model_info['relationships']
}

with open("model_documentation.json", "w") as f:
    json.dump(documentation, f, indent=2)

print("\\nModel documentation saved to model_documentation.json")
'''

# Usage
explorer = SemPyModelExploration()
print(explorer.explore_model_structure())
```

## Conclusion

SemPy provides a powerful Python interface for working with Power BI semantic models in Microsoft Fabric. By mastering its table reading, measure evaluation, and DAX query capabilities, data scientists can seamlessly integrate business intelligence assets into their data science workflows while maintaining consistency with established business definitions.

