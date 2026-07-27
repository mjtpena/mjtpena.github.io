---
title: "Building RAG Applications with Azure AI Search and GPT-4o"
author: Michael John Peña
draft: false
date: 2025-08-02
tags:
  - RAG
  - Azure AI Search
  - GPT-4o
  - Azure OpenAI
  - Python

---

I wrote "Building RAG Applications with Azure AI Search and GPT-4o" to share practical, production-minded guidance on this topic.

## The RAG Architecture

RAG works by first retrieving relevant documents from a search index, then passing those documents as context to an LLM for generation. This approach grounds the model's responses in factual data while maintaining natural language capabilities.

## Implementing RAG with Python

```python
from azure.search.documents import SearchClient
from azure.core.credentials import AzureKeyCredential
from openai import AzureOpenAI
import os

# Initialize clients
search_client = SearchClient(
    endpoint=os.environ["SEARCH_ENDPOINT"],
    index_name="knowledge-base",
    credential=AzureKeyCredential(os.environ["SEARCH_KEY"])
)

openai_client = AzureOpenAI(
    api_key=os.environ["AZURE_OPENAI_KEY"],
    api_version="2024-08-01-preview",
    azure_endpoint=os.environ["AZURE_OPENAI_ENDPOINT"]
)

def rag_query(user_question: str) -> str:
    # Step 1: Retrieve relevant documents
    search_results = search_client.search(
        search_text=user_question,
        top=5,
        select=["content", "title", "source"]
    )

    # Step 2: Build context from search results
    context_parts = []
    for result in search_results:
        context_parts.append(f"Source: {result['title']}\n{result['content']}")

    context = "\n\n---\n\n".join(context_parts)

    # Step 3: Generate response with context
    response = openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": f"Answer questions based on this context:\n\n{context}"},
            {"role": "user", "content": user_question}
        ],
        temperature=0.7
    )

    return response.choices[0].message.content
```

## Optimizing Retrieval Quality

The quality of your RAG system depends heavily on your chunking strategy and embedding model. Consider using semantic chunking to preserve context boundaries and hybrid search combining keyword and vector search for best results.

Azure AI Search's built-in vector search capabilities make it straightforward to implement production-grade RAG applications.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
