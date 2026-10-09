---
title: "Feature Engineering with LLMs: AI-Powered Feature Creation"
description: "LLM-powered feature engineering unlocks value from unstructured data. Combine semantic understanding with traditional ML for more powerful predictive models."
author: Michael John Pena
draft: false
date: 2023-04-22
tags:
  - AI
  - Feature Engineering
  - LLM
  - Machine Learning
  - Data Science
---

## LLM-Powered Feature Extraction

```python
import openai
from dataclasses import dataclass
from typing import Optional
import json

@dataclass
class ExtractedFeatures:
    numeric_features: dict
    categorical_features: dict
    text_features: dict
    metadata: dict

class LLMFeatureExtractor:
    """Extract features from unstructured data using LLMs."""

    def __init__(self, client, model: str = "gpt-4"):
        self.client = client
        self.model = model

    async def extract_features_from_text(
        self,
        text: str,
        schema: dict,
        context: str = None
    ) -> ExtractedFeatures:
        """Extract structured features from unstructured text."""

        schema_str = json.dumps(schema, indent=2)

        prompt = f"""Extract structured features from this text.

Text:
{text}

{f'Context: {context}' if context else ''}

Expected Schema:
{schema_str}

Rules:
- Extract only features present in the schema
- Return null for missing values
- Normalize numeric values where appropriate
- Categorize text fields according to schema enums

Return as JSON matching the schema exactly."""

        response = await self.client.chat_completion(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        try:
            features = json.loads(response.content)
            return self._parse_features(features, schema)
        except:
            return ExtractedFeatures({}, {}, {}, {"raw": response.content})

    def _parse_features(self, features: dict, schema: dict) -> ExtractedFeatures:
        """Parse and categorize extracted features."""
        numeric = {}
        categorical = {}
        text = {}

        for key, value in features.items():
            if key in schema:
                field_type = schema[key].get("type", "string")
                if field_type in ["number", "integer", "float"]:
                    numeric[key] = value
                elif field_type == "string" and "enum" in schema[key]:
                    categorical[key] = value
                else:
                    text[key] = value

        return ExtractedFeatures(
            numeric_features=numeric,
            categorical_features=categorical,
            text_features=text,
            metadata={"schema": schema}
        )

    async def extract_product_features(self, description: str) -> dict:
        """Extract product features from description."""

        prompt = f"""Extract product features from this description.

Description:
{description}

Extract:
- price_range: low/medium/high/premium
- category: electronics/clothing/home/food/other
- target_audience: general/youth/professional/senior
- quality_indicators: list of quality-related mentions
- key_benefits: list of main benefits
- sentiment: positive/neutral/negative
- urgency_level: none/low/medium/high

Return as JSON."""

        response = await self.client.chat_completion(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        return json.loads(response.content)
```

## Semantic Feature Generation

```python
import numpy as np
from typing import List

class SemanticFeatureGenerator:
    """Generate semantic features using embeddings and LLMs."""

    def __init__(self, embedding_client, llm_client):
        self.embedding_client = embedding_client
        self.llm_client = llm_client

    async def generate_embeddings(
        self,
        texts: List[str],
        model: str = "text-embedding-ada-002"
    ) -> np.ndarray:
        """Generate embeddings for texts."""
        response = await self.embedding_client.create_embeddings(
            input=texts,
            model=model
        )
        return np.array([e.embedding for e in response.data])

    async def compute_similarity_features(
        self,
        texts: List[str],
        reference_texts: List[str]
    ) -> np.ndarray:
        """Compute similarity features against reference texts."""

        # Get embeddings
        text_embeddings = await self.generate_embeddings(texts)
        ref_embeddings = await self.generate_embeddings(reference_texts)

        # Compute cosine similarities
        similarities = np.dot(text_embeddings, ref_embeddings.T)
        norms = np.outer(
            np.linalg.norm(text_embeddings, axis=1),
            np.linalg.norm(ref_embeddings, axis=1)
        )
        return similarities / norms

    async def generate_semantic_categories(
        self,
        texts: List[str],
        categories: List[str],
        threshold: float = 0.7
    ) -> List[List[str]]:
        """Categorize texts using semantic similarity."""

        similarities = await self.compute_similarity_features(texts, categories)

        results = []
        for i, text in enumerate(texts):
            matched_categories = [
                categories[j]
                for j, sim in enumerate(similarities[i])
                if sim > threshold
            ]
            results.append(matched_categories)

        return results

    async def extract_topics(
        self,
        texts: List[str],
        num_topics: int = 5
    ) -> dict:
        """Extract topics from text collection."""

        sample_texts = texts[:20] if len(texts) > 20 else texts
        combined = "\n---\n".join(sample_texts)

        prompt = f"""Identify the main topics from these texts.

Texts:
{combined}

Extract {num_topics} main topics. For each topic provide:
- topic_name: short descriptive name
- keywords: list of related keywords
- prevalence: estimated percentage of texts containing this topic

Return as JSON array."""

        response = await self.llm_client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )

        return json.loads(response.content)

    async def compute_topic_features(
        self,
        texts: List[str],
        topics: List[dict]
    ) -> np.ndarray:
        """Compute topic membership features."""

        # Create topic descriptions for similarity
        topic_texts = [
            f"{t['topic_name']}: {', '.join(t['keywords'])}"
            for t in topics
        ]

        return await self.compute_similarity_features(texts, topic_texts)
```

## Feature Interaction Discovery

```python
class FeatureInteractionDiscovery:
    """Discover feature interactions using LLMs."""

    def __init__(self, client):
        self.client = client

    async def suggest_interactions(
        self,
        feature_names: List[str],
        feature_descriptions: dict,
        target_description: str
    ) -> List[dict]:
        """Suggest meaningful feature interactions."""

        features_str = "\n".join([
            f"- {name}: {feature_descriptions.get(name, 'No description')}"
            for name in feature_names
        ])

        prompt = f"""Suggest meaningful feature interactions for ML modeling.

Available Features:
{features_str}

Target Variable: {target_description}

For each suggested interaction:
1. Features involved
2. Type of interaction (multiply, ratio, difference, polynomial)
3. Business rationale
4. Expected predictive value

Return as JSON array of interactions."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.5
        )

        return json.loads(response.content)

    async def generate_derived_features(
        self,
        df_schema: dict,
        target: str,
        domain: str
    ) -> List[dict]:
        """Generate derived feature suggestions."""

        prompt = f"""Suggest derived features for a {domain} ML problem.

Available columns:
{json.dumps(df_schema, indent=2)}

Target variable: {target}

Suggest derived features including:
- Mathematical transformations (log, sqrt, power)
- Date/time features (day of week, is_weekend, etc.)
- Aggregations (rolling means, counts)
- Business-specific features

For each feature provide:
- name: feature name
- formula: how to compute it
- rationale: why it might be predictive

Return as JSON array."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)

    def apply_suggested_interactions(
        self,
        df,
        interactions: List[dict]
    ):
        """Apply suggested interactions to DataFrame."""
        import pandas as pd

        for interaction in interactions:
            features = interaction["features"]
            interaction_type = interaction["type"]
            name = interaction.get("name", "_".join(features))

            if interaction_type == "multiply":
                df[name] = df[features[0]] * df[features[1]]
            elif interaction_type == "ratio":
                df[name] = df[features[0]] / (df[features[1]] + 1e-8)
            elif interaction_type == "difference":
                df[name] = df[features[0]] - df[features[1]]
            elif interaction_type == "polynomial":
                degree = interaction.get("degree", 2)
                df[name] = df[features[0]] ** degree

        return df
```

## Automated Feature Documentation

```python
class FeatureDocumentationGenerator:
    """Generate feature documentation using LLMs."""

    def __init__(self, client):
        self.client = client

    async def document_features(
        self,
        df,
        feature_names: List[str]
    ) -> dict:
        """Generate documentation for features."""
        import pandas as pd

        # Gather statistics
        stats = {}
        for col in feature_names:
            if col in df.columns:
                col_stats = {
                    "dtype": str(df[col].dtype),
                    "null_count": int(df[col].isnull().sum()),
                    "unique_count": int(df[col].nunique())
                }

                if pd.api.types.is_numeric_dtype(df[col]):
                    col_stats.update({
                        "mean": float(df[col].mean()),
                        "std": float(df[col].std()),
                        "min": float(df[col].min()),
                        "max": float(df[col].max())
                    })
                else:
                    col_stats["sample_values"] = df[col].dropna().head(5).tolist()

                stats[col] = col_stats

        prompt = f"""Generate documentation for these ML features.

Feature Statistics:
{json.dumps(stats, indent=2)}

For each feature provide:
- description: what it represents
- type: numeric/categorical/text/datetime
- business_meaning: business interpretation
- preprocessing_notes: any preprocessing needed
- potential_issues: data quality concerns

Return as JSON with feature names as keys."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)

    async def generate_feature_importance_explanation(
        self,
        feature_importances: dict,
        model_type: str,
        target: str
    ) -> str:
        """Explain feature importance in business terms."""

        prompt = f"""Explain these feature importances in business terms.

Model Type: {model_type}
Target Variable: {target}

Feature Importances (descending):
{json.dumps(feature_importances, indent=2)}

Provide:
1. Summary of most important features
2. Business interpretation of top features
3. Potential action items based on findings
4. Caveats about interpretation"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Feature Store Integration

```python
class LLMFeatureStore:
    """Feature store with LLM-powered features."""

    def __init__(self, spark, llm_client):
        self.spark = spark
        self.llm_client = llm_client
        self.extractor = LLMFeatureExtractor(llm_client)

    async def register_llm_feature(
        self,
        name: str,
        extraction_prompt: str,
        input_columns: List[str],
        output_schema: dict
    ):
        """Register an LLM-powered feature definition."""
        from pyspark.sql.functions import udf
        from pyspark.sql.types import MapType, StringType

        async def extract_feature(text):
            result = await self.extractor.extract_features_from_text(
                text, output_schema
            )
            return {**result.numeric_features, **result.categorical_features}

        # Register as Spark UDF (simplified - actual implementation needs async handling)
        self.feature_definitions[name] = {
            "prompt": extraction_prompt,
            "inputs": input_columns,
            "schema": output_schema,
            "udf": extract_feature
        }

    def compute_features(
        self,
        df,
        feature_names: List[str]
    ):
        """Compute LLM features on DataFrame."""
        from pyspark.sql.functions import col

        for name in feature_names:
            if name in self.feature_definitions:
                definition = self.feature_definitions[name]
                # Apply feature extraction
                # (Actual implementation requires proper UDF handling)
                pass

        return df

    async def create_semantic_index(
        self,
        df,
        text_column: str,
        index_name: str
    ):
        """Create semantic index for similarity features."""
        semantic_gen = SemanticFeatureGenerator(
            self.llm_client, self.llm_client
        )

        texts = df.select(text_column).collect()
        text_list = [row[0] for row in texts]

        embeddings = await semantic_gen.generate_embeddings(text_list)

        # Store embeddings for later similarity computation
        self.semantic_indices[index_name] = {
            "embeddings": embeddings,
            "texts": text_list
        }

# Usage
store = LLMFeatureStore(spark, llm_client)

# Register LLM feature
await store.register_llm_feature(
    name="customer_sentiment",
    extraction_prompt="Extract customer sentiment from feedback",
    input_columns=["feedback_text"],
    output_schema={
        "sentiment": {"type": "string", "enum": ["positive", "negative", "neutral"]},
        "intensity": {"type": "number"}
    }
)

# Compute features
df_with_features = store.compute_features(df, ["customer_sentiment"])
```

LLM-powered feature engineering unlocks value from unstructured data. Combine semantic understanding with traditional ML for more powerful predictive models.
