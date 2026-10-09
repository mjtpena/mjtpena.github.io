---
title: "RAG Architecture Maturity Model: From Basic to Production-Grade"
description: "I've seen hundreds of RAG prototypes. The gap between a demo and a production-grade system usually comes down to retrieval quality, freshness, and…"
author: Michael John Peña
draft: false
date: 2024-01-06
tags:
  - RAG
  - Architecture
  - Azure AI Search
  - Vector Search
  - Enterprise AI
---

I've seen hundreds of RAG prototypes. The gap between a demo and a production-grade system usually comes down to retrieval quality, freshness, and observability. This maturity model frames that journey and highlights practical steps to level up.

## RAG Maturity Levels

### Level 1: Basic RAG

The "hello world" of RAG:

```python
# Level 1: Basic RAG
from openai import OpenAI
import chromadb

client = OpenAI()
chroma = chromadb.Client()
collection = chroma.create_collection("documents")

def basic_rag(query: str) -> str:
    # 1. Embed the query
    query_embedding = client.embeddings.create(
        model="text-embedding-ada-002",
        input=query
    ).data[0].embedding

    # 2. Retrieve similar documents
    results = collection.query(
        query_embeddings=[query_embedding],
        n_results=5
    )

    # 3. Generate response with context
    context = "\n".join(results["documents"][0])

    response = client.chat.completions.create(
        model="gpt-4-turbo",
        messages=[
            {"role": "system", "content": "Answer based on the provided context."},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {query}"}
        ]
    )

    return response.choices[0].message.content
```

**Characteristics:**
- Single embedding model
- Basic vector similarity search
- Fixed chunk size
- No relevance filtering
- No source citation

### Level 2: Hybrid RAG

Combining vector and keyword search:

```python
# Level 2: Hybrid RAG with Azure AI Search
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

class HybridRAG:
    def __init__(self, search_client: SearchClient, openai_client):
        self.search = search_client
        self.openai = openai_client

    def retrieve(self, query: str, top_k: int = 10) -> list[dict]:
        # Get query embedding
        embedding = self.openai.embeddings.create(
            model="text-embedding-ada-002",
            input=query
        ).data[0].embedding

        # Hybrid search: vector + keyword
        vector_query = VectorizedQuery(
            vector=embedding,
            k_nearest_neighbors=top_k,
            fields="content_vector"
        )

        results = self.search.search(
            search_text=query,  # Keyword search
            vector_queries=[vector_query],  # Vector search
            select=["title", "content", "source", "chunk_id"],
            top=top_k
        )

        return [
            {
                "content": r["content"],
                "source": r["source"],
                "score": r["@search.score"]
            }
            for r in results
        ]

    def generate(self, query: str, contexts: list[dict]) -> str:
        context_text = "\n\n".join([
            f"[Source: {c['source']}]\n{c['content']}"
            for c in contexts
        ])

        response = self.openai.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {
                    "role": "system",
                    "content": """Answer based on the provided context.
                    Always cite your sources using [Source: X] format.
                    If the context doesn't contain the answer, say so."""
                },
                {
                    "role": "user",
                    "content": f"Context:\n{context_text}\n\nQuestion: {query}"
                }
            ]
        )

        return response.choices[0].message.content
```

**Improvements:**
- Keyword + vector search
- Source citation
- Explicit handling of missing information

### Level 3: Semantic RAG

Adding semantic ranking and relevance filtering:

```python
# Level 3: Semantic RAG with reranking
class SemanticRAG(HybridRAG):
    def __init__(self, search_client, openai_client, reranker_threshold: float = 0.5):
        super().__init__(search_client, openai_client)
        self.reranker_threshold = reranker_threshold

    def retrieve(self, query: str, top_k: int = 10) -> list[dict]:
        embedding = self.openai.embeddings.create(
            model="text-embedding-ada-002",
            input=query
        ).data[0].embedding

        vector_query = VectorizedQuery(
            vector=embedding,
            k_nearest_neighbors=top_k * 2,  # Over-retrieve for reranking
            fields="content_vector"
        )

        results = self.search.search(
            search_text=query,
            vector_queries=[vector_query],
            query_type="semantic",  # Enable semantic ranking
            semantic_configuration_name="my-semantic-config",
            select=["title", "content", "source", "chunk_id"],
            top=top_k * 2
        )

        # Filter by reranker score
        filtered = []
        for r in results:
            reranker_score = r.get("@search.reranker_score", 0)
            if reranker_score >= self.reranker_threshold:
                filtered.append({
                    "content": r["content"],
                    "source": r["source"],
                    "score": reranker_score
                })

        # Return top_k after filtering
        return sorted(filtered, key=lambda x: x["score"], reverse=True)[:top_k]
```

**Improvements:**
- Semantic reranking
- Relevance threshold filtering
- Better precision

### Level 4: Agentic RAG

Query understanding and multi-step retrieval:

```python
# Level 4: Agentic RAG with query decomposition
from dataclasses import dataclass
from enum import Enum

class QueryIntent(Enum):
    FACTUAL = "factual"
    COMPARISON = "comparison"
    PROCEDURAL = "procedural"
    ANALYTICAL = "analytical"

@dataclass
class DecomposedQuery:
    original: str
    intent: QueryIntent
    sub_queries: list[str]
    required_sources: list[str]

class AgenticRAG:
    def __init__(self, search_client, openai_client):
        self.search = search_client
        self.openai = openai_client

    async def process(self, query: str) -> str:
        # Step 1: Analyze and decompose query
        decomposed = await self._decompose_query(query)

        # Step 2: Retrieve for each sub-query
        all_contexts = []
        for sub_query in decomposed.sub_queries:
            contexts = await self._retrieve(sub_query, decomposed.required_sources)
            all_contexts.extend(contexts)

        # Step 3: Deduplicate and rank contexts
        unique_contexts = self._deduplicate(all_contexts)

        # Step 4: Generate response based on intent
        return await self._generate(query, unique_contexts, decomposed.intent)

    async def _decompose_query(self, query: str) -> DecomposedQuery:
        """Use LLM to understand and decompose query."""

        response = self.openai.chat.completions.create(
            model="gpt-4-turbo",
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": """Analyze the query and return JSON:
                    {
                        "intent": "factual|comparison|procedural|analytical",
                        "sub_queries": ["list of specific questions to answer"],
                        "required_sources": ["types of documents needed"]
                    }"""
                },
                {"role": "user", "content": query}
            ]
        )

        result = json.loads(response.choices[0].message.content)

        return DecomposedQuery(
            original=query,
            intent=QueryIntent(result["intent"]),
            sub_queries=result["sub_queries"],
            required_sources=result["required_sources"]
        )

    async def _retrieve(self, query: str, source_types: list[str]) -> list[dict]:
        """Retrieve with source filtering."""

        embedding = self.openai.embeddings.create(
            model="text-embedding-ada-002",
            input=query
        ).data[0].embedding

        # Build source filter
        source_filter = " or ".join([f"source_type eq '{s}'" for s in source_types])

        vector_query = VectorizedQuery(
            vector=embedding,
            k_nearest_neighbors=10,
            fields="content_vector"
        )

        results = self.search.search(
            search_text=query,
            vector_queries=[vector_query],
            filter=source_filter if source_types else None,
            query_type="semantic",
            semantic_configuration_name="my-semantic-config",
            top=10
        )

        return [{"content": r["content"], "source": r["source"]} for r in results]

    def _deduplicate(self, contexts: list[dict]) -> list[dict]:
        """Remove duplicate contexts."""
        seen = set()
        unique = []

        for ctx in contexts:
            content_hash = hash(ctx["content"][:200])
            if content_hash not in seen:
                seen.add(content_hash)
                unique.append(ctx)

        return unique

    async def _generate(
        self,
        query: str,
        contexts: list[dict],
        intent: QueryIntent
    ) -> str:
        """Generate response tailored to intent."""

        intent_instructions = {
            QueryIntent.FACTUAL: "Provide a direct, factual answer with citations.",
            QueryIntent.COMPARISON: "Structure your response as a comparison, highlighting similarities and differences.",
            QueryIntent.PROCEDURAL: "Provide step-by-step instructions.",
            QueryIntent.ANALYTICAL: "Provide analysis with reasoning and evidence."
        }

        context_text = "\n\n".join([
            f"[{c['source']}]: {c['content']}"
            for c in contexts
        ])

        response = self.openai.chat.completions.create(
            model="gpt-4-turbo",
            messages=[
                {
                    "role": "system",
                    "content": f"{intent_instructions[intent]} Always cite sources."
                },
                {
                    "role": "user",
                    "content": f"Context:\n{context_text}\n\nQuestion: {query}"
                }
            ]
        )

        return response.choices[0].message.content
```

### Level 5: Production RAG

Full production system with evaluation and monitoring:

```python
# Level 5: Production RAG with full observability
from dataclasses import dataclass
from datetime import datetime
import uuid

@dataclass
class RAGResponse:
    query_id: str
    query: str
    response: str
    contexts: list[dict]
    latency_ms: float
    tokens_used: int
    model: str
    timestamp: datetime

@dataclass
class RAGEvaluation:
    query_id: str
    relevance_score: float
    groundedness_score: float
    answer_quality_score: float
    citations_valid: bool

class ProductionRAG:
    def __init__(
        self,
        search_client,
        openai_client,
        cache,
        metrics_collector,
        evaluator
    ):
        self.search = search_client
        self.openai = openai_client
        self.cache = cache
        self.metrics = metrics_collector
        self.evaluator = evaluator

    async def query(self, query: str, user_id: str) -> RAGResponse:
        query_id = str(uuid.uuid4())
        start_time = datetime.utcnow()

        # Check cache
        cached = await self.cache.get(query)
        if cached:
            self.metrics.record("cache_hit", 1)
            return cached

        # Retrieve
        contexts = await self._retrieve(query)

        # Generate
        response_text, tokens = await self._generate(query, contexts)

        # Build response
        latency = (datetime.utcnow() - start_time).total_seconds() * 1000
        response = RAGResponse(
            query_id=query_id,
            query=query,
            response=response_text,
            contexts=contexts,
            latency_ms=latency,
            tokens_used=tokens,
            model="gpt-4-turbo",
            timestamp=datetime.utcnow()
        )

        # Record metrics
        self.metrics.record("query_latency", latency)
        self.metrics.record("tokens_used", tokens)
        self.metrics.record("contexts_retrieved", len(contexts))

        # Cache response
        await self.cache.set(query, response, ttl=3600)

        # Async evaluation
        asyncio.create_task(self._evaluate(response))

        return response

    async def _evaluate(self, response: RAGResponse):
        """Evaluate response quality asynchronously."""

        evaluation = await self.evaluator.evaluate(
            query=response.query,
            response=response.response,
            contexts=response.contexts
        )

        # Record evaluation metrics
        self.metrics.record("relevance_score", evaluation.relevance_score)
        self.metrics.record("groundedness_score", evaluation.groundedness_score)

        # Alert on low quality
        if evaluation.groundedness_score < 0.7:
            await self._alert_low_quality(response, evaluation)

    async def _retrieve(self, query: str) -> list[dict]:
        """Production retrieval with fallback."""
        try:
            return await self._hybrid_retrieve(query)
        except Exception as e:
            self.metrics.record("retrieval_error", 1)
            # Fallback to keyword-only
            return await self._keyword_retrieve(query)

    async def _generate(self, query: str, contexts: list[dict]) -> tuple[str, int]:
        """Generate with retry and fallback."""
        try:
            return await self._generate_gpt4(query, contexts)
        except Exception as e:
            self.metrics.record("generation_fallback", 1)
            return await self._generate_gpt35(query, contexts)
```

## Maturity Assessment Checklist

| Level | Capability | Have It? |
|-------|-----------|----------|
| 1 | Basic vector search | |
| 1 | Single embedding model | |
| 2 | Hybrid search (vector + keyword) | |
| 2 | Source citations | |
| 3 | Semantic reranking | |
| 3 | Relevance filtering | |
| 4 | Query decomposition | |
| 4 | Multi-step retrieval | |
| 4 | Intent-aware generation | |
| 5 | Response caching | |
| 5 | Quality evaluation | |
| 5 | Comprehensive monitoring | |
| 5 | Fallback strategies | |

## Conclusion

Most organizations start at Level 1-2 and need to reach Level 4-5 for production. Focus on:

1. **Hybrid search** - Vector-only misses keyword matches
2. **Semantic reranking** - Critical for precision
3. **Query understanding** - Complex queries need decomposition
4. **Evaluation** - You can't improve what you don't measure
5. **Observability** - Monitor everything in production

The journey from demo to production RAG is significant, but each level delivers measurable improvements in answer quality.
