---
title: "Auto-Merge Retrieval for RAG Systems"
author: Michael John Peña
draft: false
date: 2023-10-29
description: "Implementing auto-merge retrieval to automatically combine related chunks for comprehensive context."
tags:
  - RAG
  - Auto-Merge
  - Retrieval
  - LlamaIndex
  - AI
---

## Introduction

Auto-merge retrieval automatically combines retrieved chunks when they belong to the same parent section or when adjacent chunks are both relevant. This technique ensures comprehensive context without redundancy, improving generation quality.

## Auto-Merge Architecture

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Set
import uuid

@dataclass
class HierarchicalNode:
    id: str
    content: str
    level: int  # 0 = document, 1 = section, 2 = subsection, 3 = leaf
    parent_id: Optional[str] = None
    children_ids: List[str] = field(default_factory=list)
    embedding: Optional[List[float]] = None
    metadata: Dict = field(default_factory=dict)

class AutoMergeIndexer:
    """Index documents with hierarchical structure for auto-merging"""

    def __init__(
        self,
        leaf_chunk_size: int = 256,
        merge_threshold: float = 0.6
    ):
        self.leaf_chunk_size = leaf_chunk_size
        self.merge_threshold = merge_threshold
        self.nodes: Dict[str, HierarchicalNode] = {}
        self.parent_to_children: Dict[str, List[str]] = {}

    def index_document(
        self,
        document: str,
        metadata: Dict = None
    ) -> Dict:
        """Index document with hierarchy"""
        # Level 0: Document
        doc_id = f"doc_{uuid.uuid4().hex[:8]}"
        doc_node = HierarchicalNode(
            id=doc_id,
            content=document,
            level=0,
            metadata=metadata or {}
        )
        self.nodes[doc_id] = doc_node

        # Level 1: Sections (split by double newlines or headers)
        sections = self._split_into_sections(document)

        for i, section in enumerate(sections):
            section_id = f"sec_{uuid.uuid4().hex[:8]}"
            section_node = HierarchicalNode(
                id=section_id,
                content=section,
                level=1,
                parent_id=doc_id,
                metadata={"section_index": i}
            )
            self.nodes[section_id] = section_node
            doc_node.children_ids.append(section_id)

            # Level 2: Leaf chunks
            leaves = self._split_into_leaves(section)

            for j, leaf in enumerate(leaves):
                leaf_id = f"leaf_{uuid.uuid4().hex[:8]}"
                leaf_node = HierarchicalNode(
                    id=leaf_id,
                    content=leaf,
                    level=2,
                    parent_id=section_id,
                    metadata={"leaf_index": j}
                )
                self.nodes[leaf_id] = leaf_node
                section_node.children_ids.append(leaf_id)

        # Build parent-to-children mapping
        for node in self.nodes.values():
            if node.parent_id:
                if node.parent_id not in self.parent_to_children:
                    self.parent_to_children[node.parent_id] = []
                self.parent_to_children[node.parent_id].append(node.id)

        return {
            "document_id": doc_id,
            "sections": len(doc_node.children_ids),
            "total_leaves": sum(
                len(self.nodes[sid].children_ids)
                for sid in doc_node.children_ids
            )
        }

    def _split_into_sections(self, text: str) -> List[str]:
        """Split document into sections"""
        import re

        # Try splitting by headers
        if re.search(r'^#{1,3}\s', text, re.MULTILINE):
            sections = re.split(r'(?=^#{1,3}\s)', text, flags=re.MULTILINE)
        else:
            # Split by double newlines
            sections = text.split('\n\n\n')

        # Clean and filter empty sections
        sections = [s.strip() for s in sections if s.strip()]

        # Merge very small sections
        merged = []
        current = ""
        for section in sections:
            if len(current) + len(section) < 500:
                current += "\n\n" + section
            else:
                if current:
                    merged.append(current.strip())
                current = section

        if current:
            merged.append(current.strip())

        return merged if merged else [text]

    def _split_into_leaves(self, text: str) -> List[str]:
        """Split section into leaf chunks"""
        import re

        # Split by sentences first
        sentences = re.split(r'(?<=[.!?])\s+', text)

        # Group sentences into chunks
        chunks = []
        current = ""

        for sentence in sentences:
            if len(current) + len(sentence) <= self.leaf_chunk_size:
                current += " " + sentence if current else sentence
            else:
                if current:
                    chunks.append(current.strip())
                current = sentence

        if current:
            chunks.append(current.strip())

        return chunks

    def get_leaves(self) -> List[HierarchicalNode]:
        """Get all leaf nodes"""
        return [n for n in self.nodes.values() if n.level == 2]

    def get_parent(self, node_id: str) -> Optional[HierarchicalNode]:
        """Get parent node"""
        node = self.nodes.get(node_id)
        if node and node.parent_id:
            return self.nodes.get(node.parent_id)
        return None

    def get_siblings(self, node_id: str) -> List[HierarchicalNode]:
        """Get sibling nodes"""
        node = self.nodes.get(node_id)
        if not node or not node.parent_id:
            return []

        sibling_ids = self.parent_to_children.get(node.parent_id, [])
        return [self.nodes[sid] for sid in sibling_ids if sid in self.nodes]
```

## Auto-Merge Retriever

```python
class AutoMergeRetriever:
    """Retriever with automatic chunk merging"""

    def __init__(
        self,
        indexer: AutoMergeIndexer,
        embedding_model=None,
        merge_threshold: float = 0.5
    ):
        self.indexer = indexer
        self.embedding_model = embedding_model
        self.merge_threshold = merge_threshold
        self.embeddings: Dict[str, List[float]] = {}

    def build_index(self):
        """Build embeddings for leaf nodes"""
        leaves = self.indexer.get_leaves()

        for leaf in leaves:
            if self.embedding_model:
                embedding = self.embedding_model.encode(leaf.content)
            else:
                embedding = self._simple_embedding(leaf.content)

            self.embeddings[leaf.id] = embedding
            leaf.embedding = embedding

    def _simple_embedding(self, text: str) -> List[float]:
        """Simple embedding for demonstration"""
        words = text.lower().split()
        embedding = [0.0] * 128

        for word in words:
            idx = hash(word) % 128
            embedding[idx] += 1

        norm = sum(x*x for x in embedding) ** 0.5
        if norm > 0:
            embedding = [x/norm for x in embedding]

        return embedding

    def retrieve(self, query: str, top_k: int = 3) -> List[Dict]:
        """Retrieve with auto-merging"""
        # Get query embedding
        if self.embedding_model:
            query_emb = self.embedding_model.encode(query)
        else:
            query_emb = self._simple_embedding(query)

        # Score all leaves
        scored = []
        for leaf_id, embedding in self.embeddings.items():
            score = self._cosine_similarity(query_emb, embedding)
            scored.append((leaf_id, score))

        scored.sort(key=lambda x: x[1], reverse=True)

        # Get top candidates (more than needed for merging)
        candidates = scored[:top_k * 3]

        # Auto-merge relevant chunks
        merged_results = self._auto_merge(candidates, top_k)

        return merged_results

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """Calculate cosine similarity"""
        dot = sum(x*y for x, y in zip(a, b))
        norm_a = sum(x*x for x in a) ** 0.5
        norm_b = sum(x*x for x in b) ** 0.5
        return dot / (norm_a * norm_b) if norm_a * norm_b > 0 else 0

    def _auto_merge(
        self,
        candidates: List[tuple],
        top_k: int
    ) -> List[Dict]:
        """Auto-merge related chunks"""
        # Group candidates by parent
        by_parent: Dict[str, List[tuple]] = {}

        for leaf_id, score in candidates:
            leaf = self.indexer.nodes[leaf_id]
            parent_id = leaf.parent_id

            if parent_id not in by_parent:
                by_parent[parent_id] = []
            by_parent[parent_id].append((leaf_id, score))

        results = []

        for parent_id, parent_candidates in by_parent.items():
            if len(parent_candidates) == 0:
                continue

            # Check if we should merge to parent
            should_merge = self._should_merge_to_parent(parent_candidates)

            if should_merge:
                # Return parent content
                parent = self.indexer.nodes[parent_id]
                avg_score = sum(s for _, s in parent_candidates) / len(parent_candidates)

                results.append({
                    "type": "merged",
                    "content": parent.content,
                    "score": avg_score,
                    "merged_count": len(parent_candidates),
                    "node_id": parent_id,
                    "level": "section"
                })
            else:
                # Return individual leaves or merge adjacent
                merged_leaves = self._merge_adjacent_leaves(parent_candidates)

                for merged in merged_leaves:
                    results.append(merged)

        # Sort by score and take top_k
        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:top_k]

    def _should_merge_to_parent(
        self,
        candidates: List[tuple]
    ) -> bool:
        """Determine if candidates should be merged to parent"""
        if len(candidates) < 2:
            return False

        # Get parent's children count
        first_leaf = self.indexer.nodes[candidates[0][0]]
        parent = self.indexer.get_parent(first_leaf.id)

        if not parent:
            return False

        children_count = len(parent.children_ids)

        # Merge if majority of children are relevant
        coverage = len(candidates) / children_count

        # Also check average score
        avg_score = sum(s for _, s in candidates) / len(candidates)

        return coverage >= self.merge_threshold and avg_score > 0.3

    def _merge_adjacent_leaves(
        self,
        candidates: List[tuple]
    ) -> List[Dict]:
        """Merge adjacent leaf chunks"""
        if not candidates:
            return []

        # Sort by position
        sorted_candidates = []
        for leaf_id, score in candidates:
            leaf = self.indexer.nodes[leaf_id]
            position = leaf.metadata.get("leaf_index", 0)
            sorted_candidates.append((leaf_id, score, position))

        sorted_candidates.sort(key=lambda x: x[2])

        # Find adjacent groups
        groups = []
        current_group = [sorted_candidates[0]]

        for i in range(1, len(sorted_candidates)):
            prev_pos = sorted_candidates[i-1][2]
            curr_pos = sorted_candidates[i][2]

            if curr_pos - prev_pos <= 1:  # Adjacent
                current_group.append(sorted_candidates[i])
            else:
                groups.append(current_group)
                current_group = [sorted_candidates[i]]

        groups.append(current_group)

        # Convert groups to results
        results = []
        for group in groups:
            if len(group) == 1:
                leaf_id, score, _ = group[0]
                leaf = self.indexer.nodes[leaf_id]
                results.append({
                    "type": "leaf",
                    "content": leaf.content,
                    "score": score,
                    "merged_count": 1,
                    "node_id": leaf_id,
                    "level": "leaf"
                })
            else:
                # Merge group
                contents = []
                scores = []
                for leaf_id, score, _ in group:
                    leaf = self.indexer.nodes[leaf_id]
                    contents.append(leaf.content)
                    scores.append(score)

                results.append({
                    "type": "merged_adjacent",
                    "content": " ".join(contents),
                    "score": sum(scores) / len(scores),
                    "merged_count": len(group),
                    "node_ids": [g[0] for g in group],
                    "level": "merged_leaves"
                })

        return results
```

## Intelligent Merge Strategies

```python
class IntelligentMergeRetriever:
    """Advanced merging with multiple strategies"""

    def __init__(
        self,
        indexer: AutoMergeIndexer,
        embedding_model=None
    ):
        self.indexer = indexer
        self.embedding_model = embedding_model
        self.base_retriever = AutoMergeRetriever(
            indexer, embedding_model, merge_threshold=0.5
        )
        self.base_retriever.build_index()

    def retrieve_with_strategy(
        self,
        query: str,
        strategy: str = "auto",
        top_k: int = 3
    ) -> List[Dict]:
        """Retrieve with specified merge strategy"""
        if strategy == "always_merge":
            return self._always_merge_strategy(query, top_k)
        elif strategy == "never_merge":
            return self._never_merge_strategy(query, top_k)
        elif strategy == "semantic_merge":
            return self._semantic_merge_strategy(query, top_k)
        else:  # auto
            return self.base_retriever.retrieve(query, top_k)

    def _always_merge_strategy(
        self,
        query: str,
        top_k: int
    ) -> List[Dict]:
        """Always return parent sections"""
        # Get initial results
        base_results = self.base_retriever.retrieve(query, top_k * 2)

        # Group by parent and return parents
        seen_parents = set()
        results = []

        for result in base_results:
            if result["type"] == "merged":
                if result["node_id"] not in seen_parents:
                    results.append(result)
                    seen_parents.add(result["node_id"])
            else:
                node_id = result.get("node_id") or result.get("node_ids", [None])[0]
                if node_id:
                    leaf = self.indexer.nodes.get(node_id)
                    if leaf and leaf.parent_id not in seen_parents:
                        parent = self.indexer.nodes.get(leaf.parent_id)
                        if parent:
                            results.append({
                                "type": "merged",
                                "content": parent.content,
                                "score": result["score"],
                                "merged_count": len(parent.children_ids),
                                "node_id": parent.id,
                                "level": "section"
                            })
                            seen_parents.add(parent.id)

        return results[:top_k]

    def _never_merge_strategy(
        self,
        query: str,
        top_k: int
    ) -> List[Dict]:
        """Return individual leaf chunks only"""
        query_emb = self.base_retriever._simple_embedding(query)

        scored = []
        for leaf_id, embedding in self.base_retriever.embeddings.items():
            score = self.base_retriever._cosine_similarity(query_emb, embedding)
            scored.append((leaf_id, score))

        scored.sort(key=lambda x: x[1], reverse=True)

        results = []
        for leaf_id, score in scored[:top_k]:
            leaf = self.indexer.nodes[leaf_id]
            results.append({
                "type": "leaf",
                "content": leaf.content,
                "score": score,
                "merged_count": 1,
                "node_id": leaf_id,
                "level": "leaf"
            })

        return results

    def _semantic_merge_strategy(
        self,
        query: str,
        top_k: int
    ) -> List[Dict]:
        """Merge based on semantic coherence"""
        # Get candidates
        query_emb = self.base_retriever._simple_embedding(query)

        scored = []
        for leaf_id, embedding in self.base_retriever.embeddings.items():
            score = self.base_retriever._cosine_similarity(query_emb, embedding)
            scored.append((leaf_id, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        candidates = scored[:top_k * 3]

        # Semantic clustering
        clusters = self._semantic_cluster(candidates)

        results = []
        for cluster in clusters[:top_k]:
            if len(cluster) == 1:
                leaf_id, score = cluster[0]
                leaf = self.indexer.nodes[leaf_id]
                results.append({
                    "type": "leaf",
                    "content": leaf.content,
                    "score": score,
                    "merged_count": 1,
                    "node_id": leaf_id,
                    "level": "leaf"
                })
            else:
                contents = []
                scores = []
                for leaf_id, score in cluster:
                    leaf = self.indexer.nodes[leaf_id]
                    contents.append(leaf.content)
                    scores.append(score)

                results.append({
                    "type": "semantic_merged",
                    "content": " ".join(contents),
                    "score": sum(scores) / len(scores),
                    "merged_count": len(cluster),
                    "level": "semantic_cluster"
                })

        return results

    def _semantic_cluster(
        self,
        candidates: List[tuple]
    ) -> List[List[tuple]]:
        """Cluster candidates by semantic similarity"""
        if len(candidates) <= 1:
            return [[c] for c in candidates]

        # Simple clustering by embedding similarity
        clusters = []
        used = set()

        for leaf_id, score in candidates:
            if leaf_id in used:
                continue

            cluster = [(leaf_id, score)]
            used.add(leaf_id)

            emb = self.base_retriever.embeddings[leaf_id]

            # Find similar candidates
            for other_id, other_score in candidates:
                if other_id in used:
                    continue

                other_emb = self.base_retriever.embeddings[other_id]
                sim = self.base_retriever._cosine_similarity(emb, other_emb)

                if sim > 0.7:  # High similarity threshold
                    cluster.append((other_id, other_score))
                    used.add(other_id)

            clusters.append(cluster)

        # Sort clusters by max score
        clusters.sort(key=lambda c: max(s for _, s in c), reverse=True)

        return clusters
```

## Complete Auto-Merge RAG

```python
class AutoMergeRAG:
    """RAG system with auto-merge retrieval"""

    def __init__(self, generator):
        self.indexer = AutoMergeIndexer(leaf_chunk_size=200)
        self.retriever = None
        self.intelligent_retriever = None
        self.generator = generator

    def add_document(self, document: str, metadata: Dict = None):
        """Add and index document"""
        result = self.indexer.index_document(document, metadata)

        # Build retrievers
        self.retriever = AutoMergeRetriever(self.indexer)
        self.retriever.build_index()

        self.intelligent_retriever = IntelligentMergeRetriever(
            self.indexer
        )

        return result

    def query(
        self,
        question: str,
        strategy: str = "auto",
        top_k: int = 3
    ) -> Dict:
        """Query with auto-merge"""
        if not self.retriever:
            return {"error": "No documents indexed"}

        # Retrieve with strategy
        if strategy == "auto":
            results = self.retriever.retrieve(question, top_k)
        else:
            results = self.intelligent_retriever.retrieve_with_strategy(
                question, strategy, top_k
            )

        # Build context
        context_parts = []
        for i, r in enumerate(results):
            merge_info = f"[{r['type']}, {r['merged_count']} chunk(s)]"
            context_parts.append(
                f"Source {i+1} {merge_info}:\n{r['content']}"
            )

        context = "\n\n---\n\n".join(context_parts)

        # Generate
        prompt = f"""Answer based on the following context.
The context may include merged sections for comprehensive coverage.

{context}

Question: {question}

Answer:"""

        response = self.generator.generate(prompt)

        return {
            "answer": response,
            "strategy_used": strategy,
            "sources": [
                {
                    "type": r["type"],
                    "merged_count": r["merged_count"],
                    "score": r["score"],
                    "preview": r["content"][:100] + "..."
                }
                for r in results
            ]
        }

# Usage
class MockGenerator:
    def generate(self, prompt):
        return "Generated response."

rag = AutoMergeRAG(MockGenerator())

document = """
# Introduction to Machine Learning

Machine learning is a branch of artificial intelligence.
It allows systems to learn from data.
The field has grown significantly in recent years.

# Types of Machine Learning

Supervised learning uses labeled data.
Unsupervised learning finds patterns without labels.
Reinforcement learning learns through interaction.

# Deep Learning

Deep learning uses neural networks.
These networks have multiple layers.
They excel at complex pattern recognition.
"""

rag.add_document(document)

result = rag.query("What is machine learning?", strategy="auto")
print(f"Answer: {result['answer']}")
print(f"Sources: {len(result['sources'])}")
for source in result['sources']:
    print(f"  - Type: {source['type']}, Merged: {source['merged_count']}")
```

## Conclusion

Auto-merge retrieval intelligently combines related chunks to provide comprehensive context while avoiding redundancy. By understanding document hierarchy and chunk relationships, auto-merge ensures the generator receives coherent, complete information. Different merge strategies allow optimization for various use cases, from precision-focused leaf retrieval to comprehensive section-level context.
