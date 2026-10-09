---
title: "RAG Chunking Strategies: Finding the Optimal Approach"
description: "The simplest approach splits text at regular intervals with optional overlap. Semantic chunking respects content boundaries like paragraphs and sections."
author: Michael John Peña
draft: false
date: 2025-08-10
tags:
  - RAG
  - Chunking
  - Vector Search
  - NLP
  - AI Architecture
---

## Common Chunking Strategies

### Fixed-Size Chunking

The simplest approach splits text at regular intervals with optional overlap.

```python
def fixed_size_chunking(text: str, chunk_size: int = 500, overlap: int = 50) -> list[str]:
    """Split text into fixed-size chunks with overlap."""
    chunks = []
    start = 0

    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk)
        start = end - overlap

    return chunks
```

### Semantic Chunking

Semantic chunking respects content boundaries like paragraphs and sections.

```python
import re
from sentence_transformers import SentenceTransformer

def semantic_chunking(text: str, max_chunk_size: int = 1000) -> list[str]:
    """Split text at semantic boundaries."""
    # Split into paragraphs
    paragraphs = re.split(r'\n\s*\n', text)

    chunks = []
    current_chunk = []
    current_size = 0

    for para in paragraphs:
        para_size = len(para)

        if current_size + para_size > max_chunk_size and current_chunk:
            chunks.append('\n\n'.join(current_chunk))
            current_chunk = []
            current_size = 0

        current_chunk.append(para)
        current_size += para_size

    if current_chunk:
        chunks.append('\n\n'.join(current_chunk))

    return chunks
```

### Recursive Character Splitting

This approach tries multiple separators in order of preference.

```python
def recursive_split(text: str, separators: list[str], chunk_size: int) -> list[str]:
    """Recursively split using multiple separators."""
    if len(text) <= chunk_size:
        return [text]

    for sep in separators:
        if sep in text:
            parts = text.split(sep)
            return [chunk for part in parts
                    for chunk in recursive_split(part, separators[1:], chunk_size)]

    return fixed_size_chunking(text, chunk_size)

# Usage
separators = ["\n## ", "\n### ", "\n\n", "\n", ". ", " "]
chunks = recursive_split(document, separators, chunk_size=500)
```

## Choosing the Right Strategy

For structured documents, use semantic chunking. For code, chunk by functions or classes. For conversations, keep turns together. Test retrieval quality with representative queries to validate your chunking choice.
