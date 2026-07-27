---
title: "Fabric Copilot Preview: AI-Assisted Analytics"
author: Michael John Peña
draft: false
date: 2023-09-23
description: "Exploring Fabric Copilot capabilities for AI-assisted data engineering, analysis, and reporting."
tags:
  - Microsoft Fabric
  - Copilot
  - AI
  - Data Analytics
  - Generative AI

---

I wrote "Fabric Copilot Preview: AI-Assisted Analytics" to share practical, production-minded guidance on this topic.

## Introduction

Fabric Copilot brings generative AI capabilities directly into the Microsoft Fabric analytics platform. This preview feature enables natural language interactions for data exploration, code generation, and report creation, significantly accelerating analytics workflows.

## Copilot Capabilities Overview

### Data Engineering Copilot

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum

class CopilotTaskType(Enum):
    CODE_GENERATION = "code_generation"
    CODE_EXPLANATION = "code_explanation"
    DATA_EXPLORATION = "data_exploration"
    VISUALIZATION = "visualization"
    QUERY_OPTIMIZATION = "query_optimization"
    DOCUMENTATION = "documentation"

@dataclass
class CopilotPrompt:
    task_type: CopilotTaskType
    user_input: str
    context: Dict  # Table schemas, previous code, etc.
    language: str = "pyspark"

@dataclass
class CopilotResponse:
    generated_content: str
    explanation: str
    suggestions: List[str]
    confidence: float

class FabricCopilotSimulator:
    """Simulate Fabric Copilot interactions for development"""

    def __init__(self):
        self.conversation_history: List[Dict] = []

    def generate_pyspark_code(
        self,
        natural_language_request: str,
        table_context: Dict
    ) -> CopilotResponse:
        """Generate PySpark code from natural language"""
        # This simulates what Fabric Copilot would do
        prompt = self._build_code_generation_prompt(
            natural_language_request,
            table_context
        )

        # Example response structure
        example_code = self._get_example_code(natural_language_request, table_context)

        return CopilotResponse(
            generated_content=example_code,
            explanation="Generated PySpark code based on your request and the available table schema.",
            suggestions=[
                "Consider adding error handling for null values",
                "You might want to cache the result if using it multiple times",
                "Consider partitioning by date for better performance"
            ],
            confidence=0.85
        )

    def _build_code_generation_prompt(
        self,
        request: str,
        context: Dict
    ) -> str:
        """Build prompt for code generation"""
        schema_desc = "\n".join([
            f"Table: {table}\nColumns: {', '.join(cols)}"
            for table, cols in context.get("tables", {}).items()
        ])

        return f"""
Generate PySpark code for the following request:
{request}

Available tables and columns:
{schema_desc}

Requirements:
- Use Delta Lake best practices
- Include appropriate comments
- Handle potential errors gracefully
"""

    def _get_example_code(self, request: str, context: Dict) -> str:
        """Get example code (simplified simulation)"""
        request_lower = request.lower()

        if "aggregate" in request_lower or "sum" in request_lower:
            return '''
# Aggregate sales data by region
from pyspark.sql import functions as F

df_sales = spark.table("sales_data")

aggregated = (df_sales
    .groupBy("region", "product_category")
    .agg(
        F.sum("amount").alias("total_sales"),
        F.count("*").alias("transaction_count"),
        F.avg("amount").alias("avg_transaction")
    )
    .orderBy(F.desc("total_sales"))
)

# Write to Delta table
aggregated.write.format("delta").mode("overwrite").saveAsTable("sales_summary")
'''
        elif "join" in request_lower:
            return '''
# Join customer and order data
customers = spark.table("customers")
orders = spark.table("orders")

joined = (orders
    .join(customers, orders.customer_id == customers.id, "left")
    .select(
        orders.order_id,
        orders.order_date,
        customers.customer_name,
        customers.region,
        orders.total_amount
    )
)

joined.write.format("delta").mode("overwrite").saveAsTable("customer_orders")
'''
        else:
            return '''
# Load and transform data
df = spark.table("source_data")

transformed = (df
    .filter(df.status == "active")
    .withColumn("processed_date", F.current_date())
    .select("id", "name", "value", "processed_date")
)

transformed.write.format("delta").mode("append").saveAsTable("processed_data")
'''

    def explain_code(self, code: str) -> CopilotResponse:
        """Explain existing code"""
        return CopilotResponse(
            generated_content=self._generate_code_explanation(code),
            explanation="Code analysis and explanation generated",
            suggestions=[
                "Consider adding docstrings for better documentation",
                "Variable names could be more descriptive"
            ],
            confidence=0.90
        )

    def _generate_code_explanation(self, code: str) -> str:
        """Generate explanation for code"""
        return """
## Code Explanation

This PySpark code performs the following operations:

1. **Data Loading**: Reads data from the specified Delta table
2. **Transformations**: Applies filters and column transformations
3. **Aggregations**: Groups data and calculates summary statistics
4. **Output**: Writes results to a new Delta table

### Key Points:
- Uses Delta Lake format for ACID transactions
- Leverages Spark SQL functions for transformations
- Implements efficient columnar operations

### Potential Improvements:
- Add caching for reused DataFrames
- Consider broadcast joins for small lookup tables
- Implement incremental processing for large datasets
"""

    def suggest_optimizations(self, code: str) -> CopilotResponse:
        """Suggest code optimizations"""
        return CopilotResponse(
            generated_content="""
## Optimization Suggestions

### 1. Partitioning
```python
df.write.partitionBy("date").format("delta").save(path)
```

### 2. Caching
```python
df.cache()  # Cache if used multiple times
```

### 3. Broadcast Joins
```python
from pyspark.sql.functions import broadcast
df.join(broadcast(small_df), "key")
```

### 4. Predicate Pushdown
```python
# Filter early in the pipeline
df.filter("date >= '2023-01-01'").select(...)
```
""",
            explanation="Optimization suggestions based on code analysis",
            suggestions=[],
            confidence=0.80
        )

# Usage simulation
copilot = FabricCopilotSimulator()

# Generate code from natural language
response = copilot.generate_pyspark_code(
    "Calculate total sales by region and product category for 2023",
    table_context={
        "tables": {
            "sales_data": ["order_id", "date", "region", "product_category", "amount", "quantity"]
        }
    }
)

print("Generated Code:")
print(response.generated_content)
print(f"\nConfidence: {response.confidence:.0%}")
print(f"\nSuggestions: {response.suggestions}")
```

### Data Analysis Copilot

```python
class DataAnalysisCopilot:
    """Copilot for data analysis tasks"""

    def __init__(self):
        self.analysis_history = []

    def analyze_dataset(self, table_name: str, columns: List[str]) -> Dict:
        """Generate analysis suggestions for a dataset"""
        return {
            "dataset": table_name,
            "suggested_analyses": [
                {
                    "type": "distribution",
                    "description": "Analyze the distribution of numeric columns",
                    "code": self._generate_distribution_code(table_name, columns)
                },
                {
                    "type": "correlation",
                    "description": "Calculate correlations between numeric columns",
                    "code": self._generate_correlation_code(table_name)
                },
                {
                    "type": "trends",
                    "description": "Identify trends over time",
                    "code": self._generate_trend_code(table_name)
                },
                {
                    "type": "outliers",
                    "description": "Detect potential outliers",
                    "code": self._generate_outlier_code(table_name)
                }
            ]
        }

    def _generate_distribution_code(self, table: str, columns: List[str]) -> str:
        return f'''
# Distribution analysis
df = spark.table("{table}")

# Summary statistics
df.describe().show()

# Distribution of key columns
for col in {columns[:3]}:
    df.groupBy(col).count().orderBy("count", ascending=False).show(10)
'''

    def _generate_correlation_code(self, table: str) -> str:
        return f'''
# Correlation analysis
from pyspark.ml.stat import Correlation
from pyspark.ml.feature import VectorAssembler

df = spark.table("{table}")
numeric_cols = [f.name for f in df.schema.fields if str(f.dataType) in ["IntegerType", "DoubleType", "FloatType"]]

assembler = VectorAssembler(inputCols=numeric_cols, outputCol="features")
df_vector = assembler.transform(df).select("features")

matrix = Correlation.corr(df_vector, "features").head()[0]
print("Correlation Matrix:")
print(matrix.toArray())
'''

    def _generate_trend_code(self, table: str) -> str:
        return f'''
# Trend analysis
from pyspark.sql import functions as F

df = spark.table("{table}")

# Assuming there's a date column
trend = (df
    .withColumn("month", F.date_trunc("month", "date"))
    .groupBy("month")
    .agg(F.sum("value").alias("total"), F.count("*").alias("count"))
    .orderBy("month")
)

trend.show(20)
'''

    def _generate_outlier_code(self, table: str) -> str:
        return f'''
# Outlier detection using IQR
from pyspark.sql import functions as F

df = spark.table("{table}")

# Calculate IQR for numeric column
quantiles = df.approxQuantile("value", [0.25, 0.75], 0.05)
q1, q3 = quantiles[0], quantiles[1]
iqr = q3 - q1

lower_bound = q1 - 1.5 * iqr
upper_bound = q3 + 1.5 * iqr

outliers = df.filter((df.value < lower_bound) | (df.value > upper_bound))
print(f"Found {{outliers.count()}} outliers")
outliers.show()
'''

    def generate_insights_report(self, findings: List[Dict]) -> str:
        """Generate natural language insights from findings"""
        report = "# Data Insights Report\n\n"

        for i, finding in enumerate(findings, 1):
            report += f"## Finding {i}: {finding['title']}\n\n"
            report += f"{finding['description']}\n\n"

            if 'recommendation' in finding:
                report += f"**Recommendation:** {finding['recommendation']}\n\n"

        return report

# Usage
analysis_copilot = DataAnalysisCopilot()

suggestions = analysis_copilot.analyze_dataset(
    "sales_transactions",
    ["region", "product", "amount", "quantity", "date"]
)

print("Suggested Analyses:")
for suggestion in suggestions["suggested_analyses"]:
    print(f"\n{suggestion['type'].upper()}: {suggestion['description']}")
```

### Report Generation Copilot

```python
class ReportCopilot:
    """Copilot for Power BI report generation"""

    def suggest_visualizations(
        self,
        data_description: str,
        columns: List[Dict]
    ) -> List[Dict]:
        """Suggest appropriate visualizations"""
        suggestions = []

        # Analyze column types
        numeric_cols = [c["name"] for c in columns if c["type"] in ["int", "float", "decimal"]]
        categorical_cols = [c["name"] for c in columns if c["type"] in ["string", "category"]]
        date_cols = [c["name"] for c in columns if c["type"] in ["date", "datetime"]]

        # Time series visualization
        if date_cols and numeric_cols:
            suggestions.append({
                "type": "Line Chart",
                "purpose": "Show trends over time",
                "x_axis": date_cols[0],
                "y_axis": numeric_cols[0],
                "dax_measure": f"Total = SUM({numeric_cols[0]})"
            })

        # Category comparison
        if categorical_cols and numeric_cols:
            suggestions.append({
                "type": "Bar Chart",
                "purpose": "Compare values across categories",
                "category": categorical_cols[0],
                "value": numeric_cols[0],
                "dax_measure": f"Sum of {numeric_cols[0]} = SUM({numeric_cols[0]})"
            })

        # Distribution
        if numeric_cols:
            suggestions.append({
                "type": "Histogram",
                "purpose": "Show value distribution",
                "column": numeric_cols[0],
                "bins": 20
            })

        # Composition
        if categorical_cols and numeric_cols:
            suggestions.append({
                "type": "Pie/Donut Chart",
                "purpose": "Show composition/proportion",
                "category": categorical_cols[0],
                "value": numeric_cols[0],
                "note": "Best for 5 or fewer categories"
            })

        return suggestions

    def generate_dax_measure(
        self,
        description: str,
        context: Dict
    ) -> str:
        """Generate DAX measure from description"""
        desc_lower = description.lower()

        if "year over year" in desc_lower or "yoy" in desc_lower:
            return f'''
YoY Growth =
VAR CurrentYear = SUM(Sales[Amount])
VAR PreviousYear = CALCULATE(SUM(Sales[Amount]), SAMEPERIODLASTYEAR(Dates[Date]))
RETURN
DIVIDE(CurrentYear - PreviousYear, PreviousYear, 0)
'''
        elif "running total" in desc_lower:
            return f'''
Running Total =
CALCULATE(
    SUM(Sales[Amount]),
    FILTER(
        ALL(Dates[Date]),
        Dates[Date] <= MAX(Dates[Date])
    )
)
'''
        elif "average" in desc_lower:
            return f'''
Average Sale =
AVERAGE(Sales[Amount])
'''
        elif "percentage" in desc_lower or "percent" in desc_lower:
            return f'''
Percentage of Total =
DIVIDE(
    SUM(Sales[Amount]),
    CALCULATE(SUM(Sales[Amount]), ALL(Sales)),
    0
)
'''
        else:
            return f'''
Total Sales =
SUM(Sales[Amount])
'''

    def create_report_template(
        self,
        report_type: str,
        data_model: Dict
    ) -> Dict:
        """Create report template based on type"""
        templates = {
            "executive_dashboard": {
                "pages": [
                    {
                        "name": "Overview",
                        "visuals": ["KPI Cards", "Trend Line", "Top N Bar Chart"]
                    },
                    {
                        "name": "Details",
                        "visuals": ["Matrix", "Table", "Filters"]
                    }
                ],
                "measures": [
                    "Total Revenue", "Growth Rate", "Average Deal Size"
                ]
            },
            "sales_report": {
                "pages": [
                    {
                        "name": "Sales Summary",
                        "visuals": ["Revenue KPI", "Sales by Region Map", "Product Mix Donut"]
                    },
                    {
                        "name": "Trends",
                        "visuals": ["Monthly Trend", "YoY Comparison", "Forecast"]
                    },
                    {
                        "name": "Details",
                        "visuals": ["Sales Table", "Customer Analysis"]
                    }
                ],
                "measures": [
                    "Total Sales", "Sales Growth %", "Average Order Value", "Customer Count"
                ]
            }
        }

        return templates.get(report_type, templates["executive_dashboard"])

# Usage
report_copilot = ReportCopilot()

# Get visualization suggestions
columns = [
    {"name": "date", "type": "date"},
    {"name": "region", "type": "string"},
    {"name": "product", "type": "string"},
    {"name": "sales_amount", "type": "decimal"},
    {"name": "quantity", "type": "int"}
]

suggestions = report_copilot.suggest_visualizations(
    "Sales transaction data with regional breakdown",
    columns
)

for s in suggestions:
    print(f"\n{s['type']}: {s['purpose']}")

# Generate DAX
dax = report_copilot.generate_dax_measure(
    "Calculate year over year growth percentage",
    {"table": "Sales", "column": "Amount"}
)
print(f"\nGenerated DAX:\n{dax}")
```

## Conclusion

Fabric Copilot represents a significant advancement in making analytics more accessible through AI assistance. By providing natural language interfaces for code generation, data analysis, and report creation, it enables both technical and business users to work more efficiently with data. As the preview matures, expect enhanced capabilities for more complex scenarios and better context awareness.

