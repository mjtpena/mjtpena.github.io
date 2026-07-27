---
title: "Working with Projections in Azure Cognitive Search"
author: "Michael John Peña"
draft: false
date: 2022-08-27
tags: ["Azure", "Cognitive Search", "Projections", "Knowledge Store", "Data Shaping"]

---

I wrote "Working with Projections in Azure Cognitive Search" to share practical, production-minded guidance on this topic.

## Projection Types

Azure Cognitive Search supports three projection types:

1. **Table Projections**: Store data in Azure Table Storage
2. **Object Projections**: Store JSON documents in Blob Storage
3. **File Projections**: Store binary files (images) in Blob Storage

## Table Projections

```python
from azure.search.documents.indexes.models import (
    KnowledgeStore,
    KnowledgeStoreProjection,
    KnowledgeStoreTableProjectionSelector
)

# Define multiple related tables
table_projections = [
    # Main document table
    KnowledgeStoreTableProjectionSelector(
        table_name="Documents",
        reference_key_name="DocumentKey",
        generated_key_name="DocumentId",
        source="/document/documentRecord"
    ),
    # One-to-many: Entities per document
    KnowledgeStoreTableProjectionSelector(
        table_name="DocumentEntities",
        reference_key_name="DocumentKey",  # Links to Documents table
        generated_key_name="EntityId",
        source="/document/entities/*"  # Flattens array
    ),
    # One-to-many: Sentences per document
    KnowledgeStoreTableProjectionSelector(
        table_name="DocumentSentences",
        reference_key_name="DocumentKey",
        generated_key_name="SentenceId",
        source="/document/sentences/*"
    ),
    # One-to-many: Key phrases per document
    KnowledgeStoreTableProjectionSelector(
        table_name="DocumentKeyPhrases",
        reference_key_name="DocumentKey",
        generated_key_name="PhraseId",
        source="/document/keyPhrases/*"
    )
]
```

## Shaping Data for Projections

```python
from azure.search.documents.indexes.models import (
    ShaperSkill,
    InputFieldMappingEntry,
    OutputFieldMappingEntry
)

# Shaper skill to create structured output
document_shaper = ShaperSkill(
    name="document-shaper",
    description="Shape document data for projections",
    context="/document",
    inputs=[
        # Simple fields
        InputFieldMappingEntry(name="id", source="/document/id"),
        InputFieldMappingEntry(name="title", source="/document/title"),
        InputFieldMappingEntry(name="content", source="/document/content"),

        # Enriched fields
        InputFieldMappingEntry(name="language", source="/document/language"),
        InputFieldMappingEntry(name="sentiment", source="/document/sentiment"),

        # Complex nested structure
        InputFieldMappingEntry(
            name="metadata",
            source_context="/document",
            inputs=[
                InputFieldMappingEntry(name="author", source="/document/author"),
                InputFieldMappingEntry(name="publishDate", source="/document/publishDate"),
                InputFieldMappingEntry(name="category", source="/document/category")
            ]
        )
    ],
    outputs=[
        OutputFieldMappingEntry(name="output", target_name="documentRecord")
    ]
)

# Shaper for entity array
entity_shaper = ShaperSkill(
    name="entity-shaper",
    description="Shape entities for projection",
    context="/document/recognized_entities/*",
    inputs=[
        InputFieldMappingEntry(name="text", source="/document/recognized_entities/*/text"),
        InputFieldMappingEntry(name="category", source="/document/recognized_entities/*/category"),
        InputFieldMappingEntry(name="confidence", source="/document/recognized_entities/*/confidenceScore"),
        InputFieldMappingEntry(name="offset", source="/document/recognized_entities/*/offset"),
        InputFieldMappingEntry(name="length", source="/document/recognized_entities/*/length")
    ],
    outputs=[
        OutputFieldMappingEntry(name="output", target_name="entities")
    ]
)
```

## Object Projections (Blob)

```python
from azure.search.documents.indexes.models import KnowledgeStoreBlobProjectionSelector

# Object projection for full enriched documents
object_projections = [
    # Full enriched document as JSON
    KnowledgeStoreBlobProjectionSelector(
        storage_container="enriched-documents",
        generated_key_name="EnrichedDocId",
        source="/document/enrichedDocument"
    ),
    # Extracted summaries
    KnowledgeStoreBlobProjectionSelector(
        storage_container="document-summaries",
        generated_key_name="SummaryId",
        source="/document/summary"
    ),
    # Entity extractions as separate files
    KnowledgeStoreBlobProjectionSelector(
        storage_container="entity-extractions",
        generated_key_name="EntityExtractionId",
        source="/document/entityExtraction"
    )
]

# Shaper for enriched document blob
enriched_doc_shaper = ShaperSkill(
    name="enriched-document-shaper",
    context="/document",
    inputs=[
        InputFieldMappingEntry(name="id", source="/document/id"),
        InputFieldMappingEntry(name="content", source="/document/content"),
        InputFieldMappingEntry(name="entities", source="/document/entities"),
        InputFieldMappingEntry(name="keyPhrases", source="/document/keyPhrases"),
        InputFieldMappingEntry(name="sentiment", source="/document/sentiment"),
        InputFieldMappingEntry(name="language", source="/document/language"),
        InputFieldMappingEntry(name="piiEntities", source="/document/piiEntities"),
        InputFieldMappingEntry(name="linkedEntities", source="/document/linkedEntities")
    ],
    outputs=[
        OutputFieldMappingEntry(name="output", target_name="enrichedDocument")
    ]
)
```

## File Projections (Images)

```python
from azure.search.documents.indexes.models import KnowledgeStoreFileProjectionSelector

# File projections for images
file_projections = [
    # Original normalized images
    KnowledgeStoreFileProjectionSelector(
        storage_container="document-images",
        generated_key_name="ImageId",
        source="/document/normalized_images/*"
    ),
    # OCR-processed image regions
    KnowledgeStoreFileProjectionSelector(
        storage_container="ocr-regions",
        generated_key_name="OcrRegionId",
        source="/document/normalized_images/*/regions/*"
    )
]
```

## Complete Knowledge Store Configuration

```python
knowledge_store = KnowledgeStore(
    storage_connection_string=storage_connection_string,
    projections=[
        KnowledgeStoreProjection(
            tables=table_projections,
            objects=object_projections,
            files=file_projections
        )
    ]
)

# Create skillset with all projections
skillset = SearchIndexerSkillset(
    name="comprehensive-skillset",
    description="Skillset with complete knowledge store projections",
    skills=[
        # Cognitive skills
        entity_recognition_skill,
        keyphrase_skill,
        sentiment_skill,
        language_detection_skill,
        pii_detection_skill,

        # Shapers for projections
        document_shaper,
        entity_shaper,
        enriched_doc_shaper
    ],
    knowledge_store=knowledge_store
)

indexer_client.create_or_update_skillset(skillset)
```

## Querying Projected Data

```python
from azure.data.tables import TableServiceClient
from azure.storage.blob import BlobServiceClient

class KnowledgeStoreClient:
    def __init__(self, storage_connection_string):
        self.table_service = TableServiceClient.from_connection_string(storage_connection_string)
        self.blob_service = BlobServiceClient.from_connection_string(storage_connection_string)

    def get_document_with_entities(self, document_key):
        """Get document with all related entities"""
        # Get main document
        docs_table = self.table_service.get_table_client("Documents")
        doc = docs_table.get_entity(partition_key="", row_key=document_key)

        # Get related entities
        entities_table = self.table_service.get_table_client("DocumentEntities")
        entities = list(entities_table.query_entities(
            f"DocumentKey eq '{document_key}'"
        ))

        # Get key phrases
        phrases_table = self.table_service.get_table_client("DocumentKeyPhrases")
        phrases = list(phrases_table.query_entities(
            f"DocumentKey eq '{document_key}'"
        ))

        return {
            "document": doc,
            "entities": entities,
            "keyPhrases": phrases
        }

    def get_enriched_document_blob(self, blob_name):
        """Get full enriched document from blob storage"""
        container = self.blob_service.get_container_client("enriched-documents")
        blob_client = container.get_blob_client(blob_name)
        content = blob_client.download_blob().readall()
        return json.loads(content)

    def get_documents_by_entity(self, entity_text, entity_type=None):
        """Find all documents mentioning a specific entity"""
        entities_table = self.table_service.get_table_client("DocumentEntities")

        query = f"text eq '{entity_text}'"
        if entity_type:
            query += f" and category eq '{entity_type}'"

        entities = list(entities_table.query_entities(query))
        document_keys = set(e["DocumentKey"] for e in entities)

        # Get full documents
        docs_table = self.table_service.get_table_client("Documents")
        documents = [
            docs_table.get_entity(partition_key="", row_key=key)
            for key in document_keys
        ]

        return documents

# Usage
client = KnowledgeStoreClient(storage_connection_string)

# Get document with all enrichments
doc_data = client.get_document_with_entities("doc-123")
print(f"Document: {doc_data['document']['title']}")
print(f"Entities: {len(doc_data['entities'])}")

# Find documents mentioning a person
docs = client.get_documents_by_entity("Microsoft", "Organization")
print(f"Documents mentioning Microsoft: {len(docs)}")
```

Projections enable flexible storage and querying of AI-enriched content for various downstream use cases.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
