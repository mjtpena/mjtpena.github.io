---
title: "Multi-Index RAG: Querying Across Multiple Knowledge Sources"
author: Michael John Peña
draft: false
date: 2023-10-31
description: "Implementing multi-index RAG systems to query and combine information from multiple knowledge sources."
tags:
  - RAG
  - Multi-Index
  - Knowledge Management
  - Information Retrieval
  - AI

---

I wrote "Multi-Index RAG: Querying Across Multiple Knowledge Sources" to share practical, production-minded guidance on this topic.

## Introduction

Multi-index RAG enables querying across multiple knowledge sources, each potentially using different indexing strategies or containing different types of content. This post covers architectures and techniques for building effective multi-index RAG systems.

## Multi-Index Architecture

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Callable
from abc import ABC, abstractmethod
from enum import Enum
import uuid

class IndexType(Enum):
    VECTOR = "vector"
    KEYWORD = "keyword"
    GRAPH = "graph"
    STRUCTURED = "structured"

@dataclass
class IndexConfig:
    name: str
    index_type: IndexType
    description: str
    metadata: Dict = field(default_factory=dict)

@dataclass
class MultiIndexResult:
    source_index: str
    content: str
    score: float
    metadata: Dict = field(default_factory=dict)

class BaseIndex(ABC):
    """Abstract base class for indexes"""

    def __init__(self, config: IndexConfig):
        self.config = config
        self.name = config.name

    @abstractmethod
    def add_documents(self, documents: List[str], metadatas: List[Dict] = None):
        pass

    @abstractmethod
    def query(self, query: str, top_k: int = 5) -> List[Dict]:
        pass

class VectorIndex(BaseIndex):
    """Vector similarity based index"""

    def __init__(self, config: IndexConfig, embedding_model=None):
        super().__init__(config)
        self.embedding_model = embedding_model
        self.documents = []
        self.embeddings = []
        self.metadatas = []

    def add_documents(self, documents: List[str], metadatas: List[Dict] = None):
        """Add documents to vector index"""
        for i, doc in enumerate(documents):
            embedding = self._embed(doc)
            self.documents.append(doc)
            self.embeddings.append(embedding)
            self.metadatas.append(metadatas[i] if metadatas else {})

    def query(self, query: str, top_k: int = 5) -> List[Dict]:
        """Query vector index"""
        query_embedding = self._embed(query)

        # Calculate similarities
        scored = []
        for i, emb in enumerate(self.embeddings):
            score = self._cosine_similarity(query_embedding, emb)
            scored.append((i, score))

        scored.sort(key=lambda x: x[1], reverse=True)

        results = []
        for i, score in scored[:top_k]:
            results.append({
                "content": self.documents[i],
                "score": score,
                "metadata": self.metadatas[i],
                "source_index": self.name
            })

        return results

    def _embed(self, text: str) -> List[float]:
        """Generate embedding"""
        if self.embedding_model:
            return self.embedding_model.encode(text)

        # Simple fallback embedding
        words = text.lower().split()
        embedding = [0.0] * 128
        for word in words:
            idx = hash(word) % 128
            embedding[idx] += 1
        norm = sum(x*x for x in embedding) ** 0.5
        if norm > 0:
            embedding = [x/norm for x in embedding]
        return embedding

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """Calculate cosine similarity"""
        dot = sum(x*y for x, y in zip(a, b))
        norm_a = sum(x*x for x in a) ** 0.5
        norm_b = sum(x*x for x in b) ** 0.5
        return dot / (norm_a * norm_b) if norm_a * norm_b > 0 else 0

class KeywordIndex(BaseIndex):
    """BM25/keyword based index"""

    def __init__(self, config: IndexConfig):
        super().__init__(config)
        self.documents = []
        self.metadatas = []
        self.inverted_index: Dict[str, List[int]] = {}

    def add_documents(self, documents: List[str], metadatas: List[Dict] = None):
        """Add documents to keyword index"""
        for i, doc in enumerate(documents):
            doc_idx = len(self.documents)
            self.documents.append(doc)
            self.metadatas.append(metadatas[i] if metadatas else {})

            # Build inverted index
            words = self._tokenize(doc)
            for word in set(words):
                if word not in self.inverted_index:
                    self.inverted_index[word] = []
                self.inverted_index[word].append(doc_idx)

    def query(self, query: str, top_k: int = 5) -> List[Dict]:
        """Query keyword index using BM25-like scoring"""
        query_words = self._tokenize(query)

        # Score documents
        scores = {}
        for word in query_words:
            if word in self.inverted_index:
                for doc_idx in self.inverted_index[word]:
                    if doc_idx not in scores:
                        scores[doc_idx] = 0
                    # Simple TF-IDF-like scoring
                    tf = self.documents[doc_idx].lower().count(word)
                    df = len(self.inverted_index[word])
                    idf = 1 / (1 + df)
                    scores[doc_idx] += tf * idf

        # Sort and return
        sorted_docs = sorted(scores.items(), key=lambda x: x[1], reverse=True)

        results = []
        for doc_idx, score in sorted_docs[:top_k]:
            results.append({
                "content": self.documents[doc_idx],
                "score": score,
                "metadata": self.metadatas[doc_idx],
                "source_index": self.name
            })

        return results

    def _tokenize(self, text: str) -> List[str]:
        """Simple tokenization"""
        import re
        words = re.findall(r'\w+', text.lower())
        # Remove stopwords
        stopwords = {'the', 'a', 'an', 'is', 'are', 'was', 'were', 'in', 'on', 'at', 'to', 'for'}
        return [w for w in words if w not in stopwords]
```

## Multi-Index Manager

```python
class MultiIndexManager:
    """Manage multiple indexes"""

    def __init__(self):
        self.indexes: Dict[str, BaseIndex] = {}
        self.index_configs: Dict[str, IndexConfig] = {}

    def add_index(self, index: BaseIndex):
        """Add an index to the manager"""
        self.indexes[index.name] = index
        self.index_configs[index.name] = index.config

    def remove_index(self, name: str):
        """Remove an index"""
        if name in self.indexes:
            del self.indexes[name]
            del self.index_configs[name]

    def get_index(self, name: str) -> Optional[BaseIndex]:
        """Get index by name"""
        return self.indexes.get(name)

    def list_indexes(self) -> List[Dict]:
        """List all indexes"""
        return [
            {
                "name": config.name,
                "type": config.index_type.value,
                "description": config.description
            }
            for config in self.index_configs.values()
        ]

    def query_index(
        self,
        index_name: str,
        query: str,
        top_k: int = 5
    ) -> List[Dict]:
        """Query a specific index"""
        index = self.indexes.get(index_name)
        if not index:
            return []
        return index.query(query, top_k)

    def query_all(
        self,
        query: str,
        top_k_per_index: int = 3
    ) -> Dict[str, List[Dict]]:
        """Query all indexes"""
        results = {}
        for name, index in self.indexes.items():
            results[name] = index.query(query, top_k_per_index)
        return results
```

## Query Routing

```python
class QueryRouter:
    """Route queries to appropriate indexes"""

    def __init__(
        self,
        index_manager: MultiIndexManager,
        llm_client=None
    ):
        self.manager = index_manager
        self.llm = llm_client

    def route(self, query: str) -> List[str]:
        """Determine which indexes to query"""
        if self.llm:
            return self._llm_route(query)
        return self._rule_based_route(query)

    def _rule_based_route(self, query: str) -> List[str]:
        """Rule-based query routing"""
        query_lower = query.lower()
        selected = []

        for name, config in self.manager.index_configs.items():
            # Match based on keywords in description
            desc_lower = config.description.lower()
            keywords = desc_lower.split()

            # Check for overlap
            query_words = set(query_lower.split())
            desc_words = set(keywords)

            if query_words & desc_words:
                selected.append(name)

        # If nothing matched, return all
        return selected if selected else list(self.manager.indexes.keys())

    def _llm_route(self, query: str) -> List[str]:
        """LLM-based query routing"""
        index_descriptions = "\n".join([
            f"- {config.name}: {config.description}"
            for config in self.manager.index_configs.values()
        ])

        prompt = f"""Given the following query and available knowledge sources, select which sources are most relevant.

Query: {query}

Available Sources:
{index_descriptions}

List the names of relevant sources (comma-separated):"""

        response = self.llm.generate(prompt)

        # Parse response
        selected = []
        for name in self.manager.indexes.keys():
            if name.lower() in response.lower():
                selected.append(name)

        return selected if selected else list(self.manager.indexes.keys())

class SmartRouter:
    """Advanced router with query analysis"""

    def __init__(
        self,
        index_manager: MultiIndexManager,
        llm_client=None
    ):
        self.manager = index_manager
        self.llm = llm_client
        self.query_history: List[Dict] = []

    def route_with_strategy(
        self,
        query: str,
        strategy: str = "balanced"
    ) -> Dict:
        """Route with specified strategy"""
        if strategy == "all":
            return self._route_all()
        elif strategy == "single_best":
            return self._route_single_best(query)
        elif strategy == "balanced":
            return self._route_balanced(query)
        elif strategy == "cascade":
            return self._route_cascade(query)
        else:
            return self._route_all()

    def _route_all(self) -> Dict:
        """Route to all indexes"""
        return {
            "indexes": list(self.manager.indexes.keys()),
            "strategy": "all",
            "weights": {n: 1.0 for n in self.manager.indexes.keys()}
        }

    def _route_single_best(self, query: str) -> Dict:
        """Route to single best index"""
        scores = {}

        for name, config in self.manager.index_configs.items():
            score = self._estimate_relevance(query, config)
            scores[name] = score

        best = max(scores, key=scores.get)

        return {
            "indexes": [best],
            "strategy": "single_best",
            "weights": {best: 1.0},
            "scores": scores
        }

    def _route_balanced(self, query: str) -> Dict:
        """Route to relevant indexes with weights"""
        scores = {}

        for name, config in self.manager.index_configs.items():
            score = self._estimate_relevance(query, config)
            scores[name] = score

        # Select indexes above threshold
        threshold = max(scores.values()) * 0.5
        selected = [n for n, s in scores.items() if s >= threshold]

        # Normalize weights
        total = sum(scores[n] for n in selected)
        weights = {n: scores[n] / total for n in selected}

        return {
            "indexes": selected,
            "strategy": "balanced",
            "weights": weights,
            "scores": scores
        }

    def _route_cascade(self, query: str) -> Dict:
        """Route in cascade order"""
        scores = {}

        for name, config in self.manager.index_configs.items():
            score = self._estimate_relevance(query, config)
            scores[name] = score

        # Sort by score
        ordered = sorted(scores.keys(), key=lambda n: scores[n], reverse=True)

        return {
            "indexes": ordered,
            "strategy": "cascade",
            "weights": {n: 1.0 / (i + 1) for i, n in enumerate(ordered)},
            "order": ordered
        }

    def _estimate_relevance(self, query: str, config: IndexConfig) -> float:
        """Estimate relevance of index for query"""
        query_words = set(query.lower().split())
        desc_words = set(config.description.lower().split())
        name_words = set(config.name.lower().replace("_", " ").split())

        # Calculate overlap
        overlap = len(query_words & (desc_words | name_words))
        return overlap / max(len(query_words), 1)
```

## Result Fusion

```python
class ResultFusion:
    """Fuse results from multiple indexes"""

    def __init__(self, k: int = 60):
        self.k = k  # RRF parameter

    def reciprocal_rank_fusion(
        self,
        results_by_index: Dict[str, List[Dict]],
        weights: Dict[str, float] = None
    ) -> List[Dict]:
        """Combine results using RRF"""
        rrf_scores = {}
        all_docs = {}

        for index_name, results in results_by_index.items():
            weight = weights.get(index_name, 1.0) if weights else 1.0

            for rank, result in enumerate(results):
                # Create unique ID for document
                doc_id = hash(result["content"][:100])

                if doc_id not in all_docs:
                    all_docs[doc_id] = result

                # RRF score
                rrf = weight / (self.k + rank + 1)
                rrf_scores[doc_id] = rrf_scores.get(doc_id, 0) + rrf

        # Sort by RRF score
        sorted_docs = sorted(
            rrf_scores.items(),
            key=lambda x: x[1],
            reverse=True
        )

        # Build result list
        fused = []
        for doc_id, score in sorted_docs:
            doc = all_docs[doc_id].copy()
            doc["fused_score"] = score
            fused.append(doc)

        return fused

    def weighted_score_fusion(
        self,
        results_by_index: Dict[str, List[Dict]],
        weights: Dict[str, float]
    ) -> List[Dict]:
        """Combine results using weighted scores"""
        combined_scores = {}
        all_docs = {}

        for index_name, results in results_by_index.items():
            weight = weights.get(index_name, 1.0)

            # Normalize scores within index
            scores = [r["score"] for r in results]
            max_score = max(scores) if scores else 1
            min_score = min(scores) if scores else 0

            for result in results:
                doc_id = hash(result["content"][:100])

                if doc_id not in all_docs:
                    all_docs[doc_id] = result

                # Normalize and weight
                if max_score > min_score:
                    normalized = (result["score"] - min_score) / (max_score - min_score)
                else:
                    normalized = 1.0

                weighted_score = normalized * weight
                combined_scores[doc_id] = combined_scores.get(doc_id, 0) + weighted_score

        # Sort and return
        sorted_docs = sorted(
            combined_scores.items(),
            key=lambda x: x[1],
            reverse=True
        )

        fused = []
        for doc_id, score in sorted_docs:
            doc = all_docs[doc_id].copy()
            doc["fused_score"] = score
            fused.append(doc)

        return fused

    def cross_encoder_rerank(
        self,
        results: List[Dict],
        query: str,
        reranker_model=None,
        top_k: int = 10
    ) -> List[Dict]:
        """Rerank fused results with cross-encoder"""
        if not reranker_model:
            return results[:top_k]

        # Score each result
        scored = []
        for result in results:
            score = reranker_model.score(query, result["content"])
            result["rerank_score"] = score
            scored.append(result)

        # Sort by rerank score
        scored.sort(key=lambda x: x["rerank_score"], reverse=True)

        return scored[:top_k]
```

## Complete Multi-Index RAG

```python
class MultiIndexRAG:
    """Complete multi-index RAG system"""

    def __init__(self, generator):
        self.manager = MultiIndexManager()
        self.router = None
        self.fusion = ResultFusion()
        self.generator = generator

    def add_vector_index(
        self,
        name: str,
        description: str,
        documents: List[str],
        metadatas: List[Dict] = None
    ):
        """Add a vector index"""
        config = IndexConfig(
            name=name,
            index_type=IndexType.VECTOR,
            description=description
        )
        index = VectorIndex(config)
        index.add_documents(documents, metadatas)
        self.manager.add_index(index)
        self._update_router()

    def add_keyword_index(
        self,
        name: str,
        description: str,
        documents: List[str],
        metadatas: List[Dict] = None
    ):
        """Add a keyword index"""
        config = IndexConfig(
            name=name,
            index_type=IndexType.KEYWORD,
            description=description
        )
        index = KeywordIndex(config)
        index.add_documents(documents, metadatas)
        self.manager.add_index(index)
        self._update_router()

    def _update_router(self):
        """Update router with current indexes"""
        self.router = SmartRouter(self.manager, self.generator)

    def query(
        self,
        question: str,
        routing_strategy: str = "balanced",
        top_k: int = 5
    ) -> Dict:
        """Query across multiple indexes"""
        if not self.router:
            return {"error": "No indexes configured"}

        # Route query
        routing = self.router.route_with_strategy(question, routing_strategy)

        # Query selected indexes
        results_by_index = {}
        for index_name in routing["indexes"]:
            results = self.manager.query_index(index_name, question, top_k)
            results_by_index[index_name] = results

        # Fuse results
        fused = self.fusion.reciprocal_rank_fusion(
            results_by_index,
            routing["weights"]
        )

        # Build context from top results
        top_results = fused[:top_k]
        context = self._build_context(top_results)

        # Generate answer
        prompt = f"""Answer the question based on information from multiple sources.

Sources:
{context}

Question: {question}

Provide a comprehensive answer:"""

        answer = self.generator.generate(prompt)

        return {
            "answer": answer,
            "routing": routing,
            "sources": [
                {
                    "index": r.get("source_index", "unknown"),
                    "score": r.get("fused_score", 0),
                    "preview": r["content"][:100] + "..."
                }
                for r in top_results
            ],
            "indexes_queried": routing["indexes"]
        }

    def _build_context(self, results: List[Dict]) -> str:
        """Build context from fused results"""
        parts = []
        for i, r in enumerate(results):
            source = r.get("source_index", "unknown")
            parts.append(f"[Source: {source}]\n{r['content']}")
        return "\n\n---\n\n".join(parts)

# Usage
class MockGenerator:
    def generate(self, prompt):
        return "Generated multi-source answer."

rag = MultiIndexRAG(MockGenerator())

# Add different knowledge sources
technical_docs = [
    "Machine learning models require training data.",
    "Neural networks have multiple layers.",
    "Deep learning is a subset of machine learning."
]

business_docs = [
    "AI improves business efficiency.",
    "Companies invest in ML for automation.",
    "ROI of AI projects varies by industry."
]

rag.add_vector_index(
    "technical_knowledge",
    "Technical documentation about ML and AI",
    technical_docs
)

rag.add_keyword_index(
    "business_knowledge",
    "Business and strategy documents about AI adoption",
    business_docs
)

# Query
result = rag.query(
    "How do companies use machine learning?",
    routing_strategy="balanced"
)

print(f"Answer: {result['answer']}")
print(f"Indexes queried: {result['indexes_queried']}")
print(f"Sources: {len(result['sources'])}")
```

## Conclusion

Multi-index RAG enables querying across heterogeneous knowledge sources, combining results intelligently for comprehensive answers. Key components include diverse index types, smart query routing, result fusion strategies, and flexible architecture. This approach is essential for enterprise RAG systems that need to leverage multiple knowledge bases, document types, and retrieval strategies.

