---
title: "Entity Extraction at Scale with LLMs"
description: "Entity extraction at scale transforms unstructured text into structured knowledge. Combining LLM intelligence with distributed processing enables insights…"
author: Michael John Pena
draft: false
date: 2023-04-25
tags:
  - AI
  - NLP
  - Entity Extraction
  - Data Engineering
  - LLM
---

## Scalable Entity Extraction Pipeline

```python
from pyspark.sql import SparkSession
from pyspark.sql.functions import *
from pyspark.sql.types import *
import json
from dataclasses import dataclass
from typing import List, Optional

@dataclass
class ExtractedEntity:
    text: str
    entity_type: str
    confidence: float
    start_pos: int
    end_pos: int
    metadata: Optional[dict] = None

class ScalableEntityExtractor:
    """Distributed entity extraction with LLMs."""

    def __init__(self, spark: SparkSession, llm_client):
        self.spark = spark
        self.client = llm_client

    async def extract_entities_batch(
        self,
        texts: List[str],
        entity_types: List[str],
        batch_size: int = 10
    ) -> List[List[ExtractedEntity]]:
        """Extract entities from multiple texts."""

        results = []

        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            batch_results = await self._process_batch(batch, entity_types)
            results.extend(batch_results)

        return results

    async def _process_batch(
        self,
        texts: List[str],
        entity_types: List[str]
    ) -> List[List[ExtractedEntity]]:
        """Process a batch of texts."""

        texts_formatted = "\n---\n".join([
            f"[TEXT {i}]: {text}"
            for i, text in enumerate(texts)
        ])

        prompt = f"""Extract named entities from these texts.

Entity Types to Extract: {', '.join(entity_types)}

Texts:
{texts_formatted}

For each text, extract entities with:
- text: the entity text
- entity_type: type from the list above
- confidence: 0.0-1.0
- start_pos: character position
- end_pos: character position

Return as JSON: {{"text_0": [...], "text_1": [...], ...}}"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        try:
            parsed = json.loads(response.content)
            results = []
            for i in range(len(texts)):
                entities = parsed.get(f"text_{i}", [])
                results.append([
                    ExtractedEntity(**e) for e in entities
                ])
            return results
        except:
            return [[] for _ in texts]

    def extract_with_spark(
        self,
        df,
        text_col: str,
        entity_types: List[str],
        output_col: str = "entities"
    ):
        """Extract entities using Spark UDF."""

        # Define schema for entities
        entity_schema = ArrayType(StructType([
            StructField("text", StringType()),
            StructField("entity_type", StringType()),
            StructField("confidence", DoubleType()),
            StructField("start_pos", IntegerType()),
            StructField("end_pos", IntegerType())
        ]))

        # Create extraction UDF (simplified - actual impl needs async handling)
        @udf(entity_schema)
        def extract_entities(text):
            # In practice, this would call the LLM service
            # Using placeholder for demonstration
            return []

        return df.withColumn(output_col, extract_entities(col(text_col)))

    def extract_with_cognitive_services(
        self,
        df,
        text_col: str,
        output_col: str = "entities"
    ):
        """Extract entities using Azure Cognitive Services."""
        from synapse.ml.cognitive import NER

        ner = (NER()
            .setTextCol(text_col)
            .setOutputCol(output_col)
            .setErrorCol("ner_error"))

        return ner.transform(df)
```

## Domain-Specific Entity Extraction

```python
class DomainEntityExtractor:
    """Extract domain-specific entities."""

    def __init__(self, llm_client, domain: str):
        self.client = llm_client
        self.domain = domain
        self.entity_definitions = self._load_domain_definitions()

    def _load_domain_definitions(self) -> dict:
        """Load entity definitions for domain."""
        domains = {
            "healthcare": {
                "entities": [
                    "MEDICATION", "DOSAGE", "CONDITION", "PROCEDURE",
                    "ANATOMY", "SYMPTOM", "PROVIDER", "FACILITY"
                ],
                "examples": {
                    "MEDICATION": ["aspirin", "metformin", "lisinopril"],
                    "CONDITION": ["diabetes", "hypertension", "asthma"]
                }
            },
            "finance": {
                "entities": [
                    "COMPANY", "TICKER", "AMOUNT", "CURRENCY",
                    "DATE", "PERCENTAGE", "FINANCIAL_METRIC", "TRANSACTION"
                ],
                "examples": {
                    "TICKER": ["AAPL", "GOOGL", "MSFT"],
                    "FINANCIAL_METRIC": ["revenue", "EBITDA", "P/E ratio"]
                }
            },
            "legal": {
                "entities": [
                    "PERSON", "ORGANIZATION", "CASE_NUMBER", "COURT",
                    "DATE", "STATUTE", "JURISDICTION", "LEGAL_TERM"
                ],
                "examples": {
                    "COURT": ["Supreme Court", "District Court"],
                    "LEGAL_TERM": ["plaintiff", "defendant", "jurisdiction"]
                }
            }
        }
        return domains.get(self.domain, {"entities": [], "examples": {}})

    async def extract_domain_entities(
        self,
        text: str,
        include_relationships: bool = False
    ) -> dict:
        """Extract domain-specific entities."""

        entities = self.entity_definitions["entities"]
        examples = json.dumps(self.entity_definitions["examples"], indent=2)

        prompt = f"""Extract {self.domain} domain entities from this text.

Text:
{text}

Entity Types:
{', '.join(entities)}

Examples:
{examples}

Extract all entities with:
- text: exact text
- type: entity type
- normalized: normalized form (if applicable)
- confidence: 0.0-1.0
- context: surrounding context

{'Also extract relationships between entities.' if include_relationships else ''}

Return as JSON with 'entities' array{' and "relationships" array' if include_relationships else ''}."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        return json.loads(response.content)

    async def extract_medical_entities(self, clinical_note: str) -> dict:
        """Extract medical entities from clinical notes."""

        prompt = f"""Extract medical entities from this clinical note.

Clinical Note:
{clinical_note}

Extract:
1. MEDICATIONS: drug names, dosages, frequencies, routes
2. CONDITIONS: diagnoses, symptoms, medical history
3. PROCEDURES: surgeries, tests, treatments
4. ANATOMY: body parts, organs mentioned
5. MEASUREMENTS: vital signs, lab values
6. PROVIDERS: doctors, nurses, specialists
7. TEMPORAL: dates, durations, frequencies

Also identify:
- Negations (e.g., "no fever" means fever is negated)
- Uncertainties (e.g., "possible pneumonia")
- Historical vs current

Return as structured JSON."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        return json.loads(response.content)

    async def extract_financial_entities(self, document: str) -> dict:
        """Extract financial entities from documents."""

        prompt = f"""Extract financial entities from this document.

Document:
{document}

Extract:
1. COMPANIES: company names with tickers if mentioned
2. AMOUNTS: monetary values with currencies
3. DATES: relevant dates and time periods
4. METRICS: financial metrics (revenue, profit, etc.)
5. EVENTS: earnings, acquisitions, IPOs, etc.
6. PERCENTAGES: growth rates, changes, ratios
7. ANALYSTS: names of analysts or firms

Also extract:
- Sentiment towards companies (positive/negative/neutral)
- Forward-looking statements
- Risk factors mentioned

Return as structured JSON."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        return json.loads(response.content)
```

## Entity Linking and Resolution

```python
class EntityLinker:
    """Link extracted entities to knowledge bases."""

    def __init__(self, llm_client, spark: SparkSession):
        self.client = llm_client
        self.spark = spark
        self.entity_cache = {}

    async def link_entities(
        self,
        entities: List[ExtractedEntity],
        knowledge_base: str = "wikidata"
    ) -> List[dict]:
        """Link entities to knowledge base entries."""

        linked_entities = []

        for entity in entities:
            # Check cache first
            cache_key = f"{entity.text}:{entity.entity_type}"
            if cache_key in self.entity_cache:
                linked_entities.append(self.entity_cache[cache_key])
                continue

            # Query for linking
            prompt = f"""Link this entity to {knowledge_base}.

Entity: {entity.text}
Type: {entity.entity_type}

Provide:
- canonical_name: standardized name
- kb_id: {knowledge_base} identifier (if known)
- aliases: other known names
- description: brief description
- confidence: 0.0-1.0

Return as JSON."""

            response = await self.client.chat_completion(
                model="gpt-4",
                messages=[{"role": "user", "content": prompt}],
                temperature=0
            )

            linked = json.loads(response.content)
            linked["original"] = entity.__dict__
            linked_entities.append(linked)

            # Cache result
            self.entity_cache[cache_key] = linked

        return linked_entities

    async def resolve_coreferences(
        self,
        text: str,
        entities: List[dict]
    ) -> dict:
        """Resolve coreferences in text."""

        entities_str = json.dumps(entities, indent=2)

        prompt = f"""Resolve coreferences in this text.

Text:
{text}

Extracted Entities:
{entities_str}

Identify:
1. Pronouns referring to entities (he, she, it, they)
2. Definite descriptions referring to entities (the company, the CEO)
3. Abbreviated references

Return as JSON with:
- coreference_chains: groups of mentions referring to same entity
- resolved_text: text with coreferences replaced by entity names"""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)

    async def deduplicate_entities(
        self,
        entities: List[dict]
    ) -> List[dict]:
        """Deduplicate and merge similar entities."""

        prompt = f"""Deduplicate these entities.

Entities:
{json.dumps(entities, indent=2)}

Group entities that refer to the same real-world entity.
For each group, create a merged entity with:
- canonical_name: best name to use
- all_mentions: list of all text mentions
- merged_metadata: combined metadata
- mention_count: number of mentions

Return as JSON array of merged entities."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)
```

## Relationship Extraction

```python
class RelationshipExtractor:
    """Extract relationships between entities."""

    def __init__(self, llm_client):
        self.client = llm_client

    async def extract_relationships(
        self,
        text: str,
        entities: List[dict],
        relationship_types: List[str] = None
    ) -> List[dict]:
        """Extract relationships between entities."""

        default_types = [
            "WORKS_FOR", "LOCATED_IN", "OWNS", "PRODUCES",
            "PART_OF", "FOUNDED_BY", "ACQUIRED", "COMPETES_WITH"
        ]
        rel_types = relationship_types or default_types

        prompt = f"""Extract relationships between entities in this text.

Text:
{text}

Entities:
{json.dumps(entities, indent=2)}

Relationship Types: {', '.join(rel_types)}

For each relationship provide:
- subject: source entity
- predicate: relationship type
- object: target entity
- confidence: 0.0-1.0
- evidence: text supporting the relationship

Return as JSON array of relationships."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}],
            temperature=0
        )

        return json.loads(response.content)

    async def build_knowledge_graph(
        self,
        documents: List[str]
    ) -> dict:
        """Build knowledge graph from documents."""

        all_entities = []
        all_relationships = []

        for doc in documents:
            # Extract entities
            entities = await self._extract_entities(doc)
            all_entities.extend(entities)

            # Extract relationships
            relationships = await self.extract_relationships(doc, entities)
            all_relationships.extend(relationships)

        # Deduplicate and merge
        linker = EntityLinker(self.client, None)
        merged_entities = await linker.deduplicate_entities(all_entities)

        return {
            "nodes": merged_entities,
            "edges": all_relationships,
            "document_count": len(documents)
        }

    async def extract_events(
        self,
        text: str
    ) -> List[dict]:
        """Extract events and their participants."""

        prompt = f"""Extract events from this text.

Text:
{text}

For each event identify:
- event_type: what kind of event
- trigger: word/phrase indicating the event
- participants: entities involved with their roles
- time: when it happened (if mentioned)
- location: where it happened (if mentioned)
- outcome: result of the event (if mentioned)

Return as JSON array of events."""

        response = await self.client.chat_completion(
            model="gpt-4",
            messages=[{"role": "user", "content": prompt}]
        )

        return json.loads(response.content)
```

## Production Pipeline

```python
class ProductionEntityPipeline:
    """Production-ready entity extraction pipeline."""

    def __init__(self, spark: SparkSession, llm_client, config: dict):
        self.spark = spark
        self.client = llm_client
        self.config = config

        self.extractor = ScalableEntityExtractor(spark, llm_client)
        self.domain_extractor = DomainEntityExtractor(
            llm_client, config.get("domain", "general")
        )
        self.linker = EntityLinker(llm_client, spark)

    def process_documents(
        self,
        input_table: str,
        output_table: str,
        text_column: str
    ):
        """Process documents end-to-end."""

        # Read input
        df = self.spark.table(input_table)

        # Extract entities using Cognitive Services for scale
        df_with_entities = self.extractor.extract_with_cognitive_services(
            df, text_column
        )

        # Flatten entities
        df_flattened = df_with_entities.select(
            "*",
            explode(col("entities")).alias("entity")
        ).select(
            "*",
            col("entity.text").alias("entity_text"),
            col("entity.category").alias("entity_type"),
            col("entity.confidenceScore").alias("confidence")
        )

        # Write to Delta table
        df_flattened.write \
            .format("delta") \
            .mode("overwrite") \
            .saveAsTable(output_table)

        return df_flattened.count()

    async def enrich_entities(
        self,
        entity_table: str,
        enriched_table: str
    ):
        """Enrich extracted entities with linking."""

        # Read entities
        df = self.spark.table(entity_table)
        entities = df.select("entity_text", "entity_type").distinct().collect()

        # Link entities
        entity_list = [
            ExtractedEntity(
                text=e.entity_text,
                entity_type=e.entity_type,
                confidence=1.0,
                start_pos=0,
                end_pos=len(e.entity_text)
            )
            for e in entities
        ]

        linked = await self.linker.link_entities(entity_list)

        # Convert to DataFrame and save
        linked_df = self.spark.createDataFrame(linked)
        linked_df.write \
            .format("delta") \
            .mode("overwrite") \
            .saveAsTable(enriched_table)

# Usage
pipeline = ProductionEntityPipeline(
    spark, llm_client,
    {"domain": "finance"}
)

# Process documents
count = pipeline.process_documents(
    input_table="bronze.financial_reports",
    output_table="silver.report_entities",
    text_column="report_text"
)
print(f"Extracted entities from {count} documents")
```

Entity extraction at scale transforms unstructured text into structured knowledge. Combining LLM intelligence with distributed processing enables insights from document collections of any size.
