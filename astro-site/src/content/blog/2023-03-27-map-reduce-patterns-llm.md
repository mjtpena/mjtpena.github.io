---
title: "Map-Reduce Patterns for LLM Applications"
author: Michael John Pena
draft: false
date: 2023-03-27
tags:
  - OpenAI
  - AI
  - GPT-4
  - Map-Reduce
  - Architecture

---

I wrote "Map-Reduce Patterns for LLM Applications" to share practical, production-minded guidance on this topic.

## Core Map-Reduce Framework

```python
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import TypeVar, Generic, Callable
import asyncio

T = TypeVar('T')
U = TypeVar('U')
V = TypeVar('V')

@dataclass
class MapReduceConfig:
    max_concurrent: int = 5
    chunk_size: int = 4000
    use_cheap_model_for_map: bool = True

class MapReduceProcessor(Generic[T, U, V]):
    """Generic map-reduce processor for LLM operations."""

    def __init__(self, client, config: MapReduceConfig = None):
        self.client = client
        self.config = config or MapReduceConfig()

    async def process(
        self,
        items: list[T],
        map_fn: Callable[[T], U],
        reduce_fn: Callable[[list[U]], V]
    ) -> V:
        """Execute map-reduce pipeline."""

        # Map phase with concurrency control
        semaphore = asyncio.Semaphore(self.config.max_concurrent)

        async def bounded_map(item):
            async with semaphore:
                return await map_fn(item)

        mapped = await asyncio.gather(*[bounded_map(item) for item in items])

        # Reduce phase
        result = await reduce_fn(list(mapped))

        return result

class DocumentMapReduce:
    """Map-reduce specifically for document processing."""

    def __init__(self, client):
        self.client = client
        self.counter = TokenCounter()

    async def analyze_document(
        self,
        document: str,
        analysis_prompt: str,
        combine_prompt: str
    ) -> dict:
        """Analyze document using map-reduce."""

        # Split into chunks
        chunks = self._chunk_document(document)

        # Map: analyze each chunk
        chunk_analyses = []
        for i, chunk in enumerate(chunks):
            analysis = await self._analyze_chunk(chunk, analysis_prompt, i, len(chunks))
            chunk_analyses.append(analysis)

        # Reduce: combine analyses
        final = await self._combine_analyses(chunk_analyses, combine_prompt)

        return {
            "result": final,
            "chunks_processed": len(chunks),
            "method": "map_reduce"
        }

    async def _analyze_chunk(
        self,
        chunk: str,
        prompt: str,
        index: int,
        total: int
    ) -> str:
        """Map: analyze single chunk."""
        full_prompt = f"""{prompt}

Document section ({index + 1} of {total}):
{chunk}"""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": full_prompt}]
        )
        return response.content

    async def _combine_analyses(
        self,
        analyses: list[str],
        prompt: str
    ) -> str:
        """Reduce: combine chunk analyses."""
        analyses_text = "\n\n---\n\n".join([
            f"Section {i+1} Analysis:\n{a}"
            for i, a in enumerate(analyses)
        ])

        full_prompt = f"""{prompt}

Section Analyses:
{analyses_text}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": full_prompt}]
        )
        return response.content
```

## Common Map-Reduce Patterns

### Pattern 1: Extraction

```python
class ExtractionMapReduce:
    """Extract information from large documents."""

    async def extract_entities(
        self,
        document: str,
        entity_types: list[str]
    ) -> dict:
        """Extract entities using map-reduce."""

        types_str = ", ".join(entity_types)

        async def map_extract(chunk: str) -> list[dict]:
            prompt = f"""Extract all {types_str} from this text.
Return as JSON array: [{{"type": "...", "value": "...", "context": "..."}}]

Text:
{chunk}"""

            response = await self.client.chat_completion(
                model="gpt-35-turbo",
                messages=[{"role": "user", "content": prompt}],
                temperature=0
            )

            import json
            try:
                return json.loads(response.content)
            except:
                return []

        async def reduce_entities(all_entities: list[list[dict]]) -> dict:
            # Flatten and deduplicate
            flat = [e for chunk_entities in all_entities for e in chunk_entities]

            # Deduplicate by value
            seen = set()
            unique = []
            for entity in flat:
                key = (entity.get("type"), entity.get("value"))
                if key not in seen:
                    seen.add(key)
                    unique.append(entity)

            # Group by type
            by_type = {}
            for entity in unique:
                t = entity.get("type", "unknown")
                if t not in by_type:
                    by_type[t] = []
                by_type[t].append(entity)

            return by_type

        chunks = self._chunk_document(document)
        processor = MapReduceProcessor(self.client)

        return await processor.process(
            chunks,
            map_extract,
            reduce_entities
        )
```

### Pattern 2: Classification

```python
class ClassificationMapReduce:
    """Classify multiple items efficiently."""

    async def classify_batch(
        self,
        items: list[str],
        categories: list[str],
        batch_size: int = 10
    ) -> list[dict]:
        """Classify items in batches."""

        categories_str = ", ".join(categories)

        async def map_classify(batch: list[str]) -> list[dict]:
            items_str = "\n".join([f"{i+1}. {item}" for i, item in enumerate(batch)])

            prompt = f"""Classify each item into one of: {categories_str}

Items:
{items_str}

Return JSON array: [{{"item": 1, "category": "...", "confidence": 0.9}}]"""

            response = await self.client.chat_completion(
                model="gpt-35-turbo",
                messages=[{"role": "user", "content": prompt}],
                temperature=0
            )

            import json
            try:
                return json.loads(response.content)
            except:
                return [{"item": i, "category": "unknown"} for i in range(len(batch))]

        # Create batches
        batches = [items[i:i+batch_size] for i in range(0, len(items), batch_size)]

        # Process batches
        results = await asyncio.gather(*[map_classify(batch) for batch in batches])

        # Flatten
        return [r for batch_results in results for r in batch_results]
```

### Pattern 3: Question Answering

```python
class QAMapReduce:
    """Answer questions over large documents."""

    async def answer_question(
        self,
        document: str,
        question: str
    ) -> dict:
        """Find answer across document chunks."""

        async def map_search(chunk: str, chunk_id: int) -> dict:
            prompt = f"""Does this text contain information relevant to the question?

Question: {question}

Text:
{chunk}

If relevant, extract the relevant information.
If not relevant, respond with "NOT_RELEVANT".

Response:"""

            response = await self.client.chat_completion(
                model="gpt-35-turbo",
                messages=[{"role": "user", "content": prompt}]
            )

            content = response.content.strip()
            if content == "NOT_RELEVANT":
                return {"chunk_id": chunk_id, "relevant": False, "content": None}
            return {"chunk_id": chunk_id, "relevant": True, "content": content}

        async def reduce_answer(results: list[dict]) -> dict:
            # Filter relevant chunks
            relevant = [r for r in results if r["relevant"]]

            if not relevant:
                return {"answer": "No relevant information found.", "sources": []}

            # Combine relevant information
            context = "\n\n".join([r["content"] for r in relevant])

            prompt = f"""Based on this information, answer the question.

Question: {question}

Relevant Information:
{context}

Provide a comprehensive answer."""

            response = await self.client.chat_completion(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}]
            )

            return {
                "answer": response.content,
                "sources": [r["chunk_id"] for r in relevant]
            }

        chunks = self._chunk_document(document)

        # Map phase
        mapped = await asyncio.gather(*[
            map_search(chunk, i) for i, chunk in enumerate(chunks)
        ])

        # Reduce phase
        return await reduce_answer(list(mapped))
```

### Pattern 4: Aggregation

```python
class AggregationMapReduce:
    """Aggregate statistics from large datasets."""

    async def aggregate_metrics(
        self,
        data: list[dict],
        metrics: list[str]
    ) -> dict:
        """Aggregate metrics across data chunks."""

        async def map_aggregate(chunk: list[dict]) -> dict:
            import json
            data_str = json.dumps(chunk[:50], indent=2)  # Sample for large chunks

            prompt = f"""Calculate these metrics for this data: {', '.join(metrics)}

Data:
{data_str}

Return JSON with calculated values."""

            response = await self.client.chat_completion(
                model="gpt-35-turbo",
                messages=[{"role": "user", "content": prompt}],
                temperature=0
            )

            try:
                return json.loads(response.content)
            except:
                return {}

        async def reduce_aggregate(results: list[dict]) -> dict:
            import json
            results_str = json.dumps(results, indent=2)

            prompt = f"""Combine these partial aggregations into final metrics.

Partial Results:
{results_str}

Calculate final combined values for each metric."""

            response = await self.client.chat_completion(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}],
                temperature=0
            )

            try:
                return json.loads(response.content)
            except:
                return {"raw": response.content}

        # Chunk data
        chunk_size = 100
        chunks = [data[i:i+chunk_size] for i in range(0, len(data), chunk_size)]

        # Process
        mapped = await asyncio.gather(*[map_aggregate(chunk) for chunk in chunks])
        return await reduce_aggregate(list(mapped))
```

## Optimization Strategies

```python
class OptimizedMapReduce:
    """Optimized map-reduce with early termination and caching."""

    def __init__(self, client, cache=None):
        self.client = client
        self.cache = cache

    async def search_with_early_termination(
        self,
        chunks: list[str],
        search_fn,
        threshold: float = 0.9
    ) -> dict:
        """Stop searching when confident match found."""

        for i, chunk in enumerate(chunks):
            result = await search_fn(chunk)

            if result.get("confidence", 0) >= threshold:
                return {
                    "result": result,
                    "chunks_searched": i + 1,
                    "early_terminated": True
                }

        return {
            "result": None,
            "chunks_searched": len(chunks),
            "early_terminated": False
        }

    async def cached_map(
        self,
        items: list,
        map_fn,
        cache_key_fn
    ) -> list:
        """Map with caching of individual results."""

        results = []
        for item in items:
            cache_key = cache_key_fn(item)

            # Check cache
            if self.cache:
                cached = await self.cache.get(cache_key)
                if cached:
                    results.append(cached)
                    continue

            # Process
            result = await map_fn(item)
            results.append(result)

            # Cache
            if self.cache:
                await self.cache.set(cache_key, result)

        return results
```

Map-reduce transforms complex LLM tasks into manageable, parallelizable operations. Master these patterns for processing data at any scale.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
