---
title: "Knowledge Graphs and AI: Building Intelligent Data Structures"
description: "Knowledge graphs add structured reasoning capabilities to AI applications."
author: Michael John Peña
draft: false
date: 2025-03-02
tags:
  - AI
  - Knowledge Graphs
  - Neo4j
  - GraphRAG
  - Architecture
---

## Knowledge Graph Construction

```python
from neo4j import GraphDatabase
from azure.ai.openai import AzureOpenAI

class KnowledgeGraphBuilder:
    def __init__(self, neo4j_uri: str, openai_client: AzureOpenAI):
        self.driver = GraphDatabase.driver(neo4j_uri)
        self.openai = openai_client

    async def extract_entities(self, text: str) -> dict:
        """Extract entities and relationships from text."""
        response = await self.openai.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Extract entities and relationships from the text.
                Return JSON with format:
                {
                    "entities": [{"name": "", "type": "", "properties": {}}],
                    "relationships": [{"source": "", "target": "", "type": ""}]
                }"""
            }, {
                "role": "user",
                "content": text
            }],
            response_format={"type": "json_object"}
        )
        return json.loads(response.choices[0].message.content)

    def store_graph(self, entities: list, relationships: list):
        """Store extracted knowledge in Neo4j."""
        with self.driver.session() as session:
            for entity in entities:
                session.run(
                    f"MERGE (n:{entity['type']} {{name: $name}}) SET n += $props",
                    name=entity['name'],
                    props=entity.get('properties', {})
                )

            for rel in relationships:
                session.run(
                    f"""MATCH (a {{name: $source}}), (b {{name: $target}})
                    MERGE (a)-[r:{rel['type']}]->(b)""",
                    source=rel['source'],
                    target=rel['target']
                )

    def query_graph(self, question: str) -> list:
        """Query knowledge graph for relevant context."""
        with self.driver.session() as session:
            result = session.run(
                """MATCH path = (n)-[*1..3]-(m)
                WHERE n.name CONTAINS $keyword
                RETURN path LIMIT 50""",
                keyword=extract_keyword(question)
            )
            return [record["path"] for record in result]
```

Knowledge graphs add structured reasoning capabilities to AI applications.
