---
title: "Knowledge Store in Azure Cognitive Search"
description: "Knowledge Store enables rich analytics and knowledge graph construction from AI-enriched content."
author: "Michael John Peña"
draft: false
date: 2022-08-26
tags: ["Azure", "Cognitive Search", "Knowledge Store", "AI Enrichment", "Data"]
---

## Understanding Knowledge Store

Knowledge Store allows you to:
- Persist enriched data to blob storage or tables
- Create projections of your data in different shapes
- Build knowledge graphs from extracted entities
- Enable analytics on enriched content

## Creating a Knowledge Store

```python
from azure.search.documents.indexes import SearchIndexerClient
from azure.search.documents.indexes.models import (
    SearchIndexerDataSourceConnection,
    SearchIndexerDataContainer,
    SearchIndexer,
    SearchIndexerSkillset,
    EntityRecognitionSkill,
    KeyPhraseExtractionSkill,
    SentimentSkill,
    OcrSkill,
    ImageAnalysisSkill,
    KnowledgeStore,
    KnowledgeStoreProjection,
    KnowledgeStoreTableProjectionSelector,
    KnowledgeStoreBlobProjectionSelector,
    KnowledgeStoreFileProjectionSelector
)
from azure.core.credentials import AzureKeyCredential

endpoint = "https://mysearchservice.search.windows.net"
credential = AzureKeyCredential("your-admin-key")

indexer_client = SearchIndexerClient(endpoint=endpoint, credential=credential)

# Define knowledge store
knowledge_store = KnowledgeStore(
    storage_connection_string="DefaultEndpointsProtocol=https;AccountName=...",
    projections=[
        KnowledgeStoreProjection(
            # Table projections
            tables=[
                KnowledgeStoreTableProjectionSelector(
                    table_name="Documents",
                    reference_key_name="DocumentId",
                    generated_key_name="DocumentKey",
                    source="/document",
                    inputs=[]
                ),
                KnowledgeStoreTableProjectionSelector(
                    table_name="Entities",
                    reference_key_name="DocumentId",
                    generated_key_name="EntityKey",
                    source="/document/entities/*",
                    inputs=[]
                ),
                KnowledgeStoreTableProjectionSelector(
                    table_name="KeyPhrases",
                    reference_key_name="DocumentId",
                    generated_key_name="PhraseKey",
                    source="/document/keyPhrases/*",
                    inputs=[]
                )
            ],
            # Blob projections
            objects=[
                KnowledgeStoreBlobProjectionSelector(
                    storage_container="enriched-documents",
                    generated_key_name="EnrichedDocKey",
                    source="/document/enriched",
                    inputs=[]
                )
            ],
            # File projections (for images)
            files=[
                KnowledgeStoreFileProjectionSelector(
                    storage_container="extracted-images",
                    generated_key_name="ImageKey",
                    source="/document/normalized_images/*",
                    inputs=[]
                )
            ]
        )
    ]
)
```

## Skillset with Knowledge Store

```python
from azure.search.documents.indexes.models import (
    SearchIndexerSkillset,
    EntityRecognitionSkill,
    KeyPhraseExtractionSkill,
    SentimentSkill,
    ShaperSkill,
    InputFieldMappingEntry,
    OutputFieldMappingEntry
)

# Define skills
entity_skill = EntityRecognitionSkill(
    name="entity-recognition",
    description="Extract entities from content",
    context="/document",
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/content")
    ],
    outputs=[
        OutputFieldMappingEntry(name="persons", target_name="persons"),
        OutputFieldMappingEntry(name="organizations", target_name="organizations"),
        OutputFieldMappingEntry(name="locations", target_name="locations")
    ],
    categories=["Person", "Organization", "Location"]
)

keyphrase_skill = KeyPhraseExtractionSkill(
    name="keyphrase-extraction",
    description="Extract key phrases",
    context="/document",
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/content")
    ],
    outputs=[
        OutputFieldMappingEntry(name="keyPhrases", target_name="keyPhrases")
    ]
)

sentiment_skill = SentimentSkill(
    name="sentiment-analysis",
    description="Analyze sentiment",
    context="/document",
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/content")
    ],
    outputs=[
        OutputFieldMappingEntry(name="sentiment", target_name="sentiment")
    ]
)

# Shaper skill to structure output for knowledge store
shaper_skill = ShaperSkill(
    name="document-shaper",
    description="Shape document for knowledge store",
    context="/document",
    inputs=[
        InputFieldMappingEntry(name="content", source="/document/content"),
        InputFieldMappingEntry(name="persons", source="/document/persons"),
        InputFieldMappingEntry(name="organizations", source="/document/organizations"),
        InputFieldMappingEntry(name="locations", source="/document/locations"),
        InputFieldMappingEntry(name="keyPhrases", source="/document/keyPhrases"),
        InputFieldMappingEntry(name="sentiment", source="/document/sentiment")
    ],
    outputs=[
        OutputFieldMappingEntry(name="output", target_name="enriched")
    ]
)

# Create skillset with knowledge store
skillset = SearchIndexerSkillset(
    name="enrichment-skillset",
    description="Skillset with knowledge store",
    skills=[entity_skill, keyphrase_skill, sentiment_skill, shaper_skill],
    knowledge_store=knowledge_store
)

indexer_client.create_or_update_skillset(skillset)
```

## Querying Knowledge Store Data

```python
from azure.data.tables import TableServiceClient
from azure.storage.blob import BlobServiceClient

# Query table projections
table_service = TableServiceClient.from_connection_string(storage_connection_string)
documents_table = table_service.get_table_client("Documents")
entities_table = table_service.get_table_client("Entities")

# Get all documents
documents = list(documents_table.list_entities())
print(f"Total documents: {len(documents)}")

# Get entities for a specific document
doc_id = documents[0]["DocumentId"]
entities = entities_table.query_entities(f"DocumentId eq '{doc_id}'")
for entity in entities:
    print(f"Entity: {entity['text']} ({entity['category']})")

# Query blob projections
blob_service = BlobServiceClient.from_connection_string(storage_connection_string)
container = blob_service.get_container_client("enriched-documents")

for blob in container.list_blobs():
    blob_client = container.get_blob_client(blob)
    content = blob_client.download_blob().readall()
    enriched_doc = json.loads(content)
    print(f"Document: {enriched_doc.get('title', 'Untitled')}")
    print(f"  Entities: {len(enriched_doc.get('entities', []))}")
    print(f"  Key Phrases: {enriched_doc.get('keyPhrases', [])[:5]}")
```

## Building a Knowledge Graph

```python
import networkx as nx
import matplotlib.pyplot as plt

def build_knowledge_graph(table_service):
    """Build a knowledge graph from knowledge store data"""
    G = nx.Graph()

    # Get all documents and entities
    documents_table = table_service.get_table_client("Documents")
    entities_table = table_service.get_table_client("Entities")

    documents = list(documents_table.list_entities())

    for doc in documents:
        doc_id = doc["DocumentId"]

        # Add document node
        G.add_node(doc_id, type="document", title=doc.get("title", ""))

        # Get entities for this document
        entities = list(entities_table.query_entities(f"DocumentId eq '{doc_id}'"))

        for entity in entities:
            entity_name = entity.get("text", "")
            entity_type = entity.get("category", "unknown")

            # Add entity node
            G.add_node(entity_name, type=entity_type)

            # Add edge between document and entity
            G.add_edge(doc_id, entity_name, relationship="mentions")

    return G

# Build and visualize
graph = build_knowledge_graph(table_service)

# Visualize
plt.figure(figsize=(15, 10))
pos = nx.spring_layout(graph)

# Color nodes by type
colors = []
for node in graph.nodes():
    node_type = graph.nodes[node].get("type", "unknown")
    if node_type == "document":
        colors.append("lightblue")
    elif node_type == "Person":
        colors.append("lightgreen")
    elif node_type == "Organization":
        colors.append("lightyellow")
    else:
        colors.append("lightgray")

nx.draw(graph, pos, node_color=colors, with_labels=True, font_size=8)
plt.savefig("knowledge_graph.png")
```

## Analytics on Enriched Data

```python
import pandas as pd
from collections import Counter

def analyze_knowledge_store(table_service):
    """Analyze enriched content from knowledge store"""

    # Load data
    entities_df = pd.DataFrame(list(
        table_service.get_table_client("Entities").list_entities()
    ))

    keyphrases_df = pd.DataFrame(list(
        table_service.get_table_client("KeyPhrases").list_entities()
    ))

    # Entity analysis
    print("=== Entity Analysis ===")
    entity_counts = entities_df["category"].value_counts()
    print(f"Entity types: {dict(entity_counts)}")

    # Top mentioned people
    people = entities_df[entities_df["category"] == "Person"]["text"].value_counts()
    print(f"\nTop mentioned people: {dict(people.head(10))}")

    # Top organizations
    orgs = entities_df[entities_df["category"] == "Organization"]["text"].value_counts()
    print(f"\nTop organizations: {dict(orgs.head(10))}")

    # Key phrase analysis
    print("\n=== Key Phrase Analysis ===")
    all_phrases = keyphrases_df["text"].value_counts()
    print(f"Top key phrases: {dict(all_phrases.head(20))}")

    return {
        "entities": entities_df,
        "keyphrases": keyphrases_df,
        "entity_counts": entity_counts,
        "top_phrases": all_phrases.head(20)
    }

# Run analysis
analysis = analyze_knowledge_store(table_service)
```

Knowledge Store enables rich analytics and knowledge graph construction from AI-enriched content.
