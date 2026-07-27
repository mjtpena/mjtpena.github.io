---
title: "Recursive Summarization for Long Documents"
author: Michael John Pena
draft: false
date: 2023-03-26
tags:
  - OpenAI
  - AI
  - GPT-4
  - Summarization
  - Long Documents

---

I wrote "Recursive Summarization for Long Documents" to share practical, production-minded guidance on this topic.

## The Recursive Pattern

```python
from dataclasses import dataclass
from typing import Callable
import asyncio

@dataclass
class RecursiveConfig:
    chunk_size: int = 4000          # tokens per chunk
    chunk_overlap: int = 200         # overlap between chunks
    summary_ratio: float = 0.2       # target compression ratio
    max_iterations: int = 5          # prevent infinite recursion
    min_final_tokens: int = 500      # stop when below this

class RecursiveSummarizer:
    """Recursively summarize documents of any length."""

    def __init__(self, client):
        self.client = client
        self.counter = TokenCounter()

    async def summarize(
        self,
        document: str,
        config: RecursiveConfig = None
    ) -> dict:
        """Recursively summarize until target length reached."""
        config = config or RecursiveConfig()

        current_text = document
        iteration = 0
        history = []

        while iteration < config.max_iterations:
            current_tokens = self.counter.count(current_text)

            # Check if we're done
            if current_tokens <= config.min_final_tokens:
                break

            # Check if fits in context
            if current_tokens <= 7000:  # Can process in one pass
                summary = await self._single_pass_summary(current_text, config)
                history.append({
                    "iteration": iteration,
                    "input_tokens": current_tokens,
                    "output_tokens": self.counter.count(summary)
                })
                current_text = summary
                break

            # Need chunked processing
            summary = await self._chunked_summary(current_text, config)
            history.append({
                "iteration": iteration,
                "input_tokens": current_tokens,
                "output_tokens": self.counter.count(summary)
            })

            current_text = summary
            iteration += 1

        return {
            "summary": current_text,
            "iterations": len(history),
            "compression_history": history,
            "original_tokens": self.counter.count(document),
            "final_tokens": self.counter.count(current_text)
        }

    async def _single_pass_summary(
        self,
        text: str,
        config: RecursiveConfig
    ) -> str:
        """Single-pass summarization."""
        target_words = int(len(text.split()) * config.summary_ratio)

        prompt = f"""Summarize this text in approximately {target_words} words.
Preserve key information, main arguments, and important details.

Text:
{text}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def _chunked_summary(
        self,
        text: str,
        config: RecursiveConfig
    ) -> str:
        """Chunk and summarize."""
        chunks = self._create_chunks(text, config)

        # Summarize chunks in parallel
        tasks = [
            self._summarize_chunk(chunk, i, len(chunks), config)
            for i, chunk in enumerate(chunks)
        ]
        summaries = await asyncio.gather(*tasks)

        # Combine summaries
        combined = "\n\n".join(summaries)
        return combined

    def _create_chunks(
        self,
        text: str,
        config: RecursiveConfig
    ) -> list[str]:
        """Create overlapping chunks."""
        words = text.split()
        chunks = []
        step = config.chunk_size - config.chunk_overlap

        for i in range(0, len(words), step):
            chunk = ' '.join(words[i:i + config.chunk_size])
            chunks.append(chunk)
            if i + config.chunk_size >= len(words):
                break

        return chunks

    async def _summarize_chunk(
        self,
        chunk: str,
        index: int,
        total: int,
        config: RecursiveConfig
    ) -> str:
        """Summarize a single chunk."""
        target_words = int(len(chunk.split()) * config.summary_ratio)

        prompt = f"""Summarize this section ({index + 1} of {total}) in ~{target_words} words.
Preserve important information and context for later combination.

Section:
{chunk}"""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",  # Use cheaper model for chunks
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Tree-based Summarization

For better quality on very long documents:

```python
class TreeSummarizer:
    """Tree-structured summarization for improved coherence."""

    def __init__(self, client, branch_factor: int = 4):
        self.client = client
        self.branch_factor = branch_factor
        self.counter = TokenCounter()

    async def summarize(self, document: str) -> dict:
        """Build summary tree from leaves to root."""

        # Create leaf summaries
        chunks = self._split_document(document)
        leaf_summaries = await self._summarize_leaves(chunks)

        # Build tree upward
        current_level = leaf_summaries
        levels = [current_level]

        while len(current_level) > 1:
            next_level = await self._summarize_level(current_level)
            levels.append(next_level)
            current_level = next_level

        return {
            "summary": current_level[0] if current_level else "",
            "tree_depth": len(levels),
            "leaf_count": len(leaf_summaries)
        }

    async def _summarize_leaves(self, chunks: list[str]) -> list[str]:
        """Summarize leaf chunks in parallel."""
        tasks = [self._summarize_leaf(chunk, i) for i, chunk in enumerate(chunks)]
        return await asyncio.gather(*tasks)

    async def _summarize_leaf(self, chunk: str, index: int) -> str:
        """Summarize a leaf chunk."""
        prompt = f"""Create a concise summary of this text section.
Capture: main points, key facts, important details.

Section {index + 1}:
{chunk}"""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content

    async def _summarize_level(self, summaries: list[str]) -> list[str]:
        """Combine summaries into next level."""
        next_level = []

        for i in range(0, len(summaries), self.branch_factor):
            group = summaries[i:i + self.branch_factor]
            combined = await self._combine_summaries(group)
            next_level.append(combined)

        return next_level

    async def _combine_summaries(self, summaries: list[str]) -> str:
        """Combine multiple summaries into one."""
        combined_text = "\n\n---\n\n".join(summaries)

        prompt = f"""Synthesize these summaries into a unified, coherent summary.
Eliminate redundancy, preserve all unique information.

Summaries:
{combined_text}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content
```

## Extractive-Abstractive Hybrid

Combine extraction with abstraction for better faithfulness:

```python
class HybridSummarizer:
    """Hybrid extractive-abstractive summarization."""

    async def summarize(
        self,
        document: str,
        extract_ratio: float = 0.3,
        final_ratio: float = 0.1
    ) -> dict:
        """Two-phase summarization."""

        # Phase 1: Extract important sentences
        extracted = await self._extract_key_sentences(document, extract_ratio)

        # Phase 2: Abstractive rewrite
        abstract = await self._abstract_rewrite(extracted, document, final_ratio)

        return {
            "extracted_sentences": extracted,
            "final_summary": abstract,
            "method": "hybrid"
        }

    async def _extract_key_sentences(
        self,
        document: str,
        ratio: float
    ) -> str:
        """Extract key sentences."""
        target_sentences = max(5, int(document.count('.') * ratio))

        prompt = f"""Extract the {target_sentences} most important sentences from this document.
Return only the extracted sentences, maintaining original wording.
Select sentences that:
- Capture main ideas
- Contain key facts
- Represent different parts of the document

Document:
{document[:15000]}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content

    async def _abstract_rewrite(
        self,
        extracted: str,
        original: str,
        ratio: float
    ) -> str:
        """Rewrite extracted content coherently."""
        target_words = int(len(original.split()) * ratio)

        prompt = f"""Rewrite these extracted sentences into a coherent {target_words}-word summary.
Improve flow and readability while preserving all information.

Extracted content:
{extracted}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content
```

## Quality Preservation Techniques

```python
class QualityPreservingSummarizer:
    """Summarize with quality checks at each stage."""

    async def summarize_with_verification(
        self,
        document: str,
        target_length: int = 500
    ) -> dict:
        """Summarize with verification pass."""

        # Generate summary
        summary = await self._generate_summary(document, target_length)

        # Verify against original
        verification = await self._verify_summary(document, summary)

        # Correct if needed
        if not verification["faithful"]:
            summary = await self._correct_summary(document, summary, verification["issues"])

        return {
            "summary": summary,
            "verification": verification,
            "corrected": not verification["faithful"]
        }

    async def _verify_summary(
        self,
        document: str,
        summary: str
    ) -> dict:
        """Verify summary against document."""
        prompt = f"""Verify this summary against the original document.

Original (excerpt):
{document[:8000]}

Summary:
{summary}

Check:
1. Are all claims in the summary supported by the document?
2. Is any important information missing?
3. Are there any factual errors?

Return JSON:
{{"faithful": true/false, "issues": ["issue1", ...], "missing": ["missing info", ...]}}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return {"faithful": True, "issues": []}

    async def _correct_summary(
        self,
        document: str,
        summary: str,
        issues: list[str]
    ) -> str:
        """Correct summary based on issues."""
        issues_str = "\n".join(f"- {issue}" for issue in issues)

        prompt = f"""Correct this summary to fix the identified issues.

Original document (excerpt):
{document[:6000]}

Current summary:
{summary}

Issues to fix:
{issues_str}

Provide corrected summary."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )
        return response.content
```

## Performance Optimization

```python
class OptimizedRecursiveSummarizer:
    """Optimized recursive summarization with caching and parallelism."""

    def __init__(self, client, cache=None):
        self.client = client
        self.cache = cache
        self.counter = TokenCounter()

    async def summarize(
        self,
        document: str,
        cache_key: str = None
    ) -> dict:
        """Summarize with caching and parallel processing."""

        # Check cache
        if self.cache and cache_key:
            cached = await self.cache.get(cache_key)
            if cached:
                return {"summary": cached, "cached": True}

        # Process
        chunks = self._smart_chunk(document)

        # Parallel summarization with rate limiting
        semaphore = asyncio.Semaphore(5)  # Max 5 concurrent requests

        async def bounded_summarize(chunk, index):
            async with semaphore:
                return await self._summarize_chunk(chunk, index, len(chunks))

        summaries = await asyncio.gather(*[
            bounded_summarize(chunk, i) for i, chunk in enumerate(chunks)
        ])

        # Combine
        final = await self._hierarchical_combine(summaries)

        # Cache result
        if self.cache and cache_key:
            await self.cache.set(cache_key, final)

        return {"summary": final, "cached": False}

    def _smart_chunk(self, document: str) -> list[str]:
        """Chunk at natural boundaries."""
        # Try to split at paragraph boundaries
        paragraphs = document.split('\n\n')

        chunks = []
        current_chunk = []
        current_tokens = 0
        max_tokens = 4000

        for para in paragraphs:
            para_tokens = self.counter.count(para)

            if current_tokens + para_tokens > max_tokens and current_chunk:
                chunks.append('\n\n'.join(current_chunk))
                current_chunk = [para]
                current_tokens = para_tokens
            else:
                current_chunk.append(para)
                current_tokens += para_tokens

        if current_chunk:
            chunks.append('\n\n'.join(current_chunk))

        return chunks
```

Recursive summarization enables processing of documents of any length while maintaining quality through iterative refinement.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
