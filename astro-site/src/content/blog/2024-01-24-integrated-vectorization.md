---
title: "Integrated Vectorization in Azure AI Search: Simplifying RAG Pipelines"
author: Michael John Peña
draft: false
date: 2024-01-24
tags:
  - Azure AI Search
  - Vector Search
  - Embeddings
  - RAG
  - Azure OpenAI
---

Integrated vectorization removed an entire pipeline step in a recent project. I'll show how it simplifies RAG pipelines and where to be cautious when relying on automatic vectorization.

## Before and After

### Traditional Approach

```python
# Before: Manual embedding pipeline
from openai import AzureOpenAI

def index_document(doc):
    # Step 1: Generate embedding manually
    embedding = openai_client.embeddings.create(
        model="text-embedding-ada-002",
        input=doc["content"]
    ).data[0].embedding

    # Step 2: Add to document
    doc["content_vector"] = embedding

    # Step 3: Upload to search
    search_client.upload_documents([doc])

def search_with_vector(query):
    # Step 1: Generate query embedding
    query_vector = openai_client.embeddings.create(
        model="text-embedding-ada-002",
        input=query
    ).data[0].embedding

    # Step 2: Search
    return search_client.search(
        vector_queries=[VectorizedQuery(vector=query_vector, ...)]
    )
```

### Integrated Vectorization

```python
# After: Automatic vectorization
def index_document(doc):
    # Just upload - vectorization happens automatically
    search_client.upload_documents([doc])

def search_with_vector(query):
    # Just search with text - vectorization happens automatically
    return search_client.search(
        search_text=query,
        vector_queries=[VectorizableTextQuery(text=query, ...)]
    )
```

## Configuration

### Index Definition

```python
from azure.search.documents.indexes.models import (
    SearchIndex, SearchField, VectorSearch,
    VectorSearchProfile, HnswAlgorithmConfiguration,
    AzureOpenAIVectorizer, AzureOpenAIParameters
)

index = SearchIndex(
    name="documents",
    fields=[
        SearchField(name="id", type="Edm.String", key=True),
        SearchField(name="title", type="Edm.String", searchable=True),
        SearchField(name="content", type="Edm.String", searchable=True),
        SearchField(
            name="content_vector",
            type="Collection(Edm.Single)",
            searchable=True,
            vector_search_dimensions=1536,
            vector_search_profile_name="vector-profile"
        )
    ],
    vector_search=VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="hnsw-config")],
        profiles=[
            VectorSearchProfile(
                name="vector-profile",
                algorithm_configuration_name="hnsw-config",
                vectorizer="openai-vectorizer"
            )
        ],
        vectorizers=[
            AzureOpenAIVectorizer(
                name="openai-vectorizer",
                azure_open_ai_parameters=AzureOpenAIParameters(
                    resource_uri="https://your-resource.openai.azure.com",
                    deployment_id="text-embedding-ada-002",
                    model_name="text-embedding-ada-002"
                )
            )
        ]
    )
)
```

### Skillset for Indexing

```python
from azure.search.documents.indexes.models import (
    SearchIndexerSkillset,
    AzureOpenAIEmbeddingSkill,
    InputFieldMappingEntry,
    OutputFieldMappingEntry
)

skillset = SearchIndexerSkillset(
    name="vectorization-skillset",
    skills=[
        AzureOpenAIEmbeddingSkill(
            name="embedding-skill",
            resource_uri="https://your-resource.openai.azure.com",
            deployment_id="text-embedding-ada-002",
            model_name="text-embedding-ada-002",
            inputs=[
                InputFieldMappingEntry(name="text", source="/document/content")
            ],
            outputs=[
                OutputFieldMappingEntry(name="embedding", target_name="content_vector")
            ]
        )
    ]
)
```

## Query-Time Vectorization

```python
from azure.search.documents.models import VectorizableTextQuery

def search_documents(query: str, top_k: int = 10):
    """Search with automatic query vectorization."""

    # Text query that gets vectorized automatically
    vector_query = VectorizableTextQuery(
        text=query,
        k_nearest_neighbors=top_k,
        fields="content_vector"
    )

    results = search_client.search(
        search_text=query,  # For hybrid search
        vector_queries=[vector_query],
        query_type="semantic",
        semantic_configuration_name="semantic-config",
        top=top_k
    )

    return list(results)
```

## Cost Considerations

```python
# Estimate vectorization costs
def estimate_costs(document_count: int, avg_tokens_per_doc: int):
    """Estimate integrated vectorization costs."""

    # Azure OpenAI embedding pricing (approximate)
    cost_per_1k_tokens = 0.0001

    # Indexing: One embedding per document
    indexing_tokens = document_count * avg_tokens_per_doc
    indexing_cost = (indexing_tokens / 1000) * cost_per_1k_tokens

    # Querying: One embedding per query
    queries_per_day = 10000
    avg_query_tokens = 50
    query_cost_per_day = (queries_per_day * avg_query_tokens / 1000) * cost_per_1k_tokens

    return {
        "indexing_cost": indexing_cost,
        "daily_query_cost": query_cost_per_day,
        "monthly_query_cost": query_cost_per_day * 30
    }

# Example
costs = estimate_costs(100000, 500)  # 100K docs, 500 tokens each
print(f"Indexing: ${costs['indexing_cost']:.2f}")
print(f"Monthly queries: ${costs['monthly_query_cost']:.2f}")
```

## Best Practices

1. **Use managed identity** for Azure OpenAI authentication
2. **Monitor embedding latency** during indexing
3. **Cache query embeddings** for repeated queries
4. **Set appropriate rate limits** to avoid throttling
5. **Test with representative data** before full migration

## Conclusion

Integrated vectorization transforms RAG development by eliminating manual embedding pipelines. The result is simpler code, fewer moving parts, and more reliable systems. Start using it for new projects and migrate existing ones when ready.
