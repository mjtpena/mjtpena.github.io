---
title: "Structured Output with Azure OpenAI: JSON Mode and Response Formats"
description: "JSON mode guarantees the model outputs valid JSON, though you still need to specify the schema in your prompt."
author: Michael John Peña
draft: false
date: 2025-08-26
tags:
  - Azure OpenAI
  - Structured Output
  - JSON Mode
  - API Development
  - Python
---

## JSON Mode

JSON mode guarantees the model outputs valid JSON, though you still need to specify the schema in your prompt.

```python
from openai import AzureOpenAI
import json

client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2024-08-01-preview",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"]
)

def extract_entities(text: str) -> dict:
    response = client.chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": """Extract entities from the text and return as JSON:
                {
                    "people": ["name1", "name2"],
                    "organizations": ["org1", "org2"],
                    "locations": ["loc1", "loc2"],
                    "dates": ["date1", "date2"]
                }"""
            },
            {"role": "user", "content": text}
        ]
    )

    return json.loads(response.choices[0].message.content)
```

## Structured Outputs with JSON Schema

For stricter control, use JSON Schema to define exact output structure.

```python
from pydantic import BaseModel
from typing import List, Optional

class ProductReview(BaseModel):
    sentiment: str  # "positive", "negative", "neutral"
    score: float    # 0.0 to 1.0
    key_points: List[str]
    recommended: bool
    summary: str

def analyze_review(review_text: str) -> ProductReview:
    response = client.chat.completions.create(
        model="gpt-4o",
        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": "product_review",
                "strict": True,
                "schema": ProductReview.model_json_schema()
            }
        },
        messages=[
            {"role": "system", "content": "Analyze the product review."},
            {"role": "user", "content": review_text}
        ]
    )

    return ProductReview.model_validate_json(
        response.choices[0].message.content
    )
```

## Best Practices

Always validate output even with structured modes. Handle edge cases where the model might return unexpected values within the schema. Use Pydantic or similar libraries for type-safe parsing in Python applications.

Structured outputs transform unpredictable LLM responses into reliable API-compatible data.
