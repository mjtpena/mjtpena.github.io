---
title: "Natural Language to SQL: Building Intelligent Query Interfaces"
author: "Michael John Peña"
draft: false
date: 2024-04-03
tags: ["AI", "SQL", "Natural Language", "LLM", "Data"]

---

I wrote "Natural Language to SQL: Building Intelligent Query Interfaces" to share practical, production-minded guidance on this topic.

Natural language to SQL (NL2SQL) transforms how users interact with databases. This guide covers implementation strategies, from simple approaches to production-ready systems.

## The NL2SQL Challenge

```python
from dataclasses import dataclass
from typing import List, Dict, Optional

@dataclass
class DatabaseSchema:
    tables: Dict[str, List[str]]  # table_name -> columns
    relationships: List[tuple]  # (table1, col1, table2, col2)
    column_descriptions: Dict[str, str]  # column -> description

@dataclass
class NL2SQLResult:
    natural_language: str
    generated_sql: str
    confidence: float
    explanation: str
    tables_used: List[str]
```

## Basic NL2SQL Implementation

```python
import anthropic
import json

class NL2SQLConverter:
    """Convert natural language to SQL using LLM"""

    def __init__(self, schema: DatabaseSchema):
        self.client = anthropic.Anthropic()
        self.schema = schema

    def _build_schema_prompt(self) -> str:
        """Build schema description for the prompt"""
        schema_parts = ["Database Schema:\n"]

        for table, columns in self.schema.tables.items():
            schema_parts.append(f"\nTable: {table}")
            schema_parts.append(f"Columns: {', '.join(columns)}")

            # Add column descriptions
            for col in columns:
                full_col = f"{table}.{col}"
                if full_col in self.schema.column_descriptions:
                    schema_parts.append(
                        f"  - {col}: {self.schema.column_descriptions[full_col]}"
                    )

        # Add relationships
        if self.schema.relationships:
            schema_parts.append("\nRelationships:")
            for t1, c1, t2, c2 in self.schema.relationships:
                schema_parts.append(f"  {t1}.{c1} -> {t2}.{c2}")

        return "\n".join(schema_parts)

    def convert(self, natural_language: str) -> NL2SQLResult:
        """Convert natural language to SQL"""

        prompt = f"""{self._build_schema_prompt()}

Convert this natural language question to SQL:
"{natural_language}"

Requirements:
- Use only tables and columns from the schema
- Use appropriate JOINs based on relationships
- Include proper WHERE clauses
- Use aggregations when asking for totals, averages, etc.
- Format the SQL nicely

Respond with JSON:
{{
    "sql": "the SQL query",
    "explanation": "brief explanation of the query",
    "tables_used": ["list", "of", "tables"],
    "confidence": 0.95
}}"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=1000,
            messages=[{"role": "user", "content": prompt}]
        )

        # Parse response
        text = response.content[0].text
        try:
            # Extract JSON from response
            start = text.find('{')
            end = text.rfind('}') + 1
            result = json.loads(text[start:end])

            return NL2SQLResult(
                natural_language=natural_language,
                generated_sql=result["sql"],
                confidence=result.get("confidence", 0.8),
                explanation=result["explanation"],
                tables_used=result["tables_used"]
            )
        except json.JSONDecodeError:
            return NL2SQLResult(
                natural_language=natural_language,
                generated_sql="",
                confidence=0.0,
                explanation="Failed to parse response",
                tables_used=[]
            )

# Example usage
schema = DatabaseSchema(
    tables={
        "customers": ["id", "name", "email", "created_at", "region"],
        "orders": ["id", "customer_id", "amount", "status", "order_date"],
        "products": ["id", "name", "category", "price"],
        "order_items": ["id", "order_id", "product_id", "quantity"]
    },
    relationships=[
        ("orders", "customer_id", "customers", "id"),
        ("order_items", "order_id", "orders", "id"),
        ("order_items", "product_id", "products", "id")
    ],
    column_descriptions={
        "customers.region": "Geographic region (North, South, East, West)",
        "orders.status": "Order status (pending, completed, cancelled)",
        "orders.amount": "Total order amount in USD"
    }
)

converter = NL2SQLConverter(schema)
result = converter.convert("Show me total sales by region for completed orders in 2024")
print(result.generated_sql)
```

## Advanced Features

```python
class AdvancedNL2SQL:
    """Enhanced NL2SQL with validation and optimization"""

    def __init__(self, schema: DatabaseSchema):
        self.client = anthropic.Anthropic()
        self.schema = schema
        self.query_examples = []

    def add_example(self, natural_language: str, sql: str):
        """Add few-shot examples for better accuracy"""
        self.query_examples.append({
            "question": natural_language,
            "sql": sql
        })

    def convert_with_validation(self, natural_language: str) -> Dict:
        """Convert and validate the SQL"""

        # Generate SQL
        result = self._generate_sql(natural_language)

        if not result["sql"]:
            return {"success": False, "error": "Generation failed"}

        # Validate SQL
        validation = self._validate_sql(result["sql"])

        if not validation["valid"]:
            # Try to fix the SQL
            result = self._fix_sql(result["sql"], validation["errors"])

        # Optimize if valid
        if validation["valid"]:
            result["sql"] = self._optimize_sql(result["sql"])

        return {
            "success": True,
            "sql": result["sql"],
            "explanation": result["explanation"],
            "validation": validation
        }

    def _generate_sql(self, natural_language: str) -> Dict:
        """Generate SQL with few-shot examples"""

        # Build examples section
        examples = ""
        for ex in self.query_examples[-5:]:  # Use last 5 examples
            examples += f"\nQuestion: {ex['question']}\nSQL: {ex['sql']}\n"

        prompt = f"""You are an expert SQL generator.

{self._build_schema_prompt()}

Examples of correct queries:
{examples}

Now convert this question to SQL:
"{natural_language}"

Return only the SQL query, nothing else."""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )

        return {
            "sql": response.content[0].text.strip(),
            "explanation": ""
        }

    def _validate_sql(self, sql: str) -> Dict:
        """Validate SQL against schema"""
        errors = []

        # Check for referenced tables
        for table in self.schema.tables.keys():
            if table.lower() in sql.lower():
                # Table exists, check columns
                pass

        # Basic SQL syntax validation
        sql_upper = sql.upper()
        if "SELECT" not in sql_upper:
            errors.append("Missing SELECT clause")

        if "FROM" not in sql_upper:
            errors.append("Missing FROM clause")

        # Check for common issues
        if "SELECT *" in sql_upper and "JOIN" in sql_upper:
            errors.append("Warning: SELECT * with JOIN may cause ambiguous columns")

        return {
            "valid": len([e for e in errors if not e.startswith("Warning")]) == 0,
            "errors": errors
        }

    def _fix_sql(self, sql: str, errors: List[str]) -> Dict:
        """Attempt to fix SQL errors"""

        prompt = f"""Fix this SQL query:
{sql}

Errors found:
{chr(10).join(errors)}

Schema:
{self._build_schema_prompt()}

Return the corrected SQL only."""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )

        return {
            "sql": response.content[0].text.strip(),
            "explanation": "SQL was automatically corrected"
        }

    def _optimize_sql(self, sql: str) -> str:
        """Optimize SQL for performance"""

        prompt = f"""Optimize this SQL query for performance:
{sql}

Optimizations to consider:
- Use appropriate indexes (add comments suggesting indexes)
- Avoid SELECT * when possible
- Use EXISTS instead of IN for subqueries
- Proper join order

Return the optimized SQL."""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content[0].text.strip()

    def _build_schema_prompt(self) -> str:
        schema_parts = []
        for table, columns in self.schema.tables.items():
            schema_parts.append(f"Table {table}: {', '.join(columns)}")
        return "\n".join(schema_parts)
```

## Handling Ambiguity

```python
class AmbiguityHandler:
    """Handle ambiguous natural language queries"""

    def __init__(self):
        self.client = anthropic.Anthropic()

    def detect_ambiguity(self, query: str, schema: DatabaseSchema) -> Dict:
        """Detect potential ambiguities in the query"""

        prompt = f"""Analyze this natural language query for a database:
Query: "{query}"

Schema:
{self._schema_to_string(schema)}

Identify any ambiguities that could lead to incorrect SQL:
1. Unclear time ranges (e.g., "recent" - how recent?)
2. Ambiguous column references
3. Unclear aggregation scope
4. Missing filter criteria

Return JSON:
{{
    "ambiguous": true/false,
    "ambiguities": [
        {{"issue": "description", "clarification_question": "question to ask user"}}
    ]
}}"""

        response = self.client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=500,
            messages=[{"role": "user", "content": prompt}]
        )

        try:
            text = response.content[0].text
            start = text.find('{')
            end = text.rfind('}') + 1
            return json.loads(text[start:end])
        except:
            return {"ambiguous": False, "ambiguities": []}

    def _schema_to_string(self, schema: DatabaseSchema) -> str:
        return "\n".join(
            f"{table}: {', '.join(cols)}"
            for table, cols in schema.tables.items()
        )
```

## Conclusion

NL2SQL bridges the gap between business users and data. Start with a robust schema representation, add few-shot examples for accuracy, and implement validation to catch errors before execution.

