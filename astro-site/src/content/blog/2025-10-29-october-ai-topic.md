---
title: "GraphRAG: Combining Knowledge Graphs with Retrieval-Augmented Generation"
description: "GraphRAG excels when your questions involve multi-hop reasoning, relationship discovery, or when entity connections matter more than document similarity."
author: Michael John Peña
draft: false
date: 2025-10-29
tags:
  - GraphRAG
  - Knowledge Graphs
  - RAG
  - Azure OpenAI
  - Neo4j
---

## Building the Knowledge Graph

Create a knowledge graph from unstructured documents:

```python
from neo4j import GraphDatabase
from openai import AzureOpenAI
import json

class KnowledgeGraphBuilder:
    def __init__(self, neo4j_uri: str, neo4j_user: str, neo4j_password: str, openai_client: AzureOpenAI):
        self.driver = GraphDatabase.driver(neo4j_uri, auth=(neo4j_user, neo4j_password))
        self.openai = openai_client

    def extract_entities_and_relations(self, text: str) -> dict:
        """Extract entities and relationships using LLM."""

        extraction_prompt = """Analyze the following text and extract:
1. Entities (people, organizations, products, concepts)
2. Relationships between entities

Return JSON format:
{
    "entities": [{"name": "string", "type": "string", "properties": {}}],
    "relationships": [{"source": "string", "target": "string", "type": "string", "properties": {}}]
}"""

        response = self.openai.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": extraction_prompt},
                {"role": "user", "content": text}
            ],
            response_format={"type": "json_object"},
            temperature=0.1
        )

        return json.loads(response.choices[0].message.content)

    def store_in_graph(self, extracted: dict, source_id: str):
        """Store extracted entities and relationships in Neo4j."""

        with self.driver.session() as session:
            # Create entities
            for entity in extracted["entities"]:
                session.run("""
                    MERGE (e:Entity {name: $name})
                    SET e.type = $type, e.source = $source
                    SET e += $properties
                """, name=entity["name"], type=entity["type"],
                    source=source_id, properties=entity.get("properties", {}))

            # Create relationships
            for rel in extracted["relationships"]:
                session.run("""
                    MATCH (a:Entity {name: $source})
                    MATCH (b:Entity {name: $target})
                    MERGE (a)-[r:RELATED {type: $type}]->(b)
                    SET r += $properties
                """, source=rel["source"], target=rel["target"],
                    type=rel["type"], properties=rel.get("properties", {}))
```

## Implementing GraphRAG Queries

Combine graph traversal with semantic search:

```python
class GraphRAGQueryEngine:
    def __init__(self, driver, openai_client: AzureOpenAI, vector_store):
        self.driver = driver
        self.openai = openai_client
        self.vector_store = vector_store

    def query(self, question: str) -> dict:
        """Answer question using graph and vector context."""

        # Extract entities from question
        entities = self._extract_question_entities(question)

        # Get graph context
        graph_context = self._get_graph_context(entities)

        # Get vector context
        vector_context = self.vector_store.similarity_search(question, k=3)

        # Combine contexts
        combined_context = f"""
Graph Context (entity relationships):
{graph_context}

Document Context:
{chr(10).join([doc.page_content for doc in vector_context])}
"""

        response = self.openai.chat.completions.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "Answer questions using the provided graph and document context. Cite relationships when relevant."},
                {"role": "user", "content": f"Context:\n{combined_context}\n\nQuestion: {question}"}
            ]
        )

        return {
            "answer": response.choices[0].message.content,
            "entities_used": entities,
            "graph_context": graph_context
        }

    def _get_graph_context(self, entities: list) -> str:
        """Retrieve relevant subgraph for entities."""

        with self.driver.session() as session:
            result = session.run("""
                MATCH (e:Entity)-[r]-(related)
                WHERE e.name IN $entities
                RETURN e.name AS entity, type(r) AS relationship, related.name AS related_entity
                LIMIT 50
            """, entities=entities)

            context_lines = [f"{r['entity']} --[{r['relationship']}]--> {r['related_entity']}" for r in result]
            return "\n".join(context_lines)
```

## When to Use GraphRAG

GraphRAG excels when your questions involve multi-hop reasoning, relationship discovery, or when entity connections matter more than document similarity.
