---
title: "Semantic Layer with AI: Natural Language Analytics at Scale"
description: "The AI-powered semantic layer makes data truly self-service. Users ask questions in their own words, and the system handles the translation to technical…"
author: Michael John Peña
draft: false
date: 2025-01-19
tags:
  - Semantic Layer
  - AI
  - Analytics
  - Microsoft Fabric
  - Power BI
---

## What is an AI-Powered Semantic Layer?

Traditional semantic layer:
```
User → Drag & Drop → Semantic Model → SQL → Database
```

AI-powered semantic layer:
```
User → Natural Language → AI → Semantic Model → Optimized Query → Database
```

## Building the Foundation

### Define Your Semantic Model

```yaml
# semantic_model.yaml
name: sales_analytics
description: Sales performance analytics for retail operations

entities:
  - name: sales
    description: Individual sales transactions
    table: fact_sales
    columns:
      - name: amount
        description: Transaction amount in USD
        type: decimal
        aggregations: [sum, avg, min, max]
      - name: quantity
        description: Number of items sold
        type: integer
        aggregations: [sum, avg]
      - name: transaction_date
        description: Date of the transaction
        type: date
        time_grain: [day, week, month, quarter, year]

  - name: products
    description: Product catalog
    table: dim_products
    columns:
      - name: product_name
        description: Name of the product
        type: string
      - name: category
        description: Product category (Electronics, Clothing, etc.)
        type: string
        values: [Electronics, Clothing, Home, Food]
      - name: price
        description: List price of the product
        type: decimal

  - name: customers
    description: Customer information
    table: dim_customers
    columns:
      - name: customer_name
        description: Full name of the customer
        type: string
      - name: segment
        description: Customer segment
        type: string
        values: [Enterprise, SMB, Consumer]
      - name: region
        description: Geographic region
        type: string
        values: [North, South, East, West]

relationships:
  - name: sales_to_products
    from: sales.product_id
    to: products.id
    type: many_to_one

  - name: sales_to_customers
    from: sales.customer_id
    to: customers.id
    type: many_to_one

metrics:
  - name: total_revenue
    description: Total sales revenue
    expression: SUM(sales.amount)

  - name: average_order_value
    description: Average transaction value
    expression: AVG(sales.amount)

  - name: units_sold
    description: Total quantity of items sold
    expression: SUM(sales.quantity)

  - name: revenue_growth
    description: Year-over-year revenue growth percentage
    expression: (SUM(sales.amount) - LAG(SUM(sales.amount))) / LAG(SUM(sales.amount)) * 100
    time_comparison: year
```

### Natural Language to Semantic Query

```python
from azure.ai.foundry import AIFoundryClient
import yaml

class SemanticLayerAI:
    def __init__(self, model_path: str, llm_client: AIFoundryClient):
        with open(model_path) as f:
            self.model = yaml.safe_load(f)
        self.llm = llm_client

    async def query(self, natural_language: str) -> dict:
        """Convert natural language to semantic query."""

        # Build context from semantic model
        model_context = self._build_model_context()

        # Ask LLM to generate semantic query
        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"""You are a semantic layer query generator.

                Available semantic model:
                {model_context}

                Generate a semantic query based on the user's natural language request.
                Return JSON with this structure:
                {{
                    "metrics": ["metric_name", ...],
                    "dimensions": ["entity.column", ...],
                    "filters": [{{"field": "entity.column", "operator": "=|>|<|in|between", "value": "..."}}],
                    "time_range": {{"field": "entity.column", "start": "date", "end": "date"}},
                    "sort": [{{"field": "metric_or_dimension", "direction": "asc|desc"}}],
                    "limit": number_or_null
                }}"""
            }, {
                "role": "user",
                "content": natural_language
            }],
            temperature=0
        )

        semantic_query = json.loads(response.choices[0].message.content)

        # Validate query against model
        self._validate_query(semantic_query)

        # Generate SQL
        sql = self._generate_sql(semantic_query)

        return {
            "natural_language": natural_language,
            "semantic_query": semantic_query,
            "sql": sql
        }

    def _build_model_context(self) -> str:
        """Build a text description of the semantic model."""
        lines = [f"Model: {self.model['name']}", f"Description: {self.model['description']}", ""]

        lines.append("ENTITIES:")
        for entity in self.model['entities']:
            lines.append(f"\n{entity['name']}: {entity['description']}")
            lines.append("  Columns:")
            for col in entity['columns']:
                lines.append(f"    - {col['name']}: {col['description']} ({col['type']})")
                if 'values' in col:
                    lines.append(f"      Valid values: {col['values']}")

        lines.append("\nMETRICS:")
        for metric in self.model['metrics']:
            lines.append(f"  - {metric['name']}: {metric['description']}")

        lines.append("\nRELATIONSHIPS:")
        for rel in self.model['relationships']:
            lines.append(f"  - {rel['from']} -> {rel['to']} ({rel['type']})")

        return "\n".join(lines)

    def _generate_sql(self, semantic_query: dict) -> str:
        """Convert semantic query to SQL."""
        # Build SELECT clause
        select_parts = []
        for dim in semantic_query.get('dimensions', []):
            entity, column = dim.split('.')
            table = self._get_table(entity)
            select_parts.append(f"{table}.{column}")

        for metric in semantic_query.get('metrics', []):
            metric_def = self._get_metric(metric)
            select_parts.append(f"{metric_def['expression']} AS {metric}")

        # Build FROM clause with joins
        tables_needed = self._get_required_tables(semantic_query)
        from_clause = self._build_joins(tables_needed)

        # Build WHERE clause
        where_parts = []
        for filter in semantic_query.get('filters', []):
            where_parts.append(self._build_filter(filter))

        if semantic_query.get('time_range'):
            tr = semantic_query['time_range']
            where_parts.append(f"{tr['field']} BETWEEN '{tr['start']}' AND '{tr['end']}'")

        # Build GROUP BY
        group_by = semantic_query.get('dimensions', [])

        # Build ORDER BY
        order_parts = []
        for sort in semantic_query.get('sort', []):
            order_parts.append(f"{sort['field']} {sort['direction'].upper()}")

        # Assemble SQL
        sql = f"SELECT {', '.join(select_parts)}\nFROM {from_clause}"
        if where_parts:
            sql += f"\nWHERE {' AND '.join(where_parts)}"
        if group_by:
            sql += f"\nGROUP BY {', '.join(select_parts[:len(group_by)])}"
        if order_parts:
            sql += f"\nORDER BY {', '.join(order_parts)}"
        if semantic_query.get('limit'):
            sql += f"\nLIMIT {semantic_query['limit']}"

        return sql
```

## Integration with Power BI Semantic Models

```python
# Use Semantic Link (sempy.fabric) for Power BI semantic model access
import sempy.fabric as fabric
from openai import AzureOpenAI
import json

class PowerBISemanticAI:
    def __init__(self, workspace: str, dataset: str, llm_client: AzureOpenAI):
        self.workspace = workspace
        self.dataset = dataset
        self.llm = llm_client

    async def natural_language_to_dax(self, question: str) -> dict:
        """Convert natural language to DAX query."""

        # Get model metadata using Semantic Link
        tables = fabric.list_tables(dataset=self.dataset, workspace=self.workspace)
        measures = fabric.list_measures(dataset=self.dataset, workspace=self.workspace)
        relationships = fabric.list_relationships(dataset=self.dataset, workspace=self.workspace)

        model_context = self._format_model_metadata(tables, measures, relationships)

        # Generate DAX using Azure OpenAI
        response = self.llm.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"""You are a DAX expert. Generate DAX queries based on the semantic model.

                Model metadata:
                {model_context}

                Return only the DAX query, no explanations."""
            }, {
                "role": "user",
                "content": question
            }]
        )

        dax_query = response.choices[0].message.content.strip()

        # Execute DAX query using Semantic Link
        results = fabric.evaluate_dax(
            dataset=self.dataset,
            dax_string=dax_query,
            workspace=self.workspace
        )

        return {
            "question": question,
            "dax": dax_query,
            "results": results.to_dict()
        }

    async def explain_metric(self, metric_name: str) -> str:
        """Generate natural language explanation of a metric."""
        # Get measure definition using Semantic Link
        measures = fabric.list_measures(dataset=self.dataset, workspace=self.workspace)
        measure = measures[measures["Name"] == metric_name].iloc[0]

        response = self.llm.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Explain this DAX measure in plain English:

                Name: {measure["Name"]}
                Expression: {measure["Expression"]}
                Table: {measure["TableName"]}

                Provide:
                1. What it calculates
                2. How it works step by step
                3. Example use cases"""
            }]
        )

        return response.choices[0].message.content

    def _format_model_metadata(self, tables, measures, relationships) -> str:
        """Format metadata for LLM context."""
        lines = ["Tables:"]
        for _, t in tables.iterrows():
            lines.append(f"  - {t['Name']}")
        lines.append("\nMeasures:")
        for _, m in measures.iterrows():
            lines.append(f"  - {m['Name']}: {m['Expression']}")
        lines.append("\nRelationships:")
        for _, r in relationships.iterrows():
            lines.append(f"  - {r['FromTable']} -> {r['ToTable']}")
        return "\n".join(lines)
```

## Caching and Optimization

```python
from functools import lru_cache
import hashlib

class OptimizedSemanticAI:
    def __init__(self, semantic_layer: SemanticLayerAI):
        self.semantic_layer = semantic_layer
        self.query_cache = {}

    async def query(self, natural_language: str) -> dict:
        # Check cache
        cache_key = self._cache_key(natural_language)
        if cache_key in self.query_cache:
            return self.query_cache[cache_key]

        # Generate query
        result = await self.semantic_layer.query(natural_language)

        # Cache result
        self.query_cache[cache_key] = result

        return result

    def _cache_key(self, query: str) -> str:
        # Normalize and hash
        normalized = query.lower().strip()
        return hashlib.md5(normalized.encode()).hexdigest()

    async def suggest_questions(self, context: str = None) -> list[str]:
        """Suggest relevant questions based on the semantic model."""
        response = await self.semantic_layer.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Given this semantic model, suggest 5 insightful business questions:

                {self.semantic_layer._build_model_context()}

                Context: {context or 'General business analysis'}

                Return as JSON array of strings."""
            }]
        )

        return json.loads(response.choices[0].message.content)
```

## Best Practices

1. **Rich descriptions**: Better model descriptions = better AI understanding
2. **Explicit relationships**: Define all relationships clearly
3. **Validation**: Always validate generated queries before execution
4. **Feedback loop**: Learn from user corrections
5. **Guardrails**: Limit query complexity and data access

The AI-powered semantic layer makes data truly self-service. Users ask questions in their own words, and the system handles the translation to technical queries.
