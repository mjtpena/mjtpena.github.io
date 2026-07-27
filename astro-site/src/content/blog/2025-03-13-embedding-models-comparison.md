---
title: "Embedding Models Comparison: Choosing the Right Model for Your Use Case"
author: Michael John Peña
draft: false
date: 2025-03-13
tags:
  - Embeddings
  - AI
  - Comparison
  - Azure
  - Models

---

I wrote "Embedding Models Comparison: Choosing the Right Model for Your Use Case" to share practical, production-minded guidance on this topic.

## Embedding Model Analysis

```python
from azure.ai.openai import AzureOpenAI
from sentence_transformers import SentenceTransformer
import numpy as np
from typing import Protocol

class EmbeddingModel(Protocol):
    async def embed(self, texts: list[str]) -> list[list[float]]:
        ...

class AzureOpenAIEmbeddings:
    """Azure OpenAI text-embedding-3 models."""

    def __init__(self, client: AzureOpenAI, model: str = "text-embedding-3-large"):
        self.client = client
        self.model = model
        # Dimensions: small=1536, large=3072 (can reduce to 256-1536)

    async def embed(self, texts: list[str], dimensions: int = None) -> list[list[float]]:
        response = await self.client.embeddings.create(
            input=texts,
            model=self.model,
            dimensions=dimensions  # Matryoshka embeddings support
        )
        return [r.embedding for r in response.data]

class LocalEmbeddings:
    """Local embedding models for privacy/cost."""

    def __init__(self, model_name: str = "BAAI/bge-large-en-v1.5"):
        self.model = SentenceTransformer(model_name)

    def embed(self, texts: list[str]) -> list[list[float]]:
        return self.model.encode(texts).tolist()

class EmbeddingBenchmark:
    """Compare embedding models."""

    def __init__(self):
        self.models = {}
        self.test_pairs = []  # (query, relevant_doc, irrelevant_doc)

    def add_model(self, name: str, model: EmbeddingModel):
        self.models[name] = model

    async def benchmark(self) -> dict:
        results = {}
        for name, model in self.models.items():
            scores = []
            for query, relevant, irrelevant in self.test_pairs:
                embeddings = await model.embed([query, relevant, irrelevant])
                rel_sim = self.cosine_similarity(embeddings[0], embeddings[1])
                irrel_sim = self.cosine_similarity(embeddings[0], embeddings[2])
                scores.append(rel_sim > irrel_sim)
            results[name] = sum(scores) / len(scores)
        return results

# Model comparison
# | Model                    | Dimensions | Quality | Speed  | Cost    |
# |--------------------------|------------|---------|--------|---------|
# | text-embedding-3-large   | 3072       | Best    | Medium | $$$     |
# | text-embedding-3-small   | 1536       | Good    | Fast   | $$      |
# | bge-large-en-v1.5        | 1024       | Good    | Fast   | Free    |
# | all-MiniLM-L6-v2         | 384        | OK      | Fastest| Free    |
```

Balance quality, speed, and cost based on your specific retrieval needs.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
