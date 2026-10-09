---
title: "RAG Improvements: Advanced Retrieval Techniques"
author: Michael John Peña
draft: false
date: 2023-10-25
description: "Advanced techniques for improving Retrieval-Augmented Generation systems for better accuracy and relevance."
tags:
  - RAG
  - Retrieval
  - LLM
  - Vector Search
  - AI
---

## Introduction

Retrieval-Augmented Generation (RAG) enhances LLM responses by grounding them in retrieved documents. This post covers advanced techniques for improving RAG systems including query optimization, retrieval enhancement, and context management.

## RAG Architecture Overview

```python
from dataclasses import dataclass
from typing import List, Dict, Optional
from abc import ABC, abstractmethod

@dataclass
class Document:
    id: str
    content: str
    metadata: Dict
    embedding: Optional[List[float]] = None

@dataclass
class RetrievalResult:
    documents: List[Document]
    scores: List[float]
    query: str
    retrieval_time_ms: float

class RAGPipeline:
    """Enhanced RAG pipeline"""

    def __init__(
        self,
        retriever,
        generator,
        reranker=None
    ):
        self.retriever = retriever
        self.generator = generator
        self.reranker = reranker

    def query(self, user_query: str, top_k: int = 5) -> Dict:
        """Execute RAG query"""
        # Step 1: Query transformation
        transformed_query = self._transform_query(user_query)

        # Step 2: Retrieve documents
        retrieval = self.retriever.retrieve(transformed_query, top_k=top_k * 2)

        # Step 3: Rerank if available
        if self.reranker:
            retrieval = self.reranker.rerank(user_query, retrieval, top_k=top_k)
        else:
            retrieval.documents = retrieval.documents[:top_k]
            retrieval.scores = retrieval.scores[:top_k]

        # Step 4: Generate response
        context = self._build_context(retrieval.documents)
        response = self.generator.generate(user_query, context)

        return {
            "response": response,
            "sources": [doc.id for doc in retrieval.documents],
            "relevance_scores": retrieval.scores
        }

    def _transform_query(self, query: str) -> str:
        """Transform query for better retrieval"""
        # Could include query expansion, reformulation, etc.
        return query

    def _build_context(self, documents: List[Document]) -> str:
        """Build context from retrieved documents"""
        context_parts = []
        for i, doc in enumerate(documents):
            context_parts.append(f"[Document {i+1}]\n{doc.content}")
        return "\n\n".join(context_parts)
```

## Query Optimization

```python
class QueryOptimizer:
    """Optimize queries for better retrieval"""

    def __init__(self, llm_client=None):
        self.llm = llm_client

    def expand_query(self, query: str) -> List[str]:
        """Expand query with synonyms and related terms"""
        if not self.llm:
            return [query]

        expansion_prompt = f"""Generate 3 alternative ways to ask this question.
Each should capture the same intent but use different words.

Original: {query}

Alternatives:
1."""

        response = self.llm.generate(expansion_prompt)

        # Parse response
        alternatives = [query]
        for line in response.split('\n'):
            line = line.strip()
            if line and line[0].isdigit():
                alt = line.lstrip('0123456789.').strip()
                if alt:
                    alternatives.append(alt)

        return alternatives[:4]  # Original + up to 3 alternatives

    def decompose_query(self, query: str) -> List[str]:
        """Decompose complex query into sub-queries"""
        if not self.llm:
            return [query]

        decomposition_prompt = f"""Break down this complex question into simpler sub-questions.
If the question is already simple, return just the original.

Question: {query}

Sub-questions:"""

        response = self.llm.generate(decomposition_prompt)

        sub_queries = []
        for line in response.split('\n'):
            line = line.strip()
            if line and (line[0].isdigit() or line.startswith('-')):
                sub = line.lstrip('0123456789.-').strip()
                if sub:
                    sub_queries.append(sub)

        return sub_queries if sub_queries else [query]

    def generate_hypothetical_answer(self, query: str) -> str:
        """Generate hypothetical answer for HyDE retrieval"""
        if not self.llm:
            return query

        hyde_prompt = f"""Write a short, direct answer to this question.
The answer doesn't need to be correct - just plausible and detailed.

Question: {query}

Answer:"""

        return self.llm.generate(hyde_prompt)

class MultiQueryRetriever:
    """Retrieve using multiple query variations"""

    def __init__(self, base_retriever, optimizer: QueryOptimizer):
        self.retriever = base_retriever
        self.optimizer = optimizer

    def retrieve(self, query: str, top_k: int = 5) -> RetrievalResult:
        """Retrieve using expanded queries"""
        # Get query variations
        queries = self.optimizer.expand_query(query)

        # Retrieve for each query
        all_docs = {}
        all_scores = {}

        for q in queries:
            result = self.retriever.retrieve(q, top_k=top_k)
            for doc, score in zip(result.documents, result.scores):
                if doc.id in all_docs:
                    all_scores[doc.id] = max(all_scores[doc.id], score)
                else:
                    all_docs[doc.id] = doc
                    all_scores[doc.id] = score

        # Sort by score and take top_k
        sorted_ids = sorted(all_scores.keys(), key=lambda x: all_scores[x], reverse=True)
        top_ids = sorted_ids[:top_k]

        return RetrievalResult(
            documents=[all_docs[id] for id in top_ids],
            scores=[all_scores[id] for id in top_ids],
            query=query,
            retrieval_time_ms=0
        )
```

## Reranking Strategies

```python
class Reranker(ABC):
    """Abstract reranker interface"""

    @abstractmethod
    def rerank(
        self,
        query: str,
        retrieval: RetrievalResult,
        top_k: int
    ) -> RetrievalResult:
        pass

class CrossEncoderReranker(Reranker):
    """Rerank using cross-encoder model"""

    def __init__(self, model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"):
        # In production, load actual cross-encoder
        self.model_name = model_name

    def rerank(
        self,
        query: str,
        retrieval: RetrievalResult,
        top_k: int
    ) -> RetrievalResult:
        """Rerank documents using cross-encoder"""
        # Score each document
        scored_docs = []
        for doc in retrieval.documents:
            score = self._cross_encode(query, doc.content)
            scored_docs.append((doc, score))

        # Sort by score
        scored_docs.sort(key=lambda x: x[1], reverse=True)
        top_docs = scored_docs[:top_k]

        return RetrievalResult(
            documents=[d for d, s in top_docs],
            scores=[s for d, s in top_docs],
            query=query,
            retrieval_time_ms=retrieval.retrieval_time_ms
        )

    def _cross_encode(self, query: str, document: str) -> float:
        """Score query-document pair"""
        # Placeholder - use actual cross-encoder in production
        # Simple overlap score for demonstration
        query_words = set(query.lower().split())
        doc_words = set(document.lower().split())
        overlap = len(query_words & doc_words)
        return overlap / max(len(query_words), 1)

class LLMReranker(Reranker):
    """Rerank using LLM scoring"""

    def __init__(self, llm_client):
        self.llm = llm_client

    def rerank(
        self,
        query: str,
        retrieval: RetrievalResult,
        top_k: int
    ) -> RetrievalResult:
        """Rerank using LLM relevance scoring"""
        scored_docs = []

        for doc in retrieval.documents:
            score = self._llm_score(query, doc.content)
            scored_docs.append((doc, score))

        scored_docs.sort(key=lambda x: x[1], reverse=True)
        top_docs = scored_docs[:top_k]

        return RetrievalResult(
            documents=[d for d, s in top_docs],
            scores=[s for d, s in top_docs],
            query=query,
            retrieval_time_ms=retrieval.retrieval_time_ms
        )

    def _llm_score(self, query: str, document: str) -> float:
        """Score relevance using LLM"""
        prompt = f"""Rate the relevance of this document to the query on a scale of 0-10.
Only respond with a number.

Query: {query}

Document: {document[:500]}

Relevance score (0-10):"""

        response = self.llm.generate(prompt)

        try:
            score = float(response.strip()) / 10
            return min(1.0, max(0.0, score))
        except ValueError:
            return 0.5

class CohereReranker(Reranker):
    """Rerank using Cohere Rerank API"""

    def __init__(self, api_key: str):
        import cohere
        self.client = cohere.Client(api_key)

    def rerank(
        self,
        query: str,
        retrieval: RetrievalResult,
        top_k: int
    ) -> RetrievalResult:
        """Rerank using Cohere"""
        docs_text = [doc.content for doc in retrieval.documents]

        response = self.client.rerank(
            query=query,
            documents=docs_text,
            top_n=top_k,
            model="rerank-english-v2.0"
        )

        reranked_docs = []
        reranked_scores = []

        for result in response.results:
            idx = result.index
            reranked_docs.append(retrieval.documents[idx])
            reranked_scores.append(result.relevance_score)

        return RetrievalResult(
            documents=reranked_docs,
            scores=reranked_scores,
            query=query,
            retrieval_time_ms=retrieval.retrieval_time_ms
        )
```

## Context Optimization

```python
class ContextOptimizer:
    """Optimize context for generation"""

    def __init__(self, max_tokens: int = 4000):
        self.max_tokens = max_tokens

    def optimize(
        self,
        documents: List[Document],
        scores: List[float],
        query: str
    ) -> str:
        """Optimize context within token limit"""
        # Estimate tokens per document
        total_tokens = 0
        selected_docs = []

        for doc, score in zip(documents, scores):
            doc_tokens = len(doc.content.split()) * 1.3  # Rough estimate

            if total_tokens + doc_tokens <= self.max_tokens:
                selected_docs.append(doc)
                total_tokens += doc_tokens
            else:
                # Try to include truncated version
                remaining_tokens = self.max_tokens - total_tokens
                if remaining_tokens > 100:
                    truncated = self._truncate_to_tokens(
                        doc.content,
                        int(remaining_tokens)
                    )
                    selected_docs.append(
                        Document(doc.id, truncated, doc.metadata)
                    )
                break

        return self._format_context(selected_docs)

    def _truncate_to_tokens(self, text: str, max_tokens: int) -> str:
        """Truncate text to approximate token count"""
        words = text.split()
        target_words = int(max_tokens / 1.3)
        return ' '.join(words[:target_words]) + "..."

    def _format_context(self, documents: List[Document]) -> str:
        """Format documents into context string"""
        parts = []
        for i, doc in enumerate(documents):
            source = doc.metadata.get('source', f'Document {i+1}')
            parts.append(f"[{source}]\n{doc.content}")
        return "\n\n---\n\n".join(parts)

class LostInTheMiddleMitigation:
    """Mitigate 'lost in the middle' phenomenon"""

    def reorder_documents(
        self,
        documents: List[Document],
        scores: List[float]
    ) -> List[Document]:
        """Reorder documents to place important ones at start and end"""
        if len(documents) <= 2:
            return documents

        # Sort by score
        sorted_pairs = sorted(
            zip(documents, scores),
            key=lambda x: x[1],
            reverse=True
        )

        # Place alternately at start and end
        reordered = []
        start = []
        end = []

        for i, (doc, score) in enumerate(sorted_pairs):
            if i % 2 == 0:
                start.append(doc)
            else:
                end.insert(0, doc)

        return start + end
```

## Hybrid Retrieval

```python
class HybridRetriever:
    """Combine dense and sparse retrieval"""

    def __init__(
        self,
        dense_retriever,
        sparse_retriever,
        dense_weight: float = 0.7
    ):
        self.dense = dense_retriever
        self.sparse = sparse_retriever
        self.dense_weight = dense_weight
        self.sparse_weight = 1 - dense_weight

    def retrieve(self, query: str, top_k: int = 5) -> RetrievalResult:
        """Hybrid retrieval combining dense and sparse"""
        # Retrieve from both
        dense_results = self.dense.retrieve(query, top_k=top_k * 2)
        sparse_results = self.sparse.retrieve(query, top_k=top_k * 2)

        # Normalize scores
        dense_scores = self._normalize_scores(dense_results.scores)
        sparse_scores = self._normalize_scores(sparse_results.scores)

        # Combine results
        all_docs = {}
        combined_scores = {}

        for doc, score in zip(dense_results.documents, dense_scores):
            all_docs[doc.id] = doc
            combined_scores[doc.id] = score * self.dense_weight

        for doc, score in zip(sparse_results.documents, sparse_scores):
            if doc.id in combined_scores:
                combined_scores[doc.id] += score * self.sparse_weight
            else:
                all_docs[doc.id] = doc
                combined_scores[doc.id] = score * self.sparse_weight

        # Sort and select top_k
        sorted_ids = sorted(
            combined_scores.keys(),
            key=lambda x: combined_scores[x],
            reverse=True
        )[:top_k]

        return RetrievalResult(
            documents=[all_docs[id] for id in sorted_ids],
            scores=[combined_scores[id] for id in sorted_ids],
            query=query,
            retrieval_time_ms=0
        )

    def _normalize_scores(self, scores: List[float]) -> List[float]:
        """Normalize scores to 0-1 range"""
        if not scores:
            return []
        min_s, max_s = min(scores), max(scores)
        if max_s == min_s:
            return [1.0] * len(scores)
        return [(s - min_s) / (max_s - min_s) for s in scores]

class ReciprocalRankFusion:
    """Combine multiple retrieval results using RRF"""

    def __init__(self, k: int = 60):
        self.k = k

    def fuse(
        self,
        results: List[RetrievalResult],
        top_k: int = 5
    ) -> RetrievalResult:
        """Fuse multiple result lists using RRF"""
        all_docs = {}
        rrf_scores = {}

        for result in results:
            for rank, (doc, score) in enumerate(
                zip(result.documents, result.scores)
            ):
                doc_id = doc.id
                all_docs[doc_id] = doc

                # RRF score
                rrf = 1 / (self.k + rank + 1)
                rrf_scores[doc_id] = rrf_scores.get(doc_id, 0) + rrf

        # Sort by RRF score
        sorted_ids = sorted(
            rrf_scores.keys(),
            key=lambda x: rrf_scores[x],
            reverse=True
        )[:top_k]

        return RetrievalResult(
            documents=[all_docs[id] for id in sorted_ids],
            scores=[rrf_scores[id] for id in sorted_ids],
            query=results[0].query if results else "",
            retrieval_time_ms=0
        )
```

## Complete Enhanced RAG System

```python
class EnhancedRAGSystem:
    """Complete enhanced RAG system"""

    def __init__(
        self,
        retriever,
        generator,
        use_reranking: bool = True,
        use_query_expansion: bool = True
    ):
        self.retriever = retriever
        self.generator = generator

        self.query_optimizer = QueryOptimizer(generator)
        self.context_optimizer = ContextOptimizer()
        self.reranker = CrossEncoderReranker() if use_reranking else None
        self.use_query_expansion = use_query_expansion
        self.lost_middle = LostInTheMiddleMitigation()

    def query(self, user_query: str, top_k: int = 5) -> Dict:
        """Execute enhanced RAG query"""
        import time
        start_time = time.time()

        # Query optimization
        if self.use_query_expansion:
            queries = self.query_optimizer.expand_query(user_query)
        else:
            queries = [user_query]

        # Retrieve for all query variations
        all_results = []
        for q in queries:
            result = self.retriever.retrieve(q, top_k=top_k)
            all_results.append(result)

        # Fuse results
        rrf = ReciprocalRankFusion()
        fused = rrf.fuse(all_results, top_k=top_k * 2)

        # Rerank
        if self.reranker:
            fused = self.reranker.rerank(user_query, fused, top_k=top_k)
        else:
            fused.documents = fused.documents[:top_k]
            fused.scores = fused.scores[:top_k]

        # Mitigate lost in the middle
        reordered = self.lost_middle.reorder_documents(
            fused.documents, fused.scores
        )

        # Optimize context
        context = self.context_optimizer.optimize(
            reordered, fused.scores, user_query
        )

        # Generate
        response = self._generate_with_context(user_query, context)

        elapsed = (time.time() - start_time) * 1000

        return {
            "response": response,
            "sources": [doc.id for doc in fused.documents],
            "scores": fused.scores,
            "processing_time_ms": elapsed
        }

    def _generate_with_context(self, query: str, context: str) -> str:
        """Generate response using context"""
        prompt = f"""Answer the question based on the provided context.
If the answer is not in the context, say so.

Context:
{context}

Question: {query}

Answer:"""

        return self.generator.generate(prompt)
```

## Conclusion

Advanced RAG techniques significantly improve retrieval quality and response accuracy. Key improvements include query optimization through expansion and decomposition, reranking for relevance, hybrid retrieval combining dense and sparse methods, context optimization for token efficiency, and mitigation of the lost-in-the-middle phenomenon. These techniques work together to create more accurate and reliable RAG systems.
