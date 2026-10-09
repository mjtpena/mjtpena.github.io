---
title: "AI in Data Pipelines: Intelligent ETL and Data Processing"
description: "AI transforms data pipelines from rigid rule-based systems to adaptive, intelligent processes. Start with high-value, error-prone steps and expand from there."
author: Michael John Peña
draft: false
date: 2025-02-02
tags:
  - AI
  - Data Engineering
  - ETL
  - Data Pipelines
  - Azure
---

## AI-Powered Pipeline Stages

```
Extract                 Transform                    Load
   │                       │                          │
   ▼                       ▼                          ▼
┌─────────┐          ┌─────────────┐           ┌──────────┐
│ Schema  │          │ AI-Powered  │           │ Quality  │
│ Inference│         │ Transform   │           │ Validation│
│ Format  │          │ Entity      │           │ Anomaly  │
│ Detection│         │ Resolution  │           │ Detection│
└─────────┘          │ Classification│          └──────────┘
                     │ Enrichment  │
                     └─────────────┘
```

## Intelligent Schema Inference

```python
from azure.ai.foundry import AIFoundryClient
import pandas as pd

class IntelligentSchemaInferrer:
    def __init__(self, ai_client: AIFoundryClient):
        self.ai_client = ai_client

    async def infer_schema(self, sample_data: pd.DataFrame, context: str = "") -> dict:
        """Infer semantic schema from sample data."""

        # Get basic stats
        stats = {
            col: {
                "dtype": str(sample_data[col].dtype),
                "sample_values": sample_data[col].dropna().head(5).tolist(),
                "null_pct": float(sample_data[col].isnull().mean())
            }
            for col in sample_data.columns
        }

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Infer a semantic schema from this data:

                Context: {context}
                Column Statistics: {json.dumps(stats, default=str)}

                For each column determine:
                1. Semantic type (name, email, phone, address, currency, date, id, category, etc.)
                2. Business meaning
                3. Is it PII?
                4. Recommended data type for storage
                5. Validation rules

                Return JSON:
                {{
                    "columns": [
                        {{
                            "name": "column_name",
                            "semantic_type": "...",
                            "business_meaning": "...",
                            "is_pii": true/false,
                            "storage_type": "string/int/decimal/date/etc",
                            "validation": {{...}}
                        }}
                    ],
                    "table_purpose": "what this data represents",
                    "primary_key_candidates": ["col1", "col2"],
                    "relationships_hint": "possible relationships to other data"
                }}"""
            }]
        )

        return json.loads(response.choices[0].message.content)

    async def detect_format(self, raw_data: bytes, filename: str) -> dict:
        """Detect data format and parsing parameters."""

        # Try common formats
        sample = raw_data[:5000].decode('utf-8', errors='ignore')

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Analyze this data sample and determine the format:

                Filename: {filename}
                Sample (first 5000 chars):
                {sample}

                Determine:
                1. Format (csv, json, jsonl, xml, fixed-width, etc.)
                2. Delimiter (if applicable)
                3. Has header row?
                4. Encoding
                5. Quote character
                6. Escape character
                7. Any special handling needed

                Return JSON with parsing configuration."""
            }]
        )

        return json.loads(response.choices[0].message.content)
```

## Entity Resolution with AI

```python
class AIEntityResolver:
    def __init__(self, ai_client: AIFoundryClient):
        self.ai_client = ai_client

    async def resolve_entities(
        self,
        records: list[dict],
        match_fields: list[str]
    ) -> list[dict]:
        """Resolve duplicate/similar entities using AI."""

        # Group potential matches by blocking key
        blocks = self._create_blocks(records, match_fields)

        resolved = []
        for block in blocks:
            if len(block) == 1:
                resolved.append(block[0])
                continue

            # AI-powered matching for ambiguous cases
            match_result = await self._ai_match(block, match_fields)
            resolved.extend(match_result)

        return resolved

    def _create_blocks(self, records: list[dict], fields: list[str]) -> list[list[dict]]:
        """Create blocks of potentially matching records."""
        # Simple blocking by first 3 chars of key fields
        blocks = {}
        for record in records:
            key = "".join([
                str(record.get(f, ""))[:3].lower()
                for f in fields
            ])
            if key not in blocks:
                blocks[key] = []
            blocks[key].append(record)
        return list(blocks.values())

    async def _ai_match(self, candidates: list[dict], match_fields: list[str]) -> list[dict]:
        """Use AI to determine if candidates are the same entity."""

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Analyze these records for entity matching:

                Records: {json.dumps(candidates)}
                Match on fields: {match_fields}

                For each pair of records, determine:
                1. Are they the same entity? (confidence 0-1)
                2. If same, which record has better data quality?
                3. How should they be merged?

                Return JSON:
                {{
                    "groups": [
                        {{
                            "record_ids": [...],
                            "confidence": 0.95,
                            "merged_record": {{...}},
                            "merge_reasoning": "..."
                        }}
                    ],
                    "unmatched": [record_ids that don't match anything]
                }}"""
            }]
        )

        result = json.loads(response.choices[0].message.content)

        # Return merged records plus unmatched
        output = [g["merged_record"] for g in result["groups"]]
        output.extend([c for c in candidates if c["id"] in result["unmatched"]])

        return output
```

## AI-Powered Data Classification

```python
class DataClassifier:
    def __init__(self, ai_client: AIFoundryClient):
        self.ai_client = ai_client

    async def classify_records(
        self,
        records: list[dict],
        categories: list[str],
        batch_size: int = 20
    ) -> list[dict]:
        """Classify records into categories using AI."""

        results = []

        for i in range(0, len(records), batch_size):
            batch = records[i:i + batch_size]
            classifications = await self._classify_batch(batch, categories)
            results.extend(classifications)

        return results

    async def _classify_batch(self, batch: list[dict], categories: list[str]) -> list[dict]:
        """Classify a batch of records."""

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"""Classify these records into categories:

                Categories: {categories}
                Records: {json.dumps(batch)}

                For each record, provide:
                1. Primary category
                2. Confidence (0-1)
                3. Secondary category (if applicable)

                Return JSON array with same order as input:
                [
                    {{
                        "record_id": "...",
                        "category": "...",
                        "confidence": 0.95,
                        "secondary_category": "..." or null,
                        "reasoning": "brief explanation"
                    }}
                ]"""
            }]
        )

        classifications = json.loads(response.choices[0].message.content)

        # Merge classifications back to records
        for record, classification in zip(batch, classifications):
            record["ai_classification"] = classification

        return batch

    async def auto_categorize(self, records: list[dict]) -> dict:
        """Automatically discover categories from data."""

        sample = records[:50]  # Use sample for category discovery

        response = await self.ai_client.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Analyze these records and suggest a categorization scheme:

                Sample records: {json.dumps(sample)}

                Determine:
                1. What natural categories exist in this data?
                2. What would be a good taxonomy?
                3. What fields are most useful for categorization?

                Return JSON:
                {{
                    "categories": ["cat1", "cat2", ...],
                    "taxonomy": {{...hierarchical structure...}},
                    "key_fields": ["field1", "field2"],
                    "reasoning": "why this categorization"
                }}"""
            }]
        )

        return json.loads(response.choices[0].message.content)
```

## Pipeline Integration

```python
from dataclasses import dataclass
from typing import Callable

@dataclass
class PipelineStep:
    name: str
    function: Callable
    ai_enabled: bool = False

class AIPipeline:
    def __init__(self, ai_client: AIFoundryClient):
        self.ai_client = ai_client
        self.steps = []
        self.schema_inferrer = IntelligentSchemaInferrer(ai_client)
        self.entity_resolver = AIEntityResolver(ai_client)
        self.classifier = DataClassifier(ai_client)

    def add_step(self, step: PipelineStep):
        self.steps.append(step)

    async def run(self, data: pd.DataFrame, context: str = "") -> dict:
        """Run the AI-powered pipeline."""

        result = {
            "input_rows": len(data),
            "steps": [],
            "output": None
        }

        # Infer schema if not provided
        schema = await self.schema_inferrer.infer_schema(data, context)
        result["inferred_schema"] = schema

        current_data = data

        for step in self.steps:
            step_result = {
                "name": step.name,
                "input_rows": len(current_data)
            }

            try:
                if step.ai_enabled:
                    current_data = await step.function(current_data, self.ai_client)
                else:
                    current_data = step.function(current_data)

                step_result["output_rows"] = len(current_data)
                step_result["status"] = "success"
            except Exception as e:
                step_result["status"] = "failed"
                step_result["error"] = str(e)
                raise

            result["steps"].append(step_result)

        result["output"] = current_data
        result["output_rows"] = len(current_data)

        return result

# Usage example
pipeline = AIPipeline(ai_client)

pipeline.add_step(PipelineStep(
    name="deduplicate",
    function=lambda df, ai: entity_resolver.resolve_entities(df.to_dict('records'), ['name', 'email']),
    ai_enabled=True
))

pipeline.add_step(PipelineStep(
    name="classify",
    function=lambda df, ai: classifier.classify_records(df, ['category_a', 'category_b']),
    ai_enabled=True
))

result = await pipeline.run(data, context="Customer data from CRM")
```

## Best Practices

1. **Use AI selectively**: Not every transform needs AI
2. **Batch processing**: Group records for efficient AI calls
3. **Validate AI outputs**: Always verify AI decisions
4. **Track lineage**: Record which records were AI-processed
5. **Cost monitoring**: Track AI costs per pipeline run

AI transforms data pipelines from rigid rule-based systems to adaptive, intelligent processes. Start with high-value, error-prone steps and expand from there.
