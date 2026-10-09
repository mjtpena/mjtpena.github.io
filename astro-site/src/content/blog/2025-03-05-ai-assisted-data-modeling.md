---
title: "AI-Assisted Data Modeling: Accelerating Schema Design"
description: "AI-assisted modeling reduces design time while improving schema quality."
author: Michael John Peña
draft: false
date: 2025-03-05
tags:
  - AI
  - Data Modeling
  - Schema Design
  - Automation
  - Best Practices
---

## AI-Powered Data Modeling

```python
from azure.ai.openai import AzureOpenAI
from dataclasses import dataclass

@dataclass
class TableSchema:
    name: str
    columns: list[dict]
    relationships: list[dict]
    indexes: list[dict]

class AIDataModeler:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client

    async def generate_schema(self, requirements: str) -> list[TableSchema]:
        """Generate schema from natural language requirements."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """You are a data modeling expert. Generate optimal
                database schemas based on requirements. Consider:
                - Normalization (3NF by default)
                - Appropriate data types
                - Primary and foreign keys
                - Indexes for common queries
                Return JSON with tables, columns, relationships, and indexes."""
            }, {
                "role": "user",
                "content": requirements
            }],
            response_format={"type": "json_object"}
        )
        return self.parse_schema(response)

    async def detect_antipatterns(self, schema: list[TableSchema]) -> list[dict]:
        """Detect common data modeling anti-patterns."""
        schema_json = self.schema_to_json(schema)
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Analyze this schema for anti-patterns:
                - God tables (too many columns)
                - Missing indexes on foreign keys
                - Inappropriate denormalization
                - Missing audit columns
                - Inefficient data types
                Return issues with severity and recommendations."""
            }, {
                "role": "user",
                "content": schema_json
            }]
        )
        return self.parse_issues(response)

    async def generate_documentation(self, schema: list[TableSchema]) -> str:
        """Generate human-readable documentation."""
        return await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"Generate markdown documentation for: {schema}"
            }]
        )
```

AI-assisted modeling reduces design time while improving schema quality.
