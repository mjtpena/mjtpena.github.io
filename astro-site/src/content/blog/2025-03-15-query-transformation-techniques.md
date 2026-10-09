---
title: "Query Transformation Techniques: Improving RAG Recall"
description: "Query transformation is a high-leverage improvement for RAG systems."
author: Michael John Peña
draft: false
date: 2025-03-15
tags:
  - RAG
  - Query
  - Transformation
  - AI
  - Search
---

## Query Transformation Patterns

```python
from azure.ai.openai import AzureOpenAI
from typing import List

class QueryTransformer:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client

    async def expand_query(self, query: str, num_variations: int = 3) -> List[str]:
        """Generate query variations to improve recall."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"""Generate {num_variations} alternative phrasings of this query.
                Include:
                - Synonyms and related terms
                - Different perspectives on the same question
                - More specific and more general versions"""
            }, {
                "role": "user",
                "content": query
            }]
        )
        variations = self.parse_variations(response)
        return [query] + variations

    async def decompose_query(self, query: str) -> List[str]:
        """Break complex query into simpler sub-queries."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Break this complex question into simpler sub-questions.
                Each sub-question should be answerable independently."""
            }, {
                "role": "user",
                "content": query
            }]
        )
        return self.parse_subqueries(response)

    async def hypothetical_document(self, query: str) -> str:
        """Generate hypothetical answer for HyDE retrieval."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Generate a hypothetical document that would perfectly
                answer this question. Write as if it's from a knowledge base."""
            }, {
                "role": "user",
                "content": query
            }]
        )
        return response.choices[0].message.content

    async def step_back_prompt(self, query: str) -> str:
        """Generate broader context query."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Generate a more general question that provides
                background context needed to answer the specific question."""
            }, {
                "role": "user",
                "content": query
            }]
        )
        return response.choices[0].message.content

    async def extract_entities(self, query: str) -> dict:
        """Extract key entities for targeted retrieval."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"Extract key entities (people, products, dates, etc) from: {query}"
            }],
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)
```

Query transformation is a high-leverage improvement for RAG systems.
