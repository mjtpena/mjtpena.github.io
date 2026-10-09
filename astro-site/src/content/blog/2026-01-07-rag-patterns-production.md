---
title: "RAG Patterns That Actually Work in Production"
description: "Vector search alone misses exact matches. Keyword search alone misses semantic similarity. Combine them."
author: Michael John Peña
draft: false
date: 2026-01-07
tags:
  - AI
  - RAG
  - Azure
  - Architecture
---

## The Naive RAG (Don't Do This)

```python
def naive_rag(question):
    # Embed question
    embedding = get_embedding(question)
    
    # Search vector store
    docs = vector_store.search(embedding, top_k=5)
    
    # Stuff into prompt
    context = "\n".join([doc.content for doc in docs])
    prompt = f"Context: {context}\n\nQuestion: {question}"
    
    return llm.generate(prompt)
```

This works in demos. It fails in production because:
- No relevance filtering
- No context ranking
- No handling of multi-intent queries
- No citation tracking
- No fallback for poor retrieval

## Pattern 1: Hybrid Search

Vector search alone misses exact matches. Keyword search alone misses semantic similarity. Combine them.

```python
def hybrid_search(query: str, top_k: int = 5) -> List[Document]:
    # Vector search
    embedding = embed_model.encode(query)
    vector_results = vector_store.search(embedding, top_k=top_k*2)
    
    # Keyword search (BM25)
    keyword_results = bm25_index.search(query, top_k=top_k*2)
    
    # Reciprocal Rank Fusion
    combined = reciprocal_rank_fusion(
        [vector_results, keyword_results],
        weights=[0.7, 0.3]  # Favor vector search
    )
    
    return combined[:top_k]

def reciprocal_rank_fusion(result_lists, weights):
    scores = {}
    for results, weight in zip(result_lists, weights):
        for rank, doc in enumerate(results):
            if doc.id not in scores:
                scores[doc.id] = 0
            scores[doc.id] += weight / (rank + 60)  # k=60 is common
    
    return sorted(scores.items(), key=lambda x: x[1], reverse=True)
```

## Pattern 2: Query Decomposition

Complex questions need breaking down.

```python
async def decompose_and_answer(question: str) -> str:
    # Check if question is complex
    complexity = await assess_complexity(question)
    
    if complexity == "simple":
        return await simple_rag(question)
    
    # Decompose into sub-questions
    sub_questions = await decompose_question(question)
    
    # Answer each sub-question
    sub_answers = await asyncio.gather(*[
        simple_rag(sq) for sq in sub_questions
    ])
    
    # Synthesize final answer
    synthesis_prompt = f"""
    Original question: {question}
    
    Sub-answers:
    {format_sub_answers(sub_questions, sub_answers)}
    
    Provide a comprehensive answer to the original question.
    """
    
    return await llm.generate(synthesis_prompt)
```

## Pattern 3: Re-ranking

Your first-pass retrieval isn't optimal. Re-rank with a cross-encoder.

```python
from sentence_transformers import CrossEncoder

class ReRanker:
    def __init__(self):
        self.model = CrossEncoder('cross-encoder/ms-marco-MiniLM-L-12-v2')
    
    def rerank(self, query: str, documents: List[Document], top_k: int = 5):
        # Score each doc against query
        pairs = [[query, doc.content] for doc in documents]
        scores = self.model.predict(pairs)
        
        # Sort by score
        doc_scores = list(zip(documents, scores))
        doc_scores.sort(key=lambda x: x[1], reverse=True)
        
        return [doc for doc, score in doc_scores[:top_k]]
```

## Pattern 4: Contextual Compression

Don't send entire documents. Extract relevant sentences.

```python
def compress_context(query: str, documents: List[Document]) -> str:
    compressed_chunks = []
    
    for doc in documents:
        # Split into sentences
        sentences = sent_tokenize(doc.content)
        
        # Score each sentence
        sentence_embeddings = embed_model.encode(sentences)
        query_embedding = embed_model.encode([query])[0]
        
        similarities = cosine_similarity([query_embedding], sentence_embeddings)[0]
        
        # Take top 3 most relevant sentences
        top_indices = np.argsort(similarities)[-3:]
        relevant_sentences = [sentences[i] for i in sorted(top_indices)]
        
        compressed_chunks.append(" ".join(relevant_sentences))
    
    return "\n\n".join(compressed_chunks)
```

## Pattern 5: Citation Tracking

Users need to verify your answers. Track sources.

```python
def rag_with_citations(question: str) -> Dict:
    # Retrieve
    docs = hybrid_search(question, top_k=5)
    
    # Rerank
    docs = reranker.rerank(question, docs, top_k=3)
    
    # Prepare context with markers
    context_parts = []
    for i, doc in enumerate(docs, 1):
        context_parts.append(f"[{i}] {doc.content}")
    
    context = "\n\n".join(context_parts)
    
    # Generate with citation instructions
    prompt = f"""
    Answer the question using the provided context. 
    Cite your sources using [1], [2], [3] notation.
    
    Context:
    {context}
    
    Question: {question}
    
    Answer with citations:
    """
    
    answer = llm.generate(prompt)
    
    return {
        "answer": answer,
        "sources": [
            {
                "id": i+1,
                "title": doc.metadata.get("title", "Untitled"),
                "url": doc.metadata.get("url"),
                "excerpt": doc.content[:200]
            }
            for i, doc in enumerate(docs)
        ]
    }
```

## Pattern 6: Fallback Handling

Sometimes retrieval fails. Handle it gracefully.

```python
async def robust_rag(question: str) -> str:
    docs = await hybrid_search(question)
    
    # Check retrieval quality
    relevance_scores = [doc.score for doc in docs]
    avg_relevance = np.mean(relevance_scores)
    
    if avg_relevance < 0.7:  # Poor retrieval
        # Try query reformulation
        reformulated = await reformulate_query(question)
        docs = await hybrid_search(reformulated)
        
        if np.mean([doc.score for doc in docs]) < 0.7:
            # Still poor, acknowledge limitation
            return await llm.generate(f"""
            I don't have enough reliable information to answer: {question}
            
            I searched our knowledge base but couldn't find sufficiently relevant information.
            Could you rephrase your question or provide more context?
            """)
    
    # Proceed with normal RAG
    return await generate_answer(question, docs)
```

## Pattern 7: Chunk Optimization

How you chunk matters more than you think.

```python
class SmartChunker:
    def __init__(self, chunk_size=512, overlap=50):
        self.chunk_size = chunk_size
        self.overlap = overlap
    
    def chunk_document(self, document: str, metadata: dict) -> List[Chunk]:
        # Detect structure
        sections = self.detect_sections(document)
        
        chunks = []
        for section in sections:
            # Don't break sections unnaturally
            if len(section) < self.chunk_size * 1.5:
                # Keep small sections whole
                chunks.append(Chunk(
                    content=section,
                    metadata={**metadata, "section": section[:50]}
                ))
            else:
                # Split large sections with overlap
                section_chunks = self.split_with_overlap(section)
                chunks.extend([
                    Chunk(content=c, metadata=metadata)
                    for c in section_chunks
                ])
        
        return chunks
```

## What Actually Matters

After building a dozen RAG systems, here's what moves the needle:

1. **Retrieval quality >> Model quality** - GPT-4 with bad retrieval < GPT-3.5 with good retrieval

2. **Chunk strategy matters** - Spend time on this. Bad chunks = bad results

3. **Hybrid search wins** - Especially for domain-specific queries

4. **Re-ranking is worth it** - 20% better relevance for minimal latency

5. **User feedback loops** - Track when users aren't satisfied. Fix those queries

## Production Checklist

- [ ] Hybrid search implemented
- [ ] Re-ranking on retrieval results
- [ ] Query complexity handling
- [ ] Context compression for long docs
- [ ] Citation tracking
- [ ] Fallback for poor retrieval
- [ ] Logging and monitoring
- [ ] A/B testing framework
- [ ] Cost optimization (caching)
- [ ] User feedback collection

Don't build RAG systems with tutorial-level patterns. These are the patterns that actually work when users depend on your system.
