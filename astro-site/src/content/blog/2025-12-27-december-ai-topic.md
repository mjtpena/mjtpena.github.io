---
title: "Building a Custom GPT for Your Documentation with Azure OpenAI"
description: "This pattern works for any documentation. The key is good chunking, quality embeddings, and a well-crafted system prompt that keeps the bot focused on your…"
author: Michael John Peña
draft: false
date: 2025-12-27
tags:
  - Azure-OpenAI
  - Documentation
  - RAG
  - Tutorial
  - ChatGPT
---

## Architecture

```
User Question -> Azure OpenAI -> Search Your Docs -> Generate Answer
                    |
              System Prompt (defines persona)
                    |
              Azure AI Search (retrieves relevant docs)
```

## Step 1: Prepare Your Documentation

```python
import os
from azure.ai.formrecognizer import DocumentAnalysisClient
from azure.core.credentials import AzureKeyCredential

def extract_text_from_docs(folder_path: str) -> list[dict]:
    """Extract text from various document formats."""
    documents = []

    for filename in os.listdir(folder_path):
        filepath = os.path.join(folder_path, filename)

        if filename.endswith('.md'):
            with open(filepath, 'r') as f:
                content = f.read()
        elif filename.endswith('.pdf'):
            content = extract_pdf_with_form_recognizer(filepath)
        else:
            continue

        documents.append({
            "id": filename,
            "content": content,
            "source": filename,
            "chunk_id": 0
        })

    return documents

def chunk_documents(documents: list[dict], chunk_size: int = 1000) -> list[dict]:
    """Split documents into smaller chunks for better retrieval."""
    chunks = []

    for doc in documents:
        content = doc["content"]
        words = content.split()

        for i in range(0, len(words), chunk_size):
            chunk_content = " ".join(words[i:i + chunk_size])
            chunks.append({
                "id": f"{doc['id']}_chunk_{i // chunk_size}",
                "content": chunk_content,
                "source": doc["source"],
                "chunk_id": i // chunk_size
            })

    return chunks
```

## Step 2: Index in Azure AI Search

```python
from azure.search.documents import SearchClient
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import (
    SearchIndex, SearchField, SearchFieldDataType,
    VectorSearch, HnswAlgorithmConfiguration, VectorSearchProfile
)

def create_search_index(index_client: SearchIndexClient, index_name: str):
    """Create search index with vector search capability."""
    fields = [
        SearchField(name="id", type=SearchFieldDataType.String, key=True),
        SearchField(name="content", type=SearchFieldDataType.String, searchable=True),
        SearchField(name="source", type=SearchFieldDataType.String, filterable=True),
        SearchField(
            name="content_vector",
            type=SearchFieldDataType.Collection(SearchFieldDataType.Single),
            searchable=True,
            vector_search_dimensions=1536,
            vector_search_profile_name="default-profile"
        )
    ]

    vector_search = VectorSearch(
        algorithms=[HnswAlgorithmConfiguration(name="default-algorithm")],
        profiles=[VectorSearchProfile(name="default-profile", algorithm_configuration_name="default-algorithm")]
    )

    index = SearchIndex(name=index_name, fields=fields, vector_search=vector_search)
    index_client.create_or_update_index(index)
```

## Step 3: Create the Chat Interface

```python
from openai import AzureOpenAI
from azure.search.documents import SearchClient

class DocumentChatbot:
    def __init__(self, openai_client: AzureOpenAI, search_client: SearchClient):
        self.openai = openai_client
        self.search = search_client
        self.system_prompt = """You are a helpful assistant that answers questions about our documentation.

Rules:
1. Only answer based on the provided context
2. If the answer isn't in the context, say "I don't have information about that"
3. Cite the source document when answering
4. Be concise but complete"""

    async def chat(self, user_question: str) -> str:
        # Retrieve relevant documents
        context = await self._retrieve_context(user_question)

        # Generate answer
        response = await self.openai.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": self.system_prompt},
                {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {user_question}"}
            ],
            temperature=0.7,
            max_tokens=500
        )

        return response.choices[0].message.content

    async def _retrieve_context(self, query: str, top_k: int = 5) -> str:
        # Get embedding for query
        embedding = await self._get_embedding(query)

        # Search
        results = self.search.search(
            search_text=query,
            vector_queries=[{
                "vector": embedding,
                "k_nearest_neighbors": top_k,
                "fields": "content_vector"
            }],
            top=top_k
        )

        # Format context
        context_parts = []
        for result in results:
            context_parts.append(f"[{result['source']}]: {result['content']}")

        return "\n\n".join(context_parts)
```

## Step 4: Deploy as API

```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI()
chatbot = DocumentChatbot(openai_client, search_client)

class ChatRequest(BaseModel):
    question: str

class ChatResponse(BaseModel):
    answer: str

@app.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    answer = await chatbot.chat(request.question)
    return ChatResponse(answer=answer)
```

This pattern works for any documentation. The key is good chunking, quality embeddings, and a well-crafted system prompt that keeps the bot focused on your content.
