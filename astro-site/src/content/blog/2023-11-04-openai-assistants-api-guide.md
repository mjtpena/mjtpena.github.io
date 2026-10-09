---
title: "Building RAG Applications with Azure Cognitive Search and OpenAI"
description: "RAG with Azure Cognitive Search and Azure OpenAI is the production architecture I recommend most often for enterprise knowledge retrieval — not because it's…"
author: "Michael John Peña"
draft: false
date: 2023-11-04
tags: ["Azure", "RAG", "OpenAI", "Cognitive Search", "AI"]
---

RAG with Azure Cognitive Search and Azure OpenAI is the production architecture I recommend most often for enterprise knowledge retrieval — not because it's the newest or most sophisticated, but because it's the most supportable. Azure Cognitive Search (rebranded to Azure AI Search in 2023) has enterprise operational characteristics that vector database startups can't match yet: SLA, compliance certifications, Azure RBAC, and a hybrid retrieval mode that combines semantic vector search with keyword search (BM25) in a single query. The hybrid mode is the most important operational feature: it prevents the failure mode where vector similarity misses exact-match queries (product codes, reference numbers, names) that keyword search would have caught. Building RAG on Azure Cognitive Search means you're not managing a separate vector database service — the retrieval layer lives in the same Azure subscription with the same governance and monitoring tooling as everything else.

## RAG Architecture Overview

The RAG pattern combines three components:
1. **Retrieval**: Finding relevant documents from a knowledge base
2. **Augmentation**: Enriching the prompt with retrieved context
3. **Generation**: Producing answers using an LLM

## Building the Retrieval Layer

### Azure Cognitive Search Setup

```python
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex,
    SearchField,
    SearchFieldDataType,
    SimpleField,
    SearchableField,
    VectorSearch,
    HnswAlgorithmConfiguration,
    VectorSearchProfile,
    SemanticConfiguration,
    SemanticField,
    SemanticPrioritizedFields,
    SemanticSearch
)
from azure.core.credentials import AzureKeyCredential
import os

class RAGSearchService:
    def __init__(self):
        self.endpoint = os.getenv("AZURE_SEARCH_ENDPOINT")
        self.key = os.getenv("AZURE_SEARCH_KEY")
        self.index_name = "rag-knowledge-base"

        self.index_client = SearchIndexClient(
            endpoint=self.endpoint,
            credential=AzureKeyCredential(self.key)
        )

    def create_index(self, vector_dimensions: int = 1536):
        """Create search index with vector and semantic search."""
        fields = [
            SimpleField(name="id", type=SearchFieldDataType.String, key=True),
            SearchableField(name="title", type=SearchFieldDataType.String),
            SearchableField(name="content", type=SearchFieldDataType.String),
            SearchableField(name="category", type=SearchFieldDataType.String, filterable=True),
            SimpleField(name="source", type=SearchFieldDataType.String),
            SimpleField(name="last_updated", type=SearchFieldDataType.DateTimeOffset, filterable=True),
            SearchField(
                name="content_vector",
                type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
                searchable=True,
                vector_search_dimensions=vector_dimensions,
                vector_search_profile_name="vector-profile"
            )
        ]

        vector_search = VectorSearch(
            algorithms=[
                HnswAlgorithmConfiguration(
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

        semantic_search = SemanticSearch(configurations=[semantic_config])

        index = SearchIndex(
            name=self.index_name,
            fields=fields,
            vector_search=vector_search,
            semantic_search=semantic_search
        )

        self.index_client.create_or_update_index(index)
        print(f"Index '{self.index_name}' created successfully")

    def get_search_client(self) -> SearchClient:
        """Get search client for the index."""
        return SearchClient(
            endpoint=self.endpoint,
            index_name=self.index_name,
            credential=AzureKeyCredential(self.key)
        )

# Initialize
search_service = RAGSearchService()
search_service.create_index()
```

### Document Chunking and Embedding

```python
from openai import AzureOpenAI
from typing import List, Dict
import hashlib
import re

class DocumentChunker:
    def __init__(
        self,
        chunk_size: int = 1000,
        chunk_overlap: int = 200
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

        self.openai_client = AzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_KEY"),
            api_version="2023-05-15",
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")
        )

    def chunk_document(self, content: str, metadata: Dict) -> List[Dict]:
        """Split document into overlapping chunks."""
        # Clean content
        content = re.sub(r'\s+', ' ', content).strip()

        chunks = []
        start = 0

        while start < len(content):
            end = start + self.chunk_size

            # Try to break at sentence boundary
            if end < len(content):
                last_period = content.rfind('.', start, end)
                if last_period > start + self.chunk_size // 2:
                    end = last_period + 1

            chunk_text = content[start:end].strip()

            if chunk_text:
                chunk_id = hashlib.sha256(
                    f"{metadata.get('source', '')}-{start}".encode()
                ).hexdigest()[:16]

                chunks.append({
                    "id": chunk_id,
                    "content": chunk_text,
                    "title": metadata.get("title", ""),
                    "category": metadata.get("category", ""),
                    "source": metadata.get("source", ""),
                    "chunk_index": len(chunks)
                })

            start = end - self.chunk_overlap

        return chunks

    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings for texts."""
        response = self.openai_client.embeddings.create(
            model="text-embedding-ada-002",  # deployment name
            input=texts
        )

        return [item.embedding for item in response.data]

    def process_document(self, content: str, metadata: Dict) -> List[Dict]:
        """Chunk document and generate embeddings."""
        chunks = self.chunk_document(content, metadata)

        # Generate embeddings in batches
        batch_size = 16
        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            texts = [c["content"] for c in batch]
            embeddings = self.generate_embeddings(texts)

            for chunk, embedding in zip(batch, embeddings):
                chunk["content_vector"] = embedding

        return chunks

# Usage
chunker = DocumentChunker(chunk_size=1000, chunk_overlap=200)

# Process a document
document_content = open("knowledge_base/company_policies.md").read()
chunks = chunker.process_document(
    content=document_content,
    metadata={
        "title": "Company Policies",
        "category": "HR",
        "source": "company_policies.md"
    }
)

# Index chunks
search_client = search_service.get_search_client()
search_client.upload_documents(chunks)
```

## Building the RAG Pipeline

### Retrieval with Hybrid Search

```python
from azure.search.documents.models import VectorizedQuery

class RAGRetriever:
    def __init__(self, search_client: SearchClient, openai_client: AzureOpenAI):
        self.search_client = search_client
        self.openai_client = openai_client

    def get_query_embedding(self, query: str) -> List[float]:
        """Generate embedding for search query."""
        response = self.openai_client.embeddings.create(
            model="text-embedding-ada-002",
            input=query
        )
        return response.data[0].embedding

    def hybrid_search(
        self,
        query: str,
        top_k: int = 5,
        filter_expression: str = None
    ) -> List[Dict]:
        """Perform hybrid (keyword + vector) search."""
        query_embedding = self.get_query_embedding(query)

        vector_query = VectorizedQuery(
            vector=query_embedding,
            k_nearest_neighbors=top_k,
            fields="content_vector"
        )

        results = self.search_client.search(
            search_text=query,
            vector_queries=[vector_query],
            filter=filter_expression,
            top=top_k,
            query_type="semantic",
            semantic_configuration_name="semantic-config"
        )

        retrieved = []
        for result in results:
            retrieved.append({
                "id": result["id"],
                "title": result.get("title", ""),
                "content": result["content"],
                "category": result.get("category", ""),
                "source": result.get("source", ""),
                "score": result["@search.score"],
                "reranker_score": result.get("@search.reranker_score")
            })

        return retrieved

    def rerank_results(
        self,
        query: str,
        results: List[Dict],
        top_k: int = 3
    ) -> List[Dict]:
        """Rerank results using cross-encoder pattern."""
        # Use GPT to score relevance
        scored_results = []

        for result in results:
            prompt = f"""Rate the relevance of this document to the query on a scale of 0-10.

Query: {query}

Document:
{result['content'][:500]}

Respond with only a number from 0-10."""

            response = self.openai_client.chat.completions.create(
                model="gpt-35-turbo",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=5,
                temperature=0
            )

            try:
                score = float(response.choices[0].message.content.strip())
            except ValueError:
                score = 5.0

            result["relevance_score"] = score
            scored_results.append(result)

        # Sort by relevance and return top_k
        scored_results.sort(key=lambda x: x["relevance_score"], reverse=True)
        return scored_results[:top_k]

# Initialize retriever
retriever = RAGRetriever(
    search_client=search_service.get_search_client(),
    openai_client=chunker.openai_client
)
```

### Generation with Context

```python
class RAGGenerator:
    def __init__(self, openai_client: AzureOpenAI):
        self.client = openai_client

    def build_context(self, retrieved_docs: List[Dict]) -> str:
        """Build context string from retrieved documents."""
        context_parts = []

        for i, doc in enumerate(retrieved_docs, 1):
            context_parts.append(f"[Source {i}: {doc['source']}]")
            context_parts.append(doc['content'])
            context_parts.append("")

        return "\n".join(context_parts)

    def generate_response(
        self,
        query: str,
        retrieved_docs: List[Dict],
        system_prompt: str = None
    ) -> Dict:
        """Generate response using retrieved context."""
        context = self.build_context(retrieved_docs)

        if not system_prompt:
            system_prompt = """You are a helpful assistant that answers questions based on the provided context.
Always cite your sources using [Source N] notation.
If the context doesn't contain relevant information, say so clearly.
Be concise but thorough."""

        messages = [
            {"role": "system", "content": system_prompt},
            {
                "role": "user",
                "content": f"""Context:
{context}

Question: {query}

Please answer based on the context provided above."""
            }
        ]

        response = self.client.chat.completions.create(
            model="gpt-4",
            messages=messages,
            temperature=0.3,
            max_tokens=1000
        )

        return {
            "answer": response.choices[0].message.content,
            "sources": [
                {"source": doc["source"], "title": doc["title"]}
                for doc in retrieved_docs
            ],
            "token_usage": {
                "prompt": response.usage.prompt_tokens,
                "completion": response.usage.completion_tokens
            }
        }

# Complete RAG Pipeline
class RAGPipeline:
    def __init__(self):
        self.search_service = RAGSearchService()
        self.openai_client = AzureOpenAI(
            api_key=os.getenv("AZURE_OPENAI_KEY"),
            api_version="2023-05-15",
            azure_endpoint=os.getenv("AZURE_OPENAI_ENDPOINT")
        )
        self.retriever = RAGRetriever(
            search_client=self.search_service.get_search_client(),
            openai_client=self.openai_client
        )
        self.generator = RAGGenerator(self.openai_client)

    def query(
        self,
        question: str,
        top_k: int = 5,
        rerank: bool = True,
        category_filter: str = None
    ) -> Dict:
        """Execute full RAG pipeline."""
        # Build filter if category specified
        filter_expr = f"category eq '{category_filter}'" if category_filter else None

        # Retrieve relevant documents
        retrieved = self.retriever.hybrid_search(
            query=question,
            top_k=top_k,
            filter_expression=filter_expr
        )

        # Optionally rerank
        if rerank and len(retrieved) > 3:
            retrieved = self.retriever.rerank_results(
                query=question,
                results=retrieved,
                top_k=3
            )

        # Generate response
        response = self.generator.generate_response(
            query=question,
            retrieved_docs=retrieved
        )

        return response

# Usage
rag = RAGPipeline()

result = rag.query(
    question="What is the company's policy on remote work?",
    category_filter="HR"
)

print(f"Answer: {result['answer']}")
print(f"\nSources:")
for source in result['sources']:
    print(f"  - {source['title']} ({source['source']})")
```

## Conclusion

Building production RAG systems requires careful attention to chunking strategies, embedding quality, and retrieval techniques. Azure Cognitive Search's hybrid search capabilities combined with Azure OpenAI provide a powerful foundation. The key is balancing retrieval precision with generation quality while keeping costs manageable.
