---
title: "Enrichment Cache in Azure Cognitive Search"
author: "Michael John Peña"
draft: false
date: 2022-08-28
tags: ["Azure", "Cognitive Search", "Enrichment", "Cache", "Performance"]

---

I wrote "Enrichment Cache in Azure Cognitive Search" to share practical, production-minded guidance on this topic.

## Understanding Enrichment Cache

Benefits of caching:
- **Cost reduction**: Avoid re-processing unchanged documents
- **Faster re-indexing**: Skip AI calls for cached content
- **Incremental updates**: Only process new or modified documents
- **Development efficiency**: Iterate on skillsets without re-running all enrichments

## Enabling Cache

```python
from azure.search.documents.indexes import SearchIndexerClient
from azure.search.documents.indexes.models import (
    SearchIndexer,
    SearchIndexerCache
)
from azure.core.credentials import AzureKeyCredential

endpoint = "https://mysearchservice.search.windows.net"
credential = AzureKeyCredential("your-admin-key")

indexer_client = SearchIndexerClient(endpoint=endpoint, credential=credential)

# Create indexer with cache enabled
indexer = SearchIndexer(
    name="enrichment-indexer",
    description="Indexer with enrichment caching",
    data_source_name="my-datasource",
    target_index_name="my-index",
    skillset_name="my-skillset",
    cache=SearchIndexerCache(
        storage_connection_string="DefaultEndpointsProtocol=https;AccountName=...",
        enable_reprocessing=True
    )
)

indexer_client.create_or_update_indexer(indexer)
```

## Cache Configuration Options

```python
# Full cache configuration
cache_config = SearchIndexerCache(
    # Required: Storage connection
    storage_connection_string=storage_connection_string,

    # Enable incremental processing
    enable_reprocessing=True,

    # Cache identity (for managed identity)
    identity=None  # Or specify managed identity
)

# Update existing indexer to enable cache
existing_indexer = indexer_client.get_indexer("my-indexer")
existing_indexer.cache = cache_config
indexer_client.create_or_update_indexer(existing_indexer)
```

## How Cache Works

```python
"""
Cache behavior:

1. First run:
   - All documents processed through skillset
   - Enrichments stored in cache

2. Subsequent runs:
   - Check document for changes (using etag/timestamp)
   - If unchanged: retrieve enrichments from cache
   - If changed: re-process through skillset

3. Skillset changes:
   - Only affected skills re-run
   - Downstream skills use cached upstream outputs
"""

# Example: Adding a new skill
# Before: entity_skill -> keyphrase_skill -> index
# After: entity_skill -> keyphrase_skill -> sentiment_skill -> index

# Only sentiment_skill runs for existing documents
# entity_skill and keyphrase_skill results come from cache
```

## Monitoring Cache Usage

```python
import requests

def get_indexer_status(indexer_name):
    """Get indexer status including cache metrics"""
    url = f"{endpoint}/indexers/{indexer_name}/status?api-version=2021-04-30-Preview"
    headers = {"api-key": api_key}

    response = requests.get(url, headers=headers)
    status = response.json()

    # Extract cache metrics
    last_run = status.get("lastResult", {})

    return {
        "status": last_run.get("status"),
        "items_processed": last_run.get("itemsProcessed"),
        "items_failed": last_run.get("itemsFailed"),
        "initial_tracking_state": last_run.get("initialTrackingState"),
        "final_tracking_state": last_run.get("finalTrackingState"),

        # Cache-specific metrics
        "cached_documents": last_run.get("cachedDocuments", 0),
        "cache_hits": last_run.get("cacheHits", 0),
        "cache_misses": last_run.get("cacheMisses", 0)
    }

# Check status
status = get_indexer_status("enrichment-indexer")
print(f"Processed: {status['items_processed']}")
print(f"Cache hits: {status['cache_hits']}")
print(f"Cache misses: {status['cache_misses']}")
```

## Invalidating Cache

```python
# Reset indexer (clears cache and re-processes all)
indexer_client.reset_indexer("enrichment-indexer")

# Run indexer after reset
indexer_client.run_indexer("enrichment-indexer")

# Selective invalidation by running specific documents
def reprocess_documents(indexer_name, document_keys):
    """Force reprocessing of specific documents"""
    # Reset document tracking state
    url = f"{endpoint}/indexers/{indexer_name}/resetDocs?api-version=2021-04-30-Preview"
    headers = {"api-key": api_key, "Content-Type": "application/json"}

    body = {
        "documentKeys": document_keys
    }

    response = requests.post(url, headers=headers, json=body)
    return response.status_code == 204

# Reprocess specific documents
reprocess_documents("enrichment-indexer", ["doc1", "doc2", "doc3"])
```

## Cache with Skillset Updates

```python
# Scenario: Adding a new skill

# Original skillset
original_skills = [entity_skill, keyphrase_skill]

# Updated skillset with new skill
updated_skills = [entity_skill, keyphrase_skill, sentiment_skill]

# Update skillset
skillset = SearchIndexerSkillset(
    name="my-skillset",
    skills=updated_skills,
    cognitive_services_account=cognitive_services_key
)
indexer_client.create_or_update_skillset(skillset)

# Run indexer - only sentiment_skill processes documents
# entity_skill and keyphrase_skill use cached results
indexer_client.run_indexer("enrichment-indexer")
```

## Best Practices

```python
class CacheOptimizedIndexer:
    """Best practices for enrichment caching"""

    def __init__(self, indexer_client, indexer_name):
        self.client = indexer_client
        self.indexer_name = indexer_name

    def setup_optimal_cache(self, storage_connection):
        """Configure cache with optimal settings"""
        indexer = self.client.get_indexer(self.indexer_name)

        indexer.cache = SearchIndexerCache(
            storage_connection_string=storage_connection,
            enable_reprocessing=True
        )

        # Configure change tracking
        indexer.parameters = {
            "configuration": {
                # Enable high-water mark change detection
                "dataChangeDetectionPolicy": {
                    "@odata.type": "#Microsoft.Azure.Search.HighWaterMarkChangeDetectionPolicy",
                    "highWaterMarkColumnName": "_ts"  # or your timestamp column
                },
                # Enable soft delete detection
                "dataDeletionDetectionPolicy": {
                    "@odata.type": "#Microsoft.Azure.Search.SoftDeleteColumnDeletionDetectionPolicy",
                    "softDeleteColumnName": "isDeleted",
                    "softDeleteMarkerValue": "true"
                }
            }
        }

        self.client.create_or_update_indexer(indexer)

    def incremental_update(self):
        """Run incremental update using cache"""
        # Just run the indexer - it automatically uses cache
        self.client.run_indexer(self.indexer_name)

    def full_rebuild(self):
        """Force full rebuild (clears cache)"""
        self.client.reset_indexer(self.indexer_name)
        self.client.run_indexer(self.indexer_name)

    def get_cache_efficiency(self):
        """Calculate cache efficiency"""
        status = get_indexer_status(self.indexer_name)

        total = status['cache_hits'] + status['cache_misses']
        if total == 0:
            return 0

        return status['cache_hits'] / total * 100

# Usage
optimizer = CacheOptimizedIndexer(indexer_client, "enrichment-indexer")
optimizer.setup_optimal_cache(storage_connection_string)

# Run incremental update
optimizer.incremental_update()

# Check efficiency
efficiency = optimizer.get_cache_efficiency()
print(f"Cache efficiency: {efficiency:.1f}%")
```

Enrichment cache significantly reduces costs and improves performance for AI-enriched search solutions.\n\n## Takeaways\n\n*Add a concise, personal takeaway and recommended next steps here.*\n
