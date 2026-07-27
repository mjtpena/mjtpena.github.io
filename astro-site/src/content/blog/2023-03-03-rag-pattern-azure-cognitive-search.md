---
title: "Implementing RAG with Azure Cognitive Search"
author: Michael John Pena
draft: false
date: 2023-03-03
tags:
  - Azure
  - OpenAI
  - AI
  - RAG
  - Cognitive Search

---

I wrote "Implementing RAG with Azure Cognitive Search" to share practical, production-minded guidance on this topic.

## The RAG Architecture

```
User Query
    ↓
[Generate Embedding] → Azure OpenAI
    ↓
[Search Index] → Azure Cognitive Search
    ↓
[Retrieve Top K Documents]
    ↓
[Construct Prompt with Context]
    ↓
[Generate Response] → Azure OpenAI
    ↓
Response to User
```

## Setting Up the Components

### 1. Azure Cognitive Search Index

```python
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    SearchFieldDataType,
    VectorSearch,
    HnswVectorSearchAlgorithmConfiguration,
    SemanticConfiguration,
    SemanticField,
    SemanticSettings,
)
from azure.core.credentials import AzureKeyCredential

def create_search_index(index_name: str, search_endpoint: str, search_key: str):
    """Create an index optimized for RAG."""

    index_client = SearchIndexClient(
        endpoint=search_endpoint,
        credential=AzureKeyCredential(search_key)
    )

    fields = [
        SearchField(name="id", type=SearchFieldDataType.String, key=True),
        SearchField(name="title", type=SearchFieldDataType.String, searchable=True),
        SearchField(name="content", type=SearchFieldDataType.String, searchable=True),
        SearchField(name="source", type=SearchFieldDataType.String, filterable=True),
        SearchField(name="category", type=SearchFieldDataType.String, filterable=True, facetable=True),
        SearchField(
            name="contentVector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=1536,
            vector_search_configuration="vector-config"
        ),
    ]

    vector_search = VectorSearch(
        algorithm_configurations=[
            HnswVectorSearchAlgorithmConfiguration(
                name="vector-config",
                kind="hnsw",
                parameters={
                    "m": 4,
                    "efConstruction": 400,
                    "efSearch": 500,
                    "metric": "cosine"
                }
            )
        ]
    )

    semantic_config = SemanticConfiguration(
        name="semantic-config",
        prioritized_fields=SemanticSettings(
            title_field=SemanticField(field_name="title"),
            content_fields=[SemanticField(field_name="content")]
        )
    )

    index = SearchIndex(
        name=index_name,
        fields=fields,
        vector_search=vector_search,
        semantic_settings=SemanticSettings(configurations=[semantic_config])
    )

    index_client.create_or_update_index(index)
    return index
```

### 2. Document Ingestion Pipeline

```python
import openai
from azure.search.documents import SearchClient
import hashlib

class DocumentIngester:
    def __init__(self, search_client: SearchClient, openai_config: dict):
        self.search_client = search_client
        openai.api_type = "azure"
        openai.api_base = openai_config["endpoint"]
        openai.api_key = openai_config["key"]
        openai.api_version = "2023-03-15-preview"
        self.embedding_model = openai_config["embedding_deployment"]

    def chunk_document(self, content: str, chunk_size: int = 1000, overlap: int = 100) -> list[str]:
        """Split document into overlapping chunks."""
        words = content.split()
        chunks = []

        for i in range(0, len(words), chunk_size - overlap):
            chunk = ' '.join(words[i:i + chunk_size])
            if chunk:
                chunks.append(chunk)

        return chunks

    def get_embedding(self, text: str) -> list[float]:
        """Generate embedding using Azure OpenAI."""
        response = openai.Embedding.create(
            input=text,
            engine=self.embedding_model
        )
        return response['data'][0]['embedding']

    def ingest_document(self, title: str, content: str, source: str, category: str):
        """Ingest a document with chunking and embedding."""
        chunks = self.chunk_document(content)
        documents = []

        for i, chunk in enumerate(chunks):
            doc_id = hashlib.md5(f"{title}_{i}".encode()).hexdigest()
            embedding = self.get_embedding(chunk)

            documents.append({
                "id": doc_id,
                "title": f"{title} (Part {i+1})",
                "content": chunk,
                "source": source,
                "category": category,
                "contentVector": embedding
            })

        # Upload in batches
        batch_size = 100
        for i in range(0, len(documents), batch_size):
            batch = documents[i:i + batch_size]
            self.search_client.upload_documents(documents=batch)

        return len(documents)
```

### 3. RAG Query Engine

```python
class RAGEngine:
    def __init__(self, search_client: SearchClient, openai_config: dict):
        self.search_client = search_client
        openai.api_type = "azure"
        openai.api_base = openai_config["endpoint"]
        openai.api_key = openai_config["key"]
        openai.api_version = "2023-03-15-preview"
        self.embedding_model = openai_config["embedding_deployment"]
        self.chat_model = openai_config["chat_deployment"]

    def get_embedding(self, text: str) -> list[float]:
        response = openai.Embedding.create(
            input=text,
            engine=self.embedding_model
        )
        return response['data'][0]['embedding']

    def retrieve_context(self, query: str, top_k: int = 5, filters: str = None) -> list[dict]:
        """Retrieve relevant documents using hybrid search."""
        query_vector = self.get_embedding(query)

        results = self.search_client.search(
            search_text=query,
            vector=query_vector,
            top_k=top_k,
            vector_fields="contentVector",
            filter=filters,
            query_type="semantic",
            semantic_configuration_name="semantic-config",
            select=["id", "title", "content", "source"]
        )

        return [dict(r) for r in results]

    def generate_response(self, query: str, context_docs: list[dict]) -> str:
        """Generate response using retrieved context."""

        # Build context string
        context = "\n\n---\n\n".join([
            f"Source: {doc['source']}\nTitle: {doc['title']}\n{doc['content']}"
            for doc in context_docs
        ])

        system_prompt = """You are a helpful assistant that answers questions based on the provided context.
Rules:
1. Only use information from the provided context
2. If the context doesn't contain the answer, say so
3. Cite your sources by mentioning the document title
4. Be concise but thorough"""

        user_prompt = f"""Context:
{context}

Question: {query}

Answer based on the context above:"""

        response = openai.ChatCompletion.create(
            engine=self.chat_model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.3,
            max_tokens=1000
        )

        return response.choices[0].message.content

    def query(self, question: str, filters: str = None) -> dict:
        """Full RAG pipeline."""
        # Retrieve
        context_docs = self.retrieve_context(question, filters=filters)

        # Generate
        response = self.generate_response(question, context_docs)

        return {
            "question": question,
            "answer": response,
            "sources": [{"title": d["title"], "source": d["source"]} for d in context_docs]
        }
```

## Advanced Patterns

### Query Rewriting

Improve retrieval by rewriting queries:

```python
def rewrite_query(self, original_query: str) -> list[str]:
    """Generate multiple search queries from user question."""
    prompt = f"""Generate 3 different search queries that could help answer this question.
Return only the queries, one per line.

Question: {original_query}

Search queries:"""

    response = openai.ChatCompletion.create(
        engine=self.chat_model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.5
    )

    queries = response.choices[0].message.content.strip().split('\n')
    return [q.strip() for q in queries if q.strip()]
```

### Contextual Compression

Reduce context to most relevant parts:

```python
def compress_context(self, query: str, documents: list[dict]) -> list[dict]:
    """Extract only relevant portions from retrieved documents."""
    compressed = []

    for doc in documents:
        prompt = f"""Extract only the sentences from this document that are relevant to answering the question.
If nothing is relevant, respond with "NOT_RELEVANT".

Question: {query}

Document:
{doc['content']}

Relevant sentences:"""

        response = openai.ChatCompletion.create(
            engine=self.chat_model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        extracted = response.choices[0].message.content.strip()
        if extracted != "NOT_RELEVANT":
            compressed.append({
                **doc,
                "content": extracted
            })

    return compressed
```

### Source Attribution

Track which parts of the answer came from which source:

```python
def generate_with_citations(self, query: str, context_docs: list[dict]) -> dict:
    """Generate response with inline citations."""

    # Number the sources
    numbered_context = []
    for i, doc in enumerate(context_docs, 1):
        numbered_context.append(f"[{i}] {doc['title']}\n{doc['content']}")

    system_prompt = """Answer questions using the provided sources.
When you use information from a source, cite it using [number] format.
Example: Azure Functions supports Python [1] and C# [2]."""

    user_prompt = f"""Sources:
{chr(10).join(numbered_context)}

Question: {query}"""

    response = openai.ChatCompletion.create(
        engine=self.chat_model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ],
        temperature=0.3
    )

    return {
        "answer": response.choices[0].message.content,
        "citations": {str(i): doc["source"] for i, doc in enumerate(context_docs, 1)}
    }
```

## Putting It Together

```python
# Initialize
search_client = SearchClient(
    endpoint="https://your-search.search.windows.net",
    index_name="documents",
    credential=AzureKeyCredential("your-key")
)

openai_config = {
    "endpoint": "https://your-openai.openai.azure.com/",
    "key": "your-key",
    "embedding_deployment": "text-embedding-ada-002",
    "chat_deployment": "gpt-35-turbo"
}

rag = RAGEngine(search_client, openai_config)

# Query
result = rag.query("How do I configure Azure Data Factory triggers?")
print(f"Answer: {result['answer']}")
print(f"Sources: {result['sources']}")
```

## Key Considerations

1. **Chunk size**: Balance between context and relevance
2. **Top K**: More documents = more context but also more noise
3. **Hybrid search**: Combine vector and keyword for best results
4. **Filtering**: Use metadata filters to scope searches
5. **Evaluation**: Measure relevance, faithfulness, and coverage

RAG is the bridge between general-purpose LLMs and your specific enterprise data. Get it right, and you unlock tremendous value.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
