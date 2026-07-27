---
title: "GraphRAG Implementation: Combining Graphs with Retrieval"
author: Michael John Peña
draft: false
date: 2025-03-03
tags:
  - AI
  - GraphRAG
  - RAG
  - Knowledge Graphs
  - Microsoft

---

I wrote "GraphRAG Implementation: Combining Graphs with Retrieval" to share practical, production-minded guidance on this topic.

## GraphRAG Architecture

```python
from graphrag import GraphRAGIndexer, GraphRAGQueryEngine
from azure.ai.openai import AzureOpenAI

class GraphRAGSystem:
    def __init__(self, openai_client: AzureOpenAI):
        self.openai = openai_client
        self.indexer = GraphRAGIndexer(
            llm=openai_client,
            chunk_size=1200,
            overlap=100
        )

    async def build_index(self, documents: list[str]):
        """Build GraphRAG index from documents."""
        # Extract entities and relationships
        for doc in documents:
            entities = await self.indexer.extract_entities(doc)
            self.indexer.add_to_graph(entities)

        # Build community summaries
        communities = self.indexer.detect_communities()
        for community in communities:
            summary = await self.summarize_community(community)
            self.indexer.store_summary(community.id, summary)

        return self.indexer.build()

    async def summarize_community(self, community) -> str:
        """Create summary for entity community."""
        entities_text = "\n".join([e.description for e in community.entities])
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": "Summarize the key themes and relationships in these entities."
            }, {
                "role": "user",
                "content": entities_text
            }]
        )
        return response.choices[0].message.content

    async def query(self, question: str, mode: str = "global") -> str:
        """Query using local or global search."""
        if mode == "global":
            # Use community summaries for broad questions
            summaries = self.indexer.get_relevant_summaries(question)
            context = "\n\n".join(summaries)
        else:
            # Use entity relationships for specific questions
            entities = self.indexer.search_entities(question)
            context = self.build_entity_context(entities)

        return await self.generate_answer(question, context)
```

GraphRAG excels at complex questions requiring synthesis across multiple documents.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
