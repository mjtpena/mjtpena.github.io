---
title: "Bing Chat: GPT-4 Powered Search"
description: "Bing Chat represents the future of search: not just finding links, but synthesizing answers from the web with AI understanding."
author: Michael John Pena
draft: false
date: 2023-04-11
tags:
  - Microsoft
  - AI
  - Bing
  - GPT-4
  - Search
---

## Architecture: Search + LLM

```python
class BingChatArchitecture:
    """Conceptual architecture of Bing Chat."""

    async def process_query(self, user_query: str) -> dict:
        """Process user query with search augmentation."""

        # Step 1: Determine if search is needed
        needs_search = await self._classify_query(user_query)

        if needs_search:
            # Step 2: Generate search queries
            search_queries = await self._generate_search_queries(user_query)

            # Step 3: Execute searches
            search_results = await self._search(search_queries)

            # Step 4: Generate response with search context
            response = await self._generate_with_context(
                user_query,
                search_results
            )
        else:
            # Direct response without search
            response = await self._generate_direct(user_query)

        return response

    async def _classify_query(self, query: str) -> bool:
        """Determine if query needs web search."""
        # Queries about current events, specific facts, recent data
        current_indicators = [
            "today", "latest", "current", "now", "2023",
            "price", "weather", "news", "stock"
        ]
        return any(ind in query.lower() for ind in current_indicators)

    async def _generate_search_queries(self, user_query: str) -> list[str]:
        """Generate optimized search queries."""
        prompt = f"""Generate 3 search queries to answer this question.

Question: {user_query}

Return queries that:
1. Cover different aspects
2. Use effective search terms
3. Target authoritative sources

Return as JSON array."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )

        import json
        try:
            return json.loads(response.content)
        except:
            return [user_query]

    async def _generate_with_context(
        self,
        query: str,
        search_results: list[dict]
    ) -> dict:
        """Generate response with search context."""

        # Format search results
        context = self._format_search_results(search_results)

        prompt = f"""Answer this question using the search results.

Question: {query}

Search Results:
{context}

Instructions:
- Synthesize information from multiple sources
- Cite sources using [1], [2], etc.
- Indicate when information might be outdated
- Be direct and helpful"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return {
            "answer": response.content,
            "sources": [r["url"] for r in search_results[:5]],
            "search_used": True
        }
```

## Conversation Modes

Bing Chat offers three modes:

```python
from enum import Enum

class BingChatMode(Enum):
    CREATIVE = "creative"   # More imaginative, longer responses
    BALANCED = "balanced"   # Balance of accuracy and creativity
    PRECISE = "precise"     # Factual, concise, search-focused

class BingChatModeSettings:
    """Settings for each conversation mode."""

    SETTINGS = {
        BingChatMode.CREATIVE: {
            "temperature": 0.9,
            "max_tokens": 2000,
            "search_emphasis": 0.3,
            "style": "engaging and creative"
        },
        BingChatMode.BALANCED: {
            "temperature": 0.5,
            "max_tokens": 1000,
            "search_emphasis": 0.5,
            "style": "helpful and balanced"
        },
        BingChatMode.PRECISE: {
            "temperature": 0.2,
            "max_tokens": 500,
            "search_emphasis": 0.8,
            "style": "factual and concise"
        }
    }

    @classmethod
    def get_system_prompt(cls, mode: BingChatMode) -> str:
        settings = cls.SETTINGS[mode]
        return f"""You are Bing, an AI assistant.
Mode: {mode.value}
Style: {settings['style']}

Guidelines:
- Cite sources for factual claims
- Be helpful and informative
- Acknowledge limitations
- Avoid harmful content"""
```

## Building Similar Experiences

```python
class SearchAugmentedLLM:
    """Build search-augmented LLM applications."""

    def __init__(self, client, search_api):
        self.client = client
        self.search = search_api

    async def answer_with_search(
        self,
        question: str,
        max_sources: int = 5
    ) -> dict:
        """Answer question using web search."""

        # Search
        results = await self.search.search(question)
        top_results = results[:max_sources]

        # Fetch and extract content
        sources_content = []
        for result in top_results:
            content = await self._extract_content(result["url"])
            sources_content.append({
                "title": result["title"],
                "url": result["url"],
                "content": content[:2000]
            })

        # Generate answer
        answer = await self._generate_answer(question, sources_content)

        return {
            "answer": answer,
            "sources": [{"title": s["title"], "url": s["url"]} for s in sources_content]
        }

    async def _extract_content(self, url: str) -> str:
        """Extract main content from URL."""
        # Implementation depends on your needs
        # Could use trafilatura, newspaper3k, etc.
        pass

    async def _generate_answer(
        self,
        question: str,
        sources: list[dict]
    ) -> str:
        """Generate answer from sources."""

        sources_text = "\n\n".join([
            f"[{i+1}] {s['title']}\n{s['content']}"
            for i, s in enumerate(sources)
        ])

        prompt = f"""Answer this question using the provided sources.

Question: {question}

Sources:
{sources_text}

Answer citing sources as [1], [2], etc."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return response.content
```

## Key Differences from ChatGPT

| Feature | ChatGPT | Bing Chat |
|---------|---------|-----------|
| Knowledge | Cutoff date | Live search |
| Sources | None | Cited links |
| Images | Text only | Can generate |
| Conversation | Unlimited | Limited turns |
| Modes | One | Creative/Balanced/Precise |

Bing Chat represents the future of search: not just finding links, but synthesizing answers from the web with AI understanding.
