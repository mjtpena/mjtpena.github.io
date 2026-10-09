---
title: "GraphRAG: Combining Knowledge Graphs with LLMs for Superior Retrieval"
description: "Invest in GraphRAG when your use case demands deeper understanding beyond surface-level text matching."
author: Michael John Peña
draft: false
date: 2025-01-18
tags:
  - AI
  - GraphRAG
  - Knowledge Graphs
  - RAG
  - Azure
---

## What is GraphRAG?

GraphRAG combines:
1. **Knowledge Graph Construction**: Extract entities and relationships from documents
2. **Graph-Based Retrieval**: Traverse relationships to find relevant context
3. **LLM Generation**: Use structured knowledge for better answers

```
Traditional RAG:
[Documents] → [Chunks] → [Vectors] → [Similarity Search] → [LLM]

GraphRAG:
[Documents] → [Entity Extraction] → [Knowledge Graph] → [Graph Traversal] → [LLM]
```

## Building a Knowledge Graph

### Entity and Relationship Extraction

```python
from azure.ai.foundry import AIFoundryClient
import networkx as nx

class KnowledgeGraphBuilder:
    def __init__(self, llm_client):
        self.llm = llm_client
        self.graph = nx.DiGraph()

    async def extract_from_text(self, text: str, source: str) -> dict:
        """Extract entities and relationships from text."""

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "user",
                "content": f"""Extract entities and relationships from this text.

                Text:
                {text}

                Return as JSON:
                {{
                    "entities": [
                        {{"name": "Entity Name", "type": "Person|Organization|Technology|Concept|Event", "description": "brief description"}}
                    ],
                    "relationships": [
                        {{"source": "Entity1", "target": "Entity2", "type": "relationship_type", "description": "relationship description"}}
                    ]
                }}

                Focus on:
                - Key concepts and their definitions
                - Technologies and their relationships
                - Organizations and people
                - Processes and their components"""
            }]
        )

        extraction = json.loads(response.choices[0].message.content)
        self._add_to_graph(extraction, source)
        return extraction

    def _add_to_graph(self, extraction: dict, source: str):
        """Add extracted knowledge to graph."""
        # Add entities as nodes
        for entity in extraction["entities"]:
            self.graph.add_node(
                entity["name"],
                type=entity["type"],
                description=entity["description"],
                sources=[source]
            )

        # Add relationships as edges
        for rel in extraction["relationships"]:
            self.graph.add_edge(
                rel["source"],
                rel["target"],
                type=rel["type"],
                description=rel["description"],
                source=source
            )

    async def build_from_documents(self, documents: list[dict]) -> nx.DiGraph:
        """Build knowledge graph from multiple documents."""
        for doc in documents:
            # Process in chunks if document is long
            chunks = self._chunk_text(doc["content"], max_tokens=2000)
            for chunk in chunks:
                await self.extract_from_text(chunk, doc["source"])

        # Merge similar entities
        self._merge_entities()

        return self.graph

    def _merge_entities(self):
        """Merge entities that refer to the same thing."""
        # Use embeddings to find similar entity names
        # Merge nodes and combine their edges
        pass
```

### Graph Storage with Azure Cosmos DB

```python
from azure.cosmos import CosmosClient, PartitionKey

class GraphStore:
    def __init__(self, cosmos_client: CosmosClient, database: str):
        self.db = cosmos_client.get_database_client(database)
        self.nodes = self.db.get_container_client("nodes")
        self.edges = self.db.get_container_client("edges")

    def save_graph(self, graph: nx.DiGraph):
        """Persist graph to Cosmos DB."""
        # Save nodes
        for node, attrs in graph.nodes(data=True):
            self.nodes.upsert_item({
                "id": self._node_id(node),
                "name": node,
                "partitionKey": attrs.get("type", "unknown"),
                **attrs
            })

        # Save edges
        for source, target, attrs in graph.edges(data=True):
            self.edges.upsert_item({
                "id": f"{self._node_id(source)}-{self._node_id(target)}",
                "source": source,
                "target": target,
                "partitionKey": attrs.get("type", "unknown"),
                **attrs
            })

    def query_subgraph(self, entity: str, depth: int = 2) -> nx.DiGraph:
        """Query subgraph around an entity."""
        # Start with the entity
        visited = {entity}
        to_visit = [entity]

        subgraph = nx.DiGraph()

        for _ in range(depth):
            next_level = []
            for current in to_visit:
                # Get node
                node_data = self._get_node(current)
                if node_data:
                    subgraph.add_node(current, **node_data)

                # Get connected edges
                edges = self._get_edges(current)
                for edge in edges:
                    subgraph.add_edge(edge["source"], edge["target"], **edge)
                    neighbor = edge["target"] if edge["source"] == current else edge["source"]
                    if neighbor not in visited:
                        visited.add(neighbor)
                        next_level.append(neighbor)

            to_visit = next_level

        return subgraph

    def _node_id(self, name: str) -> str:
        return name.lower().replace(" ", "_")
```

## Graph-Based Retrieval

### Entity-Centric Retrieval

```python
class GraphRAGRetriever:
    def __init__(self, graph_store: GraphStore, llm_client, embedding_model):
        self.graph_store = graph_store
        self.llm = llm_client
        self.embedder = embedding_model

    async def retrieve(self, query: str, max_entities: int = 5, depth: int = 2) -> dict:
        """Retrieve relevant subgraph for a query."""

        # Step 1: Extract entities from query
        query_entities = await self._extract_query_entities(query)

        # Step 2: Find matching entities in graph
        matched_entities = await self._match_entities(query_entities)

        # Step 3: Retrieve subgraphs around matched entities
        subgraphs = []
        for entity in matched_entities[:max_entities]:
            subgraph = self.graph_store.query_subgraph(entity, depth)
            subgraphs.append(subgraph)

        # Step 4: Merge subgraphs
        merged = self._merge_subgraphs(subgraphs)

        # Step 5: Convert to context
        context = self._graph_to_context(merged)

        return {
            "query_entities": query_entities,
            "matched_entities": matched_entities,
            "graph": merged,
            "context": context
        }

    async def _extract_query_entities(self, query: str) -> list[str]:
        """Extract entity mentions from query."""
        response = await self.llm.chat.complete_async(
            deployment="gpt-4o-mini",
            messages=[{
                "role": "user",
                "content": f"""Extract key entities (concepts, technologies, organizations) from this query:
                Query: {query}

                Return as JSON array: ["entity1", "entity2", ...]"""
            }]
        )
        return json.loads(response.choices[0].message.content)

    async def _match_entities(self, query_entities: list[str]) -> list[str]:
        """Find matching entities in graph using embeddings."""
        # Get all entity names from graph
        graph_entities = self.graph_store.get_all_entity_names()

        # Embed query entities
        query_embeddings = self.embedder.embed(query_entities)

        # Embed graph entities
        graph_embeddings = self.embedder.embed(graph_entities)

        # Find best matches
        matches = []
        for i, qe in enumerate(query_entities):
            similarities = [
                (ge, cosine_similarity(query_embeddings[i], graph_embeddings[j]))
                for j, ge in enumerate(graph_entities)
            ]
            similarities.sort(key=lambda x: x[1], reverse=True)
            if similarities and similarities[0][1] > 0.7:  # Threshold
                matches.append(similarities[0][0])

        return matches

    def _graph_to_context(self, graph: nx.DiGraph) -> str:
        """Convert graph to textual context for LLM."""
        lines = ["Relevant Knowledge:\n"]

        # Add entity descriptions
        lines.append("Entities:")
        for node, attrs in graph.nodes(data=True):
            desc = attrs.get("description", "")
            node_type = attrs.get("type", "")
            lines.append(f"- {node} ({node_type}): {desc}")

        # Add relationships
        lines.append("\nRelationships:")
        for source, target, attrs in graph.edges(data=True):
            rel_type = attrs.get("type", "related to")
            desc = attrs.get("description", "")
            lines.append(f"- {source} {rel_type} {target}: {desc}")

        return "\n".join(lines)
```

## Community Detection for Summarization

GraphRAG can use community detection for hierarchical summarization:

```python
import community as community_louvain

class CommunityRAG:
    def __init__(self, graph: nx.DiGraph, llm_client):
        self.graph = graph.to_undirected()
        self.llm = llm_client
        self.communities = None
        self.summaries = {}

    def detect_communities(self):
        """Detect communities in the knowledge graph."""
        self.communities = community_louvain.best_partition(self.graph)
        return self.communities

    async def summarize_communities(self):
        """Generate summaries for each community."""
        # Group nodes by community
        community_nodes = {}
        for node, comm_id in self.communities.items():
            if comm_id not in community_nodes:
                community_nodes[comm_id] = []
            community_nodes[comm_id].append(node)

        # Summarize each community
        for comm_id, nodes in community_nodes.items():
            subgraph = self.graph.subgraph(nodes)
            context = self._graph_to_text(subgraph)

            response = await self.llm.chat.complete_async(
                deployment="gpt-4o",
                messages=[{
                    "role": "user",
                    "content": f"""Summarize this knowledge cluster in 2-3 sentences:

                    {context}

                    Focus on the main theme and key relationships."""
                }]
            )

            self.summaries[comm_id] = {
                "nodes": nodes,
                "summary": response.choices[0].message.content
            }

        return self.summaries

    async def answer_global_query(self, query: str) -> str:
        """Answer queries that span multiple topics using community summaries."""
        # Use summaries for broad context
        summaries_text = "\n".join([
            f"Topic {i}: {s['summary']}"
            for i, s in self.summaries.items()
        ])

        response = await self.llm.chat.complete_async(
            deployment="gpt-4o",
            messages=[{
                "role": "system",
                "content": f"Use this knowledge base overview:\n{summaries_text}"
            }, {
                "role": "user",
                "content": query
            }]
        )

        return response.choices[0].message.content
```

## When to Use GraphRAG

| Use Case | Traditional RAG | GraphRAG |
|----------|----------------|----------|
| Factual Q&A | Good | Better |
| Multi-hop reasoning | Poor | Excellent |
| Relationship queries | Poor | Excellent |
| Global summarization | Poor | Good |
| Sparse topics | Good | May lack coverage |

GraphRAG excels when:
- Questions require connecting multiple concepts
- Understanding relationships is key
- You need to trace reasoning paths
- Documents have rich interconnected concepts

Invest in GraphRAG when your use case demands deeper understanding beyond surface-level text matching.
