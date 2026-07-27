---
title: "Azure AI Search Index Projections: Chunking Documents at Index Time"
author: Michael John Peña
draft: false
date: 2024-01-29
tags:
  - Azure AI Search
  - Index Projections
  - Chunking
  - RAG
  - Document Processing
---

Index projections let you chunk documents at index time — I used them to turn long manuals into searchable, LLM-friendly chunks. Here's a practical approach that kept retrieval precise and contextually relevant.

## The Problem

Large documents need to be chunked for RAG, but traditional indexing creates one index document per source document:

```
Source Document (10 pages) → One Index Document
                                    ↓
             Query retrieves entire 10-page document
                    (Too much context for LLM)
```

## The Solution: Index Projections

```
Source Document (10 pages) → Skillset (Chunking) → Multiple Index Documents
                                                          ↓
                                              Query retrieves relevant chunks
                                                (Right-sized for LLM)
```

## Configuration

### Skillset with Chunking

```python
from azure.search.documents.indexes.models import (
    SearchIndexerSkillset,
    SplitSkill,
    AzureOpenAIEmbeddingSkill
)

skillset = SearchIndexerSkillset(
    name="chunking-skillset",
    skills=[
        SplitSkill(
            name="chunk-documents",
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
            name="embed-chunks",
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

### Indexer with Projections

```python
indexer = SearchIndexer(
    name="document-indexer",
    data_source_name="blob-source",
    target_index_name="chunks-index",
    skillset_name="chunking-skillset",
    parameters=SearchIndexerParameters(
        configuration={
            "indexProjections": {
                "selectors": [
                    {
                        "targetIndexName": "chunks-index",
                        "parentKeyFieldName": "parent_id",
                        "sourceContext": "/document/chunks/*",
                        "mappings": [
                            {"name": "chunk_id", "source": "/document/chunks/*/id"},
                            {"name": "content", "source": "/document/chunks/*/content"},
                            {"name": "vector", "source": "/document/chunks/*/vector"},
                            {"name": "chunk_index", "source": "/document/chunks/*/ordinal"},
                            {"name": "source_file", "source": "/document/metadata_storage_name"},
                            {"name": "source_path", "source": "/document/metadata_storage_path"}
                        ]
                    }
                ],
                "parameters": {
                    "projectionMode": "generatedKeyAsKeyField"
                }
            }
        }
    )
)
```

### Target Index Schema

```python
index = SearchIndex(
    name="chunks-index",
    fields=[
        SearchField(name="chunk_id", type="Edm.String", key=True),
        SearchField(name="parent_id", type="Edm.String", filterable=True),
        SearchField(name="content", type="Edm.String", searchable=True),
        SearchField(
            name="vector",
            type="Collection(Edm.Single)",
            vector_search_dimensions=1536,
            vector_search_profile_name="vector-profile"
        ),
        SearchField(name="chunk_index", type="Edm.Int32", sortable=True),
        SearchField(name="source_file", type="Edm.String", filterable=True),
        SearchField(name="source_path", type="Edm.String")
    ],
    vector_search=vector_search_config
)
```

## Query Patterns

### Search Chunks

```python
def search_chunks(query: str, query_vector: list, top_k: int = 5):
    """Search for relevant chunks."""

    results = search_client.search(
        search_text=query,
        vector_queries=[
            VectorizedQuery(vector=query_vector, k=top_k, fields="vector")
        ],
        select=["chunk_id", "content", "parent_id", "chunk_index", "source_file"],
        top=top_k
    )

    return list(results)
```

### Retrieve Context with Adjacent Chunks

```python
def get_context_with_neighbors(chunk_id: str, parent_id: str, window: int = 1):
    """Get chunk with neighboring chunks for better context."""

    # Get the target chunk's position
    target = search_client.get_document(chunk_id)
    target_index = target["chunk_index"]

    # Search for neighboring chunks
    results = search_client.search(
        search_text="*",
        filter=f"parent_id eq '{parent_id}' and chunk_index ge {target_index - window} and chunk_index le {target_index + window}",
        order_by=["chunk_index"],
        select=["chunk_id", "content", "chunk_index"]
    )

    # Combine content in order
    chunks = sorted(results, key=lambda x: x["chunk_index"])
    combined_content = "\n\n".join([c["content"] for c in chunks])

    return combined_content
```

### Group Results by Document

```python
def search_and_group_by_document(query: str, query_vector: list, top_docs: int = 3):
    """Search chunks but group results by source document."""

    # Over-retrieve chunks
    results = search_client.search(
        search_text=query,
        vector_queries=[
            VectorizedQuery(vector=query_vector, k=20, fields="vector")
        ],
        select=["chunk_id", "content", "parent_id", "source_file", "@search.score"],
        top=20
    )

    # Group by parent document
    docs = {}
    for r in results:
        parent = r["parent_id"]
        if parent not in docs:
            docs[parent] = {
                "source_file": r["source_file"],
                "chunks": [],
                "max_score": 0
            }
        docs[parent]["chunks"].append(r)
        docs[parent]["max_score"] = max(docs[parent]["max_score"], r["@search.score"])

    # Sort by best chunk score and return top N documents
    sorted_docs = sorted(docs.values(), key=lambda x: x["max_score"], reverse=True)

    return sorted_docs[:top_docs]
```

## Best Practices

1. **Chunk size matters** - 500-2000 tokens typically works well
2. **Add overlap** - Prevents information loss at boundaries
3. **Preserve metadata** - Keep parent_id and source info for tracing
4. **Index chunk position** - Enables retrieving adjacent chunks
5. **Test chunk sizes** - Evaluate retrieval quality with your data

## Conclusion

Index projections transform RAG architectures by enabling proper document chunking at index time. The result is more relevant retrievals and better LLM responses. Use them for any RAG system dealing with multi-page documents.
