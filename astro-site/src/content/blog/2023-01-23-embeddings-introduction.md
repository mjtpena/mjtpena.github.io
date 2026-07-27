---
title: "Introduction to Text Embeddings with Azure OpenAI"
author: Michael John Peña
draft: false
date: 2023-01-23
tags:
  - Azure
  - OpenAI
  - Embeddings
  - AI
  - NLP

---

I wrote "Introduction to Text Embeddings with Azure OpenAI" to share practical, production-minded guidance on this topic.

## What Are Embeddings?

Embeddings are dense vector representations of text where:
- Similar meanings are close together in vector space
- Different meanings are far apart
- Relationships are captured (king - man + woman = queen)

```python
import openai
import numpy as np
from typing import List

# Get an embedding
def get_embedding(text: str, deployment: str = "text-embedding-ada-002") -> List[float]:
    """Get embedding vector for text."""
    response = openai.Embedding.create(
        engine=deployment,
        input=text
    )
    return response['data'][0]['embedding']

# Example
embedding = get_embedding("Azure is a cloud computing platform")
print(f"Dimensions: {len(embedding)}")  # 1536 for ada-002
print(f"First 5 values: {embedding[:5]}")
```

## Understanding Embedding Dimensions

Azure OpenAI's text-embedding-ada-002 produces 1536-dimensional vectors:

```python
import matplotlib.pyplot as plt
from sklearn.decomposition import PCA

def visualize_embeddings(texts: List[str], labels: List[str] = None):
    """Visualize embeddings in 2D using PCA."""
    embeddings = [get_embedding(text) for text in texts]

    # Reduce to 2D
    pca = PCA(n_components=2)
    reduced = pca.fit_transform(embeddings)

    # Plot
    plt.figure(figsize=(10, 8))
    for i, (x, y) in enumerate(reduced):
        plt.scatter(x, y)
        label = labels[i] if labels else texts[i][:20]
        plt.annotate(label, (x, y), fontsize=8)

    plt.title("Text Embeddings (2D PCA)")
    plt.xlabel("PC1")
    plt.ylabel("PC2")
    plt.show()

# Example
texts = [
    "Azure is a cloud platform",
    "AWS is Amazon's cloud service",
    "Google Cloud Platform offers cloud computing",
    "Python is a programming language",
    "JavaScript runs in browsers",
    "Machine learning uses data to learn patterns"
]

visualize_embeddings(texts)
# Cloud platforms cluster together, programming languages cluster together
```

## Similarity Calculations

```python
from typing import Tuple
import numpy as np

def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Calculate cosine similarity between two vectors."""
    a = np.array(a)
    b = np.array(b)
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

def euclidean_distance(a: List[float], b: List[float]) -> float:
    """Calculate Euclidean distance between two vectors."""
    return np.linalg.norm(np.array(a) - np.array(b))

def dot_product(a: List[float], b: List[float]) -> float:
    """Calculate dot product (works well with normalized vectors)."""
    return np.dot(a, b)

class SimilarityCalculator:
    """Calculate and compare text similarities."""

    def __init__(self, deployment: str = "text-embedding-ada-002"):
        self.deployment = deployment
        self.cache = {}

    def get_embedding(self, text: str) -> List[float]:
        """Get embedding with caching."""
        if text not in self.cache:
            self.cache[text] = get_embedding(text, self.deployment)
        return self.cache[text]

    def similarity(self, text1: str, text2: str) -> float:
        """Calculate similarity between two texts."""
        emb1 = self.get_embedding(text1)
        emb2 = self.get_embedding(text2)
        return cosine_similarity(emb1, emb2)

    def rank_by_similarity(
        self,
        query: str,
        documents: List[str],
        top_k: int = 5
    ) -> List[Tuple[str, float]]:
        """Rank documents by similarity to query."""
        query_emb = self.get_embedding(query)

        scored = []
        for doc in documents:
            doc_emb = self.get_embedding(doc)
            score = cosine_similarity(query_emb, doc_emb)
            scored.append((doc, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return scored[:top_k]

# Usage
calc = SimilarityCalculator()

# Compare two sentences
sim = calc.similarity(
    "The quick brown fox jumps over the lazy dog",
    "A fast auburn fox leaps above a sleepy canine"
)
print(f"Similarity: {sim:.4f}")  # High similarity (same meaning)

sim2 = calc.similarity(
    "The quick brown fox jumps over the lazy dog",
    "Azure provides cloud computing services"
)
print(f"Similarity: {sim2:.4f}")  # Low similarity (different topics)
```

## Batch Processing

Efficiently embed many documents:

```python
from typing import List, Dict
import time

class BatchEmbedder:
    """Efficient batch embedding with rate limiting."""

    def __init__(
        self,
        deployment: str = "text-embedding-ada-002",
        batch_size: int = 100,
        requests_per_minute: int = 60
    ):
        self.deployment = deployment
        self.batch_size = batch_size
        self.min_interval = 60.0 / requests_per_minute

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """Embed a batch of texts."""
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
        all_embeddings = []
        total_batches = (len(texts) + self.batch_size - 1) // self.batch_size

        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i + self.batch_size]
            batch_num = i // self.batch_size + 1

            if show_progress:
                print(f"Processing batch {batch_num}/{total_batches}")

            start_time = time.time()
            embeddings = self.embed_batch(batch)
            all_embeddings.extend(embeddings)

            # Rate limiting
            elapsed = time.time() - start_time
            if elapsed < self.min_interval:
                time.sleep(self.min_interval - elapsed)

        return all_embeddings

    def embed_with_metadata(
        self,
        documents: List[Dict]
    ) -> List[Dict]:
        """Embed documents and add embeddings to metadata."""
        texts = [doc.get('text', doc.get('content', '')) for doc in documents]
        embeddings = self.embed_all(texts)

        results = []
        for doc, emb in zip(documents, embeddings):
            result = doc.copy()
            result['embedding'] = emb
            results.append(result)

        return results

# Usage
embedder = BatchEmbedder()

documents = [
    {"id": 1, "text": "Azure Virtual Machines provide scalable computing"},
    {"id": 2, "text": "Azure Functions is a serverless compute service"},
    {"id": 3, "text": "Azure Cosmos DB is a globally distributed database"},
    # ... many more documents
]

embedded_docs = embedder.embed_with_metadata(documents)
print(f"Embedded {len(embedded_docs)} documents")
```

## Building a Simple Semantic Search

```python
from dataclasses import dataclass
from typing import List, Optional
import json

@dataclass
class SearchResult:
    """A search result."""
    document: dict
    score: float
    rank: int

class SimpleSemanticSearch:
    """Simple in-memory semantic search."""

    def __init__(self, deployment: str = "text-embedding-ada-002"):
        self.deployment = deployment
        self.documents: List[dict] = []
        self.embeddings: List[List[float]] = []

    def add_documents(self, documents: List[dict], text_field: str = "text"):
        """Add documents to the index."""
        embedder = BatchEmbedder(self.deployment)

        for doc in documents:
            text = doc.get(text_field, "")
            embedding = get_embedding(text, self.deployment)

            self.documents.append(doc)
            self.embeddings.append(embedding)

    def search(
        self,
        query: str,
        top_k: int = 5,
        threshold: Optional[float] = None
    ) -> List[SearchResult]:
        """Search for similar documents."""
        query_embedding = get_embedding(query, self.deployment)

        # Calculate similarities
        scores = []
        for i, doc_emb in enumerate(self.embeddings):
            score = cosine_similarity(query_embedding, doc_emb)
            scores.append((i, score))

        # Sort by score
        scores.sort(key=lambda x: x[1], reverse=True)

        # Filter and limit
        results = []
        for rank, (idx, score) in enumerate(scores[:top_k], 1):
            if threshold and score < threshold:
                continue

            results.append(SearchResult(
                document=self.documents[idx],
                score=score,
                rank=rank
            ))

        return results

    def save_index(self, filepath: str):
        """Save index to file."""
        data = {
            "documents": self.documents,
            "embeddings": self.embeddings
        }
        with open(filepath, 'w') as f:
            json.dump(data, f)

    def load_index(self, filepath: str):
        """Load index from file."""
        with open(filepath, 'r') as f:
            data = json.load(f)
        self.documents = data["documents"]
        self.embeddings = data["embeddings"]

# Usage
search = SimpleSemanticSearch()

# Add documents
docs = [
    {"id": 1, "title": "VM Guide", "text": "Azure Virtual Machines are IaaS compute resources"},
    {"id": 2, "title": "Functions Guide", "text": "Azure Functions lets you run code without servers"},
    {"id": 3, "title": "Cosmos DB Guide", "text": "Cosmos DB is a NoSQL database with global distribution"},
    {"id": 4, "title": "SQL Guide", "text": "Azure SQL Database is a managed relational database"},
    {"id": 5, "title": "Blob Storage", "text": "Azure Blob Storage stores unstructured data objects"}
]

search.add_documents(docs)

# Search
results = search.search("serverless computing", top_k=3)
for r in results:
    print(f"{r.rank}. {r.document['title']} (score: {r.score:.4f})")
```

## Embedding Use Cases

```python
# 1. Document deduplication
def find_duplicates(documents: List[str], threshold: float = 0.95) -> List[Tuple[int, int]]:
    """Find near-duplicate documents."""
    embeddings = [get_embedding(doc) for doc in documents]
    duplicates = []

    for i in range(len(embeddings)):
        for j in range(i + 1, len(embeddings)):
            sim = cosine_similarity(embeddings[i], embeddings[j])
            if sim >= threshold:
                duplicates.append((i, j))

    return duplicates

# 2. Text clustering
from sklearn.cluster import KMeans

def cluster_documents(documents: List[str], n_clusters: int = 5) -> List[int]:
    """Cluster documents by semantic similarity."""
    embeddings = [get_embedding(doc) for doc in documents]

    kmeans = KMeans(n_clusters=n_clusters, random_state=42)
    labels = kmeans.fit_predict(embeddings)

    return labels.tolist()

# 3. Anomaly detection
def find_outliers(documents: List[str], threshold: float = 0.5) -> List[int]:
    """Find documents that are outliers (dissimilar to others)."""
    embeddings = [get_embedding(doc) for doc in documents]

    # Calculate average similarity to all other documents
    outlier_indices = []

    for i, emb in enumerate(embeddings):
        similarities = [
            cosine_similarity(emb, other)
            for j, other in enumerate(embeddings)
            if i != j
        ]
        avg_sim = np.mean(similarities)

        if avg_sim < threshold:
            outlier_indices.append(i)

    return outlier_indices
```

## Best Practices

1. **Cache embeddings**: Embedding generation is slow and costs tokens
2. **Batch requests**: Process multiple texts in one API call
3. **Normalize vectors**: For faster dot product similarity
4. **Choose the right model**: ada-002 balances quality and cost
5. **Handle long text**: Chunk or summarize texts over 8191 tokens
6. **Monitor costs**: Track token usage for embedding calls

## Resources

- [Azure OpenAI Embeddings](https://learn.microsoft.com/azure/cognitive-services/openai/concepts/understand-embeddings)
- [OpenAI Embeddings Guide](https://platform.openai.com/docs/guides/embeddings)
- [Embedding Use Cases](https://platform.openai.com/docs/guides/embeddings/use-cases)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
