---
title: "Natural Language to SQL: Building Text-to-SQL Systems"
author: Michael John Peña
draft: false
date: 2025-04-22
tags:
  - AI
  - SQL
  - Natural Language
  - Text-to-SQL
  - Database

---

I wrote "Natural Language to SQL: Building Text-to-SQL Systems" to share practical, production-minded guidance on this topic.

## Text-to-SQL Implementation

```python
from azure.ai.openai import AzureOpenAI
from dataclasses import dataclass
from typing import Optional, List

@dataclass
class TableSchema:
    name: str
    columns: List[dict]
    sample_data: Optional[str] = None

class NL2SQL:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client
        self.schemas: dict[str, TableSchema] = {}

    def register_table(self, schema: TableSchema):
        """Register table schema for SQL generation."""
        self.schemas[schema.name] = schema

    def get_schema_context(self) -> str:
        """Build schema context for the LLM."""
        context = "Database Schema:\n\n"

        for name, schema in self.schemas.items():
            context += f"Table: {name}\n"
            context += "Columns:\n"
            for col in schema.columns:
                context += f"  - {col['name']} ({col['type']})"
                if col.get('description'):
                    context += f": {col['description']}"
                context += "\n"

            if schema.sample_data:
                context += f"Sample data:\n{schema.sample_data}\n"

            context += "\n"

        return context

    async def generate_sql(self, question: str, dialect: str = "postgresql") -> dict:
        """Generate SQL from natural language question."""
        schema_context = self.get_schema_context()

        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"""You are a SQL expert. Generate {dialect} queries from natural language.

{schema_context}

Rules:
1. Use only tables and columns from the schema
2. Use appropriate JOINs when needed
3. Include WHERE clauses for filtering
4. Use GROUP BY for aggregations
5. Always use aliases for readability

Return JSON with:
- sql: the SQL query
- explanation: brief explanation of the query
- assumptions: any assumptions made"""
            }, {
                "role": "user",
                "content": question
            }],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)

    async def validate_sql(self, sql: str) -> dict:
        """Validate generated SQL for safety and correctness."""
        # Check for dangerous operations
        dangerous_keywords = ["DROP", "DELETE", "TRUNCATE", "UPDATE", "INSERT", "ALTER"]
        for keyword in dangerous_keywords:
            if keyword in sql.upper():
                return {"valid": False, "error": f"Dangerous operation: {keyword}"}

        # Use LLM to validate logic
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"""Validate this SQL query against the schema: {self.get_schema_context()}
                Check for:
                - Invalid table/column references
                - Logical errors
                - Performance issues
                Return JSON with valid (boolean) and issues (list)."""
            }, {
                "role": "user",
                "content": sql
            }],
            response_format={"type": "json_object"}
        )

        return json.loads(response.choices[0].message.content)

    async def explain_results(self, question: str, sql: str, results: list) -> str:
        """Generate natural language explanation of query results."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Original question: {question}
SQL query: {sql}
Results: {results[:100]}  # Limit results

Explain these results in natural language, answering the original question."""
            }]
        )

        return response.choices[0].message.content
```

Text-to-SQL democratizes data access by enabling natural language queries.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
