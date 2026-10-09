---
title: "RAG 2.0: Advanced Retrieval Patterns for Production AI"
description: "RAG 2.0 is about precision and reliability. Invest in retrieval quality, and your generation quality will follow."
author: Michael John Peña
draft: false
date: 2025-01-17
tags:
  - AI
  - RAG
  - Vector Search
  - Azure
  - LLM
---

## The Evolution of RAG

```
RAG 1.0 (2023):
Query → Embed → Vector Search → Top-K → Generate

RAG 2.0 (2025):
Query → Analyze → Multi-Strategy Retrieval → Rerank → Filter → Generate → Verify
```

## Pattern 1: Hybrid Search

Combine vector and keyword search:

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

class HybridSearcher:
    def __init__(self, search_client: SearchClient, embedder):
        self.search_client = search_client
        self.embedder = embedder

    def search(self, query: str, top_k: int = 10) -> list[dict]:
        # Generate embedding
        query_vector = self.embedder.embed(query)

        # Hybrid search: vector + keyword
        results = self.search_client.search(
            search_text=query,  # Keyword search
            vector_queries=[
                VectorizedQuery(
                    vector=query_vector,
                    k_nearest_neighbors=top_k * 2,  # Over-retrieve
                    fields="content_vector"
                )
            ],
            query_type="semantic",  # Enable semantic ranking
            semantic_configuration_name="default",
            top=top_k,
            select=["title", "content", "source", "metadata"]
        )

        return [
            {
                "title": r["title"],
                "content": r["content"],
                "source": r["source"],
                "score": r["@search.score"],
                "reranker_score": r.get("@search.reranker_score", 0)
            }
            for r in results
        ]
```

## Pattern 2: Query Transformation

Improve retrieval by transforming queries:

```python
class QueryTransformer:
    def __init__(self, llm_client):
        self.llm = llm_client

    async def transform(self, query: str) -> dict:
        """Transform user query for better retrieval."""

        # Expansion: Generate related queries
        expansion_response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Generate 3 alternative phrasings of this query for search:
                Query: {query}

                Return as JSON array: ["query1", "query2", "query3"]"""
            }]
        )
        expansions = json.loads(expansion_response.choices[0].message.content)

        # Decomposition: Break into sub-queries
        decomposition_response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""If this query has multiple parts, break it into sub-queries.
                Query: {query}

                Return as JSON array. If single query, return ["{query}"]"""
            }]
        )
        sub_queries = json.loads(decomposition_response.choices[0].message.content)

        # HyDE: Hypothetical Document Embedding
        hyde_response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Write a short paragraph that would be a perfect answer to this query:
                Query: {query}

                Write as if you're the ideal document that answers this."""
            }]
        )
        hypothetical_doc = hyde_response.choices[0].message.content

        return {
            "original": query,
            "expansions": expansions,
            "sub_queries": sub_queries,
            "hypothetical_document": hypothetical_doc
        }
```

## Pattern 3: Multi-Index Retrieval

Search across multiple specialized indexes:

```python
class MultiIndexRetriever:
    def __init__(self, indexes: dict):
        self.indexes = indexes  # {"docs": SearchClient, "code": SearchClient, "faq": SearchClient}

    async def retrieve(self, query: str, query_type: str = "auto") -> list[dict]:
        # Determine which indexes to search
        if query_type == "auto":
            index_weights = await self._classify_query(query)
        else:
            index_weights = {query_type: 1.0}

        # Search relevant indexes in parallel
        tasks = []
        for index_name, weight in index_weights.items():
            if weight > 0.1:  # Threshold
                tasks.append(self._search_index(index_name, query, weight))

        results = await asyncio.gather(*tasks)

        # Merge and sort by weighted score
        merged = []
        for index_results in results:
            merged.extend(index_results)

        merged.sort(key=lambda x: x["weighted_score"], reverse=True)
        return merged[:10]  # Top 10 across all indexes

    async def _classify_query(self, query: str) -> dict:
        """Classify query to determine index weights."""
        # Use LLM to classify
        response = await self.llm.chat.complete_async(
            deployment="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"""Classify this query. Return JSON with weights (0-1) for each category:
                - docs: Technical documentation
                - code: Code examples
                - faq: Frequently asked questions

                Query: {query}

                Example output: {{"docs": 0.6, "code": 0.3, "faq": 0.1}}"""
            }]
        )
        return json.loads(response.choices[0].message.content)

    async def _search_index(self, index_name: str, query: str, weight: float) -> list[dict]:
        client = self.indexes[index_name]
        results = client.search(search_text=query, top=10)
        return [
            {
                **r,
                "index": index_name,
                "weighted_score": r["@search.score"] * weight
            }
            for r in results
        ]
```

## Pattern 4: Contextual Compression

Reduce retrieved content to relevant portions:

```python
class ContextualCompressor:
    def __init__(self, llm_client):
        self.llm = llm_client

    async def compress(self, query: str, documents: list[dict]) -> list[dict]:
        """Extract only relevant portions of each document."""

        compressed = []
        for doc in documents:
            # Use LLM to extract relevant content
            response = await self.llm.chat.complete_async(
                deployment="gpt-4o-mini",
                messages=[{
                    "role": "user",
                    "content": f"""Given this query, extract only the relevant portions from the document.
                    If nothing is relevant, return "NOT_RELEVANT".

                    Query: {query}

                    Document:
                    {doc['content'][:3000]}

                    Relevant excerpt:"""
                }]
            )

            excerpt = response.choices[0].message.content
            if excerpt != "NOT_RELEVANT":
                compressed.append({
                    **doc,
                    "content": excerpt,
                    "original_length": len(doc["content"]),
                    "compressed_length": len(excerpt)
                })

        return compressed
```

## Pattern 5: Self-RAG (Self-Reflective RAG)

The model decides when and what to retrieve:

```python
class SelfRAG:
    def __init__(self, llm_client, retriever):
        self.llm = llm_client
        self.retriever = retriever

    async def answer(self, query: str) -> dict:
        # Step 1: Decide if retrieval is needed
        need_retrieval = await self._assess_retrieval_need(query)

        if not need_retrieval:
            # Answer directly
            response = await self._generate_direct(query)
            return {"answer": response, "retrieval": False, "sources": []}

        # Step 2: Retrieve
        docs = await self.retriever.search(query)

        # Step 3: Assess relevance of each doc
        relevant_docs = await self._filter_relevant(query, docs)

        if not relevant_docs:
            # No relevant docs, answer with caveat
            response = await self._generate_with_caveat(query)
            return {"answer": response, "retrieval": True, "sources": [], "caveat": True}

        # Step 4: Generate with relevant docs
        response = await self._generate_with_docs(query, relevant_docs)

        # Step 5: Verify response is supported
        is_supported = await self._verify_support(response, relevant_docs)

        if not is_supported:
            # Regenerate or add warning
            response = await self._regenerate_grounded(query, relevant_docs)

        return {
            "answer": response,
            "retrieval": True,
            "sources": [d["source"] for d in relevant_docs],
            "supported": is_supported
        }

    async def _assess_retrieval_need(self, query: str) -> bool:
        response = await self.llm.chat.complete_async(
            deployment="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"""Does answering this query require external information lookup?
                Query: {query}
                Answer YES or NO only."""
            }]
        )
        return "YES" in response.choices[0].message.content.upper()

    async def _filter_relevant(self, query: str, docs: list[dict]) -> list[dict]:
        relevant = []
        for doc in docs:
            response = await self.llm.chat.complete_async(
                deployment="gpt-4o-mini",
                messages=[{
                    "role": "user",
                    "content": f"""Is this document relevant to the query?
                    Query: {query}
                    Document: {doc['content'][:500]}
                    Answer RELEVANT or NOT_RELEVANT only."""
                }]
            )
            if "RELEVANT" in response.choices[0].message.content.upper():
                relevant.append(doc)
        return relevant
```

## Pattern 6: Reranking Pipeline

Multi-stage ranking for precision:

```python
class RerankerPipeline:
    def __init__(self, embedding_model, cross_encoder, llm_client):
        self.embedding_model = embedding_model
        self.cross_encoder = cross_encoder
        self.llm = llm_client

    async def rerank(self, query: str, documents: list[dict], top_k: int = 5) -> list[dict]:
        # Stage 1: Initial retrieval score (from search)
        # Already have this from retrieval

        # Stage 2: Cross-encoder reranking
        cross_scores = await self._cross_encoder_rerank(query, documents)

        # Stage 3: LLM relevance scoring
        llm_scores = await self._llm_rerank(query, documents[:20])  # Top 20 only

        # Combine scores
        for i, doc in enumerate(documents):
            doc["cross_score"] = cross_scores.get(i, 0)
            doc["llm_score"] = llm_scores.get(i, 0)
            doc["final_score"] = (
                0.3 * doc.get("score", 0) +
                0.4 * doc["cross_score"] +
                0.3 * doc["llm_score"]
            )

        # Sort by final score
        documents.sort(key=lambda x: x["final_score"], reverse=True)
        return documents[:top_k]

    async def _cross_encoder_rerank(self, query: str, docs: list[dict]) -> dict:
        """Use cross-encoder model for pairwise relevance."""
        pairs = [(query, doc["content"][:512]) for doc in docs]
        scores = self.cross_encoder.predict(pairs)
        return {i: score for i, score in enumerate(scores)}

    async def _llm_rerank(self, query: str, docs: list[dict]) -> dict:
        """Use LLM for relevance judgment."""
        doc_list = "\n".join([
            f"[{i}] {doc['content'][:200]}"
            for i, doc in enumerate(docs)
        ])

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"""Rank these documents by relevance to the query.
                Query: {query}

                Documents:
                {doc_list}

                Return as JSON: {{"rankings": [doc_index, doc_index, ...]}}
                Most relevant first."""
            }]
        )

        rankings = json.loads(response.choices[0].message.content)["rankings"]
        return {idx: 1.0 - (rank / len(rankings)) for rank, idx in enumerate(rankings)}
```

## Production RAG Checklist

1. **Hybrid search** - Combine vector and keyword
2. **Query transformation** - Improve retrieval queries
3. **Multi-index** - Specialize indexes by content type
4. **Reranking** - Multi-stage scoring
5. **Contextual compression** - Reduce noise
6. **Citation** - Track sources
7. **Evaluation** - Measure retrieval and generation quality
8. **Caching** - Cache embeddings and frequent queries

RAG 2.0 is about precision and reliability. Invest in retrieval quality, and your generation quality will follow.
