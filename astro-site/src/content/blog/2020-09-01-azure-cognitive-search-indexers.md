---
title: "Azure Cognitive Search Indexers for Document Processing"
author: Michael John Peña
draft: false
date: 2020-09-01
tags:
  - Azure
  - Cognitive Search
  - AI
  - Document Processing
---

Most "search" tutorials I see stop at "create an index, push some JSON, query it." That's the easy 10%. The 90% that matters in real projects is the indexer pipeline — the bit that pulls data out of your sources, runs cognitive skills over it, and keeps the index in sync as content changes. Indexers, datasources, and skillsets together turn Cognitive Search from a Lucene wrapper into a small ETL platform that happens to also do search.

## The Indexer Pipeline

```
Data Source → Skillset (AI Enrichment) → Index → Search Queries
```

## Creating an Indexer

```json
{
  "name": "document-indexer",
  "dataSourceName": "blob-documents",
  "targetIndexName": "documents-index",
  "skillsetName": "document-skills",
  "schedule": {
    "interval": "PT2H"
  },
  "parameters": {
    "configuration": {
      "dataToExtract": "contentAndMetadata",
      "parsingMode": "default"
    }
  },
  "fieldMappings": [
    {"sourceFieldName": "metadata_storage_path", "targetFieldName": "id"},
    {"sourceFieldName": "metadata_storage_name", "targetFieldName": "filename"}
  ],
  "outputFieldMappings": [
    {"sourceFieldName": "/document/content", "targetFieldName": "content"},
    {"sourceFieldName": "/document/keyphrases", "targetFieldName": "keyphrases"},
    {"sourceFieldName": "/document/entities", "targetFieldName": "entities"}
  ]
}
```

## AI Skillset

```json
{
  "name": "document-skills",
  "skills": [
    {
      "@odata.type": "#Microsoft.Skills.Text.KeyPhraseExtractionSkill",
      "inputs": [{"name": "text", "source": "/document/content"}],
      "outputs": [{"name": "keyPhrases", "targetName": "keyphrases"}]
    },
    {
      "@odata.type": "#Microsoft.Skills.Text.EntityRecognitionSkill",
      "categories": ["Organization", "Person", "Location"],
      "inputs": [{"name": "text", "source": "/document/content"}],
      "outputs": [{"name": "entities", "targetName": "entities"}]
    }
  ]
}
```

Now every document uploaded to blob storage is automatically indexed with AI-extracted metadata.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
