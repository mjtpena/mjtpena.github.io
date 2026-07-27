---
title: "Maximizing GPT-4's Context Window: Patterns for Large Document Processing"
author: Michael John Peña
draft: false
date: 2023-09-02
description: "Learn effective strategies for working within GPT-4's context window limits and processing large documents with Azure OpenAI Service."
tags:
  - Azure
  - OpenAI
  - GPT-4
  - Context Window
  - AI

---

I wrote "Maximizing GPT-4's Context Window: Patterns for Large Document Processing" to share practical, production-minded guidance on this topic.

## Introduction

GPT-4's context window of 8K tokens (with a 32K option for select users) is a significant improvement over GPT-3.5's 4K limit. However, real-world documents often exceed these limits. This post explores patterns for effectively processing large documents within context window constraints.

## Understanding Context Windows

### Current Limits (September 2023)

| Model | Context Window | Approximate Words |
|-------|----------------|-------------------|
| GPT-3.5 Turbo | 4,096 tokens | ~3,000 words |
| GPT-4 (8K) | 8,192 tokens | ~6,000 words |
| GPT-4 (32K) | 32,768 tokens | ~24,000 words |

```python
import tiktoken

def count_tokens(text: str, model: str = "gpt-4") -> int:
    """Count tokens in text for a specific model"""
    encoding = tiktoken.encoding_for_model(model)
    return len(encoding.encode(text))

def estimate_tokens(text: str) -> int:
    """Quick estimate: ~4 characters per token"""
    return len(text) // 4

# Example
document = "Your long document here..."
tokens = count_tokens(document)
print(f"Document contains {tokens} tokens")
```

## Pattern 1: Chunking with Overlap

Split documents into overlapping chunks to maintain context:

```python
from dataclasses import dataclass
from typing import List
import tiktoken

@dataclass
class Chunk:
    text: str
    start_index: int
    end_index: int
    token_count: int

class DocumentChunker:
    def __init__(self, model: str = "gpt-4", max_tokens: int = 6000, overlap_tokens: int = 200):
        self.encoding = tiktoken.encoding_for_model(model)
        self.max_tokens = max_tokens
        self.overlap_tokens = overlap_tokens

    def chunk_document(self, text: str) -> List[Chunk]:
        """Split document into overlapping chunks"""
        tokens = self.encoding.encode(text)
        chunks = []
        start = 0

        while start < len(tokens):
            end = min(start + self.max_tokens, len(tokens))
            chunk_tokens = tokens[start:end]
            chunk_text = self.encoding.decode(chunk_tokens)

            chunks.append(Chunk(
                text=chunk_text,
                start_index=start,
                end_index=end,
                token_count=len(chunk_tokens)
            ))

            if end >= len(tokens):
                break

            start = end - self.overlap_tokens

        return chunks

    def chunk_by_sections(self, text: str, section_delimiter: str = "\n\n") -> List[Chunk]:
        """Split by logical sections, respecting token limits"""
        sections = text.split(section_delimiter)
        chunks = []
        current_chunk = ""
        current_tokens = 0

        for section in sections:
            section_tokens = len(self.encoding.encode(section))

            if current_tokens + section_tokens > self.max_tokens:
                if current_chunk:
                    chunks.append(Chunk(
                        text=current_chunk,
                        start_index=0,
                        end_index=0,
                        token_count=current_tokens
                    ))
                current_chunk = section
                current_tokens = section_tokens
            else:
                current_chunk += section_delimiter + section if current_chunk else section
                current_tokens += section_tokens

        if current_chunk:
            chunks.append(Chunk(
                text=current_chunk,
                start_index=0,
                end_index=0,
                token_count=current_tokens
            ))

        return chunks

# Usage
chunker = DocumentChunker(max_tokens=6000, overlap_tokens=200)
chunks = chunker.chunk_document(large_document)

for i, chunk in enumerate(chunks):
    print(f"Chunk {i+1}: {chunk.token_count} tokens")
```

## Pattern 2: Map-Reduce for Summarization

Process chunks independently, then combine results:

```python
import openai
from typing import List

class MapReduceSummarizer:
    def __init__(self, deployment: str):
        self.deployment = deployment

    async def summarize_chunk(self, chunk: str) -> str:
        """Summarize a single chunk"""
        response = await openai.ChatCompletion.acreate(
            engine=self.deployment,
            messages=[
                {"role": "system", "content": "Summarize the following text concisely, preserving key information."},
                {"role": "user", "content": chunk}
            ],
            max_tokens=500,
            temperature=0.3
        )
        return response.choices[0].message.content

    async def combine_summaries(self, summaries: List[str]) -> str:
        """Combine multiple summaries into one"""
        combined = "\n\n".join([f"Section {i+1}:\n{s}" for i, s in enumerate(summaries)])

        response = await openai.ChatCompletion.acreate(
            engine=self.deployment,
            messages=[
                {"role": "system", "content": "Combine these section summaries into a coherent overall summary."},
                {"role": "user", "content": combined}
            ],
            max_tokens=1000,
            temperature=0.3
        )
        return response.choices[0].message.content

    async def summarize_document(self, document: str) -> str:
        """Map-reduce summarization of a large document"""
        # Chunk the document
        chunker = DocumentChunker(max_tokens=6000)
        chunks = chunker.chunk_document(document)

        # Map: Summarize each chunk
        summaries = []
        for chunk in chunks:
            summary = await self.summarize_chunk(chunk.text)
            summaries.append(summary)

        # Reduce: Combine summaries
        if len(summaries) == 1:
            return summaries[0]

        return await self.combine_summaries(summaries)

# Usage
summarizer = MapReduceSummarizer("gpt-4")
summary = await summarizer.summarize_document(large_document)
```

## Pattern 3: Hierarchical Processing

Build understanding layer by layer:

```python
class HierarchicalProcessor:
    def __init__(self, deployment: str):
        self.deployment = deployment
        self.chunker = DocumentChunker(max_tokens=5000)

    async def extract_key_points(self, text: str) -> List[str]:
        """Extract key points from text"""
        response = await openai.ChatCompletion.acreate(
            engine=self.deployment,
            messages=[
                {"role": "system", "content": "Extract 5-10 key points from the following text. Return as a numbered list."},
                {"role": "user", "content": text}
            ],
            max_tokens=500,
            temperature=0.2
        )
        return response.choices[0].message.content.split("\n")

    async def synthesize(self, key_points: List[str], query: str) -> str:
        """Synthesize key points to answer a query"""
        points_text = "\n".join(key_points)

        response = await openai.ChatCompletion.acreate(
            engine=self.deployment,
            messages=[
                {"role": "system", "content": f"Based on these key points, answer the question.\n\nKey Points:\n{points_text}"},
                {"role": "user", "content": query}
            ],
            max_tokens=1000,
            temperature=0.5
        )
        return response.choices[0].message.content

    async def process_document(self, document: str, query: str) -> str:
        """Process large document hierarchically"""
        # Level 1: Chunk and extract key points
        chunks = self.chunker.chunk_document(document)
        all_key_points = []

        for chunk in chunks:
            points = await self.extract_key_points(chunk.text)
            all_key_points.extend(points)

        # Level 2: If too many key points, summarize them
        if len(all_key_points) > 50:
            points_text = "\n".join(all_key_points)
            condensed = await self.extract_key_points(points_text)
            all_key_points = condensed

        # Level 3: Answer the query
        return await self.synthesize(all_key_points, query)
```

## Pattern 4: Retrieval-Augmented Generation (RAG)

Only include relevant context:

```python
from typing import List, Tuple
import numpy as np

class RAGProcessor:
    def __init__(self, deployment: str, embedding_deployment: str):
        self.deployment = deployment
        self.embedding_deployment = embedding_deployment
        self.chunker = DocumentChunker(max_tokens=500)  # Smaller chunks for retrieval
        self.chunk_embeddings: List[Tuple[str, np.ndarray]] = []

    async def get_embedding(self, text: str) -> np.ndarray:
        """Get embedding for text"""
        response = await openai.Embedding.acreate(
            engine=self.embedding_deployment,
            input=text
        )
        return np.array(response['data'][0]['embedding'])

    def cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Calculate cosine similarity"""
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    async def index_document(self, document: str):
        """Index document chunks with embeddings"""
        chunks = self.chunker.chunk_document(document)
        self.chunk_embeddings = []

        for chunk in chunks:
            embedding = await self.get_embedding(chunk.text)
            self.chunk_embeddings.append((chunk.text, embedding))

    async def retrieve_relevant(self, query: str, top_k: int = 5) -> List[str]:
        """Retrieve most relevant chunks for a query"""
        query_embedding = await self.get_embedding(query)

        similarities = []
        for chunk_text, chunk_embedding in self.chunk_embeddings:
            sim = self.cosine_similarity(query_embedding, chunk_embedding)
            similarities.append((chunk_text, sim))

        similarities.sort(key=lambda x: x[1], reverse=True)
        return [text for text, _ in similarities[:top_k]]

    async def answer_question(self, query: str) -> str:
        """Answer question using retrieved context"""
        relevant_chunks = await self.retrieve_relevant(query, top_k=5)
        context = "\n\n---\n\n".join(relevant_chunks)

        response = await openai.ChatCompletion.acreate(
            engine=self.deployment,
            messages=[
                {"role": "system", "content": f"Answer the question based on the following context:\n\n{context}"},
                {"role": "user", "content": query}
            ],
            max_tokens=1000,
            temperature=0.3
        )
        return response.choices[0].message.content

# Usage
rag = RAGProcessor("gpt-4", "text-embedding-ada-002")
await rag.index_document(large_document)
answer = await rag.answer_question("What are the main conclusions?")
```

## Pattern 5: Sliding Window for Conversation

Maintain recent context in long conversations:

```python
from collections import deque
from dataclasses import dataclass
from typing import Deque

@dataclass
class Message:
    role: str
    content: str
    token_count: int

class SlidingWindowChat:
    def __init__(self, deployment: str, max_context_tokens: int = 6000, max_response_tokens: int = 1000):
        self.deployment = deployment
        self.max_context_tokens = max_context_tokens
        self.max_response_tokens = max_response_tokens
        self.encoding = tiktoken.encoding_for_model("gpt-4")
        self.history: Deque[Message] = deque()
        self.system_message = "You are a helpful assistant."
        self.system_tokens = len(self.encoding.encode(self.system_message))

    def _count_tokens(self, text: str) -> int:
        return len(self.encoding.encode(text))

    def _get_available_tokens(self) -> int:
        return self.max_context_tokens - self.system_tokens - self.max_response_tokens

    def _trim_history(self):
        """Remove oldest messages to fit within context"""
        current_tokens = sum(m.token_count for m in self.history)
        available = self._get_available_tokens()

        while current_tokens > available and len(self.history) > 1:
            removed = self.history.popleft()
            current_tokens -= removed.token_count

    def add_message(self, role: str, content: str):
        """Add message to history"""
        token_count = self._count_tokens(content)
        self.history.append(Message(role, content, token_count))
        self._trim_history()

    async def chat(self, user_message: str) -> str:
        """Send message and get response"""
        self.add_message("user", user_message)

        messages = [{"role": "system", "content": self.system_message}]
        messages.extend([{"role": m.role, "content": m.content} for m in self.history])

        response = await openai.ChatCompletion.acreate(
            engine=self.deployment,
            messages=messages,
            max_tokens=self.max_response_tokens,
            temperature=0.7
        )

        assistant_message = response.choices[0].message.content
        self.add_message("assistant", assistant_message)

        return assistant_message

# Usage
chat = SlidingWindowChat("gpt-4")
response = await chat.chat("Hello, can you help me understand Azure?")
response = await chat.chat("Tell me more about storage options")
# Older messages automatically trimmed as conversation grows
```

## Best Practices

1. **Always count tokens before sending**: Avoid truncation errors
2. **Use overlap in chunks**: Maintain context across boundaries
3. **Implement RAG for Q&A**: Don't stuff entire documents
4. **Cache embeddings**: Recompute only when content changes
5. **Handle errors gracefully**: Context length errors should trigger chunking

## Conclusion

While current context window limits require careful document handling, these patterns enable processing documents of any size. As models evolve and context windows grow, some patterns will become less necessary, but understanding these fundamentals will remain valuable for building robust AI applications.

## Resources

- [Azure OpenAI Service Limits](https://learn.microsoft.com/azure/cognitive-services/openai/quotas-limits)
- [tiktoken Library](https://github.com/openai/tiktoken)
- [RAG Pattern Guide](https://learn.microsoft.com/azure/search/retrieval-augmented-generation-overview)

