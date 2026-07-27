---
title: "Azure AI Search Semantic Ranker: Deep Dive and Optimization"
author: Michael John Peña
draft: false
date: 2024-01-25
tags:
  - Semantic Ranker
  - Azure AI Search
  - Relevance
  - RAG
  - Search Optimization

---


Semantic ranking improved my search relevance considerably; the main cost was configuration complexity. This deep dive explains how I tuned the ranker for better results while keeping latency and costs predictable.

## How Semantic Ranking Works

```
Query → Initial Results (BM25/Vector) → Semantic Reranker → Final Results
        (Top 50 candidates)              (Deep understanding)  (Reordered)
```

## Configuration

```python
from azure.search.documents.indexes.models import (
    SearchIndex, SemanticConfiguration, SemanticField,
    SemanticPrioritizedFields, SemanticSearch
)

index = SearchIndex(
    name="documents",
    fields=[...],
    semantic_search=SemanticSearch(
        configurations=[
            SemanticConfiguration(
                name="my-semantic-config",
                prioritized_fields=SemanticPrioritizedFields(
                    title_field=SemanticField(field_name="title"),
                    content_fields=[
                        SemanticField(field_name="content"),
                        SemanticField(field_name="summary")
                    ],
                    keywords_fields=[
                        SemanticField(field_name="tags"),
                        SemanticField(field_name="category")
                    ]
                )
            )
        ]
    )
)
```

## Query Patterns

### Basic Semantic Search

```python
results = search_client.search(
    search_text="How do I reset my password?",
    query_type="semantic",
    semantic_configuration_name="my-semantic-config",
    top=10
)

for r in results:
    print(f"Score: {r['@search.reranker_score']:.4f}")
    print(f"Title: {r['title']}")
```

### With Captions and Answers

```python
from azure.search.documents.models import QueryCaptionType, QueryAnswerType

results = search_client.search(
    search_text="What is the refund policy?",
    query_type="semantic",
    semantic_configuration_name="my-semantic-config",
    query_caption=QueryCaptionType.EXTRACTIVE,
    query_answer=QueryAnswerType.EXTRACTIVE,
    top=10
)

# Get semantic answers (direct answers to the question)
if results.get_answers():
    for answer in results.get_answers():
        print(f"Answer: {answer.text}")
        print(f"Confidence: {answer.score}")
        print(f"Source: {answer.key}")

# Get captions (highlighted relevant passages)
for r in results:
    if r.get("@search.captions"):
        for caption in r["@search.captions"]:
            print(f"Caption: {caption.text}")
            print(f"Highlights: {caption.highlights}")
```

### Hybrid + Semantic

```python
from azure.search.documents.models import VectorizedQuery

def hybrid_semantic_search(query: str, query_vector: list):
    """Combine vector, keyword, and semantic ranking."""

    vector_query = VectorizedQuery(
        vector=query_vector,
        k_nearest_neighbors=50,
        fields="content_vector"
    )

    results = search_client.search(
        search_text=query,
        vector_queries=[vector_query],
        query_type="semantic",
        semantic_configuration_name="my-semantic-config",
        query_caption=QueryCaptionType.EXTRACTIVE,
        top=10
    )

    return [
        {
            "title": r["title"],
            "content": r["content"][:500],
            "reranker_score": r.get("@search.reranker_score"),
            "captions": [c.highlights for c in r.get("@search.captions", [])]
        }
        for r in results
    ]
```

## Optimization Strategies

### Field Prioritization

```python
# Optimize semantic configuration for different use cases

# Product search: Prioritize product names and descriptions
product_semantic = SemanticConfiguration(
    name="product-config",
    prioritized_fields=SemanticPrioritizedFields(
        title_field=SemanticField(field_name="product_name"),
        content_fields=[
            SemanticField(field_name="description"),
            SemanticField(field_name="features")
        ],
        keywords_fields=[
            SemanticField(field_name="brand"),
            SemanticField(field_name="category")
        ]
    )
)

# Document search: Prioritize title and full content
document_semantic = SemanticConfiguration(
    name="document-config",
    prioritized_fields=SemanticPrioritizedFields(
        title_field=SemanticField(field_name="title"),
        content_fields=[
            SemanticField(field_name="content"),
            SemanticField(field_name="abstract")
        ],
        keywords_fields=[
            SemanticField(field_name="author"),
            SemanticField(field_name="tags")
        ]
    )
)
```

### Query Tuning

```python
def optimized_search(query: str, search_type: str = "precise"):
    """Search with query-specific optimization."""

    params = {
        "search_text": query,
        "query_type": "semantic",
        "semantic_configuration_name": "my-semantic-config"
    }

    if search_type == "precise":
        # For fact-finding queries
        params["query_answer"] = QueryAnswerType.EXTRACTIVE
        params["query_answer_count"] = 3
        params["query_answer_threshold"] = 0.7

    elif search_type == "exploratory":
        # For broad searches
        params["query_caption"] = QueryCaptionType.EXTRACTIVE
        params["top"] = 20

    return search_client.search(**params)
```

## Measuring Effectiveness

```python
def evaluate_semantic_ranking(test_queries: list[dict]):
    """Evaluate semantic ranking quality."""

    results = []

    for test in test_queries:
        query = test["query"]
        expected_docs = test["expected_docs"]

        # Search with semantic ranking
        search_results = search_client.search(
            search_text=query,
            query_type="semantic",
            semantic_configuration_name="my-semantic-config",
            top=10
        )

        retrieved_docs = [r["id"] for r in search_results]

        # Calculate metrics
        precision_at_5 = len(set(retrieved_docs[:5]) & set(expected_docs)) / 5
        recall_at_10 = len(set(retrieved_docs) & set(expected_docs)) / len(expected_docs)

        results.append({
            "query": query,
            "precision@5": precision_at_5,
            "recall@10": recall_at_10
        })

    return results
```

## Best Practices

1. **Prioritize fields correctly** - Title should be concise, content fields comprehensive
2. **Use captions for RAG** - Pass captions to LLM for better context
3. **Set answer thresholds** - Filter low-confidence answers
4. **Combine with hybrid search** - Get the best of vector and semantic
5. **Monitor reranker scores** - Low scores indicate relevance issues

## Conclusion

The semantic ranker transforms search quality by understanding query intent and document meaning. Proper configuration and the right combination with hybrid search create highly relevant results for RAG applications.

