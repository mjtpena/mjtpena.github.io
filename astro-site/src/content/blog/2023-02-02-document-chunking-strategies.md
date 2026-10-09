---
title: "Document Chunking Strategies for RAG Systems"
author: Michael John Peña
draft: false
date: 2023-02-02
tags:
  - Azure
  - OpenAI
  - RAG
  - NLP
  - Data Processing
---

## Why Chunking Matters

```python
# Problem: Documents are too long for embedding models
# OpenAI embeddings: max 8191 tokens
# Optimal for retrieval: 100-500 tokens

# Bad: Entire document as one chunk
# - Too much noise in embedding
# - Retrieved context too broad

# Bad: Too small chunks
# - Loses context
# - More storage and computation

# Good: Right-sized chunks
# - Coherent semantic units
# - Enough context for understanding
```

## Strategy 1: Fixed-Size Chunking

Simple but effective for uniform content:

```python
from typing import List
import tiktoken

class FixedSizeChunker:
    """Chunk by fixed token count."""

    def __init__(
        self,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        model: str = "gpt-3.5-turbo"
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.encoding = tiktoken.encoding_for_model(model)

    def count_tokens(self, text: str) -> int:
        return len(self.encoding.encode(text))

    def chunk(self, text: str) -> List[str]:
        """Split text into fixed-size chunks with overlap."""
        tokens = self.encoding.encode(text)
        chunks = []

        start = 0
        while start < len(tokens):
            end = start + self.chunk_size
            chunk_tokens = tokens[start:end]
            chunk_text = self.encoding.decode(chunk_tokens)
            chunks.append(chunk_text)
            start = end - self.chunk_overlap

        return chunks

# Usage
chunker = FixedSizeChunker(chunk_size=500, chunk_overlap=50)
chunks = chunker.chunk(long_document)
```

## Strategy 2: Sentence-Based Chunking

Respect sentence boundaries:

```python
import re
from typing import List

class SentenceChunker:
    """Chunk by sentences, respecting boundaries."""

    def __init__(
        self,
        max_chunk_size: int = 500,
        min_chunk_size: int = 100
    ):
        self.max_chunk_size = max_chunk_size
        self.min_chunk_size = min_chunk_size
        self.sentence_pattern = re.compile(r'(?<=[.!?])\s+')

    def split_sentences(self, text: str) -> List[str]:
        """Split text into sentences."""
        sentences = self.sentence_pattern.split(text)
        return [s.strip() for s in sentences if s.strip()]

    def chunk(self, text: str) -> List[str]:
        """Group sentences into chunks."""
        sentences = self.split_sentences(text)
        chunks = []
        current_chunk = []
        current_length = 0

        for sentence in sentences:
            sentence_length = len(sentence.split())

            if current_length + sentence_length > self.max_chunk_size:
                if current_chunk:
                    chunks.append(' '.join(current_chunk))
                current_chunk = [sentence]
                current_length = sentence_length
            else:
                current_chunk.append(sentence)
                current_length += sentence_length

        if current_chunk:
            chunks.append(' '.join(current_chunk))

        return chunks
```

## Strategy 3: Paragraph-Based Chunking

Natural document structure:

```python
class ParagraphChunker:
    """Chunk by paragraphs."""

    def __init__(
        self,
        max_chunk_size: int = 1000,
        combine_short: bool = True,
        min_paragraph_length: int = 50
    ):
        self.max_chunk_size = max_chunk_size
        self.combine_short = combine_short
        self.min_paragraph_length = min_paragraph_length

    def chunk(self, text: str) -> List[str]:
        """Split by paragraphs, optionally combining short ones."""
        paragraphs = text.split('\n\n')
        paragraphs = [p.strip() for p in paragraphs if p.strip()]

        if not self.combine_short:
            return paragraphs

        chunks = []
        current_chunk = []
        current_length = 0

        for para in paragraphs:
            para_length = len(para)

            if para_length > self.max_chunk_size:
                # Large paragraph becomes its own chunk
                if current_chunk:
                    chunks.append('\n\n'.join(current_chunk))
                    current_chunk = []
                    current_length = 0
                chunks.append(para)
            elif current_length + para_length > self.max_chunk_size:
                # Start new chunk
                chunks.append('\n\n'.join(current_chunk))
                current_chunk = [para]
                current_length = para_length
            else:
                current_chunk.append(para)
                current_length += para_length

        if current_chunk:
            chunks.append('\n\n'.join(current_chunk))

        return chunks
```

## Strategy 4: Semantic Chunking

Use embeddings to find natural break points:

```python
import numpy as np
from typing import List, Tuple

class SemanticChunker:
    """Chunk based on semantic similarity."""

    def __init__(
        self,
        embedding_model,
        similarity_threshold: float = 0.5,
        min_chunk_size: int = 100
    ):
        self.embedding_model = embedding_model
        self.similarity_threshold = similarity_threshold
        self.min_chunk_size = min_chunk_size

    def cosine_similarity(self, a: List[float], b: List[float]) -> float:
        a, b = np.array(a), np.array(b)
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    def find_break_points(
        self,
        sentences: List[str]
    ) -> List[int]:
        """Find semantic break points."""
        if len(sentences) < 2:
            return []

        # Get embeddings for all sentences
        embeddings = [self.embedding_model.embed(s) for s in sentences]

        # Find points where similarity drops
        break_points = []
        for i in range(1, len(embeddings)):
            sim = self.cosine_similarity(embeddings[i-1], embeddings[i])
            if sim < self.similarity_threshold:
                break_points.append(i)

        return break_points

    def chunk(self, text: str) -> List[str]:
        """Chunk based on semantic breaks."""
        # Split into sentences first
        sentences = re.split(r'(?<=[.!?])\s+', text)
        sentences = [s.strip() for s in sentences if s.strip()]

        # Find break points
        break_points = self.find_break_points(sentences)

        # Create chunks
        chunks = []
        start = 0

        for bp in break_points:
            chunk = ' '.join(sentences[start:bp])
            if len(chunk) >= self.min_chunk_size:
                chunks.append(chunk)
            start = bp

        # Add final chunk
        if start < len(sentences):
            chunk = ' '.join(sentences[start:])
            if len(chunk) >= self.min_chunk_size:
                chunks.append(chunk)

        return chunks
```

## Strategy 5: Recursive Chunking

Hierarchical splitting with multiple separators:

```python
class RecursiveChunker:
    """Recursively split using multiple separators."""

    def __init__(
        self,
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        separators: List[str] = None
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.separators = separators or [
            "\n\n",  # Paragraphs
            "\n",    # Lines
            ". ",    # Sentences
            ", ",    # Clauses
            " ",     # Words
            ""       # Characters
        ]

    def _split_text(self, text: str, separator: str) -> List[str]:
        if separator:
            return text.split(separator)
        return list(text)

    def _merge_splits(
        self,
        splits: List[str],
        separator: str
    ) -> List[str]:
        """Merge splits back together respecting chunk size."""
        chunks = []
        current_chunk = []
        current_length = 0

        for split in splits:
            split_length = len(split)

            if current_length + split_length > self.chunk_size:
                if current_chunk:
                    chunks.append(separator.join(current_chunk))
                current_chunk = [split]
                current_length = split_length
            else:
                current_chunk.append(split)
                current_length += split_length + len(separator)

        if current_chunk:
            chunks.append(separator.join(current_chunk))

        return chunks

    def chunk(self, text: str, separators: List[str] = None) -> List[str]:
        """Recursively chunk text."""
        separators = separators or self.separators

        if not separators:
            return [text]

        separator = separators[0]
        splits = self._split_text(text, separator)

        # Check if any splits are too large
        final_chunks = []
        for split in splits:
            if len(split) > self.chunk_size:
                # Recursively split with next separator
                sub_chunks = self.chunk(split, separators[1:])
                final_chunks.extend(sub_chunks)
            else:
                final_chunks.append(split)

        # Merge small chunks
        return self._merge_splits(final_chunks, separator)
```

## Strategy 6: Document-Aware Chunking

Respect document structure (headers, sections):

```python
import re
from dataclasses import dataclass

@dataclass
class DocumentSection:
    title: str
    level: int
    content: str
    parent: str = ""

class DocumentAwareChunker:
    """Chunk respecting document structure."""

    def __init__(self, max_chunk_size: int = 1000):
        self.max_chunk_size = max_chunk_size
        self.header_pattern = re.compile(r'^(#{1,6})\s+(.+)$', re.MULTILINE)

    def parse_structure(self, text: str) -> List[DocumentSection]:
        """Parse document into sections."""
        sections = []
        current_headers = {}

        lines = text.split('\n')
        current_content = []
        current_title = "Introduction"
        current_level = 0

        for line in lines:
            header_match = self.header_pattern.match(line)

            if header_match:
                # Save previous section
                if current_content:
                    content = '\n'.join(current_content).strip()
                    if content:
                        parent = current_headers.get(current_level - 1, "")
                        sections.append(DocumentSection(
                            title=current_title,
                            level=current_level,
                            content=content,
                            parent=parent
                        ))

                # Start new section
                level = len(header_match.group(1))
                title = header_match.group(2)
                current_headers[level] = title
                current_title = title
                current_level = level
                current_content = []
            else:
                current_content.append(line)

        # Save last section
        if current_content:
            content = '\n'.join(current_content).strip()
            if content:
                sections.append(DocumentSection(
                    title=current_title,
                    level=current_level,
                    content=content,
                    parent=current_headers.get(current_level - 1, "")
                ))

        return sections

    def chunk(self, text: str) -> List[dict]:
        """Chunk with document structure metadata."""
        sections = self.parse_structure(text)
        chunks = []

        for section in sections:
            if len(section.content) <= self.max_chunk_size:
                chunks.append({
                    "content": section.content,
                    "metadata": {
                        "title": section.title,
                        "level": section.level,
                        "parent": section.parent
                    }
                })
            else:
                # Split large sections
                sub_chunks = self._split_section(section.content)
                for i, sub in enumerate(sub_chunks):
                    chunks.append({
                        "content": sub,
                        "metadata": {
                            "title": f"{section.title} (part {i+1})",
                            "level": section.level,
                            "parent": section.parent
                        }
                    })

        return chunks
```

## Choosing a Strategy

```python
CHUNKING_GUIDE = {
    "uniform_content": {
        "strategy": "Fixed-Size",
        "when": "Content is uniform (e.g., logs, records)",
        "params": {"chunk_size": 500, "overlap": 50}
    },
    "prose_text": {
        "strategy": "Sentence-Based",
        "when": "Natural language prose",
        "params": {"max_chunk_size": 500}
    },
    "structured_docs": {
        "strategy": "Document-Aware",
        "when": "Documents with headers/sections",
        "params": {"respect_structure": True}
    },
    "varied_content": {
        "strategy": "Recursive",
        "when": "Mixed content types",
        "params": {"separators": ["\n\n", "\n", ". "]}
    },
    "high_quality": {
        "strategy": "Semantic",
        "when": "Quality is critical, latency acceptable",
        "params": {"similarity_threshold": 0.5}
    }
}
```

## Best Practices

1. **Include metadata**: Track source, position, and structure
2. **Use overlap**: Prevent losing context at boundaries
3. **Test empirically**: Measure retrieval quality with different sizes
4. **Consider query type**: Adjust based on typical queries
5. **Preserve context**: Include headers/titles in chunks

## Resources

- [LangChain Text Splitters](https://python.langchain.com/docs/modules/data_connection/document_transformers/)
- [Chunking Strategies Comparison](https://www.pinecone.io/learn/chunking-strategies/)
