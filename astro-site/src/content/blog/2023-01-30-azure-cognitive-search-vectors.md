---
title: "Azure Cognitive Search Vector Search Preview: Native Azure Vector DB"
author: Michael John Peña
draft: false
date: 2023-01-30
tags:
  - Azure
  - Cognitive Search
  - Vector Search
  - Embeddings
  - AI

---

I wrote "Azure Cognitive Search Vector Search Preview: Native Azure Vector DB" to share practical, production-minded guidance on this topic.

## Why Azure Cognitive Search for Vectors?

- **Native Azure Integration**: Works seamlessly with Azure services
- **Hybrid Search**: Combine vectors with full-text search
- **Enterprise Ready**: Security, compliance, and SLA
- **Existing Infrastructure**: Add vectors to existing indexes

## Getting Started

```bash
pip install azure-search-documents openai
```

```python
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SimpleField,
    SearchableField,
    SearchFieldDataType,
    VectorSearch,
    HnswVectorSearchAlgorithmConfiguration,
    VectorSearchProfile,
    SearchField
)
from azure.core.credentials import AzureKeyCredential
import openai

# Configure Azure Cognitive Search
search_endpoint = "https://your-search.search.windows.net"
search_key = "your-search-admin-key"
index_name = "azure-docs-vector"

# Configure Azure OpenAI
openai.api_type = "azure"
openai.api_base = "https://your-openai.openai.azure.com/"
openai.api_version = "2023-03-15-preview"
openai.api_key = "your-openai-key"
```

## Creating Vector Index

```python
def create_vector_index(
    endpoint: str,
    key: str,
    index_name: str
):
    """Create an index with vector search capability."""

    index_client = SearchIndexClient(
        endpoint=endpoint,
        credential=AzureKeyCredential(key)
    )

    # Define vector search configuration
    vector_search = VectorSearch(
        algorithms=[
            HnswVectorSearchAlgorithmConfiguration(
                name="hnsw-config",
                parameters={
                    "m": 4,
                    "efConstruction": 400,
                    "efSearch": 500,
                    "metric": "cosine"
                }
            )
        ],
        profiles=[
            VectorSearchProfile(
                name="vector-profile",
                algorithm="hnsw-config"
            )
        ]
    )

    # Define fields
    fields = [
        SimpleField(
            name="id",
            type=SearchFieldDataType.String,
            key=True,
            filterable=True
        ),
        SearchableField(
            name="title",
            type=SearchFieldDataType.String,
            searchable=True
        ),
        SearchableField(
            name="content",
            type=SearchFieldDataType.String,
            searchable=True
        ),
        SimpleField(
            name="category",
            type=SearchFieldDataType.String,
            filterable=True,
            facetable=True
        ),
        SearchField(
            name="contentVector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=1536,
            vector_search_profile="vector-profile"
        )
    ]

    index = SearchIndex(
        name=index_name,
        fields=fields,
        vector_search=vector_search
    )

    index_client.create_or_update_index(index)
    return index

# Create index
create_vector_index(search_endpoint, search_key, index_name)
```

## Uploading Documents

```python
from typing import List, Dict
import uuid

def get_embedding(text: str) -> List[float]:
    """Get embedding from Azure OpenAI."""
    response = openai.Embedding.create(
        engine="text-embedding-ada-002",
        input=text
    )
    return response['data'][0]['embedding']

def upload_documents(
    endpoint: str,
    key: str,
    index_name: str,
    documents: List[Dict]
):
    """Upload documents with embeddings."""

    search_client = SearchClient(
        endpoint=endpoint,
        index_name=index_name,
        credential=AzureKeyCredential(key)
    )

    # Add embeddings
    docs_with_vectors = []
    for doc in documents:
        text = f"{doc.get('title', '')} {doc.get('content', '')}"
        embedding = get_embedding(text)

        docs_with_vectors.append({
            **doc,
            "contentVector": embedding
        })

    # Upload
    result = search_client.upload_documents(docs_with_vectors)
    return result

# Upload documents
documents = [
    {
        "id": "1",
        "title": "Azure Virtual Machines",
        "content": "Azure VMs provide scalable IaaS compute resources in the cloud.",
        "category": "compute"
    },
    {
        "id": "2",
        "title": "Azure Functions",
        "content": "Azure Functions is a serverless compute service for event-driven code.",
        "category": "compute"
    },
    {
        "id": "3",
        "title": "Azure Cosmos DB",
        "content": "Cosmos DB is a globally distributed, multi-model database service.",
        "category": "database"
    }
]

upload_documents(search_endpoint, search_key, index_name, documents)
```

## Vector Search

```python
from azure.search.documents.models import Vector

def vector_search(
    endpoint: str,
    key: str,
    index_name: str,
    query: str,
    top_k: int = 5,
    filter: str = None
) -> List[Dict]:
    """Perform vector similarity search."""

    search_client = SearchClient(
        endpoint=endpoint,
        index_name=index_name,
        credential=AzureKeyCredential(key)
    )

    # Get query embedding
    query_embedding = get_embedding(query)

    # Create vector query
    vector = Vector(
        value=query_embedding,
        k=top_k,
        fields="contentVector"
    )

    results = search_client.search(
        search_text=None,  # No text search, vector only
        vectors=[vector],
        filter=filter,
        select=["id", "title", "content", "category"]
    )

    return [
        {
            "id": r["id"],
            "title": r["title"],
            "content": r["content"],
            "category": r["category"],
            "score": r["@search.score"]
        }
        for r in results
    ]

# Vector search
results = vector_search(
    search_endpoint, search_key, index_name,
    "serverless computing"
)
for r in results:
    print(f"[{r['score']:.4f}] {r['title']}")

# Vector search with filter
results = vector_search(
    search_endpoint, search_key, index_name,
    "database for analytics",
    filter="category eq 'database'"
)
```

## Hybrid Search

Combine vector and text search:

```python
def hybrid_search(
    endpoint: str,
    key: str,
    index_name: str,
    query: str,
    top_k: int = 5,
    filter: str = None
) -> List[Dict]:
    """Perform hybrid (vector + text) search."""

    search_client = SearchClient(
        endpoint=endpoint,
        index_name=index_name,
        credential=AzureKeyCredential(key)
    )

    query_embedding = get_embedding(query)

    vector = Vector(
        value=query_embedding,
        k=top_k,
        fields="contentVector"
    )

    results = search_client.search(
        search_text=query,  # Text search
        vectors=[vector],   # Plus vector search
        filter=filter,
        select=["id", "title", "content", "category"],
        top=top_k
    )

    return list(results)

# Hybrid search combines both approaches
results = hybrid_search(
    search_endpoint, search_key, index_name,
    "Azure Functions serverless"
)
```

## Complete Search Service

```python
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.core.credentials import AzureKeyCredential
from typing import List, Dict, Optional

class AzureSearchService:
    """Search service using Azure Cognitive Search vectors."""

    def __init__(
        self,
        search_endpoint: str,
        search_key: str,
        index_name: str,
        embedding_deployment: str = "text-embedding-ada-002"
    ):
        self.search_client = SearchClient(
            endpoint=search_endpoint,
            index_name=index_name,
            credential=AzureKeyCredential(search_key)
        )
        self.index_client = SearchIndexClient(
            endpoint=search_endpoint,
            credential=AzureKeyCredential(search_key)
        )
        self.index_name = index_name
        self.embedding_deployment = embedding_deployment

    def _embed(self, text: str) -> List[float]:
        """Get embedding for text."""
        response = openai.Embedding.create(
            engine=self.embedding_deployment,
            input=text
        )
        return response['data'][0]['embedding']

    def add_documents(
        self,
        documents: List[Dict],
        text_fields: List[str] = ["title", "content"],
        vector_field: str = "contentVector"
    ):
        """Add documents with embeddings."""
        docs_with_vectors = []

        for doc in documents:
            # Combine text fields for embedding
            text = " ".join([
                str(doc.get(field, ""))
                for field in text_fields
            ])

            embedding = self._embed(text)
            doc_with_vector = {**doc, vector_field: embedding}
            docs_with_vectors.append(doc_with_vector)

        return self.search_client.upload_documents(docs_with_vectors)

    def vector_search(
        self,
        query: str,
        top_k: int = 10,
        filter_expr: Optional[str] = None,
        vector_field: str = "contentVector"
    ) -> List[Dict]:
        """Perform vector-only search."""
        query_embedding = self._embed(query)

        vector = Vector(
            value=query_embedding,
            k=top_k,
            fields=vector_field
        )

        results = self.search_client.search(
            search_text=None,
            vectors=[vector],
            filter=filter_expr,
            top=top_k
        )

        return [dict(r) for r in results]

    def hybrid_search(
        self,
        query: str,
        top_k: int = 10,
        filter_expr: Optional[str] = None,
        vector_field: str = "contentVector"
    ) -> List[Dict]:
        """Perform hybrid search."""
        query_embedding = self._embed(query)

        vector = Vector(
            value=query_embedding,
            k=top_k,
            fields=vector_field
        )

        results = self.search_client.search(
            search_text=query,
            vectors=[vector],
            filter=filter_expr,
            top=top_k
        )

        return [dict(r) for r in results]

    def delete_documents(self, ids: List[str]):
        """Delete documents by ID."""
        documents = [{"id": doc_id} for doc_id in ids]
        return self.search_client.delete_documents(documents)

    def get_document(self, doc_id: str) -> Optional[Dict]:
        """Get a single document by ID."""
        try:
            return self.search_client.get_document(doc_id)
        except:
            return None

# Usage
service = AzureSearchService(
    search_endpoint="https://your-search.search.windows.net",
    search_key="your-key",
    index_name="docs-index"
)

# Add documents
service.add_documents([
    {"id": "1", "title": "Azure Guide", "content": "Azure is...", "category": "cloud"}
])

# Vector search
results = service.vector_search("cloud computing")

# Hybrid search
results = service.hybrid_search("serverless functions")
```

## Best Practices

1. **Use hybrid search**: Combines strengths of both approaches
2. **Index text fields**: For full-text search capability
3. **Optimize HNSW params**: Balance accuracy and speed
4. **Filter strategically**: Use filters to narrow results
5. **Monitor performance**: Track search latency and relevance
6. **Plan for scale**: Consider partitioning for large indexes

## Resources

- [Azure Cognitive Search Vector Search](https://learn.microsoft.com/azure/search/vector-search-overview)
- [Azure Search Python SDK](https://github.com/Azure/azure-sdk-for-python/tree/main/sdk/search/azure-search-documents)
- [Cognitive Search Pricing](https://azure.microsoft.com/pricing/details/search/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
