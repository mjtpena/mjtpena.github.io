---
title: "Azure AI Search Advanced Features: Beyond Basic Indexing"
author: Michael John Peña
draft: false
date: 2025-04-15
tags:
  - Azure
  - AI Search
  - Vector
  - Hybrid Search
  - Enterprise

---

I wrote "Azure AI Search Advanced Features: Beyond Basic Indexing" to share practical, production-minded guidance on this topic.

## Advanced Azure AI Search

```python
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    SearchFieldDataType,
    VectorSearch,
    HnswAlgorithmConfiguration,
    VectorSearchProfile,
    SemanticConfiguration,
    SemanticField,
    SemanticPrioritizedFields,
    SearchableField,
    SimpleField
)

class AdvancedAzureSearch:
    def __init__(self, endpoint: str, key: str):
        self.index_client = SearchIndexClient(endpoint, AzureKeyCredential(key))
        self.search_client = None

    def create_advanced_index(self, index_name: str) -> SearchIndex:
        """Create index with vector, semantic, and hybrid search."""
        fields = [
            SimpleField(name="id", type=SearchFieldDataType.String, key=True),
            SearchableField(name="content", type=SearchFieldDataType.String,
                           analyzer_name="en.microsoft"),
            SearchableField(name="title", type=SearchFieldDataType.String),
            SearchField(
                name="contentVector",
                type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
                searchable=True,
                vector_search_dimensions=1536,
                vector_search_profile_name="vector-profile"
            ),
            SimpleField(name="category", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="date", type=SearchFieldDataType.DateTimeOffset,
                       filterable=True, sortable=True)
        ]

        vector_search = VectorSearch(
            algorithms=[
                HnswAlgorithmConfiguration(
                    name="hnsw-config",
                    parameters={"m": 4, "efConstruction": 400, "efSearch": 500}
                )
            ],
            profiles=[
                VectorSearchProfile(
                    name="vector-profile",
                    algorithm_configuration_name="hnsw-config"
                )
            ]
        )

        semantic_config = SemanticConfiguration(
            name="semantic-config",
            prioritized_fields=SemanticPrioritizedFields(
                title_field=SemanticField(field_name="title"),
                content_fields=[SemanticField(field_name="content")]
            )
        )

        index = SearchIndex(
            name=index_name,
            fields=fields,
            vector_search=vector_search,
            semantic_configurations=[semantic_config]
        )

        return self.index_client.create_or_update_index(index)

    async def hybrid_search(
        self,
        query: str,
        query_vector: list[float],
        filters: str = None,
        top: int = 10
    ) -> list:
        """Perform hybrid search combining vector, keyword, and semantic."""
        results = self.search_client.search(
            search_text=query,
            vector_queries=[{
                "vector": query_vector,
                "k": top,
                "fields": "contentVector"
            }],
            filter=filters,
            query_type="semantic",
            semantic_configuration_name="semantic-config",
            top=top,
            select=["id", "title", "content", "category"]
        )

        return [
            {
                "id": r["id"],
                "title": r["title"],
                "content": r["content"],
                "score": r["@search.score"],
                "reranker_score": r.get("@search.reranker_score")
            }
            for r in results
        ]

    async def search_with_captions(self, query: str) -> list:
        """Search with AI-generated captions and answers."""
        results = self.search_client.search(
            search_text=query,
            query_type="semantic",
            semantic_configuration_name="semantic-config",
            query_caption="extractive",
            query_answer="extractive"
        )

        return {
            "answers": [a.text for a in results.get_answers()],
            "results": [{
                "content": r["content"],
                "captions": [c.text for c in r.get("@search.captions", [])]
            } for r in results]
        }
```

Azure AI Search combines the best of vector, keyword, and semantic search in one service.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
