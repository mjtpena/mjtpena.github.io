---
title: "Azure Synapse Analytics + OpenAI: Intelligent Data Warehousing"
author: Michael John Pena
draft: false
date: 2023-04-18
tags:
  - Azure
  - Synapse
  - OpenAI
  - Data Warehousing
  - AI

---

I wrote "Azure Synapse Analytics + OpenAI: Intelligent Data Warehousing" to share practical, production-minded guidance on this topic.

## Synapse OpenAI Integration

```python
# Synapse notebook integration
from azure.identity import DefaultAzureCredential
from azure.synapse.spark import SparkSession
import openai
import json

class SynapseOpenAI:
    """OpenAI integration for Azure Synapse."""

    def __init__(self, endpoint: str, deployment: str):
        self.endpoint = endpoint
        self.deployment = deployment
        self._setup_client()

    def _setup_client(self):
        """Setup Azure OpenAI client."""
        credential = DefaultAzureCredential()
        token = credential.get_token("https://cognitiveservices.azure.com/.default")

        openai.api_type = "azure"
        openai.api_base = self.endpoint
        openai.api_key = token.token
        openai.api_version = "2023-03-15-preview"

    def query(self, prompt: str, temperature: float = 0.3) -> str:
        """Send query to OpenAI."""
        response = openai.ChatCompletion.create(
            engine=self.deployment,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature
        )
        return response.choices[0].message.content

# Initialize
ai = SynapseOpenAI(
    endpoint="https://your-openai.openai.azure.com/",
    deployment="gpt-4"
)
```

## Natural Language to Synapse SQL

```python
class SynapseNL2SQL:
    """Convert natural language to Synapse SQL."""

    def __init__(self, ai_client, spark: SparkSession):
        self.ai = ai_client
        self.spark = spark

    def get_warehouse_schema(self, database: str) -> str:
        """Get Synapse dedicated pool schema."""
        query = f"""
        SELECT
            s.name as schema_name,
            t.name as table_name,
            c.name as column_name,
            ty.name as data_type
        FROM {database}.sys.tables t
        JOIN {database}.sys.schemas s ON t.schema_id = s.schema_id
        JOIN {database}.sys.columns c ON t.object_id = c.object_id
        JOIN {database}.sys.types ty ON c.user_type_id = ty.user_type_id
        ORDER BY s.name, t.name, c.column_id
        """

        df = self.spark.sql(query)
        return self._format_schema(df.collect())

    def _format_schema(self, rows) -> str:
        """Format schema for LLM context."""
        tables = {}
        for row in rows:
            key = f"{row.schema_name}.{row.table_name}"
            if key not in tables:
                tables[key] = []
            tables[key].append(f"{row.column_name} ({row.data_type})")

        parts = []
        for table, columns in tables.items():
            parts.append(f"Table {table}:\n  Columns: {', '.join(columns)}")

        return "\n\n".join(parts)

    def natural_language_query(
        self,
        question: str,
        database: str
    ) -> dict:
        """Convert natural language to SQL and execute."""

        schema = self.get_warehouse_schema(database)

        prompt = f"""Convert this question to Synapse SQL (T-SQL dialect).

Database Schema:
{schema}

Question: {question}

Rules:
- Use proper T-SQL syntax
- Include appropriate JOINs
- Handle NULLs properly
- Add TOP 1000 for unbounded queries
- Use table aliases

Return only the SQL query."""

        sql = self.ai.query(prompt, temperature=0)
        sql = self._clean_sql(sql)

        try:
            df = self.spark.sql(sql)
            return {
                "question": question,
                "sql": sql,
                "success": True,
                "result": df,
                "row_count": df.count()
            }
        except Exception as e:
            return {
                "question": question,
                "sql": sql,
                "success": False,
                "error": str(e)
            }

    def _clean_sql(self, response: str) -> str:
        """Clean SQL from response."""
        sql = response.strip()
        if sql.startswith("```"):
            sql = sql.split("```")[1]
            if sql.startswith("sql"):
                sql = sql[3:]
        return sql.strip()

# Usage
nl2sql = SynapseNL2SQL(ai, spark)
result = nl2sql.natural_language_query(
    "What are the top 10 products by revenue in Q1 2023?",
    "sales_warehouse"
)
```

## Automated Data Dictionary

```python
class SynapseDataDictionary:
    """AI-generated data dictionary for Synapse."""

    def __init__(self, ai_client, spark):
        self.ai = ai_client
        self.spark = spark

    def generate_table_documentation(
        self,
        database: str,
        schema: str,
        table: str
    ) -> dict:
        """Generate documentation for a table."""

        # Get table metadata
        columns = self._get_column_info(database, schema, table)
        sample = self._get_sample_data(database, schema, table)
        stats = self._get_basic_stats(database, schema, table)

        prompt = f"""Generate comprehensive documentation for this Synapse table.

Table: {database}.{schema}.{table}

Columns:
{columns}

Sample Data (5 rows):
{sample}

Statistics:
{stats}

Generate:
1. Table description (what data it contains)
2. Column descriptions (purpose of each)
3. Business context
4. Common use cases
5. Data quality notes
6. Related tables (inferred)

Return as JSON."""

        response = self.ai.query(prompt)

        try:
            return json.loads(response)
        except:
            return {"raw_documentation": response}

    def _get_column_info(self, db, schema, table) -> str:
        """Get column information."""
        query = f"""
        SELECT
            c.name,
            t.name as type,
            c.is_nullable,
            c.max_length
        FROM {db}.sys.columns c
        JOIN {db}.sys.types t ON c.user_type_id = t.user_type_id
        JOIN {db}.sys.tables tab ON c.object_id = tab.object_id
        JOIN {db}.sys.schemas s ON tab.schema_id = s.schema_id
        WHERE tab.name = '{table}' AND s.name = '{schema}'
        """
        rows = self.spark.sql(query).collect()
        return "\n".join([f"- {r.name}: {r.type}, nullable={r.is_nullable}" for r in rows])

    def _get_sample_data(self, db, schema, table) -> str:
        """Get sample data."""
        query = f"SELECT TOP 5 * FROM {db}.{schema}.{table}"
        df = self.spark.sql(query)
        return df.toPandas().to_string()

    def _get_basic_stats(self, db, schema, table) -> str:
        """Get basic statistics."""
        query = f"SELECT COUNT(*) as row_count FROM {db}.{schema}.{table}"
        count = self.spark.sql(query).collect()[0].row_count
        return f"Row count: {count:,}"

    def generate_full_catalog(self, database: str) -> dict:
        """Generate documentation for entire database."""
        tables = self._get_all_tables(database)
        catalog = {}

        for table in tables:
            key = f"{table.schema_name}.{table.table_name}"
            catalog[key] = self.generate_table_documentation(
                database,
                table.schema_name,
                table.table_name
            )

        return catalog
```

## Query Optimization Assistant

```python
class SynapseQueryOptimizer:
    """AI-powered query optimization for Synapse."""

    def __init__(self, ai_client, spark):
        self.ai = ai_client
        self.spark = spark

    def analyze_query(self, sql: str, database: str) -> dict:
        """Analyze query for optimization opportunities."""

        # Get execution plan
        explain_query = f"EXPLAIN {sql}"
        try:
            plan = self.spark.sql(explain_query).collect()
            plan_str = str(plan)
        except:
            plan_str = "Plan not available"

        prompt = f"""Analyze this Synapse SQL query for optimization.

Query:
{sql}

Execution Plan:
{plan_str}

Provide:
1. Performance issues identified
2. Optimization recommendations
3. Index suggestions
4. Distribution key recommendations (for Synapse dedicated pools)
5. Materialized view opportunities
6. Rewritten optimized query

Format as JSON."""

        response = self.ai.query(prompt)

        try:
            return json.loads(response)
        except:
            return {"analysis": response}

    def suggest_distribution(
        self,
        table_name: str,
        common_queries: list[str]
    ) -> dict:
        """Suggest optimal distribution strategy."""

        prompt = f"""Recommend distribution strategy for Synapse dedicated pool.

Table: {table_name}

Common Queries:
{chr(10).join(common_queries)}

Consider:
1. HASH distribution - best for large fact tables
2. ROUND_ROBIN - good for staging tables
3. REPLICATE - best for small dimension tables

Recommend:
- Distribution type
- Distribution column (if HASH)
- Reasoning
- Impact on provided queries"""

        return {"recommendation": self.ai.query(prompt)}

# Usage
optimizer = SynapseQueryOptimizer(ai, spark)
analysis = optimizer.analyze_query(
    "SELECT * FROM sales.fact_orders WHERE order_date > '2023-01-01'",
    "sales_warehouse"
)
```

## Intelligent Data Profiling

```python
class SynapseDataProfiler:
    """AI-enhanced data profiling for Synapse."""

    def __init__(self, ai_client, spark):
        self.ai = ai_client
        self.spark = spark

    def profile_table(self, database: str, schema: str, table: str) -> dict:
        """Generate comprehensive data profile."""

        full_table = f"{database}.{schema}.{table}"

        # Gather statistics
        stats = self._gather_statistics(full_table)

        prompt = f"""Analyze this data profile and provide insights.

Table: {full_table}

Statistics:
{json.dumps(stats, indent=2, default=str)}

Provide:
1. Data quality assessment
2. Anomalies detected
3. Pattern observations
4. Recommendations for data cleaning
5. Potential issues for analytics"""

        analysis = self.ai.query(prompt)

        return {
            "table": full_table,
            "statistics": stats,
            "ai_analysis": analysis
        }

    def _gather_statistics(self, table: str) -> dict:
        """Gather table statistics."""
        df = self.spark.table(table)

        stats = {
            "row_count": df.count(),
            "column_count": len(df.columns),
            "columns": {}
        }

        for col in df.columns:
            col_stats = {
                "null_count": df.filter(df[col].isNull()).count(),
                "distinct_count": df.select(col).distinct().count()
            }

            # Numeric stats
            if str(df.schema[col].dataType) in ["IntegerType", "LongType", "DoubleType"]:
                numeric_stats = df.select(col).describe().collect()
                col_stats["numeric_stats"] = {
                    row[0]: row[1] for row in numeric_stats
                }

            stats["columns"][col] = col_stats

        return stats
```

Azure Synapse with OpenAI transforms data warehousing from technical SQL expertise to conversational data access. Business users can explore enterprise data using natural language.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
