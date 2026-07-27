---
title: "Semantic Compression: Preserving Meaning with Fewer Tokens"
author: Michael John Peña
draft: false
date: 2023-08-26
tags:
  - Semantic Compression
  - NLP
  - LLM
  - Optimization

---

I wrote "Semantic Compression: Preserving Meaning with Fewer Tokens" to share practical, production-minded guidance on this topic.

## Semantic vs Syntactic Compression

```python
compression_types = {
    "syntactic": {
        "method": "Remove characters/words",
        "preserves": "Text structure",
        "risk": "May lose meaning"
    },
    "semantic": {
        "method": "Preserve key information",
        "preserves": "Meaning and intent",
        "risk": "May change phrasing"
    }
}
```

## Extractive Compression

```python
from sentence_transformers import SentenceTransformer, util
import numpy as np

class ExtractiveCompressor:
    def __init__(self):
        self.model = SentenceTransformer("all-MiniLM-L6-v2")

    def compress(self, text, target_ratio=0.5):
        """Extract most important sentences."""
        sentences = text.split(". ")

        # Embed all sentences
        embeddings = self.model.encode(sentences)

        # Compute document embedding (mean of sentences)
        doc_embedding = np.mean(embeddings, axis=0)

        # Score sentences by relevance to document
        scores = util.cos_sim(doc_embedding, embeddings)[0]

        # Select top sentences
        n_select = max(1, int(len(sentences) * target_ratio))
        top_indices = scores.argsort(descending=True)[:n_select].tolist()
        top_indices.sort()  # Maintain original order

        compressed = ". ".join([sentences[i] for i in top_indices])
        return compressed

    def compress_for_query(self, text, query, target_ratio=0.5):
        """Extract sentences most relevant to query."""
        sentences = text.split(". ")
        embeddings = self.model.encode(sentences)
        query_embedding = self.model.encode(query)

        # Score by query relevance
        scores = util.cos_sim(query_embedding, embeddings)[0]

        n_select = max(1, int(len(sentences) * target_ratio))
        top_indices = scores.argsort(descending=True)[:n_select].tolist()
        top_indices.sort()

        return ". ".join([sentences[i] for i in top_indices])
```

## Abstractive Compression

```python
from transformers import pipeline

class AbstractiveCompressor:
    def __init__(self, model="facebook/bart-large-cnn"):
        self.summarizer = pipeline("summarization", model=model)

    def compress(self, text, max_length=100, min_length=30):
        """Generate compressed version preserving key information."""
        # Handle long texts by chunking
        chunks = self._chunk_text(text, max_chunk=1000)

        summaries = []
        for chunk in chunks:
            summary = self.summarizer(
                chunk,
                max_length=max_length // len(chunks),
                min_length=min_length // len(chunks),
                do_sample=False
            )[0]["summary_text"]
            summaries.append(summary)

        return " ".join(summaries)

    def _chunk_text(self, text, max_chunk=1000):
        words = text.split()
        chunks = []
        for i in range(0, len(words), max_chunk):
            chunks.append(" ".join(words[i:i+max_chunk]))
        return chunks
```

## Hierarchical Compression

```python
class HierarchicalCompressor:
    """Compress at multiple levels: document -> sections -> sentences."""

    def __init__(self):
        self.extractive = ExtractiveCompressor()
        self.abstractive = AbstractiveCompressor()

    def compress(self, document, target_tokens=500):
        # Level 1: Split into sections
        sections = self._split_sections(document)

        # Level 2: Extract key sentences from each section
        compressed_sections = []
        for section in sections:
            key_sentences = self.extractive.compress(section, target_ratio=0.5)
            compressed_sections.append(key_sentences)

        intermediate = " ".join(compressed_sections)

        # Level 3: Abstractive compression to target length
        if self._count_tokens(intermediate) > target_tokens:
            final = self.abstractive.compress(intermediate, max_length=target_tokens)
        else:
            final = intermediate

        return final

    def _split_sections(self, text):
        # Simple section splitting by double newlines or headers
        sections = text.split("\n\n")
        return [s.strip() for s in sections if s.strip()]

    def _count_tokens(self, text):
        return len(text.split()) * 1.3
```

## Semantic Chunking for RAG

```python
class SemanticChunker:
    """Create semantically coherent chunks for RAG."""

    def __init__(self, target_size=500, overlap=50):
        self.target_size = target_size
        self.overlap = overlap
        self.model = SentenceTransformer("all-MiniLM-L6-v2")

    def chunk(self, text):
        sentences = self._split_sentences(text)
        embeddings = self.model.encode(sentences)

        chunks = []
        current_chunk = []
        current_embedding = None

        for i, (sentence, embedding) in enumerate(zip(sentences, embeddings)):
            if not current_chunk:
                current_chunk.append(sentence)
                current_embedding = embedding
            else:
                # Check semantic similarity
                similarity = util.cos_sim(current_embedding, embedding).item()

                if similarity > 0.5 and len(" ".join(current_chunk)) < self.target_size:
                    current_chunk.append(sentence)
                    # Update chunk embedding
                    current_embedding = np.mean([current_embedding, embedding], axis=0)
                else:
                    chunks.append(" ".join(current_chunk))
                    current_chunk = [sentence]
                    current_embedding = embedding

        if current_chunk:
            chunks.append(" ".join(current_chunk))

        return chunks
```

## Quality Metrics

```python
from rouge_score import rouge_scorer
from bert_score import score as bert_score

def evaluate_compression(original, compressed, reference_summary=None):
    """Evaluate compression quality."""
    scorer = rouge_scorer.RougeScorer(['rouge1', 'rouge2', 'rougeL'])

    # Compression ratio
    ratio = len(original) / len(compressed)

    # Semantic similarity
    model = SentenceTransformer("all-MiniLM-L6-v2")
    orig_emb = model.encode(original)
    comp_emb = model.encode(compressed)
    similarity = util.cos_sim(orig_emb, comp_emb).item()

    metrics = {
        "compression_ratio": ratio,
        "semantic_similarity": similarity
    }

    # If reference available, compute ROUGE
    if reference_summary:
        scores = scorer.score(reference_summary, compressed)
        metrics["rouge1"] = scores["rouge1"].fmeasure
        metrics["rougeL"] = scores["rougeL"].fmeasure

    return metrics
```

## Practical Application

```python
def compress_for_llm_context(documents, query, max_tokens=3000):
    """Compress documents to fit LLM context window."""
    compressor = HierarchicalCompressor()
    chunker = SemanticChunker()

    # Chunk and rank by query relevance
    all_chunks = []
    for doc in documents:
        chunks = chunker.chunk(doc)
        all_chunks.extend(chunks)

    # Rank chunks by query relevance
    model = SentenceTransformer("all-MiniLM-L6-v2")
    query_emb = model.encode(query)
    chunk_embs = model.encode(all_chunks)
    scores = util.cos_sim(query_emb, chunk_embs)[0]

    ranked = sorted(zip(all_chunks, scores), key=lambda x: x[1], reverse=True)

    # Select top chunks within budget
    selected = []
    tokens = 0
    for chunk, score in ranked:
        chunk_tokens = len(chunk.split()) * 1.3
        if tokens + chunk_tokens <= max_tokens:
            selected.append(chunk)
            tokens += chunk_tokens

    return "\n\n".join(selected)
```

Tomorrow we'll explore context caching strategies.

## Resources

- [Text Summarization Survey](https://arxiv.org/abs/2202.06417)
- [Sentence Transformers](https://www.sbert.net/)
- [ROUGE Score](https://huggingface.co/spaces/evaluate-metric/rouge)\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
