---
title: "Building Knowledge Graphs with Azure OpenAI and Neo4j"
description: "Graph RAG significantly improves answers for questions involving relationships, hierarchies, and multi-hop reasoning."
author: Michael John Peña
draft: false
date: 2025-07-23
tags:
  - Knowledge Graphs
  - Neo4j
  - Azure OpenAI
  - Graph RAG
  - Python
---

## Entity and Relationship Extraction

Use GPT-4o to extract structured knowledge from unstructured text:

```python
from openai import AzureOpenAI
from neo4j import GraphDatabase
import json

class KnowledgeGraphBuilder:
    def __init__(self, openai_client: AzureOpenAI, neo4j_driver: GraphDatabase.driver):
        self.llm = openai_client
        self.driver = neo4j_driver

    async def extract_knowledge(self, text: str) -> dict:
        response = await self.llm.chat.completions.create(
            model="gpt-4o",
            messages=[{
                "role": "system",
                "content": """Extract entities and relationships from text.
                Return JSON with:
                - entities: [{name, type, properties}]
                - relationships: [{source, target, type, properties}]

                Entity types: Person, Organization, Product, Technology, Concept
                Relationship types: WORKS_FOR, DEVELOPS, USES, RELATED_TO, PART_OF"""
            }, {
                "role": "user",
                "content": text
            }],
            response_format={"type": "json_object"},
            temperature=0
        )

        return json.loads(response.choices[0].message.content)

    def store_in_neo4j(self, knowledge: dict):
        with self.driver.session() as session:
            # Create entities
            for entity in knowledge.get("entities", []):
                session.run("""
                    MERGE (e:{type} {{name: $name}})
                    SET e += $properties
                """.format(type=entity["type"]),
                    name=entity["name"],
                    properties=entity.get("properties", {})
                )

            # Create relationships
            for rel in knowledge.get("relationships", []):
                session.run("""
                    MATCH (source {{name: $source}})
                    MATCH (target {{name: $target}})
                    MERGE (source)-[r:{rel_type}]->(target)
                    SET r += $properties
                """.format(rel_type=rel["type"]),
                    source=rel["source"],
                    target=rel["target"],
                    properties=rel.get("properties", {})
                )
```

## Graph-Enhanced RAG Queries

Combine graph traversal with vector search for richer context:

```python
async def graph_rag_query(self, question: str) -> str:
    # Extract entities from question
    entities = await self.extract_entities_from_question(question)

    # Traverse graph for related context
    graph_context = self.get_graph_context(entities, depth=2)

    # Combine with vector search results
    vector_results = await self.vector_search(question)

    # Generate answer with combined context
    response = await self.llm.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "system",
            "content": f"Use this context to answer:\n\nGraph Context:\n{graph_context}\n\nDocuments:\n{vector_results}"
        }, {
            "role": "user",
            "content": question
        }]
    )

    return response.choices[0].message.content
```

Graph RAG significantly improves answers for questions involving relationships, hierarchies, and multi-hop reasoning.
