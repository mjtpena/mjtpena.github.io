---
title: "Azure AI Search Index Management: Operations and Maintenance"
description: "Production search indexes require operational discipline. From index versioning to blue-green deploys, these are the ops patterns I use to avoid downtime…"
author: Michael John Peña
draft: false
date: 2024-01-28
tags:
  - Azure AI Search
  - Index Management
  - Operations
  - DevOps
  - Search
---

Production search indexes require operational discipline. From index versioning to blue-green deploys, these are the ops patterns I use to avoid downtime and regressions.

## Index Lifecycle Management

### Creating Indexes

```python
from azure.search.documents.indexes import SearchIndexClient
from azure.search.documents.indexes.models import SearchIndex

def create_index_with_versioning(base_name: str, version: str):
    """Create versioned index for zero-downtime updates."""

    index_name = f"{base_name}-v{version}"

    index = SearchIndex(
        name=index_name,
        fields=[...],
        vector_search=vector_search_config,
        semantic_search=semantic_config
    )

    index_client.create_index(index)

    return index_name

# Blue-green deployment pattern
current_version = "2"
new_version = "3"

# Create new index
new_index = create_index_with_versioning("documents", new_version)

# Populate new index
populate_index(new_index)

# Update alias (if using alias pattern)
update_alias("documents-current", new_index)

# Delete old index after validation
delete_old_index(f"documents-v{current_version}")
```

### Index Updates

```python
def update_index_fields(index_name: str, new_fields: list):
    """Add new fields to existing index (additive only)."""

    current_index = index_client.get_index(index_name)

    # Add new fields (can't modify existing)
    for field in new_fields:
        current_index.fields.append(field)

    index_client.create_or_update_index(current_index)

# Adding a new field
new_field = SearchField(
    name="category",
    type="Edm.String",
    filterable=True,
    facetable=True
)
update_index_fields("documents", [new_field])
```

## Document Operations

### Bulk Operations

```python
from azure.search.documents import SearchIndexingBufferedSender

def bulk_upload_documents(documents: list, batch_size: int = 1000):
    """Efficiently upload large document sets."""

    with SearchIndexingBufferedSender(
        endpoint=endpoint,
        index_name=index_name,
        credential=credential
    ) as batch_client:
        batch_client.upload_documents(documents)

# For very large uploads
def chunked_upload(documents: list, chunk_size: int = 10000):
    """Upload in chunks with progress tracking."""

    total = len(documents)

    for i in range(0, total, chunk_size):
        chunk = documents[i:i + chunk_size]
        bulk_upload_documents(chunk)
        print(f"Uploaded {min(i + chunk_size, total)}/{total}")
```

### Delete Operations

```python
def delete_documents_by_filter(filter_condition: str):
    """Delete documents matching a filter."""

    # Search for matching documents
    results = search_client.search(
        search_text="*",
        filter=filter_condition,
        select=["id"],
        top=1000
    )

    # Delete in batches
    to_delete = [{"id": r["id"]} for r in results]
    search_client.delete_documents(to_delete)

# Example: Delete old documents
delete_documents_by_filter("lastModified lt 2024-01-01T00:00:00Z")
```

## Monitoring and Statistics

```python
def get_index_health(index_name: str):
    """Get comprehensive index health metrics."""

    stats = index_client.get_index_statistics(index_name)
    index = index_client.get_index(index_name)

    return {
        "name": index_name,
        "document_count": stats.document_count,
        "storage_size_mb": stats.storage_size / (1024 * 1024),
        "vector_index_size_mb": getattr(stats, 'vector_index_size', 0) / (1024 * 1024),
        "field_count": len(index.fields),
        "searchable_fields": len([f for f in index.fields if f.searchable]),
        "vector_fields": len([f for f in index.fields if f.vector_search_dimensions])
    }

def monitor_indexer_status(indexer_name: str):
    """Monitor indexer execution status."""

    status = indexer_client.get_indexer_status(indexer_name)

    return {
        "last_run": status.last_result.start_time if status.last_result else None,
        "status": status.last_result.status if status.last_result else "never_run",
        "documents_processed": status.last_result.items_processed if status.last_result else 0,
        "errors": status.last_result.errors if status.last_result else []
    }
```

## Automation with CI/CD

```yaml
# Azure DevOps pipeline for index management
trigger:
  branches:
    include:
      - main
  paths:
    include:
      - search/schemas/*

stages:
  - stage: Deploy
    jobs:
      - job: UpdateIndex
        steps:
          - task: AzureCLI@2
            inputs:
              azureSubscription: 'search-subscription'
              scriptType: 'bash'
              scriptLocation: 'inlineScript'
              inlineScript: |
                # Create or update index
                python scripts/deploy_index.py \
                  --service $SEARCH_SERVICE \
                  --index-definition search/schemas/documents.json

          - task: AzureCLI@2
            inputs:
              scriptType: 'bash'
              inlineScript: |
                # Run indexer
                python scripts/run_indexer.py \
                  --service $SEARCH_SERVICE \
                  --indexer documents-indexer

          - task: AzureCLI@2
            inputs:
              scriptType: 'bash'
              inlineScript: |
                # Validate
                python scripts/validate_index.py \
                  --service $SEARCH_SERVICE \
                  --index documents \
                  --min-docs 1000
```

## Best Practices

1. **Version your indexes** for zero-downtime updates
2. **Use buffered senders** for bulk operations
3. **Monitor statistics** regularly
4. **Automate with CI/CD** for consistency
5. **Set up alerts** for indexer failures
6. **Plan capacity** based on document growth

## Conclusion

Effective index management ensures reliable, performant search. Automate operations, monitor health, and plan for growth to maintain production-grade search infrastructure.
