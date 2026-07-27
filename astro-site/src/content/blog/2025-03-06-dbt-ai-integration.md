---
title: "dbt and AI: Intelligent Data Transformations"
author: Michael John Peña
draft: false
date: 2025-03-06
tags:
  - dbt
  - AI
  - Data Engineering
  - Transformations
  - Automation

---

I wrote "dbt and AI: Intelligent Data Transformations" to share practical, production-minded guidance on this topic.

## AI-Enhanced dbt Workflows

```python
# dbt_ai_helper.py
from azure.ai.openai import AzureOpenAI
import yaml

class DbtAIHelper:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client

    async def generate_model(self, description: str, source_schema: dict) -> str:
        """Generate dbt model from natural language description."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Generate a dbt SQL model based on the description.
                Follow dbt best practices:
                - Use CTEs for readability
                - Include appropriate comments
                - Use ref() for dependencies
                - Add column descriptions"""
            }, {
                "role": "user",
                "content": f"Description: {description}\nSource schema: {source_schema}"
            }]
        )
        return response.choices[0].message.content

    async def generate_tests(self, model_sql: str) -> str:
        """Generate dbt tests for a model."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Generate dbt schema.yml tests for this model.
                Include:
                - not_null tests for required columns
                - unique tests for keys
                - accepted_values where appropriate
                - relationships tests for foreign keys
                - Custom tests for business rules"""
            }, {
                "role": "user",
                "content": model_sql
            }]
        )
        return response.choices[0].message.content

    async def explain_model(self, model_sql: str) -> str:
        """Generate documentation for dbt model."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"Explain this dbt model in plain English:\n{model_sql}"
            }]
        )
        return response.choices[0].message.content

    async def optimize_model(self, model_sql: str, runtime_stats: dict) -> str:
        """Suggest optimizations based on runtime statistics."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": "Suggest SQL optimizations based on the model and stats."
            }, {
                "role": "user",
                "content": f"Model:\n{model_sql}\n\nStats:\n{runtime_stats}"
            }]
        )
        return response.choices[0].message.content
```

AI supercharges dbt workflows with intelligent generation and optimization.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
