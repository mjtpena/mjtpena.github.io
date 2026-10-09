---
title: "Retrieval-Augmented Generation: Chunking Strategies for Better Results"
description: "The best chunking strategy depends on your document types. Technical documentation benefits from header-aware chunking. Conversational content works well…"
author: Michael John Peña
draft: false
date: 2025-09-29
tags:
  - RAG
  - Chunking
  - Embeddings
  - Document Processing
  - LLM
---

## Chunking Fundamentals

```python
from dataclasses import dataclass
from typing import List, Optional
import re

@dataclass
class Chunk:
    text: str
    metadata: dict
    start_index: int
    end_index: int
    chunk_id: str

class DocumentChunker:
    def __init__(self, chunk_size: int = 512, chunk_overlap: int = 50):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap

    def fixed_size_chunks(self, text: str, doc_id: str) -> List[Chunk]:
        """Simple fixed-size chunking with overlap."""
        chunks = []
        start = 0
        chunk_num = 0

        while start < len(text):
            end = start + self.chunk_size

            # Avoid cutting words
            if end < len(text):
                while end > start and text[end] not in " \n\t":
                    end -= 1

            chunk_text = text[start:end].strip()
            if chunk_text:
                chunks.append(Chunk(
                    text=chunk_text,
                    metadata={"doc_id": doc_id, "chunk_num": chunk_num},
                    start_index=start,
                    end_index=end,
                    chunk_id=f"{doc_id}_chunk_{chunk_num}"
                ))
                chunk_num += 1

            start = end - self.chunk_overlap

        return chunks

    def semantic_chunks(self, text: str, doc_id: str) -> List[Chunk]:
        """Chunk based on semantic boundaries like paragraphs and sections."""
        chunks = []

        # Split on paragraph boundaries
        paragraphs = re.split(r'\n\s*\n', text)

        current_chunk = []
        current_length = 0
        chunk_num = 0
        start_index = 0

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            para_length = len(para)

            # If single paragraph exceeds chunk size, split it
            if para_length > self.chunk_size:
                # Flush current chunk
                if current_chunk:
                    chunk_text = "\n\n".join(current_chunk)
                    chunks.append(Chunk(
                        text=chunk_text,
                        metadata={"doc_id": doc_id, "chunk_num": chunk_num},
                        start_index=start_index,
                        end_index=start_index + len(chunk_text),
                        chunk_id=f"{doc_id}_chunk_{chunk_num}"
                    ))
                    chunk_num += 1
                    start_index += len(chunk_text) + 2

                # Split large paragraph by sentences
                sentences = self._split_sentences(para)
                for sentence_chunk in self._group_sentences(sentences, self.chunk_size):
                    chunks.append(Chunk(
                        text=sentence_chunk,
                        metadata={"doc_id": doc_id, "chunk_num": chunk_num},
                        start_index=start_index,
                        end_index=start_index + len(sentence_chunk),
                        chunk_id=f"{doc_id}_chunk_{chunk_num}"
                    ))
                    chunk_num += 1
                    start_index += len(sentence_chunk) + 1

                current_chunk = []
                current_length = 0

            elif current_length + para_length > self.chunk_size:
                # Flush current chunk
                chunk_text = "\n\n".join(current_chunk)
                chunks.append(Chunk(
                    text=chunk_text,
                    metadata={"doc_id": doc_id, "chunk_num": chunk_num},
                    start_index=start_index,
                    end_index=start_index + len(chunk_text),
                    chunk_id=f"{doc_id}_chunk_{chunk_num}"
                ))
                chunk_num += 1
                start_index += len(chunk_text) + 2

                current_chunk = [para]
                current_length = para_length
            else:
                current_chunk.append(para)
                current_length += para_length

        # Flush remaining
        if current_chunk:
            chunk_text = "\n\n".join(current_chunk)
            chunks.append(Chunk(
                text=chunk_text,
                metadata={"doc_id": doc_id, "chunk_num": chunk_num},
                start_index=start_index,
                end_index=start_index + len(chunk_text),
                chunk_id=f"{doc_id}_chunk_{chunk_num}"
            ))

        return chunks

    def _split_sentences(self, text: str) -> List[str]:
        """Split text into sentences."""
        return re.split(r'(?<=[.!?])\s+', text)

    def _group_sentences(self, sentences: List[str], max_length: int) -> List[str]:
        """Group sentences into chunks of max_length."""
        groups = []
        current = []
        current_len = 0

        for sentence in sentences:
            if current_len + len(sentence) > max_length and current:
                groups.append(" ".join(current))
                current = [sentence]
                current_len = len(sentence)
            else:
                current.append(sentence)
                current_len += len(sentence)

        if current:
            groups.append(" ".join(current))

        return groups
```

## Contextual Chunking with Headers

```python
def hierarchical_chunks(self, text: str, doc_id: str) -> List[Chunk]:
    """Preserve document hierarchy in chunks."""
    chunks = []
    current_headers = []

    # Match markdown-style headers
    sections = re.split(r'(^#{1,3}\s+.+$)', text, flags=re.MULTILINE)

    for i, section in enumerate(sections):
        if section.startswith('#'):
            level = len(re.match(r'^#+', section).group())
            header_text = section.lstrip('#').strip()

            # Update header stack
            current_headers = current_headers[:level-1] + [header_text]
        elif section.strip():
            # Create chunk with header context
            header_context = " > ".join(current_headers)
            chunk_text = f"[Context: {header_context}]\n\n{section.strip()}"

            chunks.append(Chunk(
                text=chunk_text,
                metadata={
                    "doc_id": doc_id,
                    "headers": current_headers.copy()
                },
                start_index=0,
                end_index=len(chunk_text),
                chunk_id=f"{doc_id}_section_{len(chunks)}"
            ))

    return chunks
```

The best chunking strategy depends on your document types. Technical documentation benefits from header-aware chunking. Conversational content works well with semantic paragraph chunking. Experiment and measure retrieval quality to find the optimal approach.
