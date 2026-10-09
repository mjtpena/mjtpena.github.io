---
title: "Prompt Engineering: Structured Output with JSON Mode"
description: "For even stricter control, use the structured outputs feature with a JSON schema. JSON mode transforms LLMs from conversational tools into reliable data…"
author: Michael John Peña
draft: false
date: 2025-09-13
tags:
  - Prompt Engineering
  - JSON Mode
  - LLM
  - Structured Output
  - API Design
---

## Enabling JSON Mode

```python
from openai import AzureOpenAI
import json
import os

client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2024-06-01",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"]
)

def extract_entities_json(text: str) -> dict:
    """Extract named entities with JSON mode for reliable parsing."""

    response = client.chat.completions.create(
        model="gpt-4o",
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": """Extract named entities from the text.
Return a JSON object with this structure:
{
    "people": [{"name": "...", "role": "..."}],
    "organizations": [{"name": "...", "type": "..."}],
    "locations": [{"name": "...", "type": "city|country|address"}],
    "dates": [{"text": "...", "normalized": "YYYY-MM-DD"}]
}"""
            },
            {"role": "user", "content": text}
        ]
    )

    return json.loads(response.choices[0].message.content)

# Example usage
text = """
Microsoft CEO Satya Nadella announced at the Seattle conference
on September 15, 2025 that the company will expand its AI
research center in London.
"""

entities = extract_entities_json(text)
print(json.dumps(entities, indent=2))
```

## Structured Outputs with Schema Validation

For even stricter control, use the structured outputs feature with a JSON schema.

```python
from pydantic import BaseModel
from typing import List, Optional

class Person(BaseModel):
    name: str
    role: Optional[str] = None

class Organization(BaseModel):
    name: str
    org_type: Optional[str] = None

class ExtractedEntities(BaseModel):
    people: List[Person]
    organizations: List[Organization]
    key_facts: List[str]

def extract_with_schema(text: str) -> ExtractedEntities:
    """Extract entities with strict schema validation."""

    response = client.beta.chat.completions.parse(
        model="gpt-4o",
        messages=[
            {
                "role": "system",
                "content": "Extract entities and key facts from the provided text."
            },
            {"role": "user", "content": text}
        ],
        response_format=ExtractedEntities
    )

    return response.choices[0].message.parsed
```

## Handling Edge Cases

```python
def safe_json_extract(text: str, schema_description: str) -> dict:
    """Extract JSON with fallback handling."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o",
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": schema_description},
                {"role": "user", "content": text}
            ],
            temperature=0  # Deterministic output
        )

        result = json.loads(response.choices[0].message.content)
        return {"success": True, "data": result}

    except json.JSONDecodeError as e:
        return {"success": False, "error": f"JSON parse error: {e}"}
    except Exception as e:
        return {"success": False, "error": str(e)}
```

JSON mode transforms LLMs from conversational tools into reliable data extraction engines. Always validate outputs against expected schemas before passing data to downstream systems.
