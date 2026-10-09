---
title: "Building Semantic Search with Azure OpenAI Embeddings"
author: Michael John Peña
draft: false
date: 2023-01-24
tags:
  - Azure
  - OpenAI
  - Embeddings
  - Semantic Search
  - AI
---

## The Problem with Keyword Search

```python
# Keyword search limitations
documents = [
    "Azure provides cloud computing services",
    "Microsoft's cloud platform offers IaaS and PaaS",
    "The sky is blue with white clouds"
]

query = "cloud hosting solutions"

# Keyword matching would miss document 2 (no "cloud" in query)
# and might incorrectly match document 3 (has "cloud" but wrong context)
```

## Semantic Search Architecture

```
User Query → Embed Query → Vector Similarity → Rank Results → Return Documents
     ↓                            ↑
Documents → Embed Docs → Store Vectors (Index)
```

## Building the Search Engine

```python
import openai
import numpy as np
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any
from datetime import datetime
import json
import hashlib

@dataclass
class Document:
    """A searchable document."""
    id: str
    content: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    embedding: Optional[List[float]] = None
    created_at: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "content": self.content,
            "metadata": self.metadata,
            "embedding": self.embedding,
            "created_at": self.created_at.isoformat()
        }

@dataclass
class SearchResult:
    """A search result with score."""
    document: Document
    score: float
    rank: int

class SemanticSearchEngine:
    """Production-ready semantic search engine."""

    def __init__(
        self,
        embedding_deployment: str = "text-embedding-ada-002",
        similarity_metric: str = "cosine"
    ):
        self.embedding_deployment = embedding_deployment
        self.similarity_metric = similarity_metric
        self.documents: Dict[str, Document] = {}
        self._embedding_cache: Dict[str, List[float]] = {}

    def _get_embedding(self, text: str) -> List[float]:
        """Get embedding with caching."""
        cache_key = hashlib.md5(text.encode()).hexdigest()

        if cache_key not in self._embedding_cache:
            response = openai.Embedding.create(
                engine=self.embedding_deployment,
                input=text
            )
            self._embedding_cache[cache_key] = response['data'][0]['embedding']

        return self._embedding_cache[cache_key]

    def _calculate_similarity(self, a: List[float], b: List[float]) -> float:
        """Calculate similarity between vectors."""
        a = np.array(a)
        b = np.array(b)

        if self.similarity_metric == "cosine":
            return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))
        elif self.similarity_metric == "dot":
            return np.dot(a, b)
        elif self.similarity_metric == "euclidean":
            return -np.linalg.norm(a - b)  # Negative so higher is better
        else:
            raise ValueError(f"Unknown metric: {self.similarity_metric}")

    def add_document(self, doc: Document) -> str:
        """Add a single document to the index."""
        if doc.embedding is None:
            doc.embedding = self._get_embedding(doc.content)

        self.documents[doc.id] = doc
        return doc.id

    def add_documents(self, docs: List[Document], batch_size: int = 100):
        """Add multiple documents with batch embedding."""
        # Separate docs that need embedding
        needs_embedding = [d for d in docs if d.embedding is None]
        has_embedding = [d for d in docs if d.embedding is not None]

        # Batch embed
        for i in range(0, len(needs_embedding), batch_size):
            batch = needs_embedding[i:i + batch_size]
            texts = [d.content for d in batch]

            response = openai.Embedding.create(
                engine=self.embedding_deployment,
                input=texts
            )

            for doc, emb_data in zip(batch, response['data']):
                doc.embedding = emb_data['embedding']

        # Add all documents
        for doc in docs:
            self.documents[doc.id] = doc

    def search(
        self,
        query: str,
        top_k: int = 10,
        filters: Optional[Dict[str, Any]] = None,
        min_score: Optional[float] = None
    ) -> List[SearchResult]:
        """Search for documents similar to query."""
        query_embedding = self._get_embedding(query)

        # Calculate scores
        scored_docs = []
        for doc_id, doc in self.documents.items():
            # Apply metadata filters
            if filters:
                skip = False
                for key, value in filters.items():
                    if doc.metadata.get(key) != value:
                        skip = True
                        break
                if skip:
                    continue

            score = self._calculate_similarity(query_embedding, doc.embedding)

            # Apply minimum score filter
            if min_score and score < min_score:
                continue

            scored_docs.append((doc, score))

        # Sort by score
        scored_docs.sort(key=lambda x: x[1], reverse=True)

        # Build results
        results = []
        for rank, (doc, score) in enumerate(scored_docs[:top_k], 1):
            results.append(SearchResult(document=doc, score=score, rank=rank))

        return results

    def find_similar(
        self,
        doc_id: str,
        top_k: int = 5,
        exclude_self: bool = True
    ) -> List[SearchResult]:
        """Find documents similar to a given document."""
        if doc_id not in self.documents:
            raise ValueError(f"Document {doc_id} not found")

        source_doc = self.documents[doc_id]

        scored_docs = []
        for other_id, other_doc in self.documents.items():
            if exclude_self and other_id == doc_id:
                continue

            score = self._calculate_similarity(source_doc.embedding, other_doc.embedding)
            scored_docs.append((other_doc, score))

        scored_docs.sort(key=lambda x: x[1], reverse=True)

        return [
            SearchResult(document=doc, score=score, rank=rank)
            for rank, (doc, score) in enumerate(scored_docs[:top_k], 1)
        ]

    def delete_document(self, doc_id: str) -> bool:
        """Delete a document from the index."""
        if doc_id in self.documents:
            del self.documents[doc_id]
            return True
        return False

    def save_index(self, filepath: str):
        """Save the index to a file."""
        data = {
            "documents": {
                doc_id: doc.to_dict()
                for doc_id, doc in self.documents.items()
            },
            "config": {
                "embedding_deployment": self.embedding_deployment,
                "similarity_metric": self.similarity_metric
            }
        }

        with open(filepath, 'w') as f:
            json.dump(data, f)

    def load_index(self, filepath: str):
        """Load an index from a file."""
        with open(filepath, 'r') as f:
            data = json.load(f)

        self.embedding_deployment = data["config"]["embedding_deployment"]
        self.similarity_metric = data["config"]["similarity_metric"]

        for doc_id, doc_data in data["documents"].items():
            self.documents[doc_id] = Document(
                id=doc_data["id"],
                content=doc_data["content"],
                metadata=doc_data["metadata"],
                embedding=doc_data["embedding"],
                created_at=datetime.fromisoformat(doc_data["created_at"])
            )

    def get_stats(self) -> dict:
        """Get index statistics."""
        return {
            "document_count": len(self.documents),
            "embedding_dimensions": len(next(iter(self.documents.values())).embedding) if self.documents else 0,
            "cache_size": len(self._embedding_cache)
        }
```

## Using the Search Engine

```python
# Initialize
engine = SemanticSearchEngine()

# Add documents
docs = [
    Document(
        id="doc1",
        content="Azure Virtual Machines provide IaaS compute resources in the cloud",
        metadata={"category": "compute", "service": "VM"}
    ),
    Document(
        id="doc2",
        content="Azure Functions is a serverless compute service that runs code on-demand",
        metadata={"category": "compute", "service": "Functions"}
    ),
    Document(
        id="doc3",
        content="Azure Cosmos DB is a globally distributed NoSQL database service",
        metadata={"category": "database", "service": "CosmosDB"}
    ),
    Document(
        id="doc4",
        content="Azure Blob Storage provides scalable object storage for unstructured data",
        metadata={"category": "storage", "service": "Blob"}
    ),
    Document(
        id="doc5",
        content="Azure Kubernetes Service simplifies deploying and managing containerized applications",
        metadata={"category": "compute", "service": "AKS"}
    )
]

engine.add_documents(docs)

# Search
results = engine.search("serverless computing", top_k=3)
for r in results:
    print(f"{r.rank}. [{r.score:.4f}] {r.document.content[:60]}...")

# Search with filters
compute_results = engine.search(
    "database for high throughput",
    filters={"category": "database"}
)

# Find similar documents
similar = engine.find_similar("doc2", top_k=3)
```

## Improving Search Quality

### Hybrid Search

Combine semantic search with keyword matching:

```python
from rank_bm25 import BM25Okapi

class HybridSearchEngine(SemanticSearchEngine):
    """Hybrid search combining semantic and keyword matching."""

    def __init__(self, semantic_weight: float = 0.7, **kwargs):
        super().__init__(**kwargs)
        self.semantic_weight = semantic_weight
        self.keyword_weight = 1 - semantic_weight
        self._bm25 = None
        self._tokenized_corpus = []

    def _tokenize(self, text: str) -> List[str]:
        """Simple tokenization."""
        return text.lower().split()

    def _rebuild_bm25(self):
        """Rebuild BM25 index."""
        self._tokenized_corpus = [
            self._tokenize(doc.content)
            for doc in self.documents.values()
        ]
        self._bm25 = BM25Okapi(self._tokenized_corpus)

    def add_documents(self, docs: List[Document], **kwargs):
        super().add_documents(docs, **kwargs)
        self._rebuild_bm25()

    def search(
        self,
        query: str,
        top_k: int = 10,
        **kwargs
    ) -> List[SearchResult]:
        # Semantic search
        semantic_results = super().search(query, top_k=len(self.documents), **kwargs)
        semantic_scores = {r.document.id: r.score for r in semantic_results}

        # Keyword search
        tokenized_query = self._tokenize(query)
        bm25_scores = self._bm25.get_scores(tokenized_query)

        # Normalize BM25 scores
        max_bm25 = max(bm25_scores) if max(bm25_scores) > 0 else 1
        bm25_scores = bm25_scores / max_bm25

        doc_ids = list(self.documents.keys())
        keyword_scores = {doc_ids[i]: bm25_scores[i] for i in range(len(doc_ids))}

        # Combine scores
        combined_scores = {}
        for doc_id in self.documents:
            semantic = semantic_scores.get(doc_id, 0)
            keyword = keyword_scores.get(doc_id, 0)
            combined_scores[doc_id] = (
                self.semantic_weight * semantic +
                self.keyword_weight * keyword
            )

        # Sort and return
        sorted_docs = sorted(combined_scores.items(), key=lambda x: x[1], reverse=True)

        results = []
        for rank, (doc_id, score) in enumerate(sorted_docs[:top_k], 1):
            results.append(SearchResult(
                document=self.documents[doc_id],
                score=score,
                rank=rank
            ))

        return results
```

### Query Expansion

Expand queries for better recall:

```python
class QueryExpander:
    """Expand queries using LLM."""

    def __init__(self, chat_deployment: str = "gpt-35-turbo"):
        self.chat_deployment = chat_deployment

    def expand_query(self, query: str, n_expansions: int = 3) -> List[str]:
        """Generate query variations."""
        prompt = f"""Generate {n_expansions} alternative ways to search for:
"{query}"

Return only the alternative queries, one per line."""

        response = openai.ChatCompletion.create(
            engine=self.chat_deployment,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7
        )

        expansions = response.choices[0].message.content.strip().split('\n')
        return [query] + [e.strip() for e in expansions if e.strip()]

class ExpandedSearchEngine(SemanticSearchEngine):
    """Search engine with query expansion."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.expander = QueryExpander()

    def search(
        self,
        query: str,
        top_k: int = 10,
        expand: bool = True,
        **kwargs
    ) -> List[SearchResult]:
        if not expand:
            return super().search(query, top_k, **kwargs)

        # Expand query
        queries = self.expander.expand_query(query)

        # Search with all queries
        all_results = {}
        for q in queries:
            results = super().search(q, top_k=top_k * 2, **kwargs)
            for r in results:
                if r.document.id not in all_results:
                    all_results[r.document.id] = r
                else:
                    # Keep higher score
                    if r.score > all_results[r.document.id].score:
                        all_results[r.document.id] = r

        # Re-rank by score
        sorted_results = sorted(all_results.values(), key=lambda x: x.score, reverse=True)

        # Re-assign ranks
        return [
            SearchResult(r.document, r.score, rank)
            for rank, r in enumerate(sorted_results[:top_k], 1)
        ]
```

## Performance Optimization

```python
import faiss
import numpy as np

class FAISSSearchEngine:
    """High-performance search using FAISS."""

    def __init__(self, embedding_dim: int = 1536):
        self.embedding_dim = embedding_dim
        self.index = faiss.IndexFlatIP(embedding_dim)  # Inner product for cosine sim
        self.documents: List[Document] = []

    def _normalize(self, embeddings: np.ndarray) -> np.ndarray:
        """Normalize vectors for cosine similarity with dot product."""
        norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
        return embeddings / norms

    def add_documents(self, docs: List[Document]):
        """Add documents to FAISS index."""
        embeddings = []
        for doc in docs:
            if doc.embedding is None:
                doc.embedding = get_embedding(doc.content)
            embeddings.append(doc.embedding)
            self.documents.append(doc)

        embeddings = np.array(embeddings, dtype=np.float32)
        embeddings = self._normalize(embeddings)
        self.index.add(embeddings)

    def search(self, query: str, top_k: int = 10) -> List[SearchResult]:
        """Search using FAISS."""
        query_emb = np.array([get_embedding(query)], dtype=np.float32)
        query_emb = self._normalize(query_emb)

        scores, indices = self.index.search(query_emb, top_k)

        results = []
        for rank, (score, idx) in enumerate(zip(scores[0], indices[0]), 1):
            if idx >= 0:  # FAISS returns -1 for empty slots
                results.append(SearchResult(
                    document=self.documents[idx],
                    score=float(score),
                    rank=rank
                ))

        return results
```

## Best Practices

1. **Pre-compute embeddings**: Don't embed at query time for documents
2. **Use appropriate chunk sizes**: Split long documents
3. **Implement hybrid search**: Combine semantic and keyword
4. **Cache embeddings**: Both queries and documents
5. **Use vector databases**: For large-scale deployments
6. **Monitor search quality**: Track relevance metrics

## Resources

- [FAISS Library](https://github.com/facebookresearch/faiss)
- [Azure Cognitive Search](https://learn.microsoft.com/azure/search/vector-search-overview)
- [Embedding Best Practices](https://platform.openai.com/docs/guides/embeddings/what-are-embeddings)
