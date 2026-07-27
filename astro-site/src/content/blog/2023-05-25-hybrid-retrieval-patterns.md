---
title: "Hybrid Retrieval Patterns for RAG Applications"
author: Michael John Peña
draft: false
date: 2023-05-25
tags:
  - RAG
  - Vector Search
  - Hybrid Search
  - Azure Cognitive Search
  - AI

---

I wrote "Hybrid Retrieval Patterns for RAG Applications" to share practical, production-minded guidance on this topic.

## Why Hybrid Retrieval?

Each retrieval method has strengths and weaknesses:

| Method | Strengths | Weaknesses |
|--------|-----------|------------|
| Keyword | Exact matches, rare terms | No semantic understanding |
| Vector | Semantic similarity | Can miss exact terms |
| Hybrid | Best of both | More complex |

```
┌─────────────────────────────────────────────────────┐
│             Hybrid Retrieval Pipeline                │
├─────────────────────────────────────────────────────┤
│                                                      │
│         ┌──────────────────────────────┐            │
│         │          Query               │            │
│         └──────────────┬───────────────┘            │
│                        │                            │
│         ┌──────────────┼───────────────┐            │
│         │              │               │            │
│         ▼              ▼               ▼            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐         │
│  │ Keyword  │  │  Vector  │  │ Semantic │         │
│  │ Search   │  │  Search  │  │ Reranker │         │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘         │
│       │             │             │               │
│       └─────────────┼─────────────┘               │
│                     ▼                              │
│              ┌──────────┐                          │
│              │  Fusion  │                          │
│              │  (RRF)   │                          │
│              └────┬─────┘                          │
│                   ▼                                │
│            Final Results                           │
│                                                    │
└────────────────────────────────────────────────────┘
```

## Reciprocal Rank Fusion (RRF)

RRF combines results from multiple retrieval methods:

```python
def reciprocal_rank_fusion(
    results_lists: list[list[dict]],
    k: int = 60
) -> list[dict]:
    """
    Combine multiple ranked result lists using RRF.

    Args:
        results_lists: List of result lists, each with 'id' and 'score'
        k: RRF parameter (default 60)

    Returns:
        Fused and re-ranked results
    """
    fused_scores = {}
    doc_data = {}

    for results in results_lists:
        for rank, doc in enumerate(results):
            doc_id = doc["id"]

            # RRF score: 1 / (k + rank)
            rrf_score = 1 / (k + rank + 1)

            if doc_id in fused_scores:
                fused_scores[doc_id] += rrf_score
            else:
                fused_scores[doc_id] = rrf_score
                doc_data[doc_id] = doc

    # Sort by fused score
    sorted_docs = sorted(
        fused_scores.items(),
        key=lambda x: x[1],
        reverse=True
    )

    # Return documents with fused scores
    return [
        {**doc_data[doc_id], "fused_score": score}
        for doc_id, score in sorted_docs
    ]
```

## Multi-Stage Retrieval

```python
class MultiStageRetriever:
    """Multi-stage retrieval with different techniques"""

    def __init__(self, search_client, openai_client):
        self.search = search_client
        self.openai = openai_client

    def keyword_search(self, query: str, top_k: int = 50) -> list[dict]:
        """Stage 1: Keyword search for initial recall"""
        results = self.search.search(
            search_text=query,
            query_type="full",  # Lucene query syntax
            search_mode="all",
            top=top_k,
            select=["id", "title", "content", "category"]
        )
        return [
            {**dict(r), "retrieval_method": "keyword"}
            for r in results
        ]

    def vector_search(self, query: str, top_k: int = 50) -> list[dict]:
        """Stage 2: Vector search for semantic matches"""
        query_embedding = self.get_embedding(query)

        vector_query = VectorizedQuery(
            vector=query_embedding,
            k_nearest_neighbors=top_k,
            fields="content_vector"
        )

        results = self.search.search(
            search_text=None,
            vector_queries=[vector_query],
            select=["id", "title", "content", "category"]
        )
        return [
            {**dict(r), "retrieval_method": "vector"}
            for r in results
        ]

    def rerank(self, query: str, documents: list[dict], top_k: int = 10) -> list[dict]:
        """Stage 3: Cross-encoder reranking"""
        # Use semantic search for reranking
        doc_ids = [doc["id"] for doc in documents]
        id_filter = " or ".join([f"id eq '{id}'" for id in doc_ids])

        results = self.search.search(
            search_text=query,
            filter=id_filter,
            query_type="semantic",
            semantic_configuration_name="my-semantic-config",
            top=top_k
        )

        return list(results)

    def retrieve(self, query: str, top_k: int = 10) -> list[dict]:
        """Complete multi-stage retrieval"""

        # Stage 1 & 2: Parallel retrieval
        keyword_results = self.keyword_search(query, top_k=50)
        vector_results = self.vector_search(query, top_k=50)

        # Stage 3: Fusion
        fused_results = reciprocal_rank_fusion(
            [keyword_results, vector_results]
        )

        # Stage 4: Rerank top candidates
        candidates = fused_results[:30]  # Rerank top 30
        final_results = self.rerank(query, candidates, top_k)

        return final_results

    def get_embedding(self, text: str) -> list[float]:
        response = self.openai.embeddings.create(
            model="text-embedding-ada-002",
            input=text
        )
        return response.data[0].embedding
```

## Query Expansion

```python
class QueryExpander:
    """Expand queries for better retrieval"""

    def __init__(self, openai_client):
        self.openai = openai_client

    def expand_query(self, query: str, num_expansions: int = 3) -> list[str]:
        """Generate query variations"""

        prompt = f"""Generate {num_expansions} alternative phrasings of this search query.
Each alternative should capture the same intent but use different words.

Original query: {query}

Return only the alternatives, one per line, without numbering."""

        response = self.openai.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7
        )

        expansions = response.choices[0].message.content.strip().split("\n")
        return [query] + [e.strip() for e in expansions if e.strip()]

    def hypothetical_document(self, query: str) -> str:
        """Generate hypothetical document that would answer the query (HyDE)"""

        prompt = f"""Write a short paragraph that would be a perfect answer to this question.
Write as if you are an expert explaining the topic.

Question: {query}

Answer:"""

        response = self.openai.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7
        )

        return response.choices[0].message.content

class HyDERetriever:
    """Hypothetical Document Embeddings retrieval"""

    def __init__(self, search_client, openai_client):
        self.search = search_client
        self.openai = openai_client
        self.expander = QueryExpander(openai_client)

    def retrieve(self, query: str, top_k: int = 10) -> list[dict]:
        """Retrieve using HyDE"""

        # Generate hypothetical document
        hypo_doc = self.expander.hypothetical_document(query)

        # Embed the hypothetical document (not the query)
        hypo_embedding = self.get_embedding(hypo_doc)

        # Search with hypothetical document embedding
        vector_query = VectorizedQuery(
            vector=hypo_embedding,
            k_nearest_neighbors=top_k,
            fields="content_vector"
        )

        results = self.search.search(
            search_text=None,
            vector_queries=[vector_query]
        )

        return list(results)

    def get_embedding(self, text: str) -> list[float]:
        response = self.openai.embeddings.create(
            model="text-embedding-ada-002",
            input=text
        )
        return response.data[0].embedding
```

## Multi-Vector Retrieval

```python
class MultiVectorRetriever:
    """Retrieve using multiple embedding types"""

    def __init__(self, search_client, openai_client):
        self.search = search_client
        self.openai = openai_client

    def retrieve(self, query: str, top_k: int = 10) -> list[dict]:
        """Search using multiple vector fields"""

        query_embedding = self.get_embedding(query)

        # Query multiple vector fields
        vector_queries = [
            VectorizedQuery(
                vector=query_embedding,
                k_nearest_neighbors=top_k,
                fields="title_vector",
                weight=0.3
            ),
            VectorizedQuery(
                vector=query_embedding,
                k_nearest_neighbors=top_k,
                fields="content_vector",
                weight=0.5
            ),
            VectorizedQuery(
                vector=query_embedding,
                k_nearest_neighbors=top_k,
                fields="summary_vector",
                weight=0.2
            )
        ]

        results = self.search.search(
            search_text=query,  # Also include keyword search
            vector_queries=vector_queries,
            top=top_k
        )

        return list(results)

    def get_embedding(self, text: str) -> list[float]:
        response = self.openai.embeddings.create(
            model="text-embedding-ada-002",
            input=text
        )
        return response.data[0].embedding
```

## Contextual Compression

```python
class ContextualCompressor:
    """Compress retrieved documents to relevant portions"""

    def __init__(self, openai_client):
        self.openai = openai_client

    def compress(self, query: str, documents: list[dict]) -> list[dict]:
        """Extract only relevant portions of documents"""

        compressed_docs = []

        for doc in documents:
            prompt = f"""Extract only the portions of the following document that are relevant to answering the question.
If no part is relevant, respond with "NOT_RELEVANT".

Question: {query}

Document:
{doc['content']}

Relevant portions:"""

            response = self.openai.chat.completions.create(
                model="gpt-3.5-turbo",
                messages=[{"role": "user", "content": prompt}],
                temperature=0
            )

            compressed_content = response.choices[0].message.content

            if compressed_content.strip() != "NOT_RELEVANT":
                compressed_docs.append({
                    **doc,
                    "original_content": doc["content"],
                    "content": compressed_content
                })

        return compressed_docs

class CompressedRAG:
    """RAG with contextual compression"""

    def __init__(self, retriever, compressor, openai_client):
        self.retriever = retriever
        self.compressor = compressor
        self.openai = openai_client

    def query(self, question: str, top_k: int = 10) -> dict:
        # Retrieve more documents initially
        documents = self.retriever.retrieve(question, top_k=top_k * 2)

        # Compress to relevant portions
        compressed = self.compressor.compress(question, documents)

        # Take top k compressed docs
        compressed = compressed[:top_k]

        # Generate answer
        answer = self.generate(question, compressed)

        return {
            "question": question,
            "answer": answer,
            "sources": compressed
        }

    def generate(self, query: str, documents: list[dict]) -> str:
        context = "\n\n".join([doc["content"] for doc in documents])

        response = self.openai.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "Answer based on the context provided."},
                {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {query}"}
            ]
        )

        return response.choices[0].message.content
```

Hybrid retrieval improves RAG quality by combining the strengths of different search approaches. Tomorrow, I will cover Azure Dev Box and development environments.

## Resources

- [Azure Search Hybrid](https://learn.microsoft.com/en-us/azure/search/hybrid-search-overview)
- [RRF Algorithm](https://learn.microsoft.com/en-us/azure/search/hybrid-search-ranking)
- [Semantic Ranking](https://learn.microsoft.com/en-us/azure/search/semantic-ranking)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
