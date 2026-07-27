---
title: "Azure AI Search Updates: What's New in Summer 2024"
author: Michael John Peña
draft: false
date: 2024-07-25
tags:
  - Azure
  - AI Search
  - Vector Search
  - RAG
  - Search

---

I wrote "Azure AI Search Updates: What's New in Summer 2024" to share practical, production-minded guidance on this topic.

## Vector Search Improvements

**Expanded Vector Dimensions**

Azure AI Search now supports vectors up to 3072 dimensions, accommodating larger embedding models:

```python
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex, SearchField, SearchFieldDataType,
    VectorSearch, HnswAlgorithmConfiguration, VectorSearchProfile
)

# Support for larger embeddings
index = SearchIndex(
    name="large-embeddings-index",
    fields=[
        SearchField(name="id", type=SearchFieldDataType.String, key=True),
        SearchField(name="content", type=SearchFieldDataType.String, searchable=True),
        SearchField(
            name="embedding",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            vector_search_dimensions=3072,  # OpenAI text-embedding-3-large
            vector_search_profile_name="vector-profile"
        )
    ],
    vector_search=VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="hnsw")],
        profiles=[VectorSearchProfile(name="vector-profile", algorithm_configuration_name="hnsw")]
    )
)
```

**Multiple Vector Fields**

Index documents with multiple embeddings for different purposes:

```python
fields = [
    SearchField(name="id", type=SearchFieldDataType.String, key=True),
    SearchField(name="title", type=SearchFieldDataType.String, searchable=True),
    SearchField(name="content", type=SearchFieldDataType.String, searchable=True),
    SearchField(
        name="title_embedding",
        type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
        vector_search_dimensions=1536,
        vector_search_profile_name="title-profile"
    ),
    SearchField(
        name="content_embedding",
        type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
        vector_search_dimensions=1536,
        vector_search_profile_name="content-profile"
    ),
    SearchField(
        name="summary_embedding",
        type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
        vector_search_dimensions=1536,
        vector_search_profile_name="summary-profile"
    )
]
```

## Hybrid Search Enhancements

**Improved Hybrid Scoring**

New reciprocal rank fusion (RRF) improvements for better hybrid results:

```python
from azure.search.documents import SearchClient
from azure.search.documents.models import VectorizedQuery

client = SearchClient(endpoint, index_name, credential)

# Hybrid search with multiple vector fields
vector_query_title = VectorizedQuery(
    vector=title_embedding,
    k_nearest_neighbors=10,
    fields="title_embedding",
    weight=0.3
)

vector_query_content = VectorizedQuery(
    vector=content_embedding,
    k_nearest_neighbors=20,
    fields="content_embedding",
    weight=0.7
)

results = client.search(
    search_text="Azure data analytics",
    vector_queries=[vector_query_title, vector_query_content],
    select=["id", "title", "content"],
    top=10,
    query_type="semantic",
    semantic_configuration_name="default"
)

for result in results:
    print(f"Score: {result['@search.score']}")
    print(f"Title: {result['title']}")
```

**Semantic Ranking Improvements**

Enhanced semantic ranker with better relevance:

```python
from azure.search.documents.indexes.models import (
    SemanticConfiguration, SemanticPrioritizedFields, SemanticField
)

semantic_config = SemanticConfiguration(
    name="default",
    prioritized_fields=SemanticPrioritizedFields(
        title_field=SemanticField(field_name="title"),
        content_fields=[
            SemanticField(field_name="content"),
            SemanticField(field_name="summary")
        ],
        keywords_fields=[
            SemanticField(field_name="tags")
        ]
    )
)
```

## New Indexer Capabilities

**Integrated Vectorization**

Automatic embedding generation during indexing:

```python
from azure.search.documents.indexes.models import (
    SearchIndexerDataSourceConnection,
    SearchIndexer,
    FieldMapping,
    IndexingParameters,
    AzureOpenAIEmbeddingSkill,
    SearchIndexerSkillset
)

# Skill to generate embeddings
embedding_skill = AzureOpenAIEmbeddingSkill(
    name="embedding-skill",
    description="Generate embeddings using Azure OpenAI",
    context="/document",
    resource_uri="https://your-openai.openai.azure.com",
    deployment_id="text-embedding-3-small",
    model_name="text-embedding-3-small",
    inputs=[
        {"name": "text", "source": "/document/content"}
    ],
    outputs=[
        {"name": "embedding", "targetName": "content_embedding"}
    ]
)

skillset = SearchIndexerSkillset(
    name="embedding-skillset",
    skills=[embedding_skill],
    cognitive_services_account=None  # Uses managed identity
)
```

**Incremental Enrichment**

Only re-process changed documents:

```python
indexer = SearchIndexer(
    name="docs-indexer",
    data_source_name="blob-datasource",
    target_index_name="documents-index",
    skillset_name="embedding-skillset",
    parameters=IndexingParameters(
        configuration={
            "dataToExtract": "contentAndMetadata",
            "parsingMode": "default"
        }
    ),
    cache={
        "storageConnectionString": "your-storage-connection-string",
        "enableReprocessing": True
    }
)
```

## Performance Optimizations

**HNSW Tuning**

Fine-tune HNSW parameters for your workload:

```python
from azure.search.documents.indexes.models import HnswAlgorithmConfiguration

# High recall configuration (slower, more accurate)
high_recall_config = HnswAlgorithmConfiguration(
    name="high-recall",
    parameters={
        "m": 8,           # Connections per node (default: 4)
        "efConstruction": 800,  # Build-time accuracy (default: 400)
        "efSearch": 1000,       # Search-time accuracy (default: 500)
        "metric": "cosine"
    }
)

# High speed configuration (faster, less accurate)
high_speed_config = HnswAlgorithmConfiguration(
    name="high-speed",
    parameters={
        "m": 4,
        "efConstruction": 200,
        "efSearch": 100,
        "metric": "cosine"
    }
)
```

**Exhaustive KNN Option**

For smaller datasets or when exact results matter:

```python
from azure.search.documents.indexes.models import ExhaustiveKnnAlgorithmConfiguration

# Exact search (no approximation)
exact_config = ExhaustiveKnnAlgorithmConfiguration(
    name="exact",
    parameters={
        "metric": "cosine"
    }
)
```

## Security Updates

**Customer-Managed Keys for Vectors**

Encrypt vector data with your own keys:

```python
from azure.search.documents.indexes.models import SearchIndex, EncryptionKey

index = SearchIndex(
    name="encrypted-index",
    fields=fields,
    encryption_key=EncryptionKey(
        key_vault_key_name="your-key",
        key_vault_key_version="version",
        key_vault_uri="https://your-vault.vault.azure.net"
    )
)
```

**Private Endpoint Support**

Access search over private network:

```bicep
resource privateEndpoint 'Microsoft.Network/privateEndpoints@2023-05-01' = {
  name: 'pe-search'
  location: location
  properties: {
    subnet: {
      id: subnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'search-connection'
        properties: {
          privateLinkServiceId: searchService.id
          groupIds: ['searchService']
        }
      }
    ]
  }
}
```

## Best Practices for RAG

**Document Chunking Strategy**

```python
def chunk_document(content: str, chunk_size: int = 1000, overlap: int = 200) -> list[dict]:
    """Chunk document with metadata for optimal retrieval."""
    chunks = []
    start = 0
    chunk_num = 0

    while start < len(content):
        end = start + chunk_size
        chunk_text = content[start:end]

        # Try to break at sentence boundary
        if end < len(content):
            last_period = chunk_text.rfind('.')
            if last_period > chunk_size * 0.5:
                end = start + last_period + 1
                chunk_text = content[start:end]

        chunks.append({
            "chunk_id": f"chunk_{chunk_num}",
            "content": chunk_text.strip(),
            "chunk_number": chunk_num,
            "char_start": start,
            "char_end": end
        })

        start = end - overlap
        chunk_num += 1

    return chunks
```

**Optimal Query Pattern**

```python
async def hybrid_rag_search(query: str, filters: str = None) -> list[dict]:
    """Optimized hybrid search for RAG."""
    query_embedding = await generate_embedding(query)

    vector_query = VectorizedQuery(
        vector=query_embedding,
        k_nearest_neighbors=50,  # Over-retrieve
        fields="content_embedding"
    )

    results = client.search(
        search_text=query,
        vector_queries=[vector_query],
        filter=filters,
        query_type="semantic",
        semantic_configuration_name="default",
        top=10,
        select=["id", "content", "title", "url"]
    )

    return [
        {
            "content": r["content"],
            "title": r.get("title", ""),
            "url": r.get("url", ""),
            "score": r["@search.score"],
            "reranker_score": r.get("@search.reranker_score", 0)
        }
        for r in results
    ]
```

## Migration Considerations

If upgrading from older versions:

1. **Review vector dimensions**: Ensure compatibility with new embedding models
2. **Update HNSW parameters**: Default values have changed
3. **Test hybrid scoring**: RRF behavior may differ slightly
4. **Enable incremental enrichment**: Reduce reprocessing costs

## Conclusion

Azure AI Search's summer 2024 updates significantly improve vector search capabilities, hybrid retrieval, and operational efficiency. For RAG applications, the combination of larger vector support, better hybrid scoring, and integrated vectorization makes building production systems more straightforward.

Upgrade to take advantage of these improvements, and review your HNSW parameters to optimize for your specific workload.

