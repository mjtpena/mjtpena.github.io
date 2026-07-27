---
title: "Advanced Chunking Strategies for RAG: Beyond Fixed-Size Splits"
author: Michael John Peña
draft: false
date: 2024-01-07
tags:
  - RAG
  - Chunking
  - NLP
  - Azure AI Search
  - Document Processing
---

In projects I've worked on, chunking decisions alone changed retrieval quality more than model choice ever did. This deep dive pulls together advanced chunking strategies I used to preserve coherence while optimising token budgets.

## Why Chunking Matters

The chunk is the unit of retrieval. When a user asks a question:
1. Their query gets embedded
2. Similar chunks are retrieved
3. Those chunks become context for the LLM

If your chunks split important information across boundaries, you lose context. If they're too large, you waste token budget. If they're too small, you lose coherence.

## Chunking Strategies

### 1. Fixed-Size Chunking (Baseline)

Simple but often suboptimal:

```python
def fixed_size_chunk(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[str]:
    """Basic fixed-size chunking with overlap."""
    chunks = []
    start = 0

    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk)
        start = end - overlap

    return chunks

# Problems:
# - Splits mid-sentence
# - Ignores document structure
# - Fixed size regardless of content type
```

### 2. Sentence-Aware Chunking

Respect sentence boundaries:

```python
import nltk
from nltk.tokenize import sent_tokenize

def sentence_aware_chunk(
    text: str,
    max_chunk_size: int = 1000,
    overlap_sentences: int = 2
) -> list[str]:
    """Chunk by sentences, respecting boundaries."""

    sentences = sent_tokenize(text)
    chunks = []
    current_chunk = []
    current_size = 0

    for sentence in sentences:
        sentence_size = len(sentence)

        if current_size + sentence_size > max_chunk_size and current_chunk:
            # Save current chunk
            chunks.append(" ".join(current_chunk))

            # Start new chunk with overlap
            current_chunk = current_chunk[-overlap_sentences:] if overlap_sentences else []
            current_size = sum(len(s) for s in current_chunk)

        current_chunk.append(sentence)
        current_size += sentence_size

    # Don't forget the last chunk
    if current_chunk:
        chunks.append(" ".join(current_chunk))

    return chunks
```

### 3. Semantic Chunking

Group sentences by semantic similarity:

```python
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

class SemanticChunker:
    def __init__(self, embedding_client, similarity_threshold: float = 0.75):
        self.embeddings = embedding_client
        self.threshold = similarity_threshold

    def chunk(self, text: str, max_chunk_size: int = 1500) -> list[str]:
        """Chunk based on semantic similarity between sentences."""

        sentences = sent_tokenize(text)
        if len(sentences) <= 1:
            return [text]

        # Embed all sentences
        embeddings = self._embed_batch(sentences)

        # Group semantically similar consecutive sentences
        chunks = []
        current_chunk = [sentences[0]]
        current_embedding = embeddings[0]

        for i in range(1, len(sentences)):
            similarity = cosine_similarity(
                [current_embedding],
                [embeddings[i]]
            )[0][0]

            current_text = " ".join(current_chunk)

            # Check if we should start a new chunk
            if similarity < self.threshold or len(current_text) + len(sentences[i]) > max_chunk_size:
                chunks.append(current_text)
                current_chunk = [sentences[i]]
                current_embedding = embeddings[i]
            else:
                current_chunk.append(sentences[i])
                # Update embedding as average
                current_embedding = np.mean(
                    [current_embedding, embeddings[i]],
                    axis=0
                )

        # Last chunk
        if current_chunk:
            chunks.append(" ".join(current_chunk))

        return chunks

    def _embed_batch(self, texts: list[str]) -> list[list[float]]:
        """Embed multiple texts efficiently."""
        response = self.embeddings.create(
            model="text-embedding-ada-002",
            input=texts
        )
        return [e.embedding for e in response.data]
```

### 4. Recursive Structure-Aware Chunking

Use document structure (headers, paragraphs):

```python
from dataclasses import dataclass
from typing import Optional
import re

@dataclass
class DocumentSection:
    title: str
    content: str
    level: int
    children: list["DocumentSection"]

class StructureAwareChunker:
    def __init__(self, max_chunk_size: int = 1500):
        self.max_chunk_size = max_chunk_size

    def chunk_markdown(self, markdown: str) -> list[dict]:
        """Chunk markdown respecting header structure."""

        # Parse into sections
        sections = self._parse_markdown_structure(markdown)

        # Convert sections to chunks
        chunks = []
        for section in sections:
            chunks.extend(self._section_to_chunks(section, []))

        return chunks

    def _parse_markdown_structure(self, markdown: str) -> list[DocumentSection]:
        """Parse markdown into hierarchical sections."""

        lines = markdown.split("\n")
        root_sections = []
        section_stack = []

        current_content = []

        for line in lines:
            header_match = re.match(r'^(#{1,6})\s+(.+)$', line)

            if header_match:
                # Save accumulated content to current section
                if section_stack and current_content:
                    section_stack[-1].content = "\n".join(current_content)
                    current_content = []

                level = len(header_match.group(1))
                title = header_match.group(2)

                new_section = DocumentSection(
                    title=title,
                    content="",
                    level=level,
                    children=[]
                )

                # Find parent
                while section_stack and section_stack[-1].level >= level:
                    section_stack.pop()

                if section_stack:
                    section_stack[-1].children.append(new_section)
                else:
                    root_sections.append(new_section)

                section_stack.append(new_section)
            else:
                current_content.append(line)

        # Handle remaining content
        if section_stack and current_content:
            section_stack[-1].content = "\n".join(current_content)

        return root_sections

    def _section_to_chunks(
        self,
        section: DocumentSection,
        parent_titles: list[str]
    ) -> list[dict]:
        """Convert section to chunks, preserving hierarchy context."""

        chunks = []
        context_path = parent_titles + [section.title]

        # Check if section content fits in one chunk
        full_content = f"{'#' * section.level} {section.title}\n\n{section.content}"

        if len(full_content) <= self.max_chunk_size and not section.children:
            chunks.append({
                "content": full_content,
                "metadata": {
                    "section_path": " > ".join(context_path),
                    "level": section.level
                }
            })
        else:
            # Split content if too large
            if section.content:
                content_chunks = self._split_content(section.content)
                for i, chunk_content in enumerate(content_chunks):
                    header = f"{'#' * section.level} {section.title}"
                    if len(content_chunks) > 1:
                        header += f" (Part {i+1}/{len(content_chunks)})"

                    chunks.append({
                        "content": f"{header}\n\n{chunk_content}",
                        "metadata": {
                            "section_path": " > ".join(context_path),
                            "level": section.level,
                            "part": i + 1
                        }
                    })

            # Process children
            for child in section.children:
                chunks.extend(self._section_to_chunks(child, context_path))

        return chunks

    def _split_content(self, content: str) -> list[str]:
        """Split content by paragraphs then sentences if needed."""

        paragraphs = content.split("\n\n")
        chunks = []
        current_chunk = []
        current_size = 0

        for para in paragraphs:
            if current_size + len(para) > self.max_chunk_size:
                if current_chunk:
                    chunks.append("\n\n".join(current_chunk))
                current_chunk = [para]
                current_size = len(para)
            else:
                current_chunk.append(para)
                current_size += len(para)

        if current_chunk:
            chunks.append("\n\n".join(current_chunk))

        return chunks
```

### 5. Document-Type Specific Chunking

Different document types need different strategies:

```python
from abc import ABC, abstractmethod
from enum import Enum

class DocumentType(Enum):
    PROSE = "prose"
    CODE = "code"
    TABLE = "table"
    FAQ = "faq"
    LEGAL = "legal"

class DocumentChunker(ABC):
    @abstractmethod
    def chunk(self, content: str) -> list[dict]:
        pass

class CodeChunker(DocumentChunker):
    """Chunk code files by logical units."""

    def chunk(self, content: str) -> list[dict]:
        # For Python: split by function/class definitions
        import ast

        try:
            tree = ast.parse(content)
        except SyntaxError:
            # Fall back to line-based chunking
            return self._line_based_chunk(content)

        chunks = []

        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                # Get source lines for this node
                start_line = node.lineno - 1
                end_line = node.end_lineno

                lines = content.split("\n")
                chunk_content = "\n".join(lines[start_line:end_line])

                chunks.append({
                    "content": chunk_content,
                    "metadata": {
                        "type": "function" if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) else "class",
                        "name": node.name,
                        "line_start": start_line + 1,
                        "line_end": end_line
                    }
                })

        return chunks

    def _line_based_chunk(self, content: str, chunk_lines: int = 50) -> list[dict]:
        lines = content.split("\n")
        chunks = []

        for i in range(0, len(lines), chunk_lines):
            chunk_content = "\n".join(lines[i:i+chunk_lines])
            chunks.append({
                "content": chunk_content,
                "metadata": {
                    "line_start": i + 1,
                    "line_end": min(i + chunk_lines, len(lines))
                }
            })

        return chunks

class FAQChunker(DocumentChunker):
    """Chunk FAQ documents by Q&A pairs."""

    def chunk(self, content: str) -> list[dict]:
        # Assume Q: ... A: ... format
        qa_pattern = r'Q:\s*(.+?)\s*A:\s*(.+?)(?=Q:|$)'
        matches = re.findall(qa_pattern, content, re.DOTALL)

        chunks = []
        for question, answer in matches:
            chunks.append({
                "content": f"Question: {question.strip()}\n\nAnswer: {answer.strip()}",
                "metadata": {
                    "type": "qa_pair",
                    "question": question.strip()[:100]
                }
            })

        return chunks

class TableChunker(DocumentChunker):
    """Chunk tables row by row with headers."""

    def chunk(self, content: str, rows_per_chunk: int = 10) -> list[dict]:
        lines = content.strip().split("\n")

        # Assume first line is headers
        headers = lines[0]
        data_lines = lines[1:]

        chunks = []
        for i in range(0, len(data_lines), rows_per_chunk):
            chunk_rows = data_lines[i:i+rows_per_chunk]
            chunk_content = headers + "\n" + "\n".join(chunk_rows)

            chunks.append({
                "content": chunk_content,
                "metadata": {
                    "type": "table",
                    "row_start": i + 1,
                    "row_end": min(i + rows_per_chunk, len(data_lines))
                }
            })

        return chunks

# Factory
def get_chunker(doc_type: DocumentType) -> DocumentChunker:
    chunkers = {
        DocumentType.CODE: CodeChunker(),
        DocumentType.FAQ: FAQChunker(),
        DocumentType.TABLE: TableChunker(),
        # Add more...
    }
    return chunkers.get(doc_type, SentenceAwareChunker())
```

## Chunking Pipeline

Putting it all together:

```python
class ChunkingPipeline:
    def __init__(self, embedding_client):
        self.semantic_chunker = SemanticChunker(embedding_client)
        self.structure_chunker = StructureAwareChunker()
        self.type_chunkers = {
            "py": CodeChunker(),
            "faq": FAQChunker(),
        }

    def process_document(
        self,
        content: str,
        filename: str,
        doc_type: Optional[str] = None
    ) -> list[dict]:
        """Process document with appropriate chunking strategy."""

        # Detect document type
        if doc_type is None:
            doc_type = self._detect_type(filename, content)

        # Select chunker
        if doc_type in self.type_chunkers:
            chunks = self.type_chunkers[doc_type].chunk(content)
        elif filename.endswith(".md"):
            chunks = self.structure_chunker.chunk_markdown(content)
        else:
            chunks = self.semantic_chunker.chunk(content)

        # Enrich metadata
        for i, chunk in enumerate(chunks):
            chunk["metadata"]["source_file"] = filename
            chunk["metadata"]["chunk_index"] = i
            chunk["metadata"]["total_chunks"] = len(chunks)

        return chunks

    def _detect_type(self, filename: str, content: str) -> str:
        """Auto-detect document type."""
        ext = filename.split(".")[-1].lower()

        if ext in ["py", "js", "ts", "java", "cs"]:
            return "code"
        if "Q:" in content and "A:" in content:
            return "faq"
        return "prose"
```

## Evaluation

Always measure chunking quality:

```python
def evaluate_chunking(chunks: list[dict], test_queries: list[dict]) -> dict:
    """Evaluate chunking quality with test queries."""

    results = {
        "avg_chunk_size": np.mean([len(c["content"]) for c in chunks]),
        "chunk_size_std": np.std([len(c["content"]) for c in chunks]),
        "total_chunks": len(chunks),
        "retrieval_accuracy": 0.0
    }

    # For each test query, check if correct chunk is retrievable
    # Implementation depends on your retrieval system

    return results
```

## Conclusion

Chunking is foundational to RAG quality. Key takeaways:

1. **Never use naive fixed-size** - At minimum, respect sentences
2. **Use document structure** - Headers and sections matter
3. **Consider semantic similarity** - Keep related content together
4. **Adapt to document type** - Code, tables, and prose need different strategies
5. **Measure and iterate** - Chunking quality affects retrieval quality

The right chunking strategy can improve retrieval accuracy by 20-40%. It's worth the investment.
