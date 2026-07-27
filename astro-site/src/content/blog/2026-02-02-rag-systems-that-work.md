---
title: "Building RAG Systems That Actually Work"
author: Michael John Peña
draft: false
date: 2026-02-02
tags:
  - AI
  - RAG
  - Azure
  - Engineering

---

I wrote "Building RAG Systems That Actually Work" to share practical, production-minded guidance on this topic.

## The Common Approach

```python
# What most tutorials teach
documents = load_documents("./docs")
embeddings = embed(documents)
store_in_vector_db(embeddings)

# At query time
results = vector_search(user_query, top_k=5)
answer = llm.complete(f"Answer based on: {results}\n\nQuestion: {user_query}")
```

This works for demos. It fails in production.

## Why It Fails

**Chunking matters more than you think.** Random 500-token chunks lose context. A sentence about "the system" means nothing without knowing which system.

**Relevance isn't similarity.** Vector similarity finds related text. Users want answers. These are different things.

**Top-k is a lie.** Returning 5 chunks doesn't mean 5 relevant chunks. Sometimes zero are relevant. Sometimes you need 20.

## What Actually Works

### 1. Smart Chunking

```python
# Bad: Fixed-size chunks
chunks = split_every_n_tokens(document, 500)

# Better: Semantic chunking
chunks = split_by_sections(document)
for chunk in chunks:
    chunk.metadata = {
        "source": document.title,
        "section": chunk.heading,
        "context": document.summary
    }
```

Preserve document structure. Add metadata. Give chunks context.

### 2. Hybrid Search

```python
# Don't rely on vectors alone
vector_results = vector_search(query, top_k=10)
keyword_results = keyword_search(query, top_k=10)

# Combine and re-rank
combined = reciprocal_rank_fusion(vector_results, keyword_results)
final = rerank(combined, query, top_k=5)
```

Vector search misses exact matches. Keyword search misses semantic meaning. Use both.

### 3. Query Understanding

```python
# Don't search with raw user input
refined_query = llm.complete(f"""
Given this user question: {user_query}
Generate 3 search queries that would find relevant information.
""")

# Search with multiple queries
all_results = []
for query in refined_query:
    all_results.extend(vector_search(query))
```

Users ask vague questions. Transform them into better search queries.

### 4. Answer Grounding

```python
answer = llm.complete(f"""
Based on these sources, answer the question.
If the sources don't contain the answer, say so.
Always cite which source you're using.

Sources: {results}
Question: {user_query}
""")
```

Force citations. Admit when information isn't available. Users trust honest systems.

## The Architecture That Works

1. **Ingest:** Smart chunking with metadata
2. **Index:** Vector + keyword hybrid index
3. **Query:** Query expansion and refinement
4. **Retrieve:** Hybrid search with re-ranking
5. **Generate:** Grounded answer with citations
6. **Evaluate:** Track relevance and user satisfaction

## Metrics That Matter

**Relevance:** Are retrieved chunks actually useful?

**Faithfulness:** Does the answer match the sources?

**Coverage:** Are we finding all relevant information?

**User satisfaction:** Do users trust the answers?

## The Reality

Good RAG isn't about the vector database or the embedding model. It's about the pipeline around them.

Chunking, retrieval, re-ranking, and grounding matter more than which embedding model you pick.

Get the fundamentals right. The fancy stuff is optional.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
