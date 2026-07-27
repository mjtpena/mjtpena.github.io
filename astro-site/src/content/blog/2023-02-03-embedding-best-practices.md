---
title: "Embedding Best Practices for Production AI Systems"
author: Michael John Peña
draft: false
date: 2023-02-03
tags:
  - Azure
  - OpenAI
  - Embeddings
  - Best Practices
  - AI

---

I wrote "Embedding Best Practices for Production AI Systems" to share practical, production-minded guidance on this topic.

## Choosing the Right Model

```python
EMBEDDING_MODELS = {
    "text-embedding-ada-002": {
        "provider": "OpenAI/Azure",
        "dimensions": 1536,
        "max_tokens": 8191,
        "cost": "$0.0001/1K tokens",
        "quality": "Excellent",
        "speed": "Fast",
        "best_for": "General purpose, production"
    },
    "text-embedding-3-small": {
        "provider": "OpenAI",
        "dimensions": 1536,
        "max_tokens": 8191,
        "cost": "$0.00002/1K tokens",
        "quality": "Good",
        "speed": "Very fast",
        "best_for": "Cost-sensitive, high volume"
    },
    "text-embedding-3-large": {
        "provider": "OpenAI",
        "dimensions": 3072,
        "max_tokens": 8191,
        "cost": "$0.00013/1K tokens",
        "quality": "Excellent+",
        "speed": "Fast",
        "best_for": "Highest quality needs"
    }
}

def recommend_model(requirements: dict) -> str:
    """Recommend embedding model based on requirements."""
    if requirements.get("budget") == "low":
        return "text-embedding-3-small"
    if requirements.get("quality") == "highest":
        return "text-embedding-3-large"
    return "text-embedding-ada-002"
```

## Text Preprocessing

```python
import re
from typing import Optional

class TextPreprocessor:
    """Preprocess text before embedding."""

    def __init__(
        self,
        lowercase: bool = False,
        remove_urls: bool = True,
        remove_emails: bool = True,
        normalize_whitespace: bool = True,
        max_length: Optional[int] = None
    ):
        self.lowercase = lowercase
        self.remove_urls = remove_urls
        self.remove_emails = remove_emails
        self.normalize_whitespace = normalize_whitespace
        self.max_length = max_length

    def process(self, text: str) -> str:
        """Apply all preprocessing steps."""
        if self.remove_urls:
            text = re.sub(r'https?://\S+|www\.\S+', '[URL]', text)

        if self.remove_emails:
            text = re.sub(r'\S+@\S+', '[EMAIL]', text)

        if self.normalize_whitespace:
            text = re.sub(r'\s+', ' ', text)
            text = text.strip()

        if self.lowercase:
            text = text.lower()

        if self.max_length and len(text) > self.max_length:
            text = text[:self.max_length]

        return text

# Usage
preprocessor = TextPreprocessor(
    remove_urls=True,
    normalize_whitespace=True,
    max_length=8000  # Leave room for tokens
)

clean_text = preprocessor.process(raw_text)
```

## Batching for Efficiency

```python
from typing import List
import time

class BatchEmbedder:
    """Efficient batch embedding with rate limiting."""

    def __init__(
        self,
        deployment: str = "text-embedding-ada-002",
        batch_size: int = 100,
        max_tokens_per_batch: int = 8000,
        requests_per_minute: int = 60
    ):
        self.deployment = deployment
        self.batch_size = batch_size
        self.max_tokens_per_batch = max_tokens_per_batch
        self.min_interval = 60.0 / requests_per_minute

    def estimate_tokens(self, text: str) -> int:
        """Rough token estimate."""
        return len(text) // 4

    def create_batches(self, texts: List[str]) -> List[List[str]]:
        """Create batches respecting size and token limits."""
        batches = []
        current_batch = []
        current_tokens = 0

        for text in texts:
            tokens = self.estimate_tokens(text)

            if len(current_batch) >= self.batch_size or \
               current_tokens + tokens > self.max_tokens_per_batch:
                if current_batch:
                    batches.append(current_batch)
                current_batch = [text]
                current_tokens = tokens
            else:
                current_batch.append(text)
                current_tokens += tokens

        if current_batch:
            batches.append(current_batch)

        return batches

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Embed a single batch."""
        response = openai.Embedding.create(
            engine=self.deployment,
            input=texts
        )
        return [item['embedding'] for item in response['data']]

    def embed_all(
        self,
        texts: List[str],
        show_progress: bool = True
    ) -> List[List[float]]:
        """Embed all texts with batching and rate limiting."""
        batches = self.create_batches(texts)
        all_embeddings = []

        for i, batch in enumerate(batches):
            if show_progress:
                print(f"Processing batch {i+1}/{len(batches)}")

            start_time = time.time()
            embeddings = self.embed_batch(batch)
            all_embeddings.extend(embeddings)

            # Rate limiting
            elapsed = time.time() - start_time
            if elapsed < self.min_interval:
                time.sleep(self.min_interval - elapsed)

        return all_embeddings
```

## Caching Embeddings

```python
import hashlib
import json
from typing import Optional, Dict
import redis

class EmbeddingCache:
    """Cache embeddings to avoid recomputation."""

    def __init__(
        self,
        redis_url: str = "redis://localhost:6379",
        ttl_seconds: int = 86400 * 30,  # 30 days
        prefix: str = "emb:"
    ):
        self.redis = redis.from_url(redis_url)
        self.ttl = ttl_seconds
        self.prefix = prefix

    def _hash_text(self, text: str, model: str) -> str:
        """Create cache key from text and model."""
        content = f"{model}:{text}"
        return self.prefix + hashlib.sha256(content.encode()).hexdigest()

    def get(self, text: str, model: str) -> Optional[List[float]]:
        """Get cached embedding."""
        key = self._hash_text(text, model)
        cached = self.redis.get(key)

        if cached:
            return json.loads(cached)
        return None

    def set(self, text: str, model: str, embedding: List[float]):
        """Cache an embedding."""
        key = self._hash_text(text, model)
        self.redis.setex(
            key,
            self.ttl,
            json.dumps(embedding)
        )

    def get_or_compute(
        self,
        text: str,
        model: str,
        compute_fn: callable
    ) -> List[float]:
        """Get from cache or compute and cache."""
        cached = self.get(text, model)
        if cached:
            return cached

        embedding = compute_fn(text)
        self.set(text, model, embedding)
        return embedding

class CachedEmbedder:
    """Embedder with caching."""

    def __init__(self, cache: EmbeddingCache, deployment: str):
        self.cache = cache
        self.deployment = deployment

    def embed(self, text: str) -> List[float]:
        """Embed with caching."""
        def compute(t):
            response = openai.Embedding.create(
                engine=self.deployment,
                input=t
            )
            return response['data'][0]['embedding']

        return self.cache.get_or_compute(text, self.deployment, compute)
```

## Handling Long Texts

```python
import numpy as np
from typing import List

class LongTextEmbedder:
    """Handle texts longer than model max tokens."""

    def __init__(
        self,
        deployment: str = "text-embedding-ada-002",
        max_tokens: int = 8191,
        chunk_overlap: int = 100
    ):
        self.deployment = deployment
        self.max_tokens = max_tokens
        self.chunk_overlap = chunk_overlap

    def estimate_tokens(self, text: str) -> int:
        return len(text) // 4

    def chunk_text(self, text: str) -> List[str]:
        """Split text into chunks."""
        # Simple character-based chunking
        max_chars = self.max_tokens * 4
        overlap_chars = self.chunk_overlap * 4

        chunks = []
        start = 0

        while start < len(text):
            end = start + max_chars
            chunks.append(text[start:end])
            start = end - overlap_chars

        return chunks

    def embed(self, text: str) -> List[float]:
        """Embed text, handling long texts."""
        if self.estimate_tokens(text) <= self.max_tokens:
            response = openai.Embedding.create(
                engine=self.deployment,
                input=text
            )
            return response['data'][0]['embedding']

        # Chunk and average embeddings
        chunks = self.chunk_text(text)
        chunk_embeddings = []

        for chunk in chunks:
            response = openai.Embedding.create(
                engine=self.deployment,
                input=chunk
            )
            chunk_embeddings.append(response['data'][0]['embedding'])

        # Weighted average by chunk length
        weights = [len(c) for c in chunks]
        total_weight = sum(weights)
        weights = [w / total_weight for w in weights]

        avg_embedding = np.zeros(len(chunk_embeddings[0]))
        for emb, weight in zip(chunk_embeddings, weights):
            avg_embedding += np.array(emb) * weight

        return avg_embedding.tolist()
```

## Normalization

```python
import numpy as np

def normalize_embedding(embedding: List[float]) -> List[float]:
    """L2 normalize embedding for cosine similarity."""
    arr = np.array(embedding)
    norm = np.linalg.norm(arr)
    if norm > 0:
        arr = arr / norm
    return arr.tolist()

def normalize_batch(embeddings: List[List[float]]) -> List[List[float]]:
    """Normalize a batch of embeddings."""
    arr = np.array(embeddings)
    norms = np.linalg.norm(arr, axis=1, keepdims=True)
    norms = np.where(norms > 0, norms, 1)  # Avoid division by zero
    normalized = arr / norms
    return normalized.tolist()

# Note: OpenAI embeddings are already normalized
# But normalize if combining or modifying embeddings
```

## Quality Evaluation

```python
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

class EmbeddingEvaluator:
    """Evaluate embedding quality."""

    def __init__(self, embedder):
        self.embedder = embedder

    def test_similarity(
        self,
        text_pairs: List[tuple],
        expected_similar: List[bool]
    ) -> Dict:
        """Test if similar texts have similar embeddings."""
        results = []

        for (text1, text2), should_match in zip(text_pairs, expected_similar):
            emb1 = self.embedder.embed(text1)
            emb2 = self.embedder.embed(text2)
            similarity = cosine_similarity([emb1], [emb2])[0][0]
            is_similar = similarity > 0.8

            results.append({
                "text1": text1[:50],
                "text2": text2[:50],
                "similarity": similarity,
                "expected_similar": should_match,
                "correct": is_similar == should_match
            })

        accuracy = sum(r["correct"] for r in results) / len(results)
        return {"accuracy": accuracy, "results": results}

    def test_retrieval(
        self,
        queries: List[str],
        documents: List[str],
        relevance_labels: List[List[int]]  # 1 if relevant, 0 if not
    ) -> Dict:
        """Test retrieval quality."""
        doc_embeddings = [self.embedder.embed(d) for d in documents]

        mrr_sum = 0
        recall_at_5_sum = 0

        for query, labels in zip(queries, relevance_labels):
            query_emb = self.embedder.embed(query)
            similarities = cosine_similarity([query_emb], doc_embeddings)[0]

            # Get ranked indices
            ranked = np.argsort(similarities)[::-1]

            # Find first relevant doc (for MRR)
            for rank, idx in enumerate(ranked, 1):
                if labels[idx] == 1:
                    mrr_sum += 1 / rank
                    break

            # Count relevant in top 5 (for recall@5)
            top_5 = ranked[:5]
            relevant_in_top_5 = sum(labels[idx] for idx in top_5)
            total_relevant = sum(labels)
            recall_at_5_sum += relevant_in_top_5 / total_relevant if total_relevant > 0 else 0

        n_queries = len(queries)
        return {
            "mrr": mrr_sum / n_queries,
            "recall@5": recall_at_5_sum / n_queries
        }
```

## Production Checklist

```python
EMBEDDING_CHECKLIST = {
    "preprocessing": [
        "Clean and normalize text",
        "Handle special characters",
        "Remove PII if needed",
        "Truncate to model limit"
    ],
    "efficiency": [
        "Batch requests",
        "Implement caching",
        "Use rate limiting",
        "Monitor API usage"
    ],
    "quality": [
        "Evaluate on your data",
        "Test edge cases",
        "Monitor drift over time",
        "Compare model options"
    ],
    "operations": [
        "Handle errors gracefully",
        "Implement retries",
        "Log embedding metadata",
        "Track costs"
    ]
}
```

## Resources

- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [MTEB Benchmark](https://huggingface.co/spaces/mteb/leaderboard)
- [Embedding Best Practices](https://www.pinecone.io/learn/series/nlp/dense-embeddings/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
