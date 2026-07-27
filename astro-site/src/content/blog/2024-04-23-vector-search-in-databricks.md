---
title: "Vector Search in Databricks: Semantic Search at Scale"
author: "Michael John Peña"
draft: false
date: 2024-04-23
tags: ["Databricks", "Vector Search", "Embeddings", "AI", "Search"]

---

I wrote "Vector Search in Databricks: Semantic Search at Scale" to share practical, production-minded guidance on this topic.

Databricks Vector Search enables semantic similarity search over your lakehouse data. Build RAG applications, recommendation systems, and intelligent search with managed vector indexes.

## Vector Search Architecture

```python
VECTOR_SEARCH_COMPONENTS = {
    "index_types": {
        "delta_sync": {
            "description": "Auto-syncs with Delta table",
            "use_case": "Production RAG applications",
            "features": ["Auto-refresh", "Managed embeddings", "Real-time sync"]
        },
        "direct_access": {
            "description": "Direct vector operations",
            "use_case": "Pre-computed embeddings",
            "features": ["Bring your own embeddings", "Manual updates"]
        }
    },
    "embedding_models": [
        "databricks-bge-large-en",
        "databricks-gte-large-en",
        "Custom models via Model Serving"
    ],
    "similarity_metrics": [
        "cosine",
        "dot_product",
        "euclidean"
    ]
}
```

## Setting Up Vector Search

```python
from databricks.vector_search.client import VectorSearchClient

# Initialize the client
vsc = VectorSearchClient()

# Create a Vector Search endpoint
endpoint = vsc.create_endpoint(
    name="my-vector-search-endpoint",
    endpoint_type="STANDARD"
)

# Wait for endpoint to be ready
vsc.wait_for_endpoint(endpoint.name)
print(f"Endpoint {endpoint.name} is ready")
```

## Creating a Delta Sync Index

```python
# Create index that auto-syncs with Delta table
index = vsc.create_delta_sync_index(
    endpoint_name="my-vector-search-endpoint",
    index_name="my_catalog.my_schema.document_index",

    # Source Delta table
    source_table_name="my_catalog.my_schema.documents",

    # Pipeline configuration
    pipeline_type="TRIGGERED",  # or "CONTINUOUS"

    # Column containing primary key
    primary_key="doc_id",

    # Column to embed (text column)
    embedding_source_column="content",

    # Embedding model endpoint
    embedding_model_endpoint_name="databricks-bge-large-en"
)

# Wait for index to be ready
vsc.wait_for_index(
    endpoint_name="my-vector-search-endpoint",
    index_name="my_catalog.my_schema.document_index"
)
```

## Creating a Direct Access Index

```python
# For pre-computed embeddings
index = vsc.create_direct_access_index(
    endpoint_name="my-vector-search-endpoint",
    index_name="my_catalog.my_schema.precomputed_index",
    primary_key="id",
    embedding_dimension=1024,
    embedding_vector_column="embedding",
    schema={
        "id": "string",
        "content": "string",
        "embedding": "array<float>",
        "metadata": "string"
    }
)
```

## Querying Vector Search

```python
from databricks.vector_search.client import VectorSearchClient

vsc = VectorSearchClient()

# Get the index
index = vsc.get_index(
    endpoint_name="my-vector-search-endpoint",
    index_name="my_catalog.my_schema.document_index"
)

# Similarity search with text query (auto-embedded)
results = index.similarity_search(
    query_text="How do I configure auto-scaling in Databricks?",
    columns=["doc_id", "title", "content", "source"],
    num_results=10,
    filters={"source": "documentation"}  # Optional filtering
)

# Process results
for doc in results['result']['data_array']:
    score = doc[0]  # Similarity score
    doc_id = doc[1]
    title = doc[2]
    content = doc[3]
    print(f"Score: {score:.4f} | {title}")
```

## Building a RAG Application

```python
import anthropic
from databricks.vector_search.client import VectorSearchClient

class DatabricksRAG:
    """RAG application using Databricks Vector Search"""

    def __init__(
        self,
        endpoint_name: str,
        index_name: str,
        llm_model: str = "claude-3-sonnet-20240229"
    ):
        self.vsc = VectorSearchClient()
        self.index = self.vsc.get_index(endpoint_name, index_name)
        self.llm = anthropic.Anthropic()
        self.llm_model = llm_model

    def retrieve(
        self,
        query: str,
        num_results: int = 5,
        filters: dict = None
    ) -> list:
        """Retrieve relevant documents"""

        results = self.index.similarity_search(
            query_text=query,
            columns=["doc_id", "title", "content"],
            num_results=num_results,
            filters=filters
        )

        documents = []
        for row in results['result']['data_array']:
            documents.append({
                "score": row[0],
                "doc_id": row[1],
                "title": row[2],
                "content": row[3]
            })

        return documents

    def generate(
        self,
        query: str,
        context: list,
        system_prompt: str = None
    ) -> str:
        """Generate response using retrieved context"""

        if system_prompt is None:
            system_prompt = """You are a helpful assistant that answers questions
            based on the provided context. If the context doesn't contain
            relevant information, say so."""

        # Format context
        context_text = "\n\n---\n\n".join([
            f"Source: {doc['title']}\n{doc['content']}"
            for doc in context
        ])

        # Generate response
        response = self.llm.messages.create(
            model=self.llm_model,
            max_tokens=1000,
            system=system_prompt,
            messages=[
                {
                    "role": "user",
                    "content": f"""Based on the following context, answer the question.

Context:
{context_text}

Question: {query}

Answer:"""
                }
            ]
        )

        return response.content[0].text

    def query(
        self,
        question: str,
        num_context: int = 5,
        filters: dict = None
    ) -> dict:
        """Complete RAG pipeline"""

        # Retrieve
        context = self.retrieve(question, num_context, filters)

        # Generate
        answer = self.generate(question, context)

        return {
            "question": question,
            "answer": answer,
            "sources": [
                {"title": doc["title"], "score": doc["score"]}
                for doc in context
            ]
        }

# Usage
rag = DatabricksRAG(
    endpoint_name="my-vector-search-endpoint",
    index_name="my_catalog.my_schema.document_index"
)

result = rag.query("How do I create a cluster in Databricks?")
print(result["answer"])
print("\nSources:")
for source in result["sources"]:
    print(f"  - {source['title']} (score: {source['score']:.3f})")
```

## Hybrid Search

```python
class HybridSearch:
    """Combine vector search with keyword search"""

    def __init__(self, vsc_client, index, spark):
        self.vsc = vsc_client
        self.index = index
        self.spark = spark

    def search(
        self,
        query: str,
        num_results: int = 10,
        vector_weight: float = 0.7
    ) -> list:
        """Perform hybrid search"""

        # Vector search
        vector_results = self.index.similarity_search(
            query_text=query,
            columns=["doc_id", "title", "content"],
            num_results=num_results * 2
        )

        # Keyword search using Spark SQL
        keyword_results = self.spark.sql(f"""
            SELECT
                doc_id,
                title,
                content,
                -- Simple BM25-like scoring
                (
                    SIZE(SPLIT(LOWER(content), '{query.lower()}')) - 1 +
                    SIZE(SPLIT(LOWER(title), '{query.lower()}')) * 2
                ) as keyword_score
            FROM documents
            WHERE LOWER(content) LIKE '%{query.lower()}%'
               OR LOWER(title) LIKE '%{query.lower()}%'
            ORDER BY keyword_score DESC
            LIMIT {num_results * 2}
        """).collect()

        # Combine and rank results
        combined = self._fuse_results(
            vector_results['result']['data_array'],
            keyword_results,
            vector_weight
        )

        return combined[:num_results]

    def _fuse_results(
        self,
        vector_results: list,
        keyword_results: list,
        vector_weight: float
    ) -> list:
        """Fuse results using reciprocal rank fusion"""

        scores = {}
        k = 60  # RRF constant

        # Score vector results
        for rank, row in enumerate(vector_results):
            doc_id = row[1]
            scores[doc_id] = scores.get(doc_id, 0) + \
                            vector_weight * (1 / (k + rank + 1))

        # Score keyword results
        for rank, row in enumerate(keyword_results):
            doc_id = row['doc_id']
            scores[doc_id] = scores.get(doc_id, 0) + \
                            (1 - vector_weight) * (1 / (k + rank + 1))

        # Sort by combined score
        ranked = sorted(scores.items(), key=lambda x: x[1], reverse=True)

        return ranked
```

## Monitoring and Maintenance

```python
# Monitor index status
def monitor_index(vsc, endpoint_name: str, index_name: str):
    """Monitor vector search index"""

    index = vsc.get_index(endpoint_name, index_name)

    print(f"Index: {index_name}")
    print(f"Status: {index.status}")
    print(f"Num vectors: {index.num_vectors}")
    print(f"Last updated: {index.last_updated}")

    # Check sync status for Delta Sync indexes
    if hasattr(index, 'sync_status'):
        print(f"Sync status: {index.sync_status}")

# Trigger manual sync
def sync_index(vsc, endpoint_name: str, index_name: str):
    """Trigger index sync with source table"""

    vsc.sync_index(
        endpoint_name=endpoint_name,
        index_name=index_name
    )
    print(f"Sync triggered for {index_name}")
```

## Conclusion

Databricks Vector Search provides managed semantic search infrastructure integrated with your lakehouse. Use it to build powerful RAG applications, recommendation systems, and intelligent search experiences.

