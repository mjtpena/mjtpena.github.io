---
title: "Azure AI Search Updates: January 2024 Features and Capabilities"
description: "I've been integrating Azure AI Search into RAG systems; the January 2024 updates simplify common workflows. Below are the changes I judged most impactful…"
author: Michael John Peña
draft: false
date: 2024-01-23
tags:
  - Azure AI Search
  - Vector Search
  - RAG
  - Semantic Search
  - Azure
---

I've been integrating Azure AI Search into RAG systems; the January 2024 updates simplify common workflows. Below are the changes I judged most impactful and how I used them.

## Key Updates

### 1. Integrated Vectorization (Preview)

Automatically vectorize content during indexing:

```python
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    VectorSearch,
    VectorSearchProfile,
    HnswAlgorithmConfiguration,
    AzureOpenAIVectorizer,
    AzureOpenAIParameters
)

# Define index with integrated vectorization
index = SearchIndex(
    name="documents-with-vectors",
    fields=[
        SearchField(name="id", type="Edm.String", key=True),
        SearchField(name="content", type="Edm.String", searchable=True),
        SearchField(
            name="content_vector",
            type="Collection(Edm.Single)",
            searchable=True,
            vector_search_dimensions=1536,
            vector_search_profile_name="my-vector-profile"
        )
    ],
    vector_search=VectorSearch(
        algorithms=[
            HnswAlgorithmConfiguration(name="my-hnsw")
        ],
        profiles=[
            VectorSearchProfile(
                name="my-vector-profile",
                algorithm_configuration_name="my-hnsw",
                vectorizer="my-openai-vectorizer"
            )
        ],
        vectorizers=[
            AzureOpenAIVectorizer(
                name="my-openai-vectorizer",
                azure_open_ai_parameters=AzureOpenAIParameters(
                    resource_uri="https://your-openai.openai.azure.com",
                    deployment_id="text-embedding-ada-002",
                    model_name="text-embedding-ada-002"
                )
            )
        ]
    )
)

# Create index
index_client.create_index(index)
```

### 2. Vector Compression

Reduce storage costs with scalar quantization:

```python
from azure.search.documents.indexes.models import (
    ScalarQuantizationCompression,
    VectorSearchCompression
)

# Configure vector compression
vector_search = VectorSearch(
    algorithms=[HnswAlgorithmConfiguration(name="my-hnsw")],
    compressions=[
        ScalarQuantizationCompression(
            name="my-scalar-quantization",
            rerank_with_original_vectors=True,
            default_oversampling=10.0,
            parameters={
                "quantized_data_type": "int8"
            }
        )
    ],
    profiles=[
        VectorSearchProfile(
            name="compressed-profile",
            algorithm_configuration_name="my-hnsw",
            compression_configuration_name="my-scalar-quantization"
        )
    ]
)
```

### 3. Improved Semantic Ranker

Enhanced semantic ranking with better relevance:

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import QueryType, QueryCaptionType, QueryAnswerType

search_client = SearchClient(endpoint, index_name, credential)

# Semantic search with captions and answers
results = search_client.search(
    search_text="How do I configure Azure OpenAI?",
    query_type=QueryType.SEMANTIC,
    semantic_configuration_name="my-semantic-config",
    query_caption=QueryCaptionType.EXTRACTIVE,
    query_answer=QueryAnswerType.EXTRACTIVE,
    top=10
)

for result in results:
    print(f"Score: {result['@search.reranker_score']}")
    print(f"Content: {result['content'][:200]}...")

    if result.get("@search.captions"):
        for caption in result["@search.captions"]:
            print(f"Caption: {caption.text}")
            print(f"Highlights: {caption.highlights}")
```

## Hybrid Search Patterns

### Combining Vector and Keyword Search

```python
from azure.search.documents.models import VectorizedQuery

def hybrid_search(query: str, query_vector: list, top_k: int = 10):
    """Perform hybrid search combining vector and keyword."""

    vector_query = VectorizedQuery(
        vector=query_vector,
        k_nearest_neighbors=top_k * 2,
        fields="content_vector"
    )

    results = search_client.search(
        search_text=query,
        vector_queries=[vector_query],
        query_type=QueryType.SEMANTIC,
        semantic_configuration_name="my-semantic-config",
        select=["id", "title", "content", "source"],
        top=top_k
    )

    return [
        {
            "id": r["id"],
            "title": r["title"],
            "content": r["content"],
            "score": r["@search.reranker_score"],
            "source": r["source"]
        }
        for r in results
    ]
```

### Multi-Vector Search

```python
# Search across multiple vector fields
def multi_vector_search(query: str, query_vector: list):
    """Search across multiple vector fields."""

    # Title vector (more weight for title matches)
    title_vector_query = VectorizedQuery(
        vector=query_vector,
        k_nearest_neighbors=20,
        fields="title_vector",
        weight=1.5
    )

    # Content vector
    content_vector_query = VectorizedQuery(
        vector=query_vector,
        k_nearest_neighbors=20,
        fields="content_vector",
        weight=1.0
    )

    results = search_client.search(
        search_text=query,
        vector_queries=[title_vector_query, content_vector_query],
        select=["id", "title", "content"],
        top=10
    )

    return list(results)
```

## Index Optimization

### Skillset for Document Processing

```python
from azure.search.documents.indexes.models import (
    SearchIndexerSkillset,
    SplitSkill,
    AzureOpenAIEmbeddingSkill
)

# Create skillset for chunking and embedding
skillset = SearchIndexerSkillset(
    name="document-processing-skillset",
    skills=[
        SplitSkill(
            name="split-skill",
            description="Split documents into chunks",
            text_split_mode="pages",
            maximum_page_length=2000,
            page_overlap_length=200,
            inputs=[
                {"name": "text", "source": "/document/content"}
            ],
            outputs=[
                {"name": "textItems", "targetName": "chunks"}
            ]
        ),
        AzureOpenAIEmbeddingSkill(
            name="embedding-skill",
            description="Generate embeddings",
            resource_uri="https://your-openai.openai.azure.com",
            deployment_id="text-embedding-ada-002",
            model_name="text-embedding-ada-002",
            inputs=[
                {"name": "text", "source": "/document/chunks/*"}
            ],
            outputs=[
                {"name": "embedding", "targetName": "vector"}
            ]
        )
    ]
)
```

### Index Projections

```python
# Project chunks as separate documents
indexer_config = {
    "name": "document-indexer",
    "dataSourceName": "blob-datasource",
    "targetIndexName": "chunked-documents",
    "skillsetName": "document-processing-skillset",
    "parameters": {
        "configuration": {
            "indexProjections": {
                "selectors": [
                    {
                        "targetIndexName": "chunked-documents",
                        "parentKeyFieldName": "parent_id",
                        "sourceContext": "/document/chunks/*",
                        "mappings": [
                            {"name": "chunk_id", "source": "/document/chunks/*/id"},
                            {"name": "content", "source": "/document/chunks/*/content"},
                            {"name": "vector", "source": "/document/chunks/*/vector"},
                            {"name": "source_file", "source": "/document/metadata_storage_name"}
                        ]
                    }
                ]
            }
        }
    }
}
```

## Performance Tuning

### Query Performance

```python
# Optimize query performance
def optimized_search(query: str, filters: dict = None):
    """Search with performance optimizations."""

    # Build filter string
    filter_str = None
    if filters:
        filter_parts = [f"{k} eq '{v}'" for k, v in filters.items()]
        filter_str = " and ".join(filter_parts)

    results = search_client.search(
        search_text=query,
        filter=filter_str,
        select=["id", "title", "content"],  # Only select needed fields
        search_fields=["title", "content"],  # Limit search scope
        top=10,
        include_total_count=False  # Disable count for faster queries
    )

    return list(results)
```

### Index Statistics

```python
def get_index_statistics(index_name: str) -> dict:
    """Get index statistics for monitoring."""

    stats = index_client.get_index_statistics(index_name)

    return {
        "document_count": stats.document_count,
        "storage_size_bytes": stats.storage_size,
        "storage_size_mb": stats.storage_size / (1024 * 1024),
        "vector_index_size_bytes": stats.vector_index_size
    }
```

## Best Practices

1. **Use integrated vectorization** for simpler pipelines
2. **Enable compression** for large vector indexes
3. **Combine hybrid + semantic** for best relevance
4. **Project chunks** for efficient document search
5. **Monitor statistics** to optimize costs

## Conclusion

Azure AI Search's January 2024 updates make it easier to build production RAG systems:

- Integrated vectorization simplifies indexing
- Compression reduces costs
- Enhanced semantic ranking improves relevance
- Index projections enable better chunking

These features position Azure AI Search as a complete solution for enterprise search and RAG applications.
