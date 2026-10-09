---
title: "Semantic Link in Microsoft Fabric: Connecting Data and Analytics"
author: Michael John Peña
draft: false
date: 2023-09-26
description: "Understanding Semantic Link in Microsoft Fabric for seamless integration between Power BI datasets and Spark notebooks."
tags:
  - Microsoft Fabric
  - Semantic Link
  - Power BI
  - Data Science
  - Analytics
---

## Introduction

Semantic Link is a powerful feature in Microsoft Fabric that bridges the gap between Power BI semantic models (datasets) and data science workloads. It enables data scientists to leverage curated business logic from Power BI while working in notebooks with Python and Spark.

## Understanding Semantic Link

### Core Concepts

```python
from dataclasses import dataclass
from typing import List, Dict, Optional

@dataclass
class SemanticModel:
    name: str
    workspace: str
    tables: List[str]
    measures: List[str]
    relationships: List[Dict]

@dataclass
class SemanticLinkConnection:
    workspace_id: str
    dataset_id: str
    dataset_name: str

class SemanticLinkExplained:
    """Understanding Semantic Link concepts"""

    def __init__(self):
        self.capabilities = {
            "read_data": "Read tables from Power BI datasets directly",
            "evaluate_measures": "Execute DAX measures and get results",
            "access_relationships": "Leverage existing data model relationships",
            "use_business_logic": "Reuse curated business definitions",
            "write_back": "Write predictions back to semantic models"
        }

    def explain_benefits(self) -> Dict:
        """Explain benefits of Semantic Link"""
        return {
            "consistency": "Use the same business logic in both BI reports and ML models",
            "governance": "Centralized data definitions ensure compliance",
            "productivity": "No need to recreate complex business calculations",
            "collaboration": "Data scientists and BI analysts work with same source of truth",
            "freshness": "Access live data through DirectQuery-enabled models"
        }

    def get_use_cases(self) -> List[Dict]:
        """Get common use cases for Semantic Link"""
        return [
            {
                "name": "ML Feature Engineering",
                "description": "Use DAX measures as ML features without recreating logic",
                "example": "Customer lifetime value calculated in Power BI used for churn prediction"
            },
            {
                "name": "Data Validation",
                "description": "Validate notebook calculations against established BI metrics",
                "example": "Compare Spark-calculated revenue with Power BI revenue measure"
            },
            {
                "name": "Predictive Analytics",
                "description": "Add predictions to Power BI reports",
                "example": "Forecast values calculated in notebooks displayed in Power BI"
            },
            {
                "name": "What-If Analysis",
                "description": "Perform scenario analysis with ML models",
                "example": "Simulate impact of price changes on demand"
            }
        ]
```

### Working with Semantic Link

```python
# Semantic Link in Fabric Notebooks
class SemanticLinkOperations:
    """Operations using Semantic Link"""

    def __init__(self):
        pass

    def generate_connection_code(self, workspace_name: str, dataset_name: str) -> str:
        """Generate code to connect to semantic model"""
        return f'''
# Connect to Power BI Semantic Model using Semantic Link
import sempy.fabric as fabric

# List available datasets in workspace
datasets = fabric.list_datasets("{workspace_name}")
print("Available datasets:")
for ds in datasets:
    print(f"  - {{ds['name']}}")

# Read table from semantic model
df = fabric.read_table(
    dataset="{dataset_name}",
    table="Sales"
)

print(f"Loaded {{df.shape[0]}} rows from Sales table")
df.head()
'''

    def generate_measure_evaluation_code(
        self,
        dataset_name: str,
        measures: List[str],
        group_by: List[str] = None
    ) -> str:
        """Generate code to evaluate DAX measures"""
        measures_str = str(measures)
        group_by_str = str(group_by) if group_by else "None"

        return f'''
# Evaluate DAX Measures using Semantic Link
import sempy.fabric as fabric

# Define measures to evaluate
measures = {measures_str}

# Evaluate measures with optional grouping
result = fabric.evaluate_measure(
    dataset="{dataset_name}",
    measure=measures,
    groupby_columns={group_by_str}
)

print("Measure Results:")
result
'''

    def generate_dax_query_code(self, dataset_name: str, dax_query: str) -> str:
        """Generate code to execute DAX query"""
        return f'''
# Execute DAX Query using Semantic Link
import sempy.fabric as fabric

dax_query = """
{dax_query}
"""

result = fabric.evaluate_dax(
    dataset="{dataset_name}",
    dax_string=dax_query
)

result
'''

    def generate_relationship_exploration_code(self, dataset_name: str) -> str:
        """Generate code to explore data model relationships"""
        return f'''
# Explore Semantic Model Relationships
import sempy.fabric as fabric

# Get model info
model_info = fabric.get_model_info("{dataset_name}")

# List tables
print("Tables in model:")
for table in model_info['tables']:
    print(f"  - {{table['name']}}: {{len(table['columns'])}} columns")

# List relationships
print("\\nRelationships:")
for rel in model_info['relationships']:
    print(f"  {{rel['fromTable']}}.{{rel['fromColumn']}} -> {{rel['toTable']}}.{{rel['toColumn']}}")

# List measures
print("\\nMeasures:")
for measure in model_info['measures']:
    print(f"  {{measure['name']}}: {{measure['expression'][:50]}}...")
'''

# Usage
semantic_ops = SemanticLinkOperations()

# Generate connection code
conn_code = semantic_ops.generate_connection_code(
    "SalesWorkspace",
    "SalesAnalytics"
)
print(conn_code)

# Generate measure evaluation code
measure_code = semantic_ops.generate_measure_evaluation_code(
    "SalesAnalytics",
    ["Total Revenue", "Average Order Value", "Customer Count"],
    ["Region", "ProductCategory"]
)
print(measure_code)
```

### Integrating Semantic Link with ML Workflows

```python
class SemanticLinkML:
    """Machine Learning with Semantic Link"""

    def generate_feature_extraction_code(
        self,
        dataset_name: str,
        tables: List[str],
        measures: List[str],
        target_table: str
    ) -> str:
        """Generate code to extract features from semantic model"""
        return f'''
# Feature Extraction using Semantic Link
import sempy.fabric as fabric
import pandas as pd

# Extract base data from tables
dfs = {{}}
for table in {tables}:
    dfs[table] = fabric.read_table(dataset="{dataset_name}", table=table)

# Evaluate business measures as features
measure_features = fabric.evaluate_measure(
    dataset="{dataset_name}",
    measure={measures},
    groupby_columns=["CustomerID"]
)

# Merge all features
features_df = dfs["{target_table}"]
features_df = features_df.merge(measure_features, on="CustomerID", how="left")

print(f"Feature dataset shape: {{features_df.shape}}")
print(f"Features: {{list(features_df.columns)}}")

features_df.head()
'''

    def generate_prediction_writeback_code(
        self,
        predictions_df: str,
        target_dataset: str,
        target_table: str
    ) -> str:
        """Generate code to write predictions back to semantic model"""
        return f'''
# Write Predictions back to Semantic Model
import sempy.fabric as fabric

# Assuming {predictions_df} contains predictions
# Add predictions to lakehouse table first
{predictions_df}.write.format("delta").mode("overwrite").saveAsTable("ml_predictions")

# Create relationship in Power BI or use as linked table
# The predictions can now be accessed in Power BI reports

print("Predictions saved. Create relationship in Power BI to join with existing model.")
'''

    def generate_validation_code(
        self,
        dataset_name: str,
        spark_calculation: str,
        dax_measure: str,
        groupby: List[str]
    ) -> str:
        """Generate code to validate Spark vs DAX calculations"""
        return f'''
# Validate Spark Calculations against DAX Measures
import sempy.fabric as fabric
from pyspark.sql import functions as F

# Get DAX measure result
dax_result = fabric.evaluate_measure(
    dataset="{dataset_name}",
    measure=["{dax_measure}"],
    groupby_columns={groupby}
)

# Get Spark calculation result
spark_df = spark.table("source_table")
spark_result = (spark_df
    .groupBy({groupby})
    .agg({spark_calculation})
    .toPandas()
)

# Compare results
comparison = dax_result.merge(
    spark_result,
    on={groupby},
    suffixes=('_dax', '_spark')
)

comparison['difference'] = comparison['{dax_measure}_dax'] - comparison['spark_calc']
comparison['pct_diff'] = (comparison['difference'] / comparison['{dax_measure}_dax'] * 100).round(2)

print("Validation Results:")
print(f"Max difference: {{comparison['pct_diff'].abs().max()}}%")
comparison[comparison['pct_diff'].abs() > 0.01]  # Show discrepancies > 0.01%
'''

# Usage
semantic_ml = SemanticLinkML()

feature_code = semantic_ml.generate_feature_extraction_code(
    dataset_name="CustomerAnalytics",
    tables=["Customers", "Transactions"],
    measures=["Lifetime Value", "Avg Transaction", "Recency Score"],
    target_table="Customers"
)
print(feature_code)
```

### Advanced Semantic Link Patterns

```python
class AdvancedSemanticPatterns:
    """Advanced patterns for Semantic Link"""

    def generate_incremental_analysis_code(
        self,
        dataset_name: str,
        date_column: str,
        measures: List[str]
    ) -> str:
        """Generate code for incremental analysis"""
        return f'''
# Incremental Analysis with Semantic Link
import sempy.fabric as fabric
from datetime import datetime, timedelta

# Get date range for analysis
end_date = datetime.now()
start_date = end_date - timedelta(days=30)

# Filter data for recent period
dax_query = f"""
EVALUATE
CALCULATETABLE(
    SUMMARIZE(
        Sales,
        Sales[{date_column}],
        "Revenue", [Total Revenue],
        "Orders", [Order Count]
    ),
    Sales[{date_column}] >= DATE({{start_date.year}}, {{start_date.month}}, {{start_date.day}})
)
"""

recent_data = fabric.evaluate_dax(
    dataset="{dataset_name}",
    dax_string=dax_query
)

# Calculate trends
recent_data['{date_column}'] = pd.to_datetime(recent_data['{date_column}'])
recent_data = recent_data.sort_values('{date_column}')

# 7-day rolling average
recent_data['Revenue_7d_avg'] = recent_data['Revenue'].rolling(7).mean()

print("Recent trend analysis complete")
recent_data.tail(10)
'''

    def generate_time_intelligence_code(
        self,
        dataset_name: str,
        time_periods: List[str]
    ) -> str:
        """Generate code leveraging DAX time intelligence"""
        measures_code = []
        for period in time_periods:
            if period == "YTD":
                measures_code.append('"Revenue YTD", TOTALYTD([Total Revenue], \'Date\'[Date])')
            elif period == "MTD":
                measures_code.append('"Revenue MTD", TOTALMTD([Total Revenue], \'Date\'[Date])')
            elif period == "YoY":
                measures_code.append('"Revenue YoY", [Total Revenue] - CALCULATE([Total Revenue], SAMEPERIODLASTYEAR(\'Date\'[Date]))')
            elif period == "MoM":
                measures_code.append('"Revenue MoM %", DIVIDE([Total Revenue] - CALCULATE([Total Revenue], DATEADD(\'Date\'[Date], -1, MONTH)), CALCULATE([Total Revenue], DATEADD(\'Date\'[Date], -1, MONTH)))')

        dax_measures = ",\\n    ".join(measures_code)

        return f'''
# Time Intelligence Analysis using DAX
import sempy.fabric as fabric

dax_query = """
EVALUATE
SUMMARIZE(
    Sales,
    'Date'[Year],
    'Date'[Month],
    {dax_measures}
)
ORDER BY 'Date'[Year], 'Date'[Month]
"""

time_analysis = fabric.evaluate_dax(
    dataset="{dataset_name}",
    dax_string=dax_query
)

print("Time Intelligence Results:")
time_analysis
'''

    def generate_what_if_analysis_code(
        self,
        dataset_name: str,
        base_measure: str,
        parameter_name: str,
        parameter_range: tuple
    ) -> str:
        """Generate code for what-if analysis"""
        return f'''
# What-If Analysis with Semantic Link
import sempy.fabric as fabric
import numpy as np

# Define parameter range
parameter_values = np.linspace({parameter_range[0]}, {parameter_range[1]}, 20)

results = []
for param_value in parameter_values:
    # Create DAX with parameter value
    dax_query = f"""
    EVALUATE
    ROW(
        "Parameter", {{param_value}},
        "Result", CALCULATE([{base_measure}] * {{param_value}})
    )
    """

    result = fabric.evaluate_dax(
        dataset="{dataset_name}",
        dax_string=dax_query
    )

    results.append({{
        '{parameter_name}': param_value,
        'projected_{base_measure.lower().replace(" ", "_")}': result['Result'].iloc[0]
    }})

# Create sensitivity analysis dataframe
sensitivity_df = pd.DataFrame(results)

# Visualize
import matplotlib.pyplot as plt
plt.figure(figsize=(10, 6))
plt.plot(sensitivity_df['{parameter_name}'], sensitivity_df['projected_{base_measure.lower().replace(" ", "_")}'])
plt.xlabel('{parameter_name}')
plt.ylabel('Projected {base_measure}')
plt.title('What-If Analysis: {parameter_name} Impact on {base_measure}')
plt.grid(True)
plt.show()

sensitivity_df
'''

# Usage
advanced = AdvancedSemanticPatterns()

time_intel_code = advanced.generate_time_intelligence_code(
    "SalesAnalytics",
    ["YTD", "YoY", "MoM"]
)
print(time_intel_code)
```

## Conclusion

Semantic Link in Microsoft Fabric bridges the gap between business intelligence and data science, enabling organizations to maintain consistency across their analytics workloads. By leveraging curated business logic from Power BI semantic models, data scientists can focus on building models rather than recreating calculations, while ensuring alignment with established business definitions.
