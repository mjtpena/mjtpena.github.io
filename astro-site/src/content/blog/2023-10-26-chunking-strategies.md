---
title: "Document Chunking Strategies for RAG Systems"
author: Michael John Peña
draft: false
date: 2023-10-26
description: "Comprehensive guide to document chunking strategies for optimal retrieval in RAG applications."
tags:
  - Chunking
  - RAG
  - Document Processing
  - Text Splitting
  - AI
---

## Introduction

Document chunking is a critical step in RAG pipelines that directly impacts retrieval quality. This post covers various chunking strategies, their trade-offs, and how to choose the right approach for your use case.

## Chunking Fundamentals

```python
from dataclasses import dataclass
from typing import List, Dict, Optional, Callable
from abc import ABC, abstractmethod

@dataclass
class Chunk:
    id: str
    content: str
    metadata: Dict
    start_index: int
    end_index: int
    parent_id: Optional[str] = None

class ChunkingStrategy(ABC):
    """Abstract base class for chunking strategies"""

    @abstractmethod
    def chunk(self, text: str, metadata: Dict = None) -> List[Chunk]:
        pass

class ChunkingConfig:
    """Configuration for chunking"""

    def __init__(
        self,
        chunk_size: int = 512,
        chunk_overlap: int = 50,
        min_chunk_size: int = 100,
        separator: str = "\n\n"
    ):
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.min_chunk_size = min_chunk_size
        self.separator = separator
```

## Fixed-Size Chunking

```python
import uuid

class FixedSizeChunker(ChunkingStrategy):
    """Simple fixed-size chunking with overlap"""

    def __init__(self, config: ChunkingConfig = None):
        self.config = config or ChunkingConfig()

    def chunk(self, text: str, metadata: Dict = None) -> List[Chunk]:
        """Split text into fixed-size chunks"""
        chunks = []
        start = 0
        chunk_num = 0

        while start < len(text):
            end = start + self.config.chunk_size

            # Adjust end to word boundary
            if end < len(text):
                end = self._find_word_boundary(text, end)

            chunk_text = text[start:end].strip()

            if len(chunk_text) >= self.config.min_chunk_size:
                chunks.append(Chunk(
                    id=f"chunk_{uuid.uuid4().hex[:8]}",
                    content=chunk_text,
                    metadata={
                        **(metadata or {}),
                        "chunk_index": chunk_num,
                        "chunking_strategy": "fixed_size"
                    },
                    start_index=start,
                    end_index=end
                ))
                chunk_num += 1

            # Move start with overlap
            start = end - self.config.chunk_overlap
            if start >= len(text) - self.config.min_chunk_size:
                break

        return chunks

    def _find_word_boundary(self, text: str, position: int) -> int:
        """Find nearest word boundary"""
        # Look forward for space
        forward = position
        while forward < len(text) and text[forward] not in ' \n\t':
            forward += 1

        # Look backward for space
        backward = position
        while backward > 0 and text[backward] not in ' \n\t':
            backward -= 1

        # Choose closer boundary
        if forward - position < position - backward:
            return forward
        return backward

# Usage
chunker = FixedSizeChunker(ChunkingConfig(chunk_size=500, chunk_overlap=50))
text = "Your long document text here..." * 100
chunks = chunker.chunk(text, metadata={"source": "document.pdf"})
print(f"Created {len(chunks)} chunks")
```

## Semantic Chunking

```python
class SemanticChunker(ChunkingStrategy):
    """Chunk based on semantic boundaries"""

    def __init__(
        self,
        embedding_model=None,
        similarity_threshold: float = 0.5,
        max_chunk_size: int = 1000
    ):
        self.embedding_model = embedding_model
        self.threshold = similarity_threshold
        self.max_size = max_chunk_size

    def chunk(self, text: str, metadata: Dict = None) -> List[Chunk]:
        """Split text at semantic boundaries"""
        # Split into sentences first
        sentences = self._split_sentences(text)

        if not sentences:
            return []

        # Get embeddings for each sentence
        embeddings = self._get_embeddings(sentences)

        # Find semantic break points
        break_points = self._find_break_points(embeddings)

        # Create chunks from break points
        chunks = self._create_chunks(sentences, break_points, metadata)

        return chunks

    def _split_sentences(self, text: str) -> List[Dict]:
        """Split text into sentences with positions"""
        import re
        sentences = []
        start = 0

        for match in re.finditer(r'[^.!?]+[.!?]+', text):
            sentences.append({
                "text": match.group().strip(),
                "start": match.start(),
                "end": match.end()
            })

        return sentences

    def _get_embeddings(self, sentences: List[Dict]) -> List[List[float]]:
        """Get embeddings for sentences"""
        if self.embedding_model:
            texts = [s["text"] for s in sentences]
            return self.embedding_model.encode(texts)

        # Fallback: simple word-based representation
        embeddings = []
        for sentence in sentences:
            words = set(sentence["text"].lower().split())
            # Simple bag-of-words embedding (placeholder)
            embeddings.append(list(words)[:100])
        return embeddings

    def _find_break_points(self, embeddings: List) -> List[int]:
        """Find semantic break points"""
        break_points = []

        for i in range(1, len(embeddings)):
            similarity = self._cosine_similarity(
                embeddings[i-1], embeddings[i]
            )

            if similarity < self.threshold:
                break_points.append(i)

        return break_points

    def _cosine_similarity(self, a, b) -> float:
        """Calculate cosine similarity"""
        if isinstance(a, list) and isinstance(a[0], str):
            # Bag-of-words fallback
            set_a, set_b = set(a), set(b)
            intersection = len(set_a & set_b)
            union = len(set_a | set_b)
            return intersection / union if union > 0 else 0

        # Vector similarity
        import math
        dot = sum(x*y for x, y in zip(a, b))
        norm_a = math.sqrt(sum(x*x for x in a))
        norm_b = math.sqrt(sum(x*x for x in b))
        return dot / (norm_a * norm_b) if norm_a * norm_b > 0 else 0

    def _create_chunks(
        self,
        sentences: List[Dict],
        break_points: List[int],
        metadata: Dict
    ) -> List[Chunk]:
        """Create chunks from sentences and break points"""
        chunks = []
        start_idx = 0

        for i, break_point in enumerate(break_points + [len(sentences)]):
            chunk_sentences = sentences[start_idx:break_point]

            if chunk_sentences:
                content = ' '.join(s["text"] for s in chunk_sentences)

                # Check max size
                if len(content) > self.max_size:
                    # Split further if too large
                    sub_chunks = self._split_large_chunk(
                        chunk_sentences, metadata, len(chunks)
                    )
                    chunks.extend(sub_chunks)
                else:
                    chunks.append(Chunk(
                        id=f"semantic_{uuid.uuid4().hex[:8]}",
                        content=content,
                        metadata={
                            **(metadata or {}),
                            "chunk_index": len(chunks),
                            "chunking_strategy": "semantic"
                        },
                        start_index=chunk_sentences[0]["start"],
                        end_index=chunk_sentences[-1]["end"]
                    ))

            start_idx = break_point

        return chunks

    def _split_large_chunk(
        self,
        sentences: List[Dict],
        metadata: Dict,
        base_index: int
    ) -> List[Chunk]:
        """Split a large chunk into smaller pieces"""
        chunks = []
        current_content = ""
        current_start = sentences[0]["start"] if sentences else 0

        for sentence in sentences:
            if len(current_content) + len(sentence["text"]) > self.max_size:
                if current_content:
                    chunks.append(Chunk(
                        id=f"semantic_{uuid.uuid4().hex[:8]}",
                        content=current_content.strip(),
                        metadata={
                            **(metadata or {}),
                            "chunk_index": base_index + len(chunks),
                            "chunking_strategy": "semantic"
                        },
                        start_index=current_start,
                        end_index=sentence["start"]
                    ))
                current_content = sentence["text"]
                current_start = sentence["start"]
            else:
                current_content += " " + sentence["text"]

        if current_content:
            chunks.append(Chunk(
                id=f"semantic_{uuid.uuid4().hex[:8]}",
                content=current_content.strip(),
                metadata={
                    **(metadata or {}),
                    "chunk_index": base_index + len(chunks),
                    "chunking_strategy": "semantic"
                },
                start_index=current_start,
                end_index=sentences[-1]["end"] if sentences else current_start
            ))

        return chunks
```

## Recursive Character Text Splitter

```python
class RecursiveChunker(ChunkingStrategy):
    """Recursively split text using multiple separators"""

    def __init__(
        self,
        chunk_size: int = 512,
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

    def chunk(self, text: str, metadata: Dict = None) -> List[Chunk]:
        """Recursively split text"""
        return self._split_recursive(
            text,
            self.separators,
            metadata or {},
            0
        )

    def _split_recursive(
        self,
        text: str,
        separators: List[str],
        metadata: Dict,
        start_offset: int
    ) -> List[Chunk]:
        """Recursively split using separators"""
        if not separators:
            # No more separators, split by size
            return self._split_by_size(text, metadata, start_offset)

        separator = separators[0]
        remaining_separators = separators[1:]

        if separator:
            splits = text.split(separator)
        else:
            splits = list(text)

        chunks = []
        current_chunk = ""
        current_start = start_offset

        for i, split in enumerate(splits):
            # Calculate potential new chunk
            potential = current_chunk + (separator if current_chunk else "") + split

            if len(potential) <= self.chunk_size:
                current_chunk = potential
            else:
                # Current chunk is full
                if current_chunk:
                    if len(current_chunk) > self.chunk_size:
                        # Still too large, recurse
                        sub_chunks = self._split_recursive(
                            current_chunk,
                            remaining_separators,
                            metadata,
                            current_start
                        )
                        chunks.extend(sub_chunks)
                    else:
                        chunks.append(Chunk(
                            id=f"recursive_{uuid.uuid4().hex[:8]}",
                            content=current_chunk,
                            metadata={
                                **metadata,
                                "chunk_index": len(chunks),
                                "chunking_strategy": "recursive"
                            },
                            start_index=current_start,
                            end_index=current_start + len(current_chunk)
                        ))

                # Start new chunk with overlap
                if chunks and self.chunk_overlap > 0:
                    overlap = chunks[-1].content[-self.chunk_overlap:]
                    current_chunk = overlap + split
                else:
                    current_chunk = split

                current_start = start_offset + text.find(split)

        # Handle remaining content
        if current_chunk:
            if len(current_chunk) > self.chunk_size:
                sub_chunks = self._split_recursive(
                    current_chunk,
                    remaining_separators,
                    metadata,
                    current_start
                )
                chunks.extend(sub_chunks)
            else:
                chunks.append(Chunk(
                    id=f"recursive_{uuid.uuid4().hex[:8]}",
                    content=current_chunk,
                    metadata={
                        **metadata,
                        "chunk_index": len(chunks),
                        "chunking_strategy": "recursive"
                    },
                    start_index=current_start,
                    end_index=current_start + len(current_chunk)
                ))

        return chunks

    def _split_by_size(
        self,
        text: str,
        metadata: Dict,
        start_offset: int
    ) -> List[Chunk]:
        """Split text by character size"""
        chunks = []
        start = 0

        while start < len(text):
            end = min(start + self.chunk_size, len(text))
            chunk_text = text[start:end]

            chunks.append(Chunk(
                id=f"recursive_{uuid.uuid4().hex[:8]}",
                content=chunk_text,
                metadata={
                    **metadata,
                    "chunk_index": len(chunks),
                    "chunking_strategy": "recursive"
                },
                start_index=start_offset + start,
                end_index=start_offset + end
            ))

            start = end - self.chunk_overlap

        return chunks
```

## Document-Aware Chunking

```python
class DocumentAwareChunker(ChunkingStrategy):
    """Chunk based on document structure"""

    def __init__(self, chunk_size: int = 512):
        self.chunk_size = chunk_size

    def chunk(self, text: str, metadata: Dict = None) -> List[Chunk]:
        """Chunk respecting document structure"""
        # Detect document type
        doc_type = self._detect_document_type(text)

        if doc_type == "markdown":
            return self._chunk_markdown(text, metadata)
        elif doc_type == "code":
            return self._chunk_code(text, metadata)
        else:
            return self._chunk_generic(text, metadata)

    def _detect_document_type(self, text: str) -> str:
        """Detect document type"""
        # Check for markdown headers
        if text.count('#') > 2 and '\n#' in text:
            return "markdown"

        # Check for code patterns
        code_indicators = ['def ', 'class ', 'function ', 'import ', 'const ']
        if sum(1 for ind in code_indicators if ind in text) > 2:
            return "code"

        return "generic"

    def _chunk_markdown(self, text: str, metadata: Dict) -> List[Chunk]:
        """Chunk markdown by headers"""
        import re
        chunks = []

        # Split by headers
        header_pattern = r'^(#{1,6})\s+(.+)$'
        sections = re.split(r'(?=^#{1,6}\s)', text, flags=re.MULTILINE)

        for section in sections:
            if not section.strip():
                continue

            # Extract header
            header_match = re.match(header_pattern, section, re.MULTILINE)
            header = header_match.group(2) if header_match else ""

            chunks.append(Chunk(
                id=f"md_{uuid.uuid4().hex[:8]}",
                content=section.strip(),
                metadata={
                    **(metadata or {}),
                    "section_header": header,
                    "chunking_strategy": "markdown"
                },
                start_index=text.find(section),
                end_index=text.find(section) + len(section)
            ))

        return chunks

    def _chunk_code(self, text: str, metadata: Dict) -> List[Chunk]:
        """Chunk code by functions/classes"""
        import re
        chunks = []

        # Split by function/class definitions
        patterns = [
            r'(^(?:def|async def)\s+\w+.*?(?=^(?:def|async def|class)|\Z))',
            r'(^class\s+\w+.*?(?=^(?:def|async def|class)|\Z))',
        ]

        remaining = text
        for pattern in patterns:
            matches = list(re.finditer(pattern, remaining, re.MULTILINE | re.DOTALL))
            for match in matches:
                chunks.append(Chunk(
                    id=f"code_{uuid.uuid4().hex[:8]}",
                    content=match.group().strip(),
                    metadata={
                        **(metadata or {}),
                        "chunking_strategy": "code"
                    },
                    start_index=match.start(),
                    end_index=match.end()
                ))

        return chunks if chunks else self._chunk_generic(text, metadata)

    def _chunk_generic(self, text: str, metadata: Dict) -> List[Chunk]:
        """Fallback to recursive chunking"""
        recursive = RecursiveChunker(chunk_size=self.chunk_size)
        return recursive.chunk(text, metadata)
```

## Chunking Evaluation

```python
class ChunkingEvaluator:
    """Evaluate chunking quality"""

    def evaluate(
        self,
        chunks: List[Chunk],
        original_text: str
    ) -> Dict:
        """Evaluate chunk quality"""
        metrics = {}

        # Coverage
        metrics["coverage"] = self._calculate_coverage(chunks, original_text)

        # Size distribution
        metrics["size_stats"] = self._calculate_size_stats(chunks)

        # Overlap analysis
        metrics["overlap_stats"] = self._analyze_overlap(chunks)

        # Completeness
        metrics["completeness"] = self._check_completeness(chunks)

        return metrics

    def _calculate_coverage(
        self,
        chunks: List[Chunk],
        original: str
    ) -> float:
        """Calculate text coverage"""
        covered_chars = set()
        for chunk in chunks:
            for i in range(chunk.start_index, chunk.end_index):
                covered_chars.add(i)

        return len(covered_chars) / len(original) if original else 0

    def _calculate_size_stats(self, chunks: List[Chunk]) -> Dict:
        """Calculate size statistics"""
        sizes = [len(c.content) for c in chunks]

        if not sizes:
            return {"count": 0}

        return {
            "count": len(sizes),
            "min": min(sizes),
            "max": max(sizes),
            "avg": sum(sizes) / len(sizes),
            "std": self._std(sizes)
        }

    def _std(self, values: List[float]) -> float:
        """Calculate standard deviation"""
        if len(values) < 2:
            return 0
        mean = sum(values) / len(values)
        variance = sum((x - mean) ** 2 for x in values) / len(values)
        return variance ** 0.5

    def _analyze_overlap(self, chunks: List[Chunk]) -> Dict:
        """Analyze chunk overlap"""
        overlaps = []

        for i in range(len(chunks) - 1):
            current = chunks[i]
            next_chunk = chunks[i + 1]

            if current.end_index > next_chunk.start_index:
                overlap = current.end_index - next_chunk.start_index
                overlaps.append(overlap)

        return {
            "chunks_with_overlap": len(overlaps),
            "avg_overlap": sum(overlaps) / len(overlaps) if overlaps else 0,
            "max_overlap": max(overlaps) if overlaps else 0
        }

    def _check_completeness(self, chunks: List[Chunk]) -> Dict:
        """Check for incomplete sentences"""
        incomplete = 0

        for chunk in chunks:
            content = chunk.content.strip()
            # Check if ends with sentence terminator
            if content and content[-1] not in '.!?"\')':
                incomplete += 1

        return {
            "total_chunks": len(chunks),
            "incomplete_endings": incomplete,
            "completeness_rate": 1 - (incomplete / len(chunks)) if chunks else 1
        }

# Usage
evaluator = ChunkingEvaluator()

text = "Sample document text..." * 50
chunker = RecursiveChunker(chunk_size=200, chunk_overlap=20)
chunks = chunker.chunk(text)

metrics = evaluator.evaluate(chunks, text)
print(f"Chunks: {metrics['size_stats']['count']}")
print(f"Coverage: {metrics['coverage']:.1%}")
print(f"Completeness: {metrics['completeness']['completeness_rate']:.1%}")
```

## Conclusion

Effective chunking is essential for RAG performance. Fixed-size chunking provides simplicity, semantic chunking preserves meaning, recursive chunking respects text hierarchy, and document-aware chunking leverages structure. Evaluate chunking quality using coverage, size distribution, and completeness metrics to optimize for your specific use case.
