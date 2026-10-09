---
title: "LLM-Powered SQL Generation: Patterns and Practices"
description: "LLM-powered SQL generation democratizes data access. With proper validation and safety measures, it enables anyone to query databases using natural language."
author: Michael John Pena
draft: false
date: 2023-04-14
tags:
  - AI
  - SQL
  - OpenAI
  - Data
  - NLP
---

## Core Pattern

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class SQLGenerationResult:
    query: str
    explanation: str
    confidence: float
    validated: bool
    error: Optional[str] = None

class SQLGenerator:
    """Generate SQL from natural language."""

    def __init__(self, client, db_connection):
        self.client = client
        self.db = db_connection

    async def generate(
        self,
        question: str,
        schema: str,
        dialect: str = "postgresql"
    ) -> SQLGenerationResult:
        """Generate SQL from natural language question."""

        prompt = f"""Convert this question to {dialect} SQL.

Database Schema:
{schema}

Question: {question}

Rules:
- Use only tables and columns from the schema
- Use appropriate JOINs
- Handle NULL values properly
- Add LIMIT 1000 for unbounded queries
- Use aliases for readability

Return the SQL query only."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[
                {"role": "system", "content": f"You are a {dialect} SQL expert."},
                {"role": "user", "content": prompt}
            ],
            temperature=0
        )

        sql = self._clean_sql(response.content)

        # Validate
        validation = await self._validate_sql(sql, schema)

        return SQLGenerationResult(
            query=sql,
            explanation=await self._explain_sql(sql),
            confidence=validation["confidence"],
            validated=validation["valid"],
            error=validation.get("error")
        )

    def _clean_sql(self, response: str) -> str:
        """Clean SQL from response."""
        sql = response.strip()
        if sql.startswith("```"):
            sql = sql.split("```")[1]
            if sql.startswith("sql"):
                sql = sql[3:]
        return sql.strip()

    async def _validate_sql(self, sql: str, schema: str) -> dict:
        """Validate generated SQL."""
        prompt = f"""Validate this SQL query against the schema.

Schema:
{schema}

Query:
{sql}

Check:
1. All tables exist
2. All columns exist
3. JOINs are valid
4. No syntax errors

Return JSON: {{"valid": true/false, "confidence": 0.0-1.0, "error": "..." or null}}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return {"valid": True, "confidence": 0.7}

    async def _explain_sql(self, sql: str) -> str:
        """Explain what the SQL does."""
        prompt = f"""Explain this SQL in plain language (2-3 sentences):

{sql}"""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content
```

## Schema Management

```python
class SchemaManager:
    """Manage database schema for LLM context."""

    def __init__(self, db_connection):
        self.db = db_connection
        self._cache = {}

    def get_schema_for_llm(
        self,
        tables: list[str] = None,
        include_samples: bool = False
    ) -> str:
        """Get schema formatted for LLM context."""

        if tables:
            schema_info = [self._get_table_schema(t) for t in tables]
        else:
            schema_info = self._get_all_schemas()

        parts = []
        for table in schema_info:
            part = f"Table: {table['name']}\n"
            part += f"Columns: {', '.join([f\"{c['name']} ({c['type']})\" for c in table['columns']])}\n"

            if table.get('primary_key'):
                part += f"Primary Key: {table['primary_key']}\n"

            if table.get('foreign_keys'):
                for fk in table['foreign_keys']:
                    part += f"Foreign Key: {fk['column']} -> {fk['references']}\n"

            if include_samples and table.get('sample'):
                part += f"Sample values: {table['sample']}\n"

            parts.append(part)

        return "\n".join(parts)

    def get_relevant_tables(
        self,
        question: str,
        all_tables: list[str]
    ) -> list[str]:
        """Identify relevant tables for a question."""
        # Use embeddings or keyword matching
        # to find relevant tables
        question_lower = question.lower()

        relevant = []
        for table in all_tables:
            if table.lower() in question_lower:
                relevant.append(table)

        return relevant or all_tables[:5]  # Default to first 5
```

## Query Refinement

```python
class SQLRefiner:
    """Refine and improve SQL queries."""

    async def refine_for_performance(
        self,
        sql: str,
        schema: str
    ) -> dict:
        """Suggest performance improvements."""

        prompt = f"""Analyze this SQL for performance issues.

Schema:
{schema}

Query:
{sql}

Suggest:
1. Index recommendations
2. Query rewrites
3. JOIN optimizations
4. Subquery improvements"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return {"suggestions": response.content}

    async def fix_error(
        self,
        sql: str,
        error: str,
        schema: str
    ) -> str:
        """Fix SQL based on error message."""

        prompt = f"""Fix this SQL query that produced an error.

Schema:
{schema}

Original Query:
{sql}

Error:
{error}

Return only the corrected SQL."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        return self._clean_sql(response.content)
```

## Safety Guardrails

```python
class SQLSafetyGuard:
    """Ensure SQL queries are safe."""

    DANGEROUS_PATTERNS = [
        r"\bDROP\b",
        r"\bDELETE\b(?!\s+FROM.*WHERE)",  # DELETE without WHERE
        r"\bTRUNCATE\b",
        r"\bUPDATE\b(?!.*WHERE)",  # UPDATE without WHERE
        r"\bALTER\b",
        r"\bCREATE\b",
        r"\bGRANT\b",
        r"\bREVOKE\b",
        r"--",  # SQL comments (potential injection)
        r";.*;",  # Multiple statements
    ]

    def check_safety(self, sql: str) -> dict:
        """Check if SQL is safe to execute."""
        import re

        issues = []
        for pattern in self.DANGEROUS_PATTERNS:
            if re.search(pattern, sql, re.IGNORECASE):
                issues.append(f"Dangerous pattern detected: {pattern}")

        return {
            "safe": len(issues) == 0,
            "issues": issues
        }

    def enforce_read_only(self, sql: str) -> bool:
        """Check if query is read-only."""
        sql_upper = sql.upper().strip()
        return sql_upper.startswith("SELECT") or sql_upper.startswith("WITH")
```

LLM-powered SQL generation democratizes data access. With proper validation and safety measures, it enables anyone to query databases using natural language.
