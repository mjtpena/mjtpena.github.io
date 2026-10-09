---
title: "Structured Outputs: Getting Reliable Data from LLMs"
description: "Structured outputs enable reliable integration of LLM capabilities into data pipelines."
author: Michael John Peña
draft: false
date: 2025-03-19
tags:
  - AI
  - Structured Output
  - JSON
  - Parsing
  - Best Practices
---

## Structured Output Patterns

```python
from azure.ai.openai import AzureOpenAI
from pydantic import BaseModel, Field
from typing import List, Optional
import json

class ExtractedEntity(BaseModel):
    """Schema for extracted entities."""
    name: str = Field(description="Entity name")
    type: str = Field(description="Entity type (person, org, location, etc)")
    confidence: float = Field(ge=0, le=1, description="Confidence score")

class ExtractionResult(BaseModel):
    """Schema for extraction results."""
    entities: List[ExtractedEntity]
    summary: str
    sentiment: str = Field(description="positive, negative, or neutral")

class StructuredOutputAgent:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client

    async def extract_with_schema(self, text: str, schema: type[BaseModel]) -> BaseModel:
        """Extract structured data using JSON mode."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"""Extract information according to this schema:
                {schema.model_json_schema()}
                Return valid JSON only."""
            }, {
                "role": "user",
                "content": text
            }],
            response_format={"type": "json_object"}
        )

        data = json.loads(response.choices[0].message.content)
        return schema.model_validate(data)

    async def extract_with_function(self, text: str, schema: type[BaseModel]) -> BaseModel:
        """Extract using function calling for better structure adherence."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"Extract information from: {text}"
            }],
            tools=[{
                "type": "function",
                "function": {
                    "name": "extract_data",
                    "description": "Extract structured data",
                    "parameters": schema.model_json_schema()
                }
            }],
            tool_choice={"type": "function", "function": {"name": "extract_data"}}
        )

        args = json.loads(response.choices[0].message.tool_calls[0].function.arguments)
        return schema.model_validate(args)

    async def extract_with_retry(self, text: str, schema: type[BaseModel], max_retries: int = 3) -> BaseModel:
        """Extract with validation and retry."""
        for attempt in range(max_retries):
            try:
                result = await self.extract_with_schema(text, schema)
                return result
            except Exception as e:
                if attempt == max_retries - 1:
                    raise
                # Add error context for next attempt
                continue
        raise ValueError("Failed to extract valid structure")

# Usage
result = await agent.extract_with_schema(article_text, ExtractionResult)
print(f"Found {len(result.entities)} entities, sentiment: {result.sentiment}")
```

Structured outputs enable reliable integration of LLM capabilities into data pipelines.
