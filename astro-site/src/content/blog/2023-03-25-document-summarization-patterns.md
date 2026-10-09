---
title: "Document Summarization Patterns with GPT-4"
description: "Effective summarization adapts to document type, size, and audience needs. These patterns provide a foundation for production-ready summarization systems."
author: Michael John Pena
draft: false
date: 2023-03-25
tags:
  - OpenAI
  - AI
  - GPT-4
  - Summarization
  - NLP
---

## Summarization Approaches

Different documents need different approaches:

```python
from enum import Enum
from dataclasses import dataclass

class SummaryType(Enum):
    EXTRACTIVE = "extractive"      # Pull key sentences
    ABSTRACTIVE = "abstractive"    # Rewrite in new words
    BULLET_POINTS = "bullet_points"
    EXECUTIVE = "executive"        # High-level for leadership
    TECHNICAL = "technical"        # Preserve technical details
    STRUCTURED = "structured"      # Specific sections

@dataclass
class SummaryConfig:
    summary_type: SummaryType
    target_length: int  # words
    audience: str
    preserve_quotes: bool = False
    include_metadata: bool = True

class DocumentSummarizer:
    """Multi-strategy document summarization."""

    def __init__(self, client):
        self.client = client
        self.counter = TokenCounter()

    async def summarize(
        self,
        document: str,
        config: SummaryConfig
    ) -> dict:
        """Summarize document based on configuration."""

        doc_tokens = self.counter.count(document)

        # Select strategy based on document size
        if doc_tokens <= 25000:
            return await self._direct_summarize(document, config)
        else:
            return await self._chunked_summarize(document, config)

    async def _direct_summarize(
        self,
        document: str,
        config: SummaryConfig
    ) -> dict:
        """Direct summarization for documents that fit in context."""

        prompts = {
            SummaryType.EXTRACTIVE: f"""Extract the {config.target_length // 20} most important sentences from this document.
Present them in order of importance, maintaining original wording.""",

            SummaryType.ABSTRACTIVE: f"""Write a {config.target_length}-word summary of this document.
Rephrase in clear, concise language while preserving all key information.""",

            SummaryType.BULLET_POINTS: f"""Summarize this document in {config.target_length // 15} bullet points.
Each point should be a complete, standalone insight.""",

            SummaryType.EXECUTIVE: f"""Write a {config.target_length}-word executive summary.
Focus on: key findings, business impact, and recommended actions.
Use language appropriate for {config.audience}.""",

            SummaryType.TECHNICAL: f"""Write a {config.target_length}-word technical summary.
Preserve: technical terms, numbers, specifications, and methodology details.""",

            SummaryType.STRUCTURED: """Summarize in this structure:
## Overview (2-3 sentences)
## Key Points (5-7 bullets)
## Details (brief elaboration on each point)
## Conclusion (1-2 sentences)"""
        }

        prompt = f"""{prompts[config.summary_type]}

Document:
{document}"""

        response = await self.client.chat_completion(
            model="gpt-4-32k" if self.counter.count(document) > 7000 else "gpt-4",
            messages=[
                {"role": "system", "content": f"You are creating summaries for {config.audience}."},
                {"role": "user", "content": prompt}
            ]
        )

        return {
            "summary": response.content,
            "type": config.summary_type.value,
            "method": "direct"
        }
```

## Map-Reduce Summarization

For documents exceeding context limits:

```python
class MapReduceSummarizer:
    """Map-reduce pattern for large document summarization."""

    def __init__(self, client, chunk_size: int = 5000):
        self.client = client
        self.chunk_size = chunk_size
        self.counter = TokenCounter()

    async def summarize(
        self,
        document: str,
        final_length: int = 500
    ) -> dict:
        """Summarize large document using map-reduce."""

        # Split into chunks
        chunks = self._split_document(document)

        # Map phase: summarize each chunk
        chunk_summaries = []
        for i, chunk in enumerate(chunks):
            summary = await self._summarize_chunk(chunk, i + 1, len(chunks))
            chunk_summaries.append(summary)

        # Reduce phase: combine summaries
        if len(chunk_summaries) > 10:
            # Recursive reduction for very large documents
            combined = await self._recursive_reduce(chunk_summaries, final_length)
        else:
            combined = await self._reduce_summaries(chunk_summaries, final_length)

        return {
            "summary": combined,
            "chunks_processed": len(chunks),
            "method": "map_reduce"
        }

    def _split_document(self, document: str) -> list[str]:
        """Split document into chunks."""
        words = document.split()
        chunks = []
        chunk_words = self.chunk_size

        for i in range(0, len(words), chunk_words):
            chunk = ' '.join(words[i:i + chunk_words])
            chunks.append(chunk)

        return chunks

    async def _summarize_chunk(
        self,
        chunk: str,
        chunk_num: int,
        total_chunks: int
    ) -> str:
        """Summarize a single chunk."""
        prompt = f"""Summarize this document section ({chunk_num} of {total_chunks}).
Extract key information, main points, and important details.
Keep summary to ~200 words.

Section:
{chunk}"""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",  # Use cheaper model for chunks
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def _reduce_summaries(
        self,
        summaries: list[str],
        final_length: int
    ) -> str:
        """Combine chunk summaries into final summary."""
        all_summaries = "\n\n---\n\n".join([
            f"Section {i+1}:\n{s}" for i, s in enumerate(summaries)
        ])

        prompt = f"""Combine these section summaries into a coherent {final_length}-word final summary.

Section Summaries:
{all_summaries}

Create a unified summary that:
1. Synthesizes information across all sections
2. Eliminates redundancy
3. Maintains logical flow
4. Preserves key details"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content

    async def _recursive_reduce(
        self,
        summaries: list[str],
        final_length: int
    ) -> str:
        """Recursively reduce many summaries."""
        while len(summaries) > 5:
            # Combine pairs
            new_summaries = []
            for i in range(0, len(summaries), 3):
                group = summaries[i:i + 3]
                combined = await self._reduce_summaries(group, 300)
                new_summaries.append(combined)
            summaries = new_summaries

        return await self._reduce_summaries(summaries, final_length)
```

## Hierarchical Summarization

For structured documents:

```python
class HierarchicalSummarizer:
    """Summarize preserving document structure."""

    def __init__(self, client):
        self.client = client

    async def summarize_hierarchical(
        self,
        document: str,
        depth: int = 2
    ) -> dict:
        """Create hierarchical summary preserving structure."""

        # Extract document structure
        structure = await self._extract_structure(document)

        # Summarize at each level
        summaries = {}
        for section in structure["sections"]:
            section_summary = await self._summarize_section(
                section["title"],
                section["content"],
                depth
            )
            summaries[section["title"]] = section_summary

        # Create overall summary
        overall = await self._create_overview(structure, summaries)

        return {
            "overview": overall,
            "sections": summaries,
            "structure": structure
        }

    async def _extract_structure(self, document: str) -> dict:
        """Extract document structure."""
        prompt = f"""Analyze the structure of this document.

Document:
{document[:8000]}

Return JSON:
{{
    "title": "document title",
    "sections": [
        {{"title": "section title", "level": 1, "start": "first few words...", "topics": ["topic1"]}}
    ]
}}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return {"title": "Document", "sections": []}

    async def _summarize_section(
        self,
        title: str,
        content: str,
        depth: int
    ) -> dict:
        """Summarize a section with optional subsections."""
        prompt = f"""Summarize this section: {title}

Content:
{content}

Provide:
1. Main summary (2-3 sentences)
2. Key points (3-5 bullets)
3. Notable details (if any)"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return {"title": title, "summary": response.content}
```

## Comparative Summarization

Summarize multiple documents together:

```python
class ComparativeSummarizer:
    """Summarize and compare multiple documents."""

    async def compare_and_summarize(
        self,
        documents: list[dict],  # [{"title": "...", "content": "..."}]
        focus: str = None
    ) -> dict:
        """Create comparative summary of multiple documents."""

        # Summarize each document
        summaries = []
        for doc in documents:
            summary = await self._summarize_for_comparison(doc["content"])
            summaries.append({
                "title": doc["title"],
                "summary": summary
            })

        # Create comparison
        comparison = await self._create_comparison(summaries, focus)

        return {
            "individual_summaries": summaries,
            "comparison": comparison
        }

    async def _create_comparison(
        self,
        summaries: list[dict],
        focus: str
    ) -> dict:
        """Create comparison across documents."""
        summaries_text = "\n\n".join([
            f"Document: {s['title']}\n{s['summary']}"
            for s in summaries
        ])

        focus_instruction = f"\nFocus on: {focus}" if focus else ""

        prompt = f"""Compare these document summaries.

{summaries_text}
{focus_instruction}

Provide:
1. Common themes across all documents
2. Key differences
3. Contradictions or conflicts
4. Unique insights from each
5. Synthesis - what can we conclude from all documents together?"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return {
            "analysis": response.content,
            "documents_compared": len(summaries)
        }
```

## Progressive Summarization

Different levels of detail:

```python
class ProgressiveSummarizer:
    """Generate summaries at multiple detail levels."""

    async def multi_level_summary(
        self,
        document: str
    ) -> dict:
        """Generate summaries at different detail levels."""

        levels = {
            "one_line": "Summarize in exactly one sentence.",
            "brief": "Summarize in 50 words.",
            "standard": "Summarize in 150 words.",
            "detailed": "Summarize in 400 words, preserving key details.",
            "comprehensive": "Create a comprehensive 800-word summary with all important information."
        }

        summaries = {}
        for level, instruction in levels.items():
            prompt = f"""{instruction}

Document:
{document[:25000]}"""

            response = await self.client.chat_completion(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}]
            )

            summaries[level] = response.content

        return summaries
```

## Quality Metrics

```python
class SummaryEvaluator:
    """Evaluate summary quality."""

    async def evaluate(
        self,
        document: str,
        summary: str
    ) -> dict:
        """Evaluate summary against original document."""

        prompt = f"""Evaluate this summary against the original document.

Original Document (excerpt):
{document[:5000]}

Summary:
{summary}

Rate (1-10) and explain:
1. Coverage: Does it cover main points?
2. Accuracy: Is the information correct?
3. Coherence: Is it well-organized and readable?
4. Conciseness: Is it appropriately condensed?
5. Faithfulness: Does it avoid adding information not in the original?

Return JSON with scores and explanations."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        return {"evaluation": response.content}
```

Effective summarization adapts to document type, size, and audience needs. These patterns provide a foundation for production-ready summarization systems.
