---
title: "Parent-Child Retrieval for RAG Systems"
author: Michael John Peña
draft: false
date: 2023-10-27
description: "Implementing parent-child document retrieval to improve context and accuracy in RAG applications."
tags:
  - RAG
  - Parent-Child Retrieval
  - Document Retrieval
  - LlamaIndex
  - AI
---

## Introduction

Parent-child retrieval is a powerful RAG technique that retrieves small chunks for precision but returns larger parent chunks for context. This approach combines the benefits of fine-grained retrieval with comprehensive context for generation.

## Parent-Child Architecture

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional
import uuid

@dataclass
class ChildChunk:
    id: str
    content: str
    embedding: Optional[List[float]] = None
    parent_id: str = ""
    position: int = 0
    metadata: Dict = field(default_factory=dict)

@dataclass
class ParentChunk:
    id: str
    content: str
    children: List[ChildChunk] = field(default_factory=list)
    metadata: Dict = field(default_factory=dict)

class ParentChildIndexer:
    """Index documents with parent-child relationships"""

    def __init__(
        self,
        parent_chunk_size: int = 2000,
        child_chunk_size: int = 400,
        child_overlap: int = 50
    ):
        self.parent_size = parent_chunk_size
        self.child_size = child_chunk_size
        self.child_overlap = child_overlap
        self.parents: Dict[str, ParentChunk] = {}
        self.children: Dict[str, ChildChunk] = {}
        self.child_to_parent: Dict[str, str] = {}

    def index_document(self, document: str, metadata: Dict = None) -> Dict:
        """Index document with parent-child structure"""
        # Create parent chunks
        parents = self._create_parent_chunks(document, metadata)

        # Create child chunks for each parent
        for parent in parents:
            children = self._create_child_chunks(parent)
            parent.children = children

            self.parents[parent.id] = parent

            for child in children:
                self.children[child.id] = child
                self.child_to_parent[child.id] = parent.id

        return {
            "parent_count": len(parents),
            "child_count": sum(len(p.children) for p in parents),
            "parent_ids": [p.id for p in parents]
        }

    def _create_parent_chunks(
        self,
        text: str,
        metadata: Dict
    ) -> List[ParentChunk]:
        """Create parent-level chunks"""
        parents = []
        start = 0

        while start < len(text):
            end = min(start + self.parent_size, len(text))

            # Find paragraph boundary
            if end < len(text):
                boundary = text.rfind('\n\n', start, end)
                if boundary > start:
                    end = boundary + 2

            chunk_text = text[start:end].strip()

            if chunk_text:
                parents.append(ParentChunk(
                    id=f"parent_{uuid.uuid4().hex[:12]}",
                    content=chunk_text,
                    metadata={
                        **(metadata or {}),
                        "start_position": start,
                        "end_position": end
                    }
                ))

            start = end

        return parents

    def _create_child_chunks(self, parent: ParentChunk) -> List[ChildChunk]:
        """Create child chunks from parent"""
        children = []
        text = parent.content
        start = 0
        position = 0

        while start < len(text):
            end = min(start + self.child_size, len(text))

            # Find sentence boundary
            if end < len(text):
                for sep in ['. ', '! ', '? ', '\n']:
                    boundary = text.rfind(sep, start + self.child_size // 2, end)
                    if boundary > start:
                        end = boundary + len(sep)
                        break

            chunk_text = text[start:end].strip()

            if chunk_text:
                children.append(ChildChunk(
                    id=f"child_{uuid.uuid4().hex[:12]}",
                    content=chunk_text,
                    parent_id=parent.id,
                    position=position,
                    metadata={
                        "parent_id": parent.id,
                        "position_in_parent": position
                    }
                ))
                position += 1

            start = end - self.child_overlap
            if start >= len(text) - 50:
                break

        return children

    def get_parent(self, child_id: str) -> Optional[ParentChunk]:
        """Get parent chunk for a child"""
        parent_id = self.child_to_parent.get(child_id)
        if parent_id:
            return self.parents.get(parent_id)
        return None

    def get_all_children(self) -> List[ChildChunk]:
        """Get all child chunks for indexing"""
        return list(self.children.values())
```

## Parent-Child Retriever

```python
class ParentChildRetriever:
    """Retrieve using child chunks, return parent context"""

    def __init__(
        self,
        indexer: ParentChildIndexer,
        embedding_model=None,
        return_mode: str = "parent"  # parent, both, or child_with_context
    ):
        self.indexer = indexer
        self.embedding_model = embedding_model
        self.return_mode = return_mode
        self.child_embeddings: Dict[str, List[float]] = {}

    def build_index(self):
        """Build embeddings index for children"""
        children = self.indexer.get_all_children()

        for child in children:
            if self.embedding_model:
                embedding = self.embedding_model.encode(child.content)
            else:
                # Placeholder embedding
                embedding = self._simple_embedding(child.content)

            self.child_embeddings[child.id] = embedding
            child.embedding = embedding

    def _simple_embedding(self, text: str) -> List[float]:
        """Simple word-based embedding for demo"""
        words = text.lower().split()
        # Create simple hash-based embedding
        embedding = [0.0] * 128
        for word in words:
            idx = hash(word) % 128
            embedding[idx] += 1
        # Normalize
        norm = sum(x*x for x in embedding) ** 0.5
        if norm > 0:
            embedding = [x/norm for x in embedding]
        return embedding

    def retrieve(
        self,
        query: str,
        top_k: int = 3
    ) -> List[Dict]:
        """Retrieve relevant content"""
        # Get query embedding
        if self.embedding_model:
            query_embedding = self.embedding_model.encode(query)
        else:
            query_embedding = self._simple_embedding(query)

        # Find top-k similar children
        similarities = []
        for child_id, child_emb in self.child_embeddings.items():
            sim = self._cosine_similarity(query_embedding, child_emb)
            similarities.append((child_id, sim))

        similarities.sort(key=lambda x: x[1], reverse=True)
        top_children = similarities[:top_k]

        # Build results based on return mode
        results = []
        seen_parents = set()

        for child_id, score in top_children:
            child = self.indexer.children[child_id]
            parent = self.indexer.get_parent(child_id)

            if self.return_mode == "parent":
                if parent and parent.id not in seen_parents:
                    results.append({
                        "content": parent.content,
                        "score": score,
                        "type": "parent",
                        "parent_id": parent.id,
                        "matched_child": child.content
                    })
                    seen_parents.add(parent.id)

            elif self.return_mode == "both":
                results.append({
                    "child_content": child.content,
                    "parent_content": parent.content if parent else None,
                    "score": score,
                    "child_id": child_id,
                    "parent_id": parent.id if parent else None
                })

            elif self.return_mode == "child_with_context":
                context = self._get_surrounding_context(child, parent)
                results.append({
                    "content": context,
                    "score": score,
                    "child_id": child_id,
                    "type": "child_with_context"
                })

        return results

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """Calculate cosine similarity"""
        dot = sum(x*y for x, y in zip(a, b))
        norm_a = sum(x*x for x in a) ** 0.5
        norm_b = sum(x*x for x in b) ** 0.5
        return dot / (norm_a * norm_b) if norm_a * norm_b > 0 else 0

    def _get_surrounding_context(
        self,
        child: ChildChunk,
        parent: ParentChunk
    ) -> str:
        """Get child with surrounding siblings for context"""
        if not parent:
            return child.content

        position = child.position
        siblings = sorted(parent.children, key=lambda c: c.position)

        # Get previous and next sibling
        context_parts = []

        # Previous sibling
        if position > 0:
            prev_child = next(
                (c for c in siblings if c.position == position - 1),
                None
            )
            if prev_child:
                context_parts.append(f"[Previous]: {prev_child.content}")

        # Current child
        context_parts.append(f"[Matched]: {child.content}")

        # Next sibling
        if position < len(siblings) - 1:
            next_child = next(
                (c for c in siblings if c.position == position + 1),
                None
            )
            if next_child:
                context_parts.append(f"[Next]: {next_child.content}")

        return "\n\n".join(context_parts)

# Usage
indexer = ParentChildIndexer(
    parent_chunk_size=1500,
    child_chunk_size=300,
    child_overlap=30
)

document = """
Long document content here with multiple paragraphs.
Each paragraph covers different topics.
The parent chunks contain broader context.
Child chunks are more focused and specific.
This structure allows for precise retrieval.
While maintaining comprehensive context for generation.
""" * 20

# Index document
result = indexer.index_document(document, {"source": "test.pdf"})
print(f"Parents: {result['parent_count']}, Children: {result['child_count']}")

# Build retriever
retriever = ParentChildRetriever(indexer, return_mode="parent")
retriever.build_index()

# Query
results = retriever.retrieve("precise retrieval context", top_k=2)
for r in results:
    print(f"Score: {r['score']:.3f}")
    print(f"Content preview: {r['content'][:200]}...")
```

## Multi-Level Hierarchy

```python
@dataclass
class HierarchicalChunk:
    id: str
    content: str
    level: int  # 0 = document, 1 = section, 2 = paragraph, 3 = sentence
    parent_id: Optional[str] = None
    children_ids: List[str] = field(default_factory=list)
    metadata: Dict = field(default_factory=dict)

class HierarchicalIndexer:
    """Index documents with multiple hierarchy levels"""

    def __init__(self):
        self.chunks: Dict[str, HierarchicalChunk] = {}
        self.level_sizes = {
            0: float('inf'),  # Document
            1: 3000,          # Section
            2: 800,           # Paragraph
            3: 200            # Sentence/small chunk
        }

    def index_document(
        self,
        document: str,
        max_level: int = 3
    ) -> Dict:
        """Index with hierarchical structure"""
        # Level 0: Document
        doc_chunk = HierarchicalChunk(
            id=f"doc_{uuid.uuid4().hex[:8]}",
            content=document,
            level=0
        )
        self.chunks[doc_chunk.id] = doc_chunk

        # Build hierarchy
        self._build_hierarchy(doc_chunk, max_level)

        return {
            "levels": self._count_by_level(),
            "total_chunks": len(self.chunks)
        }

    def _build_hierarchy(self, parent: HierarchicalChunk, max_level: int):
        """Recursively build hierarchy"""
        if parent.level >= max_level:
            return

        child_level = parent.level + 1
        child_size = self.level_sizes.get(child_level, 500)

        # Split parent content
        children = self._split_at_level(
            parent.content,
            child_level,
            child_size
        )

        for child_content in children:
            child = HierarchicalChunk(
                id=f"l{child_level}_{uuid.uuid4().hex[:8]}",
                content=child_content,
                level=child_level,
                parent_id=parent.id
            )
            self.chunks[child.id] = child
            parent.children_ids.append(child.id)

            # Recurse
            self._build_hierarchy(child, max_level)

    def _split_at_level(
        self,
        text: str,
        level: int,
        target_size: int
    ) -> List[str]:
        """Split text appropriately for level"""
        if level == 1:  # Sections
            # Split by headers or large breaks
            parts = text.split('\n\n\n')
            if len(parts) == 1:
                parts = text.split('\n\n')
        elif level == 2:  # Paragraphs
            parts = text.split('\n\n')
        else:  # Sentences/small
            import re
            parts = re.split(r'(?<=[.!?])\s+', text)

        # Merge small parts
        merged = []
        current = ""
        for part in parts:
            if len(current) + len(part) <= target_size:
                current += (" " if current else "") + part
            else:
                if current:
                    merged.append(current.strip())
                current = part

        if current:
            merged.append(current.strip())

        return [m for m in merged if m]

    def _count_by_level(self) -> Dict[int, int]:
        """Count chunks by level"""
        counts = {}
        for chunk in self.chunks.values():
            counts[chunk.level] = counts.get(chunk.level, 0) + 1
        return counts

    def get_ancestors(self, chunk_id: str) -> List[HierarchicalChunk]:
        """Get all ancestors of a chunk"""
        ancestors = []
        chunk = self.chunks.get(chunk_id)

        while chunk and chunk.parent_id:
            parent = self.chunks.get(chunk.parent_id)
            if parent:
                ancestors.append(parent)
                chunk = parent
            else:
                break

        return ancestors

    def get_descendants(
        self,
        chunk_id: str,
        max_level: int = None
    ) -> List[HierarchicalChunk]:
        """Get all descendants of a chunk"""
        descendants = []
        chunk = self.chunks.get(chunk_id)

        if not chunk:
            return descendants

        def collect(c: HierarchicalChunk):
            for child_id in c.children_ids:
                child = self.chunks.get(child_id)
                if child:
                    if max_level is None or child.level <= max_level:
                        descendants.append(child)
                        collect(child)

        collect(chunk)
        return descendants

class HierarchicalRetriever:
    """Retrieve from hierarchical index"""

    def __init__(
        self,
        indexer: HierarchicalIndexer,
        search_level: int = 3,
        return_level: int = 2
    ):
        self.indexer = indexer
        self.search_level = search_level  # Level to search at
        self.return_level = return_level  # Level to return

    def retrieve(self, query: str, top_k: int = 3) -> List[Dict]:
        """Retrieve with level control"""
        # Get chunks at search level
        search_chunks = [
            c for c in self.indexer.chunks.values()
            if c.level == self.search_level
        ]

        # Score chunks
        scored = []
        for chunk in search_chunks:
            score = self._score_chunk(query, chunk)
            scored.append((chunk, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        top_results = scored[:top_k]

        # Get return-level content
        results = []
        seen_return_ids = set()

        for chunk, score in top_results:
            # Find ancestor at return level
            return_chunk = self._get_at_level(chunk, self.return_level)

            if return_chunk and return_chunk.id not in seen_return_ids:
                results.append({
                    "content": return_chunk.content,
                    "score": score,
                    "return_level": self.return_level,
                    "matched_at_level": self.search_level,
                    "matched_chunk": chunk.content[:100]
                })
                seen_return_ids.add(return_chunk.id)

        return results

    def _score_chunk(self, query: str, chunk: HierarchicalChunk) -> float:
        """Score chunk relevance"""
        query_words = set(query.lower().split())
        chunk_words = set(chunk.content.lower().split())
        overlap = len(query_words & chunk_words)
        return overlap / len(query_words) if query_words else 0

    def _get_at_level(
        self,
        chunk: HierarchicalChunk,
        target_level: int
    ) -> Optional[HierarchicalChunk]:
        """Get chunk or ancestor at target level"""
        if chunk.level == target_level:
            return chunk
        elif chunk.level > target_level:
            # Go up to ancestors
            ancestors = self.indexer.get_ancestors(chunk.id)
            for ancestor in ancestors:
                if ancestor.level == target_level:
                    return ancestor
        return chunk  # Return original if level not found
```

## Integration with RAG Pipeline

```python
class ParentChildRAG:
    """Complete RAG with parent-child retrieval"""

    def __init__(self, generator):
        self.indexer = ParentChildIndexer()
        self.retriever = None
        self.generator = generator

    def add_documents(self, documents: List[str], metadatas: List[Dict] = None):
        """Add documents to index"""
        for i, doc in enumerate(documents):
            metadata = metadatas[i] if metadatas else {}
            self.indexer.index_document(doc, metadata)

        # Build retriever
        self.retriever = ParentChildRetriever(
            self.indexer,
            return_mode="parent"
        )
        self.retriever.build_index()

    def query(self, question: str, top_k: int = 3) -> Dict:
        """Query with parent-child retrieval"""
        if not self.retriever:
            raise ValueError("No documents indexed")

        # Retrieve parents
        results = self.retriever.retrieve(question, top_k=top_k)

        # Build context from parent chunks
        context_parts = []
        for i, r in enumerate(results):
            context_parts.append(f"[Source {i+1}]\n{r['content']}")

        context = "\n\n---\n\n".join(context_parts)

        # Generate response
        prompt = f"""Answer the question based on the provided context.

Context:
{context}

Question: {question}

Answer:"""

        response = self.generator.generate(prompt)

        return {
            "answer": response,
            "sources": [
                {
                    "parent_id": r.get("parent_id"),
                    "score": r["score"],
                    "matched_child_preview": r.get("matched_child", "")[:100]
                }
                for r in results
            ]
        }

# Usage
class MockGenerator:
    def generate(self, prompt):
        return "Generated response based on context."

rag = ParentChildRAG(MockGenerator())

docs = [
    "First document with detailed content...",
    "Second document covering other topics..."
]

rag.add_documents(docs)

result = rag.query("What is the main topic?")
print(f"Answer: {result['answer']}")
print(f"Sources used: {len(result['sources'])}")
```

## Conclusion

Parent-child retrieval improves RAG systems by enabling precise matching on small chunks while providing comprehensive context from larger parent chunks. This approach balances retrieval accuracy with context richness, leading to better generation quality. Hierarchical structures can extend this pattern to multiple levels for even finer control over context granularity.
