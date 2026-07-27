---
title: "Introduction to Retrieval Augmented Generation (RAG)"
author: Michael John Peña
draft: false
date: 2023-01-31
tags:
  - Azure
  - OpenAI
  - RAG
  - AI
  - Architecture

---

I wrote "Introduction to Retrieval Augmented Generation (RAG)" to share practical, production-minded guidance on this topic.

## Why RAG?

LLMs have two key limitations:
1. **Knowledge cutoff**: They only know what they were trained on
2. **Hallucinations**: They can make up plausible-sounding but false information

RAG solves both by retrieving relevant context before generating responses.

```
Without RAG:
User: "What's our company's refund policy?"
LLM: *Makes up a generic answer or says "I don't know"*

With RAG:
User: "What's our company's refund policy?"
System: *Retrieves actual policy documents*
LLM: "Based on your policy, customers can request refunds within 30 days..."
```

## RAG Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      RAG Pipeline                            │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┐    ┌──────────┐    ┌─────────┐    ┌─────────┐ │
│  │  User   │───▶│  Embed   │───▶│ Retrieve│───▶│ Generate│ │
│  │  Query  │    │  Query   │    │ Context │    │ Response│ │
│  └─────────┘    └──────────┘    └────┬────┘    └─────────┘ │
│                                       │                      │
│                                       ▼                      │
│                              ┌────────────────┐             │
│                              │ Vector Store   │             │
│                              │ (Embeddings)   │             │
│                              └────────────────┘             │
│                                       ▲                      │
│                                       │                      │
│  ┌─────────┐    ┌──────────┐    ┌────┴────┐                │
│  │Documents│───▶│  Chunk   │───▶│  Embed  │                │
│  │         │    │          │    │  Store  │                │
│  └─────────┘    └──────────┘    └─────────┘                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Basic RAG Implementation

```python
import openai
from typing import List, Dict, Optional
from dataclasses import dataclass
import numpy as np

@dataclass
class Document:
    """A document chunk for RAG."""
    id: str
    content: str
    metadata: Dict
    embedding: Optional[List[float]] = None

class SimpleRAG:
    """Simple RAG implementation."""

    def __init__(
        self,
        embedding_deployment: str = "text-embedding-ada-002",
        chat_deployment: str = "gpt-35-turbo"
    ):
        self.embedding_deployment = embedding_deployment
        self.chat_deployment = chat_deployment
        self.documents: List[Document] = []

    def _get_embedding(self, text: str) -> List[float]:
        """Get embedding for text."""
        response = openai.Embedding.create(
            engine=self.embedding_deployment,
            input=text
        )
        return response['data'][0]['embedding']

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """Calculate cosine similarity."""
        a, b = np.array(a), np.array(b)
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    def add_documents(self, documents: List[Document]):
        """Add documents to the knowledge base."""
        for doc in documents:
            if doc.embedding is None:
                doc.embedding = self._get_embedding(doc.content)
            self.documents.append(doc)

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        threshold: float = 0.7
    ) -> List[Document]:
        """Retrieve relevant documents for a query."""
        query_embedding = self._get_embedding(query)

        # Score all documents
        scored = []
        for doc in self.documents:
            score = self._cosine_similarity(query_embedding, doc.embedding)
            if score >= threshold:
                scored.append((doc, score))

        # Sort by score and return top k
        scored.sort(key=lambda x: x[1], reverse=True)
        return [doc for doc, _ in scored[:top_k]]

    def generate(
        self,
        query: str,
        context_docs: List[Document],
        system_prompt: str = None
    ) -> str:
        """Generate response using retrieved context."""

        # Build context string
        context = "\n\n".join([
            f"Document {i+1}:\n{doc.content}"
            for i, doc in enumerate(context_docs)
        ])

        # Default system prompt
        if system_prompt is None:
            system_prompt = """You are a helpful assistant that answers questions based on the provided context.
If the context doesn't contain relevant information, say so.
Always cite which document(s) you're using."""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"""Context:
{context}

Question: {query}

Answer based on the context above:"""}
        ]

        response = openai.ChatCompletion.create(
            engine=self.chat_deployment,
            messages=messages,
            temperature=0.7,
            max_tokens=500
        )

        return response.choices[0].message.content

    def query(
        self,
        question: str,
        top_k: int = 5
    ) -> Dict:
        """Complete RAG pipeline: retrieve and generate."""
        # Retrieve relevant documents
        relevant_docs = self.retrieve(question, top_k)

        if not relevant_docs:
            return {
                "answer": "I couldn't find relevant information to answer your question.",
                "sources": []
            }

        # Generate response
        answer = self.generate(question, relevant_docs)

        return {
            "answer": answer,
            "sources": [
                {"id": doc.id, "content": doc.content[:200]}
                for doc in relevant_docs
            ]
        }

# Usage
rag = SimpleRAG()

# Add knowledge base
docs = [
    Document(
        id="policy-1",
        content="Our refund policy allows customers to request full refunds within 30 days of purchase. After 30 days, store credit is offered.",
        metadata={"type": "policy", "topic": "refunds"}
    ),
    Document(
        id="policy-2",
        content="Shipping is free for orders over $50. Standard shipping takes 5-7 business days. Express shipping is available for $15.",
        metadata={"type": "policy", "topic": "shipping"}
    ),
    Document(
        id="faq-1",
        content="To track your order, log into your account and visit the Orders section. You'll see tracking numbers for shipped items.",
        metadata={"type": "faq", "topic": "orders"}
    )
]

rag.add_documents(docs)

# Query
result = rag.query("What's the refund policy?")
print(f"Answer: {result['answer']}")
print(f"Sources: {[s['id'] for s in result['sources']]}")
```

## Document Chunking

Split documents into appropriate chunks:

```python
from typing import List
import re

class TextChunker:
    """Split text into chunks for RAG."""

    def __init__(
        self,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        separators: List[str] = None
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.separators = separators or ["\n\n", "\n", ". ", " "]

    def _split_text(self, text: str, separator: str) -> List[str]:
        """Split text by separator."""
        return text.split(separator)

    def chunk(self, text: str) -> List[str]:
        """Split text into overlapping chunks."""
        chunks = []
        current_chunk = ""

        # Split by paragraphs first
        paragraphs = text.split("\n\n")

        for para in paragraphs:
            if len(current_chunk) + len(para) <= self.chunk_size:
                current_chunk += para + "\n\n"
            else:
                if current_chunk:
                    chunks.append(current_chunk.strip())
                current_chunk = para + "\n\n"

        if current_chunk:
            chunks.append(current_chunk.strip())

        # Add overlap
        if self.chunk_overlap > 0:
            overlapped_chunks = []
            for i, chunk in enumerate(chunks):
                if i > 0:
                    # Add end of previous chunk
                    prev_end = chunks[i-1][-self.chunk_overlap:]
                    chunk = prev_end + " " + chunk
                overlapped_chunks.append(chunk)
            return overlapped_chunks

        return chunks

    def chunk_with_metadata(
        self,
        text: str,
        source_id: str,
        base_metadata: Dict = None
    ) -> List[Document]:
        """Chunk text and create Documents with metadata."""
        chunks = self.chunk(text)

        return [
            Document(
                id=f"{source_id}_chunk_{i}",
                content=chunk,
                metadata={
                    **(base_metadata or {}),
                    "source_id": source_id,
                    "chunk_index": i,
                    "total_chunks": len(chunks)
                }
            )
            for i, chunk in enumerate(chunks)
        ]

# Usage
chunker = TextChunker(chunk_size=500, chunk_overlap=50)

long_document = """
Azure Virtual Machines provides on-demand, scalable computing resources.
You can use VMs to run a wide range of workloads...

[... more text ...]
"""

documents = chunker.chunk_with_metadata(
    long_document,
    source_id="azure-vm-docs",
    base_metadata={"service": "VM", "category": "compute"}
)
```

## Enhanced RAG with Reranking

```python
class EnhancedRAG(SimpleRAG):
    """RAG with reranking for better results."""

    def rerank(
        self,
        query: str,
        documents: List[Document],
        top_k: int = 3
    ) -> List[Document]:
        """Rerank documents using LLM."""
        if not documents:
            return []

        # Create ranking prompt
        doc_list = "\n".join([
            f"{i+1}. {doc.content[:200]}..."
            for i, doc in enumerate(documents)
        ])

        messages = [
            {"role": "system", "content": "You are a relevance ranking assistant."},
            {"role": "user", "content": f"""Given the query: "{query}"

Rank these documents by relevance (most relevant first). Return only the numbers separated by commas.

Documents:
{doc_list}

Ranking (e.g., "3,1,5,2,4"):"""}
        ]

        response = openai.ChatCompletion.create(
            engine=self.chat_deployment,
            messages=messages,
            temperature=0,
            max_tokens=50
        )

        # Parse ranking
        try:
            ranking = [
                int(x.strip()) - 1
                for x in response.choices[0].message.content.split(",")
            ]
            reranked = [documents[i] for i in ranking if i < len(documents)]
            return reranked[:top_k]
        except:
            return documents[:top_k]

    def query(
        self,
        question: str,
        initial_k: int = 10,
        final_k: int = 3,
        use_reranking: bool = True
    ) -> Dict:
        """RAG with optional reranking."""
        # Retrieve more than needed
        relevant_docs = self.retrieve(question, initial_k)

        # Rerank to get best matches
        if use_reranking and len(relevant_docs) > final_k:
            relevant_docs = self.rerank(question, relevant_docs, final_k)
        else:
            relevant_docs = relevant_docs[:final_k]

        if not relevant_docs:
            return {
                "answer": "I couldn't find relevant information.",
                "sources": []
            }

        answer = self.generate(question, relevant_docs)

        return {
            "answer": answer,
            "sources": [{"id": d.id, "content": d.content[:200]} for d in relevant_docs]
        }
```

## RAG Best Practices

```python
RAG_BEST_PRACTICES = {
    "chunking": [
        "Chunk size should be 200-500 tokens",
        "Include overlap (10-20%) for context",
        "Preserve semantic boundaries (paragraphs, sections)",
        "Include metadata with each chunk"
    ],
    "retrieval": [
        "Retrieve more than you need, then rerank",
        "Use hybrid search (vector + keyword)",
        "Consider query expansion",
        "Filter by metadata when relevant"
    ],
    "generation": [
        "Include clear instructions in system prompt",
        "Ask model to cite sources",
        "Handle 'not found' cases explicitly",
        "Control response length"
    ],
    "evaluation": [
        "Measure retrieval relevance",
        "Check for hallucinations",
        "Evaluate answer completeness",
        "Monitor latency"
    ]
}
```

## Resources

- [Azure OpenAI + Cognitive Search](https://learn.microsoft.com/azure/search/search-get-started-openai)
- [RAG Best Practices](https://learn.microsoft.com/azure/cognitive-services/openai/how-to/use-your-data)
- [LangChain RAG](https://python.langchain.com/docs/use_cases/question_answering/)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
