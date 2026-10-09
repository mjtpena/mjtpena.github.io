---
title: "Copilot for Docs: Chat With Your Documentation"
description: "Copilot for Docs is one of the most concrete RAG applications Microsoft shipped publicly in this period—a conversational interface over documentation that…"
author: Michael John Pena
draft: false
date: 2023-04-05
tags:
  - GitHub
  - AI
  - Copilot
  - Documentation
  - RAG
---

Copilot for Docs is one of the most concrete RAG applications Microsoft shipped publicly in this period—a conversational interface over documentation that uses retrieval-augmented generation to answer questions about specific repositories, libraries, and frameworks, citing the exact documentation passages that support each answer. The underlying architecture is exactly the RAG pattern: documentation is chunked and indexed as embeddings; user questions are embedded and used to retrieve the most relevant documentation chunks; GPT-4 generates an answer grounded in the retrieved chunks and includes citations to the source documentation pages. The practical difference from web search: asking "how do I authenticate with the GitHub REST API using a personal access token in Python?" in a search engine returns a list of pages to read; asking it in Copilot for Docs returns a direct answer with the authentication code snippet and a citation to the relevant GitHub Docs page—no page-scanning required. The scope limitation: the initial Copilot for Docs preview covered Microsoft-maintained documentation (Azure, GitHub, Microsoft 365, .NET)—it was not a general documentation assistant for any library; enabling it for custom repositories or third-party documentation was a separate, later capability. The implications for technical writers: Copilot for Docs created a new quality signal for documentation—if the documentation couldn't ground accurate answers to common questions, that was a documentation completeness problem; good documentation became measurable through AI answer quality.

## How It Works

```
User Question
     ↓
[Embed Question]
     ↓
[Search Documentation Index]
     ↓
[Retrieve Relevant Sections]
     ↓
[Construct Prompt with Context]
     ↓
[Generate Answer with Citations]
     ↓
Contextual Response
```

## Building a Docs Copilot

```python
from dataclasses import dataclass
from typing import Optional

@dataclass
class DocSection:
    content: str
    title: str
    url: str
    source: str
    embedding: Optional[list[float]] = None

class DocsCopilot:
    """Conversational documentation assistant."""

    def __init__(self, client, vector_store):
        self.client = client
        self.vector_store = vector_store
        self.conversation_history = []

    async def ask(
        self,
        question: str,
        doc_filter: str = None,
        include_examples: bool = True
    ) -> dict:
        """Ask a question about the documentation."""

        # Search for relevant docs
        relevant_docs = await self._search_docs(question, doc_filter)

        # Build context
        context = self._build_context(relevant_docs, include_examples)

        # Add to conversation
        self.conversation_history.append({
            "role": "user",
            "content": question
        })

        # Generate answer
        response = await self._generate_answer(question, context)

        # Add response to history
        self.conversation_history.append({
            "role": "assistant",
            "content": response["answer"]
        })

        return {
            "answer": response["answer"],
            "sources": [{"title": d.title, "url": d.url} for d in relevant_docs],
            "confidence": response.get("confidence", "medium")
        }

    async def _search_docs(
        self,
        query: str,
        filter_source: str = None
    ) -> list[DocSection]:
        """Search documentation for relevant sections."""

        filters = {}
        if filter_source:
            filters["source"] = filter_source

        results = await self.vector_store.search(
            query=query,
            k=5,
            filters=filters
        )

        return [DocSection(**r) for r in results]

    def _build_context(
        self,
        docs: list[DocSection],
        include_examples: bool
    ) -> str:
        """Build context from retrieved documents."""

        context_parts = []
        for doc in docs:
            section = f"### {doc.title}\nSource: {doc.url}\n\n{doc.content}"
            context_parts.append(section)

        return "\n\n---\n\n".join(context_parts)

    async def _generate_answer(
        self,
        question: str,
        context: str
    ) -> dict:
        """Generate answer from context."""

        system_prompt = """You are a documentation assistant. Answer questions based ONLY on the provided documentation context.

Guidelines:
- If the answer is in the docs, provide it with relevant code examples
- If the answer is NOT in the docs, say "I couldn't find this in the documentation"
- Always cite which documentation section your answer comes from
- Include code examples when relevant
- Be concise but complete"""

        messages = [
            {"role": "system", "content": system_prompt},
            *self.conversation_history[-6:],  # Keep last 3 exchanges
            {"role": "user", "content": f"Documentation Context:\n{context}\n\nQuestion: {question}"}
        ]

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=messages
        )

        return {"answer": response.content}

    def clear_history(self):
        """Clear conversation history."""
        self.conversation_history = []
```

## Indexing Documentation

```python
import os
import re
from pathlib import Path

class DocsIndexer:
    """Index documentation for semantic search."""

    def __init__(self, client, vector_store):
        self.client = client
        self.vector_store = vector_store

    async def index_markdown_docs(
        self,
        docs_path: str,
        source_name: str
    ) -> dict:
        """Index markdown documentation files."""

        indexed = 0
        errors = []

        for md_file in Path(docs_path).rglob("*.md"):
            try:
                sections = self._parse_markdown(md_file)

                for section in sections:
                    # Generate embedding
                    embedding = await self._get_embedding(section["content"])

                    # Store in vector DB
                    await self.vector_store.upsert({
                        "id": f"{source_name}:{md_file.stem}:{section['title']}",
                        "content": section["content"],
                        "title": section["title"],
                        "url": self._generate_url(source_name, md_file, section["anchor"]),
                        "source": source_name,
                        "embedding": embedding
                    })

                    indexed += 1

            except Exception as e:
                errors.append({"file": str(md_file), "error": str(e)})

        return {
            "indexed_sections": indexed,
            "errors": errors
        }

    def _parse_markdown(self, file_path: Path) -> list[dict]:
        """Parse markdown into sections."""

        with open(file_path) as f:
            content = f.read()

        sections = []
        current_section = {"title": "Introduction", "content": "", "anchor": ""}

        for line in content.split("\n"):
            # Check for headers
            header_match = re.match(r'^(#{1,3})\s+(.+)$', line)

            if header_match:
                # Save current section if it has content
                if current_section["content"].strip():
                    sections.append(current_section)

                # Start new section
                title = header_match.group(2)
                anchor = title.lower().replace(" ", "-").replace(".", "")
                current_section = {
                    "title": title,
                    "content": "",
                    "anchor": anchor
                }
            else:
                current_section["content"] += line + "\n"

        # Don't forget last section
        if current_section["content"].strip():
            sections.append(current_section)

        return sections

    async def _get_embedding(self, text: str) -> list[float]:
        """Get embedding for text."""
        response = await self.client.embedding(
            model="text-embedding-ada-002",
            input=text[:8000]  # Truncate if needed
        )
        return response.embedding

    def _generate_url(
        self,
        source: str,
        file_path: Path,
        anchor: str
    ) -> str:
        """Generate documentation URL."""
        # This depends on your docs hosting
        base_url = f"https://docs.example.com/{source}"
        return f"{base_url}/{file_path.stem}#{anchor}"
```

## Multi-Source Documentation

```python
class MultiSourceDocsCopilot:
    """Query across multiple documentation sources."""

    def __init__(self, client, vector_store):
        self.client = client
        self.vector_store = vector_store
        self.sources = {}

    def register_source(
        self,
        name: str,
        description: str,
        priority: int = 1
    ):
        """Register a documentation source."""
        self.sources[name] = {
            "description": description,
            "priority": priority
        }

    async def ask_across_sources(
        self,
        question: str,
        sources: list[str] = None
    ) -> dict:
        """Ask question across multiple doc sources."""

        # Determine relevant sources
        if not sources:
            sources = await self._identify_relevant_sources(question)

        # Search each source
        all_results = []
        for source in sources:
            results = await self.vector_store.search(
                query=question,
                k=3,
                filters={"source": source}
            )
            for r in results:
                r["source"] = source
            all_results.extend(results)

        # Rank and deduplicate
        ranked = self._rank_results(all_results)

        # Generate unified answer
        context = self._build_multi_source_context(ranked[:5])
        answer = await self._generate_unified_answer(question, context)

        return {
            "answer": answer,
            "sources_used": sources,
            "references": [{"source": r["source"], "title": r["title"]} for r in ranked[:5]]
        }

    async def _identify_relevant_sources(
        self,
        question: str
    ) -> list[str]:
        """Identify which documentation sources are relevant."""

        sources_desc = "\n".join([
            f"- {name}: {info['description']}"
            for name, info in self.sources.items()
        ])

        prompt = f"""Which documentation sources would be relevant for this question?

Available sources:
{sources_desc}

Question: {question}

Return JSON array of source names: ["source1", "source2"]"""

        response = await self.client.chat_completion(
            model="gpt-35-turbo",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return list(self.sources.keys())
```

## Code Example Extraction

```python
class CodeExampleExtractor:
    """Extract and enhance code examples from docs."""

    async def get_examples(
        self,
        topic: str,
        language: str = None
    ) -> list[dict]:
        """Get code examples for a topic."""

        # Search for relevant docs
        results = await self.vector_store.search(
            query=f"{topic} example code",
            k=10
        )

        # Extract code blocks
        examples = []
        for result in results:
            code_blocks = self._extract_code_blocks(
                result["content"],
                language
            )
            for code in code_blocks:
                examples.append({
                    "code": code["code"],
                    "language": code["language"],
                    "context": result["title"],
                    "source": result["url"]
                })

        return examples

    def _extract_code_blocks(
        self,
        content: str,
        language_filter: str = None
    ) -> list[dict]:
        """Extract code blocks from markdown content."""
        import re

        pattern = r'```(\w+)?\n(.*?)```'
        matches = re.findall(pattern, content, re.DOTALL)

        blocks = []
        for lang, code in matches:
            if language_filter and lang != language_filter:
                continue
            blocks.append({
                "language": lang or "text",
                "code": code.strip()
            })

        return blocks

    async def explain_example(
        self,
        code: str,
        context: str
    ) -> str:
        """Explain a code example."""

        prompt = f"""Explain this code example from the documentation.

Context: {context}

Code:
```
{code}
```

Provide:
1. What it does
2. Key concepts demonstrated
3. How to adapt for different use cases"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

Copilot for Docs transforms static documentation into an interactive knowledge base. Combined with proper indexing and retrieval, it makes documentation truly accessible.
