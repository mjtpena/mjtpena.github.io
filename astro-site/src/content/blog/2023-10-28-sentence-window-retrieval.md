---
title: "Sentence Window Retrieval for RAG Applications"
author: Michael John Peña
draft: false
date: 2023-10-28
description: "Implementing sentence window retrieval to balance precision and context in RAG systems."
tags:
  - RAG
  - Sentence Window
  - Retrieval
  - Context Window
  - AI

---

I wrote "Sentence Window Retrieval for RAG Applications" to share practical, production-minded guidance on this topic.

## Introduction

Sentence window retrieval indexes individual sentences for precise matching but returns surrounding sentences as context. This technique provides the best of both worlds: high-precision retrieval with sufficient context for accurate generation.

## Sentence Window Architecture

```python
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple
import uuid
import re

@dataclass
class Sentence:
    id: str
    content: str
    position: int
    document_id: str
    embedding: Optional[List[float]] = None
    metadata: Dict = field(default_factory=dict)

@dataclass
class SentenceWindow:
    center_sentence: Sentence
    window_sentences: List[Sentence]
    window_text: str
    score: float = 0.0

class SentenceWindowIndexer:
    """Index documents by sentences with window support"""

    def __init__(self, window_size: int = 3):
        self.window_size = window_size  # Sentences before and after
        self.sentences: Dict[str, Sentence] = {}
        self.document_sentences: Dict[str, List[str]] = {}  # doc_id -> [sentence_ids]

    def index_document(
        self,
        document: str,
        document_id: str = None,
        metadata: Dict = None
    ) -> Dict:
        """Index document by sentences"""
        doc_id = document_id or f"doc_{uuid.uuid4().hex[:8]}"

        # Split into sentences
        sentences = self._split_sentences(document)

        sentence_ids = []
        for i, sentence_text in enumerate(sentences):
            if not sentence_text.strip():
                continue

            sentence = Sentence(
                id=f"sent_{uuid.uuid4().hex[:8]}",
                content=sentence_text.strip(),
                position=i,
                document_id=doc_id,
                metadata={
                    **(metadata or {}),
                    "position": i,
                    "total_sentences": len(sentences)
                }
            )

            self.sentences[sentence.id] = sentence
            sentence_ids.append(sentence.id)

        self.document_sentences[doc_id] = sentence_ids

        return {
            "document_id": doc_id,
            "sentence_count": len(sentence_ids)
        }

    def _split_sentences(self, text: str) -> List[str]:
        """Split text into sentences"""
        # Handle common abbreviations
        text = re.sub(r'(Mr|Mrs|Ms|Dr|Prof|Sr|Jr)\.', r'\1<PERIOD>', text)
        text = re.sub(r'(\d)\.(\d)', r'\1<PERIOD>\2', text)

        # Split on sentence boundaries
        sentences = re.split(r'(?<=[.!?])\s+', text)

        # Restore periods
        sentences = [s.replace('<PERIOD>', '.') for s in sentences]

        return sentences

    def get_window(
        self,
        sentence_id: str,
        window_size: int = None
    ) -> SentenceWindow:
        """Get sentence with surrounding window"""
        sentence = self.sentences.get(sentence_id)
        if not sentence:
            return None

        size = window_size or self.window_size
        doc_sentences = self.document_sentences.get(sentence.document_id, [])

        # Find position in document
        try:
            idx = doc_sentences.index(sentence_id)
        except ValueError:
            return SentenceWindow(
                center_sentence=sentence,
                window_sentences=[sentence],
                window_text=sentence.content
            )

        # Get window indices
        start_idx = max(0, idx - size)
        end_idx = min(len(doc_sentences), idx + size + 1)

        # Collect window sentences
        window_ids = doc_sentences[start_idx:end_idx]
        window_sentences = [
            self.sentences[sid]
            for sid in window_ids
            if sid in self.sentences
        ]

        # Build window text
        window_text = ' '.join(s.content for s in window_sentences)

        return SentenceWindow(
            center_sentence=sentence,
            window_sentences=window_sentences,
            window_text=window_text
        )

    def get_all_sentences(self) -> List[Sentence]:
        """Get all indexed sentences"""
        return list(self.sentences.values())
```

## Sentence Window Retriever

```python
class SentenceWindowRetriever:
    """Retrieve sentences and return windows"""

    def __init__(
        self,
        indexer: SentenceWindowIndexer,
        embedding_model=None,
        window_size: int = 3
    ):
        self.indexer = indexer
        self.embedding_model = embedding_model
        self.window_size = window_size
        self.embeddings: Dict[str, List[float]] = {}

    def build_index(self):
        """Build embeddings for all sentences"""
        sentences = self.indexer.get_all_sentences()

        for sentence in sentences:
            if self.embedding_model:
                embedding = self.embedding_model.encode(sentence.content)
            else:
                embedding = self._simple_embedding(sentence.content)

            self.embeddings[sentence.id] = embedding
            sentence.embedding = embedding

    def _simple_embedding(self, text: str) -> List[float]:
        """Simple TF-based embedding for demo"""
        words = text.lower().split()
        embedding = [0.0] * 256

        for word in words:
            idx = hash(word) % 256
            embedding[idx] += 1

        # Normalize
        norm = sum(x*x for x in embedding) ** 0.5
        if norm > 0:
            embedding = [x/norm for x in embedding]

        return embedding

    def retrieve(
        self,
        query: str,
        top_k: int = 5,
        return_windows: bool = True
    ) -> List[Dict]:
        """Retrieve relevant sentences/windows"""
        # Get query embedding
        if self.embedding_model:
            query_embedding = self.embedding_model.encode(query)
        else:
            query_embedding = self._simple_embedding(query)

        # Score all sentences
        scored = []
        for sentence_id, embedding in self.embeddings.items():
            score = self._cosine_similarity(query_embedding, embedding)
            scored.append((sentence_id, score))

        # Sort by score
        scored.sort(key=lambda x: x[1], reverse=True)

        # Get top-k unique windows (avoid overlapping)
        results = []
        seen_positions = set()

        for sentence_id, score in scored:
            if len(results) >= top_k:
                break

            sentence = self.indexer.sentences[sentence_id]
            position_key = (sentence.document_id, sentence.position)

            # Check for overlap with existing windows
            if self._has_overlap(position_key, seen_positions):
                continue

            if return_windows:
                window = self.indexer.get_window(sentence_id, self.window_size)
                results.append({
                    "type": "window",
                    "content": window.window_text,
                    "center_sentence": sentence.content,
                    "score": score,
                    "sentence_id": sentence_id,
                    "document_id": sentence.document_id,
                    "position": sentence.position
                })

                # Mark positions as seen
                for ws in window.window_sentences:
                    seen_positions.add((ws.document_id, ws.position))
            else:
                results.append({
                    "type": "sentence",
                    "content": sentence.content,
                    "score": score,
                    "sentence_id": sentence_id,
                    "document_id": sentence.document_id,
                    "position": sentence.position
                })
                seen_positions.add(position_key)

        return results

    def _cosine_similarity(self, a: List[float], b: List[float]) -> float:
        """Calculate cosine similarity"""
        dot = sum(x*y for x, y in zip(a, b))
        norm_a = sum(x*x for x in a) ** 0.5
        norm_b = sum(x*x for x in b) ** 0.5
        return dot / (norm_a * norm_b) if norm_a * norm_b > 0 else 0

    def _has_overlap(
        self,
        position: Tuple[str, int],
        seen: set
    ) -> bool:
        """Check if position overlaps with seen windows"""
        doc_id, pos = position

        for seen_doc, seen_pos in seen:
            if seen_doc == doc_id:
                if abs(pos - seen_pos) <= self.window_size:
                    return True

        return False
```

## Dynamic Window Sizing

```python
class DynamicWindowRetriever:
    """Retriever with dynamic window sizes based on context"""

    def __init__(
        self,
        indexer: SentenceWindowIndexer,
        embedding_model=None,
        min_window: int = 1,
        max_window: int = 5
    ):
        self.indexer = indexer
        self.embedding_model = embedding_model
        self.min_window = min_window
        self.max_window = max_window
        self.base_retriever = SentenceWindowRetriever(
            indexer, embedding_model, min_window
        )
        self.base_retriever.build_index()

    def retrieve_with_dynamic_window(
        self,
        query: str,
        top_k: int = 3
    ) -> List[Dict]:
        """Retrieve with dynamically sized windows"""
        # Get initial results with minimum window
        initial_results = self.base_retriever.retrieve(
            query, top_k=top_k * 2, return_windows=False
        )

        results = []

        for result in initial_results[:top_k]:
            sentence = self.indexer.sentences[result["sentence_id"]]

            # Determine optimal window size
            window_size = self._determine_window_size(
                query, sentence, result["score"]
            )

            # Get window with determined size
            window = self.indexer.get_window(
                result["sentence_id"],
                window_size
            )

            results.append({
                "content": window.window_text,
                "center_sentence": sentence.content,
                "score": result["score"],
                "window_size": window_size,
                "sentence_count": len(window.window_sentences),
                "document_id": sentence.document_id
            })

        return results

    def _determine_window_size(
        self,
        query: str,
        sentence: Sentence,
        match_score: float
    ) -> int:
        """Determine optimal window size based on context"""
        # Factors for window size:
        # 1. Match score - higher score = smaller window needed
        # 2. Sentence length - shorter sentences need more context
        # 3. Query complexity - complex queries need more context

        # Base on match score
        if match_score > 0.8:
            base_window = self.min_window
        elif match_score > 0.5:
            base_window = self.min_window + 1
        else:
            base_window = self.min_window + 2

        # Adjust for sentence length
        if len(sentence.content) < 50:
            base_window += 1  # Short sentence needs context
        elif len(sentence.content) > 200:
            base_window = max(self.min_window, base_window - 1)

        # Adjust for query complexity
        query_words = len(query.split())
        if query_words > 10:
            base_window += 1  # Complex query

        return min(self.max_window, max(self.min_window, base_window))
```

## Sentence Fusion

```python
class SentenceFusionRetriever:
    """Combine multiple sentence windows intelligently"""

    def __init__(
        self,
        indexer: SentenceWindowIndexer,
        embedding_model=None
    ):
        self.indexer = indexer
        self.retriever = SentenceWindowRetriever(
            indexer, embedding_model, window_size=2
        )
        self.retriever.build_index()

    def retrieve_and_fuse(
        self,
        query: str,
        top_k: int = 3,
        max_fused_sentences: int = 10
    ) -> Dict:
        """Retrieve and fuse relevant sentences"""
        # Get more candidates than needed
        results = self.retriever.retrieve(
            query, top_k=top_k * 2, return_windows=False
        )

        if not results:
            return {"content": "", "sentences": []}

        # Group by document
        by_document = {}
        for r in results:
            doc_id = r["document_id"]
            if doc_id not in by_document:
                by_document[doc_id] = []
            by_document[doc_id].append(r)

        # For each document, fuse consecutive sentences
        fused_results = []

        for doc_id, doc_results in by_document.items():
            # Sort by position
            doc_results.sort(key=lambda x: x["position"])

            # Find consecutive groups
            groups = self._find_consecutive_groups(doc_results)

            for group in groups:
                fused_content = self._fuse_group(group)
                avg_score = sum(r["score"] for r in group) / len(group)

                fused_results.append({
                    "content": fused_content,
                    "document_id": doc_id,
                    "score": avg_score,
                    "sentence_count": len(group),
                    "positions": [r["position"] for r in group]
                })

        # Sort by score and return top-k
        fused_results.sort(key=lambda x: x["score"], reverse=True)

        return {
            "results": fused_results[:top_k],
            "total_fused_groups": len(fused_results)
        }

    def _find_consecutive_groups(
        self,
        results: List[Dict]
    ) -> List[List[Dict]]:
        """Find groups of consecutive sentences"""
        if not results:
            return []

        groups = []
        current_group = [results[0]]

        for i in range(1, len(results)):
            prev_pos = results[i-1]["position"]
            curr_pos = results[i]["position"]

            if curr_pos - prev_pos <= 2:  # Allow small gap
                current_group.append(results[i])
            else:
                groups.append(current_group)
                current_group = [results[i]]

        if current_group:
            groups.append(current_group)

        return groups

    def _fuse_group(self, group: List[Dict]) -> str:
        """Fuse a group of results into coherent text"""
        # Get all sentences in range
        if not group:
            return ""

        doc_id = group[0]["document_id"]
        min_pos = min(r["position"] for r in group)
        max_pos = max(r["position"] for r in group)

        # Get sentence IDs in range
        doc_sentences = self.indexer.document_sentences.get(doc_id, [])

        texts = []
        for i in range(min_pos, min(max_pos + 1, len(doc_sentences))):
            if i < len(doc_sentences):
                sentence = self.indexer.sentences.get(doc_sentences[i])
                if sentence:
                    texts.append(sentence.content)

        return ' '.join(texts)
```

## Complete Sentence Window RAG

```python
class SentenceWindowRAG:
    """RAG system using sentence window retrieval"""

    def __init__(self, generator):
        self.indexer = SentenceWindowIndexer(window_size=3)
        self.retriever = None
        self.generator = generator

    def add_document(
        self,
        document: str,
        document_id: str = None,
        metadata: Dict = None
    ):
        """Add document to index"""
        result = self.indexer.index_document(
            document, document_id, metadata
        )

        # Rebuild retriever
        self.retriever = SentenceWindowRetriever(
            self.indexer,
            window_size=3
        )
        self.retriever.build_index()

        return result

    def query(self, question: str, top_k: int = 3) -> Dict:
        """Query with sentence window retrieval"""
        if not self.retriever:
            return {"error": "No documents indexed"}

        # Retrieve windows
        results = self.retriever.retrieve(question, top_k=top_k)

        # Build context
        context_parts = []
        for i, r in enumerate(results):
            context_parts.append(
                f"[Context {i+1}] (relevance: {r['score']:.2f})\n{r['content']}"
            )

        context = "\n\n---\n\n".join(context_parts)

        # Generate response
        prompt = f"""Based on the following context passages, answer the question.
Each context shows relevant sentences with surrounding context.

{context}

Question: {question}

Provide a concise, accurate answer based on the context:"""

        response = self.generator.generate(prompt)

        return {
            "answer": response,
            "sources": [
                {
                    "content_preview": r["content"][:150] + "...",
                    "score": r["score"],
                    "center_sentence": r["center_sentence"],
                    "document_id": r["document_id"]
                }
                for r in results
            ],
            "retrieval_count": len(results)
        }

# Usage example
class MockGenerator:
    def generate(self, prompt):
        return "Generated answer based on retrieved context."

rag = SentenceWindowRAG(MockGenerator())

# Add documents
doc1 = """
Machine learning is a subset of artificial intelligence.
It enables systems to learn from data automatically.
Deep learning is a type of machine learning using neural networks.
Neural networks are inspired by the human brain.
They consist of layers of interconnected nodes.
"""

doc2 = """
Natural language processing deals with text data.
It enables computers to understand human language.
Modern NLP uses transformer architectures.
Transformers use attention mechanisms.
BERT and GPT are popular transformer models.
"""

rag.add_document(doc1, "ml_intro")
rag.add_document(doc2, "nlp_intro")

# Query
result = rag.query("What is deep learning?")
print(f"Answer: {result['answer']}")
print(f"Sources: {len(result['sources'])}")
for source in result['sources']:
    print(f"  - Score: {source['score']:.2f}")
    print(f"    Center: {source['center_sentence']}")
```

## Conclusion

Sentence window retrieval provides an excellent balance between retrieval precision and context richness. By indexing individual sentences but returning surrounding context, this approach captures precise semantic matches while giving the generator enough information for accurate responses. Dynamic window sizing and sentence fusion further enhance retrieval quality for complex queries.

