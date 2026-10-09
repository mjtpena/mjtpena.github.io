---
title: "Azure Databricks + OpenAI: LLMs for Data Engineering"
description: "Azure Databricks with Azure OpenAI creates intelligent data platforms where natural language becomes the interface for data engineering tasks."
author: Michael John Pena
draft: false
date: 2023-04-13
tags:
  - Azure
  - Databricks
  - OpenAI
  - Data Engineering
  - AI
---

## Setting Up the Integration

```python
# Databricks notebook setup
import openai
from pyspark.sql import SparkSession

# Configure Azure OpenAI
openai.api_type = "azure"
openai.api_base = dbutils.secrets.get("openai", "endpoint")
openai.api_key = dbutils.secrets.get("openai", "key")
openai.api_version = "2023-03-15-preview"

class DatabricksOpenAI:
    """Azure OpenAI integration for Databricks."""

    def __init__(self, deployment_name: str = "gpt-4"):
        self.deployment = deployment_name

    def chat(self, prompt: str, temperature: float = 0.3) -> str:
        """Send chat completion request."""
        response = openai.ChatCompletion.create(
            engine=self.deployment,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature
        )
        return response.choices[0].message.content

ai = DatabricksOpenAI()
```

## Natural Language to SQL

```python
class NL2SQLDatabricks:
    """Convert natural language to Spark SQL."""

    def __init__(self, ai_client, spark: SparkSession):
        self.ai = ai_client
        self.spark = spark

    def get_schema_context(self, database: str) -> str:
        """Get database schema for context."""
        tables = self.spark.sql(f"SHOW TABLES IN {database}").collect()

        schema_parts = []
        for table in tables:
            table_name = f"{database}.{table.tableName}"
            columns = self.spark.sql(f"DESCRIBE {table_name}").collect()

            cols_str = ", ".join([f"{c.col_name} {c.data_type}" for c in columns])
            schema_parts.append(f"Table {table_name}: {cols_str}")

        return "\n".join(schema_parts)

    def query(self, natural_language: str, database: str) -> dict:
        """Convert natural language to SQL and execute."""

        schema = self.get_schema_context(database)

        prompt = f"""Convert this question to Spark SQL.

Database Schema:
{schema}

Question: {natural_language}

Return only the SQL query, no explanation."""

        sql = self.ai.chat(prompt, temperature=0)

        # Clean up response
        sql = sql.strip().replace("```sql", "").replace("```", "").strip()

        # Execute
        try:
            df = self.spark.sql(sql)
            return {
                "sql": sql,
                "success": True,
                "result": df,
                "row_count": df.count()
            }
        except Exception as e:
            return {
                "sql": sql,
                "success": False,
                "error": str(e)
            }

# Usage
nl2sql = NL2SQLDatabricks(ai, spark)
result = nl2sql.query(
    "Show me the top 10 customers by total spend last quarter",
    "sales_db"
)
if result["success"]:
    display(result["result"])
```

## AI-Powered Data Quality

```python
class AIDataQuality:
    """AI-assisted data quality checks."""

    def __init__(self, ai_client, spark):
        self.ai = ai_client
        self.spark = spark

    def analyze_data_quality(self, table_name: str) -> dict:
        """Analyze data quality issues."""

        # Get sample and stats
        df = self.spark.table(table_name)
        sample = df.limit(100).toPandas().to_string()
        stats = df.describe().toPandas().to_string()

        prompt = f"""Analyze this data for quality issues.

Table: {table_name}

Sample (100 rows):
{sample}

Statistics:
{stats}

Identify:
1. Missing value patterns
2. Potential outliers
3. Data type issues
4. Inconsistencies
5. Suggested cleaning steps"""

        analysis = self.ai.chat(prompt)

        return {
            "table": table_name,
            "analysis": analysis,
            "row_count": df.count()
        }

    def generate_validation_rules(self, table_name: str) -> str:
        """Generate data validation rules."""

        schema = self.spark.table(table_name).schema
        schema_str = "\n".join([f"{f.name}: {f.dataType}" for f in schema.fields])

        prompt = f"""Generate data validation rules for this table.

Table: {table_name}
Schema:
{schema_str}

Generate:
1. Null checks for required fields
2. Range validations for numeric fields
3. Format validations for strings
4. Referential integrity checks

Return as Python code using Great Expectations or similar."""

        return self.ai.chat(prompt)

# Usage
dq = AIDataQuality(ai, spark)
quality_report = dq.analyze_data_quality("bronze.transactions")
print(quality_report["analysis"])
```

## Intelligent ETL Documentation

```python
class ETLDocGenerator:
    """Generate ETL documentation with AI."""

    def __init__(self, ai_client):
        self.ai = ai_client

    def document_notebook(self, notebook_code: str) -> str:
        """Generate documentation for a Databricks notebook."""

        prompt = f"""Document this Databricks ETL notebook.

Code:
{notebook_code[:10000]}

Generate:
1. Overview of what the notebook does
2. Input data sources
3. Transformations applied
4. Output tables/files
5. Dependencies
6. Scheduling recommendations"""

        return self.ai.chat(prompt)

    def generate_lineage_description(
        self,
        source_tables: list[str],
        target_table: str,
        transformations: str
    ) -> str:
        """Describe data lineage."""

        prompt = f"""Describe the data lineage for this pipeline.

Source tables: {', '.join(source_tables)}
Target table: {target_table}
Transformations: {transformations}

Create a clear description of:
1. Data flow
2. Key transformations
3. Business logic applied
4. Data freshness expectations"""

        return self.ai.chat(prompt)
```

## Auto-Generated Notebooks

```python
class NotebookGenerator:
    """Generate Databricks notebooks from descriptions."""

    def __init__(self, ai_client):
        self.ai = ai_client

    def generate_etl_notebook(
        self,
        description: str,
        source_format: str,
        target_format: str
    ) -> str:
        """Generate ETL notebook code."""

        prompt = f"""Generate a Databricks notebook for this ETL task.

Description: {description}
Source format: {source_format}
Target format: {target_format}

Include:
1. Configuration cell
2. Data reading
3. Transformations
4. Data quality checks
5. Writing to target
6. Error handling
7. Comments explaining each step

Use PySpark and Delta Lake best practices."""

        return self.ai.chat(prompt)

    def generate_analysis_notebook(
        self,
        data_description: str,
        analysis_goals: list[str]
    ) -> str:
        """Generate data analysis notebook."""

        goals_str = "\n".join(f"- {g}" for g in analysis_goals)

        prompt = f"""Generate a Databricks analysis notebook.

Data: {data_description}
Analysis Goals:
{goals_str}

Include:
1. Data exploration
2. Visualizations
3. Statistical analysis
4. Insights summary
5. Recommendations"""

        return self.ai.chat(prompt)

# Usage
gen = NotebookGenerator(ai)
notebook_code = gen.generate_etl_notebook(
    "Load customer data from CSV, clean it, and write to Delta table",
    "CSV",
    "Delta Lake"
)
print(notebook_code)
```

Azure Databricks with Azure OpenAI creates intelligent data platforms where natural language becomes the interface for data engineering tasks.
