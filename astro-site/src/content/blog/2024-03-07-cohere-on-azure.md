---
title: "Cohere on Azure: Enterprise Search and RAG Solutions"
description: "Cohere's models are now available on Azure AI, offering specialized capabilities for enterprise search and retrieval-augmented generation (RAG). This guide…"
author: "Michael John Peña"
draft: false
date: 2024-03-07
tags: ["Azure", "Cohere", "AI", "RAG", "Search", "Embeddings"]
---

Cohere's models are now available on Azure AI, offering specialized capabilities for enterprise search and retrieval-augmented generation (RAG). This guide covers how to leverage Cohere's unique features.

## Cohere's Model Lineup

| Model | Purpose | Best For |
|-------|---------|----------|
| Command R | Generation with RAG | Document-based Q&A |
| Command R+ | Advanced RAG | Complex reasoning |
| Embed | Embeddings | Semantic search |
| Rerank | Relevance scoring | Search optimization |

## Setting Up Cohere on Azure

```python
from azure.ai.ml import MLClient
from azure.identity import DefaultAzureCredential

credential = DefaultAzureCredential()
ml_client = MLClient(
    credential=credential,
    subscription_id="your-subscription",
    resource_group="your-rg",
    workspace_name="your-workspace"
)

# Deploy Cohere Command R
from azure.ai.ml.entities import ServerlessEndpoint

endpoint = ServerlessEndpoint(
    name="cohere-command-r",
    model_id="azureml://registries/azureml-cohere/models/Cohere-command-r/versions/1"
)

ml_client.serverless_endpoints.begin_create_or_update(endpoint).result()
```

## Using Cohere Embed for Semantic Search

```python
import requests
import numpy as np
from typing import List

class CohereEmbeddings:
    def __init__(self, endpoint_url: str, api_key: str):
        self.endpoint_url = endpoint_url
        self.api_key = api_key

    def embed(self, texts: List[str], input_type: str = "search_document") -> np.ndarray:
        """
        input_type options:
        - search_document: For documents to be searched
        - search_query: For search queries
        - classification: For classification tasks
        - clustering: For clustering tasks
        """
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }

        payload = {
            "texts": texts,
            "input_type": input_type,
            "truncate": "END"
        }

        response = requests.post(
            f"{self.endpoint_url}/embed",
            headers=headers,
            json=payload
        )

        return np.array(response.json()["embeddings"])

# Example usage
embedder = CohereEmbeddings(
    endpoint_url="https://cohere-embed.inference.ai.azure.com",
    api_key="your-api-key"
)

# Embed documents
documents = [
    "Azure AI provides machine learning capabilities.",
    "Kubernetes orchestrates containerized applications.",
    "Python is a popular programming language."
]
doc_embeddings = embedder.embed(documents, input_type="search_document")

# Embed query
query = "What is cloud machine learning?"
query_embedding = embedder.embed([query], input_type="search_query")

# Calculate similarity
similarities = np.dot(doc_embeddings, query_embedding.T).flatten()
for doc, sim in zip(documents, similarities):
    print(f"Similarity: {sim:.4f} - {doc}")
```

## Using Cohere Rerank for Better Search

```python
import requests
from typing import List, Dict

class CohereRerank:
    def __init__(self, endpoint_url: str, api_key: str):
        self.endpoint_url = endpoint_url
        self.api_key = api_key

    def rerank(
        self,
        query: str,
        documents: List[str],
        top_n: int = 5
    ) -> List[Dict]:
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }

        payload = {
            "query": query,
            "documents": documents,
            "top_n": top_n,
            "return_documents": True
        }

        response = requests.post(
            f"{self.endpoint_url}/rerank",
            headers=headers,
            json=payload
        )

        return response.json()["results"]

# Example: Rerank search results
reranker = CohereRerank(
    endpoint_url="https://cohere-rerank.inference.ai.azure.com",
    api_key="your-api-key"
)

query = "How to deploy machine learning models?"
documents = [
    "Azure ML provides model deployment capabilities.",
    "Docker containers can run anywhere.",
    "MLflow tracks experiments and deploys models.",
    "Python is used for data science.",
    "Kubernetes manages containerized workloads."
]

results = reranker.rerank(query, documents, top_n=3)
for result in results:
    print(f"Score: {result['relevance_score']:.4f}")
    print(f"Document: {result['document']['text']}\n")
```

## Building a RAG Pipeline with Cohere

```python
import requests
from typing import List, Dict

class CohereRAGPipeline:
    def __init__(
        self,
        embed_endpoint: str,
        command_endpoint: str,
        rerank_endpoint: str,
        api_key: str
    ):
        self.embed_endpoint = embed_endpoint
        self.command_endpoint = command_endpoint
        self.rerank_endpoint = rerank_endpoint
        self.api_key = api_key
        self.documents: List[str] = []
        self.embeddings = None

    def index_documents(self, documents: List[str]):
        """Index documents with embeddings"""
        self.documents = documents

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }

        response = requests.post(
            f"{self.embed_endpoint}/embed",
            headers=headers,
            json={"texts": documents, "input_type": "search_document"}
        )

        self.embeddings = response.json()["embeddings"]

    def retrieve(self, query: str, top_k: int = 10) -> List[str]:
        """Retrieve relevant documents"""
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }

        # Embed query
        response = requests.post(
            f"{self.embed_endpoint}/embed",
            headers=headers,
            json={"texts": [query], "input_type": "search_query"}
        )
        query_embedding = response.json()["embeddings"][0]

        # Calculate similarities
        import numpy as np
        similarities = np.dot(self.embeddings, query_embedding)
        top_indices = np.argsort(similarities)[-top_k:][::-1]

        return [self.documents[i] for i in top_indices]

    def rerank(self, query: str, documents: List[str], top_n: int = 5) -> List[str]:
        """Rerank documents for relevance"""
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }

        response = requests.post(
            f"{self.rerank_endpoint}/rerank",
            headers=headers,
            json={"query": query, "documents": documents, "top_n": top_n}
        )

        results = response.json()["results"]
        return [r["document"]["text"] for r in results]

    def generate(self, query: str, context: List[str]) -> str:
        """Generate answer with context"""
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}"
        }

        # Format documents for Command R
        documents = [{"text": doc} for doc in context]

        payload = {
            "message": query,
            "documents": documents,
            "citation_quality": "accurate",
            "temperature": 0.3
        }

        response = requests.post(
            f"{self.command_endpoint}/chat",
            headers=headers,
            json=payload
        )

        return response.json()["text"]

    def query(self, question: str) -> str:
        """Full RAG pipeline"""
        # 1. Retrieve
        candidates = self.retrieve(question, top_k=20)

        # 2. Rerank
        relevant = self.rerank(question, candidates, top_n=5)

        # 3. Generate
        answer = self.generate(question, relevant)

        return answer

# Usage
pipeline = CohereRAGPipeline(
    embed_endpoint="https://cohere-embed.inference.ai.azure.com",
    command_endpoint="https://cohere-command-r.inference.ai.azure.com",
    rerank_endpoint="https://cohere-rerank.inference.ai.azure.com",
    api_key="your-api-key"
)

# Index your documents
pipeline.index_documents([
    "Azure Machine Learning is a cloud service for ML.",
    "Cohere provides NLP models for enterprise.",
    # ... more documents
])

# Query
answer = pipeline.query("What is Azure Machine Learning?")
print(answer)
```

## Conclusion

Cohere on Azure provides specialized tools for enterprise search and RAG. The combination of embeddings, reranking, and RAG-optimized generation makes it ideal for document-intensive applications.
