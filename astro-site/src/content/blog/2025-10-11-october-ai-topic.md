---
title: "Prompt Engineering Patterns for Enterprise Applications"
description: "Include examples in prompts to guide model behavior for domain-specific tasks. This is especially effective for classification and formatting tasks where…"
author: Michael John Peña
draft: false
date: 2025-10-11
tags:
  - Prompt Engineering
  - Azure OpenAI
  - LLM
  - AI Applications
  - Best Practices
---

## Structured Output Patterns

Use JSON schema definitions to ensure consistent, parseable responses:

```python
from openai import AzureOpenAI
from pydantic import BaseModel
from typing import List, Optional
import json

class ExtractedEntity(BaseModel):
    name: str
    entity_type: str
    confidence: float
    context: Optional[str]

class EntityExtractionResult(BaseModel):
    entities: List[ExtractedEntity]
    summary: str
    processing_notes: Optional[str]

class StructuredPromptEngine:
    def __init__(self, client: AzureOpenAI, deployment: str):
        self.client = client
        self.deployment = deployment

    def extract_entities(self, text: str, entity_types: List[str]) -> EntityExtractionResult:
        """Extract entities with structured output."""

        schema_description = EntityExtractionResult.model_json_schema()

        system_prompt = f"""You are an entity extraction system. Extract entities from the provided text.

Return your response as valid JSON matching this schema:
{json.dumps(schema_description, indent=2)}

Only extract entities of these types: {', '.join(entity_types)}
Assign confidence scores between 0.0 and 1.0 based on extraction certainty."""

        response = self.client.chat.completions.create(
            model=self.deployment,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Extract entities from: {text}"}
            ],
            response_format={"type": "json_object"},
            temperature=0.1
        )

        result_json = json.loads(response.choices[0].message.content)
        return EntityExtractionResult(**result_json)
```

## Chain-of-Thought Prompting

Improve reasoning quality by asking the model to show its work:

```python
def analyze_with_reasoning(self, question: str, context: str) -> dict:
    """Use chain-of-thought prompting for complex analysis."""

    system_prompt = """You are an analytical assistant. When answering questions:

1. First, identify the key information needed to answer
2. List relevant facts from the context
3. Show your reasoning step by step
4. Provide your final answer
5. Rate your confidence (high/medium/low) with justification

Format your response as JSON with keys: key_information, relevant_facts, reasoning_steps, answer, confidence, confidence_justification"""

    response = self.client.chat.completions.create(
        model=self.deployment,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Context: {context}\n\nQuestion: {question}"}
        ],
        response_format={"type": "json_object"},
        temperature=0.2
    )

    return json.loads(response.choices[0].message.content)
```

## Few-Shot Learning Templates

Include examples in prompts to guide model behavior for domain-specific tasks. This is especially effective for classification and formatting tasks where the expected output pattern needs to match existing systems.
