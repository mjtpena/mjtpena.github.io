---
title: "Semantic Memory for AI Agents: Knowledge Representation"
author: Michael John Peña
draft: false
date: 2024-07-22
tags:
  - AI
  - Agents
  - Memory
  - Knowledge Graph
  - Semantic

---

I wrote "Semantic Memory for AI Agents: Knowledge Representation" to share practical, production-minded guidance on this topic.

## Semantic vs Episodic Memory

| Aspect | Semantic Memory | Episodic Memory |
|--------|-----------------|-----------------|
| Content | Facts, concepts, relationships | Events, experiences |
| Context | Context-free | Time and place specific |
| Example | "Python is a programming language" | "User asked about Python yesterday" |
| Use | General knowledge | Personal experiences |

## Knowledge Representation

```python
from dataclasses import dataclass
from typing import Optional
from enum import Enum

class RelationType(Enum):
    IS_A = "is_a"               # Inheritance
    HAS = "has"                 # Composition
    RELATED_TO = "related_to"  # General relation
    USED_FOR = "used_for"       # Purpose
    PART_OF = "part_of"         # Part-whole
    CREATED_BY = "created_by"   # Authorship
    DEPENDS_ON = "depends_on"   # Dependency

@dataclass
class Concept:
    id: str
    name: str
    definition: str
    category: str
    properties: dict
    examples: list[str]
    embedding: list[float] = None

@dataclass
class Relation:
    source_id: str
    target_id: str
    relation_type: RelationType
    confidence: float
    metadata: dict = None

@dataclass
class Fact:
    id: str
    subject: str
    predicate: str
    object: str
    confidence: float
    source: str
    embedding: list[float] = None
```

## Semantic Memory Store

```python
from langchain_openai import AzureOpenAIEmbeddings
import uuid
import json

class SemanticMemoryStore:
    def __init__(self, storage_client, embeddings: AzureOpenAIEmbeddings):
        self.storage = storage_client
        self.embeddings = embeddings
        self.concepts = {}
        self.relations = []
        self.facts = []

    def add_concept(
        self,
        name: str,
        definition: str,
        category: str,
        properties: dict = None,
        examples: list[str] = None
    ) -> str:
        """Add a concept to semantic memory."""
        concept_id = str(uuid.uuid4())

        # Generate embedding from definition
        embedding = self.embeddings.embed_query(f"{name}: {definition}")

        concept = Concept(
            id=concept_id,
            name=name,
            definition=definition,
            category=category,
            properties=properties or {},
            examples=examples or [],
            embedding=embedding
        )

        self.concepts[concept_id] = concept
        self._persist_concept(concept)

        return concept_id

    def add_relation(
        self,
        source_name: str,
        target_name: str,
        relation_type: RelationType,
        confidence: float = 1.0
    ) -> bool:
        """Add a relation between concepts."""
        source = self._find_concept_by_name(source_name)
        target = self._find_concept_by_name(target_name)

        if not source or not target:
            return False

        relation = Relation(
            source_id=source.id,
            target_id=target.id,
            relation_type=relation_type,
            confidence=confidence
        )

        self.relations.append(relation)
        self._persist_relation(relation)

        return True

    def add_fact(
        self,
        subject: str,
        predicate: str,
        obj: str,
        confidence: float = 1.0,
        source: str = "user"
    ) -> str:
        """Add a fact to semantic memory."""
        fact_id = str(uuid.uuid4())

        # Generate embedding
        fact_text = f"{subject} {predicate} {obj}"
        embedding = self.embeddings.embed_query(fact_text)

        fact = Fact(
            id=fact_id,
            subject=subject,
            predicate=predicate,
            object=obj,
            confidence=confidence,
            source=source,
            embedding=embedding
        )

        self.facts.append(fact)
        self._persist_fact(fact)

        return fact_id

    def query_concepts(self, query: str, k: int = 5) -> list[Concept]:
        """Find concepts related to query."""
        query_embedding = self.embeddings.embed_query(query)

        # Vector similarity search
        similarities = []
        for concept in self.concepts.values():
            if concept.embedding:
                sim = self._cosine_similarity(query_embedding, concept.embedding)
                similarities.append((concept, sim))

        similarities.sort(key=lambda x: x[1], reverse=True)
        return [c for c, _ in similarities[:k]]

    def query_facts(self, query: str, k: int = 5) -> list[Fact]:
        """Find facts related to query."""
        query_embedding = self.embeddings.embed_query(query)

        similarities = []
        for fact in self.facts:
            if fact.embedding:
                sim = self._cosine_similarity(query_embedding, fact.embedding)
                similarities.append((fact, sim))

        similarities.sort(key=lambda x: x[1], reverse=True)
        return [f for f, _ in similarities[:k]]

    def get_related_concepts(self, concept_name: str) -> dict:
        """Get all concepts related to a given concept."""
        concept = self._find_concept_by_name(concept_name)
        if not concept:
            return {}

        related = {"parents": [], "children": [], "related": []}

        for rel in self.relations:
            if rel.source_id == concept.id:
                target = self.concepts.get(rel.target_id)
                if target:
                    if rel.relation_type == RelationType.IS_A:
                        related["parents"].append(target.name)
                    else:
                        related["related"].append((target.name, rel.relation_type.value))

            elif rel.target_id == concept.id:
                source = self.concepts.get(rel.source_id)
                if source:
                    if rel.relation_type == RelationType.IS_A:
                        related["children"].append(source.name)
                    else:
                        related["related"].append((source.name, rel.relation_type.value))

        return related

    def _find_concept_by_name(self, name: str) -> Optional[Concept]:
        for concept in self.concepts.values():
            if concept.name.lower() == name.lower():
                return concept
        return None

    def _cosine_similarity(self, a: list[float], b: list[float]) -> float:
        import numpy as np
        a, b = np.array(a), np.array(b)
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))

    def _persist_concept(self, concept: Concept):
        self.storage.save(f"concept:{concept.id}", concept.__dict__)

    def _persist_relation(self, relation: Relation):
        self.storage.append("relations", relation.__dict__)

    def _persist_fact(self, fact: Fact):
        self.storage.save(f"fact:{fact.id}", fact.__dict__)
```

## Knowledge Extraction

```python
from langchain_openai import AzureChatOpenAI

class KnowledgeExtractor:
    def __init__(self, memory: SemanticMemoryStore):
        self.memory = memory
        self.llm = AzureChatOpenAI(azure_deployment="gpt-4o")

    def extract_from_text(self, text: str) -> dict:
        """Extract concepts and facts from text."""
        prompt = f"""
Extract knowledge from this text:

{text}

Return JSON:
{{
  "concepts": [
    {{"name": "...", "definition": "...", "category": "..."}}
  ],
  "facts": [
    {{"subject": "...", "predicate": "...", "object": "..."}}
  ],
  "relations": [
    {{"source": "...", "target": "...", "type": "is_a|has|related_to|used_for|part_of"}}
  ]
}}
"""

        response = self.llm.invoke(prompt)

        try:
            extracted = json.loads(response.content)
        except:
            return {"concepts": [], "facts": [], "relations": []}

        # Store extracted knowledge
        stored = {"concepts": [], "facts": [], "relations": []}

        for concept in extracted.get("concepts", []):
            try:
                cid = self.memory.add_concept(
                    name=concept["name"],
                    definition=concept["definition"],
                    category=concept.get("category", "general")
                )
                stored["concepts"].append(cid)
            except:
                pass

        for fact in extracted.get("facts", []):
            try:
                fid = self.memory.add_fact(
                    subject=fact["subject"],
                    predicate=fact["predicate"],
                    obj=fact["object"],
                    source="extraction"
                )
                stored["facts"].append(fid)
            except:
                pass

        for rel in extracted.get("relations", []):
            try:
                rel_type = RelationType(rel["type"])
                self.memory.add_relation(
                    source_name=rel["source"],
                    target_name=rel["target"],
                    relation_type=rel_type
                )
                stored["relations"].append(rel)
            except:
                pass

        return stored

    def learn_from_conversation(self, messages: list[dict]) -> dict:
        """Extract knowledge from conversation."""
        conversation_text = "\n".join(
            f"{m['role']}: {m['content']}"
            for m in messages
        )

        return self.extract_from_text(conversation_text)
```

## Semantic Query Engine

```python
class SemanticQueryEngine:
    def __init__(self, memory: SemanticMemoryStore):
        self.memory = memory
        self.llm = AzureChatOpenAI(azure_deployment="gpt-4o")

    def answer_question(self, question: str) -> str:
        """Answer question using semantic memory."""
        # Find relevant concepts
        concepts = self.memory.query_concepts(question, k=3)

        # Find relevant facts
        facts = self.memory.query_facts(question, k=5)

        # Build context
        context_parts = []

        if concepts:
            concepts_text = "\n".join(
                f"- {c.name}: {c.definition}"
                for c in concepts
            )
            context_parts.append(f"Relevant concepts:\n{concepts_text}")

        if facts:
            facts_text = "\n".join(
                f"- {f.subject} {f.predicate} {f.object}"
                for f in facts
            )
            context_parts.append(f"Relevant facts:\n{facts_text}")

        context = "\n\n".join(context_parts)

        prompt = f"""
Answer this question using only the provided knowledge:

Knowledge:
{context}

Question: {question}

If the knowledge doesn't contain the answer, say "I don't have that information."
"""

        response = self.llm.invoke(prompt)
        return response.content

    def explain_concept(self, concept_name: str) -> str:
        """Provide detailed explanation of a concept."""
        concept = self.memory._find_concept_by_name(concept_name)

        if not concept:
            return f"I don't have information about '{concept_name}'."

        # Get related concepts
        related = self.memory.get_related_concepts(concept_name)

        # Get relevant facts
        facts = self.memory.query_facts(concept_name, k=5)

        explanation = f"""
**{concept.name}**

{concept.definition}

Category: {concept.category}
"""

        if concept.properties:
            props = "\n".join(f"- {k}: {v}" for k, v in concept.properties.items())
            explanation += f"\n\nProperties:\n{props}"

        if concept.examples:
            examples = "\n".join(f"- {e}" for e in concept.examples)
            explanation += f"\n\nExamples:\n{examples}"

        if related["parents"]:
            explanation += f"\n\nIs a type of: {', '.join(related['parents'])}"

        if related["children"]:
            explanation += f"\n\nTypes include: {', '.join(related['children'])}"

        if facts:
            facts_text = "\n".join(
                f"- {f.subject} {f.predicate} {f.object}"
                for f in facts[:3]
            )
            explanation += f"\n\nRelated facts:\n{facts_text}"

        return explanation

    def find_connections(self, concept1: str, concept2: str) -> str:
        """Find connections between two concepts."""
        c1 = self.memory._find_concept_by_name(concept1)
        c2 = self.memory._find_concept_by_name(concept2)

        if not c1 or not c2:
            return "One or both concepts not found."

        # Direct relations
        direct = []
        for rel in self.memory.relations:
            if (rel.source_id == c1.id and rel.target_id == c2.id) or \
               (rel.source_id == c2.id and rel.target_id == c1.id):
                direct.append(rel)

        # Find common related concepts
        r1 = self.memory.get_related_concepts(concept1)
        r2 = self.memory.get_related_concepts(concept2)

        all_r1 = set(r1["parents"] + r1["children"] + [r[0] for r in r1["related"]])
        all_r2 = set(r2["parents"] + r2["children"] + [r[0] for r in r2["related"]])

        common = all_r1 & all_r2

        result = f"Connections between {concept1} and {concept2}:\n\n"

        if direct:
            result += "Direct relations:\n"
            for rel in direct:
                result += f"- {rel.relation_type.value}\n"

        if common:
            result += f"\nCommon connections: {', '.join(common)}\n"

        if not direct and not common:
            result += "No direct connections found."

        return result
```

## Building Domain Knowledge

```python
class DomainKnowledgeBuilder:
    def __init__(self, memory: SemanticMemoryStore, extractor: KnowledgeExtractor):
        self.memory = memory
        self.extractor = extractor

    def build_azure_data_knowledge(self):
        """Build knowledge base for Azure Data platform."""

        # Add core concepts
        self.memory.add_concept(
            name="Azure Synapse Analytics",
            definition="An enterprise analytics service that brings together big data and data warehousing",
            category="Azure Service",
            properties={"type": "PaaS", "workloads": ["SQL", "Spark", "Pipelines"]},
            examples=["Running SQL queries on petabytes of data", "Building data pipelines"]
        )

        self.memory.add_concept(
            name="Microsoft Fabric",
            definition="An all-in-one analytics solution for enterprises that covers everything from data movement to data science",
            category="Azure Service",
            properties={"type": "SaaS", "components": ["OneLake", "Power BI", "Data Factory"]},
            examples=["Unified lakehouse architecture", "Real-time analytics"]
        )

        self.memory.add_concept(
            name="Azure Data Factory",
            definition="A cloud-based data integration service that allows creating data-driven workflows",
            category="Azure Service",
            properties={"type": "PaaS", "purpose": "ETL/ELT"},
            examples=["Copying data from on-premises to cloud", "Data transformation pipelines"]
        )

        # Add relations
        self.memory.add_relation(
            "Microsoft Fabric", "Azure Synapse Analytics",
            RelationType.RELATED_TO
        )

        self.memory.add_relation(
            "Azure Data Factory", "Microsoft Fabric",
            RelationType.PART_OF
        )

        # Add facts
        self.memory.add_fact(
            subject="Microsoft Fabric",
            predicate="was announced at",
            obj="Microsoft Build 2023",
            source="official"
        )

        self.memory.add_fact(
            subject="Azure Synapse Analytics",
            predicate="supports",
            obj="T-SQL and Apache Spark",
            source="documentation"
        )

    def import_from_documentation(self, doc_url: str):
        """Import knowledge from documentation."""
        # Fetch and extract from documentation
        # This would integrate with documentation scraping
        pass
```

## Best Practices

1. **Structure knowledge clearly**: Concepts, facts, relations
2. **Use embeddings for retrieval**: Enable semantic search
3. **Track confidence and sources**: Know where knowledge came from
4. **Build domain-specific bases**: Focus on relevant knowledge
5. **Update and maintain**: Knowledge becomes stale

## Conclusion

Semantic memory gives agents persistent knowledge that transcends individual conversations. By structuring facts and concepts with relationships, agents can reason about their domain effectively.

Build your knowledge base deliberately, update it as the domain evolves, and use it to provide informed, contextual responses.

